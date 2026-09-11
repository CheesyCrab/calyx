// Wormtide — deterministic adaptation of Godot's swarmflow cart.
// Q8 is persistent state; bounded guest f64 steering quantizes back each frame.

import {
  run_start, run_update, frame, clear, use_palette,
  px_pixel, px_rect, px_rect_outline, px_line, px_circle_outline,
  px_text, px_text_centered, trace,
  input_x, input_y, a_pressed, start_pressed,
  seed, rand_range, sfx, round_i32, Vec2i,
} from "../../sdk/assembly/index";

const TITLE: i32 = 0;
const PLAY: i32 = 1;
const WIN: i32 = 2;
const LOSE: i32 = 3;
const FP: i32 = 256;
const COUNT: i32 = 60;
const MAX_SPEED: f64 = 1.0; // 60 px/s at 60 Hz
const SEEK_ACCEL: f64 = 80.0 / 3600.0;
const SEP_ACCEL: f64 = 120.0 / 3600.0;
const SEP_R2: i64 = <i64>(10 * FP) * <i64>(10 * FP);
const COMBAT_R2: i64 = <i64>(6 * FP) * <i64>(6 * FP);
const VISION_R2: i64 = <i64>(15 * FP) * <i64>(15 * FP);
const AGGRO_R2: i64 = <i64>(100 * FP) * <i64>(100 * FP);
const PING_STEP: i32 = 2 * FP;
const PING_MAX: i32 = 160 * FP;
const PING_BAND: i32 = 12 * FP;
const CURSOR_STEP: i32 = 427; // ~100 px/s
const DISTANCE_FROM = new Vec2i();
const DISTANCE_TO = new Vec2i();

class Worm {
  x: i32;
  y: i32;
  vx: i32 = 0;
  vy: i32 = 0;
  alive: bool = true;
  reveal: i32 = 0;
  constructor(x: i32, y: i32) { this.x = x; this.y = y; }
}

class Ping {
  x: i32;
  y: i32;
  radius: i32 = 0;
  constructor(x: i32, y: i32) { this.x = x; this.y = y; }
}

class Spark {
  x: i32;
  y: i32;
  age: i32 = 0;
  constructor(x: i32, y: i32) { this.x = x; this.y = y; }
}

let state: i32 = TITLE;
let players: Worm[] = [];
let enemies: Worm[] = [];
let pings: Ping[] = [];
let sparks: Spark[] = [];
let cursor_x: i32 = 80 * FP;
let cursor_y: i32 = 120 * FP;
let ai_x: i32 = 240 * FP;
let ai_y: i32 = 120 * FP;
let ai_timer: i32 = 0;
let ping_timer: i32 = 0;
let reveal_sound_timer: i32 = 0;
let elapsed: i32 = 0;
let casualties: i32 = 0;
let pings_fired: i32 = 0;
let last_player_count: i32 = COUNT;
let last_enemy_count: i32 = COUNT;

function dist2(ax: i32, ay: i32, bx: i32, by: i32): i64 {
  return DISTANCE_FROM.set(ax, ay).distance_squared_to(DISTANCE_TO.set(bx, by));
}

function q8_to_f64(value: i32): f64 { return <f64>value / FP; }
function q8_from_f64_round(value: f64): i32 { return round_i32(value * FP); }
function length_f64(x: f64, y: f64): f64 { return Math.sqrt(x * x + y * y); }

function clamp_q8(value: i32, low: i32, high: i32): i32 {
  return value < low ? low : (value > high ? high : value);
}

function inside_combat_range(distance_squared: i64): bool {
  return distance_squared < COMBAT_R2;
}

function inside_vision_range(distance_squared: i64): bool {
  return distance_squared <= VISION_R2;
}

function logic_self_test(): void {
  assert(q8_from_f64_round(MAX_SPEED) == FP);
  assert(clamp_q8(3 * FP, 4 * FP, 315 * FP) == 4 * FP);
  assert(clamp_q8(316 * FP, 4 * FP, 315 * FP) == 315 * FP);
  assert(inside_combat_range(COMBAT_R2 - 1) && !inside_combat_range(COMBAT_R2));
  assert(inside_vision_range(VISION_R2) && !inside_vision_range(VISION_R2 + 1));
}

function spawn_swarm(cx: i32, cy: i32): Worm[] {
  const out: Worm[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(new Worm(
      (cx + rand_range(-20, 21)) * FP,
      (cy + rand_range(-20, 21)) * FP,
    ));
  }
  return out;
}

function reset_game(): void {
  seed(0x57a24f10);
  players = spawn_swarm(60, 120);
  enemies = spawn_swarm(260, 120);
  pings = [];
  sparks = [];
  cursor_x = 80 * FP; cursor_y = 120 * FP;
  ai_x = 240 * FP; ai_y = 120 * FP;
  ai_timer = 0; ping_timer = 0; reveal_sound_timer = 0;
  elapsed = 0; casualties = 0; pings_fired = 0;
  last_player_count = COUNT; last_enemy_count = COUNT;
}

function count_alive(swarm: Worm[]): i32 {
  let count = 0;
  for (let i = 0; i < swarm.length; i++) if (swarm[i].alive) count++;
  return count;
}

function centroid(swarm: Worm[]): i64 {
  let sx: i64 = 0, sy: i64 = 0, n: i64 = 0;
  for (let i = 0; i < swarm.length; i++) {
    const w = swarm[i];
    if (!w.alive) continue;
    sx += w.x; sy += w.y; n++;
  }
  if (n == 0) return (<i64>(160 * FP) << 32) | <u32>(120 * FP);
  return (<i64>(<i32>(sx / n)) << 32) | <u32>(<i32>(sy / n));
}

function steer(swarm: Worm[], tx: i32, ty: i32): void {
  for (let i = 0; i < swarm.length; i++) {
    const w = swarm[i];
    if (!w.alive) continue;
    const px = q8_to_f64(w.x), py = q8_to_f64(w.y);
    let ax: f64 = 0.0, ay: f64 = 0.0;
    let dx = q8_to_f64(tx) - px, dy = q8_to_f64(ty) - py;
    let d = length_f64(dx, dy);
    if (d > 0.0001) { ax += dx / d * SEEK_ACCEL; ay += dy / d * SEEK_ACCEL; }
    let sx: f64 = 0.0, sy: f64 = 0.0;
    for (let j = 0; j < swarm.length; j++) {
      if (i == j || !swarm[j].alive) continue;
      if (dist2(w.x, w.y, swarm[j].x, swarm[j].y) >= SEP_R2) continue;
      dx = px - q8_to_f64(swarm[j].x);
      dy = py - q8_to_f64(swarm[j].y);
      d = length_f64(dx, dy);
      if (d > 0.0001) { sx += dx / (d * d); sy += dy / (d * d); }
    }
    ax += sx * SEP_ACCEL; ay += sy * SEP_ACCEL;
    let vx = q8_to_f64(w.vx) + ax, vy = q8_to_f64(w.vy) + ay;
    const speed = length_f64(vx, vy);
    if (speed > MAX_SPEED) { vx /= speed; vy /= speed; }
    w.vx = q8_from_f64_round(vx);
    w.vy = q8_from_f64_round(vy);
    w.x += w.vx; w.y += w.vy;
    const lo = 2 * FP, hi_x = 317 * FP, hi_y = 237 * FP;
    if (w.x < lo) { w.x = lo; w.vx = 0; }
    if (w.x > hi_x) { w.x = hi_x; w.vx = 0; }
    if (w.y < lo) { w.y = lo; w.vy = 0; }
    if (w.y > hi_y) { w.y = hi_y; w.vy = 0; }
  }
}

function update_ai(): void {
  ai_timer--;
  if (ai_timer > 0) return;
  ai_timer = 180;
  const pc = centroid(players), ec = centroid(enemies);
  const px = <i32>(pc >> 32), py = <i32>pc;
  const ex = <i32>(ec >> 32), ey = <i32>ec;
  if (dist2(px, py, ex, ey) < AGGRO_R2) { ai_x = px; ai_y = py; }
  else { ai_x = 240 * FP; ai_y = 120 * FP; }
}

function emit_ping(): void {
  const c = centroid(players);
  pings.push(new Ping(<i32>(c >> 32), <i32>c));
  ping_timer = 120; pings_fired++;
  sfx("powerup");
}

function update_reveal(): void {
  let newly_revealed = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.reveal > 0) e.reveal--;
    if (!e.alive) continue;
    let seen = false;
    for (let j = 0; j < players.length && !seen; j++) {
      const p = players[j];
      if (p.alive && inside_vision_range(dist2(p.x, p.y, e.x, e.y))) seen = true;
    }
    for (let k = 0; k < pings.length && !seen; k++) {
      const ping = pings[k];
      const d2 = dist2(ping.x, ping.y, e.x, e.y);
      const inner = ping.radius > PING_BAND ? ping.radius - PING_BAND : 0;
      if (d2 >= <i64>inner * inner && d2 <= <i64>ping.radius * ping.radius) seen = true;
    }
    if (seen) { if (e.reveal == 0) newly_revealed++; e.reveal = 180; }
  }
  if (newly_revealed > 0 && reveal_sound_timer == 0) {
    sfx("blip"); reveal_sound_timer = 12;
  }
  for (let i = pings.length - 1; i >= 0; i--) {
    pings[i].radius += PING_STEP;
    if (pings[i].radius > PING_MAX) pings.splice(i, 1);
  }
}

function resolve_combat(): void {
  let hits = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.alive) continue;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!e.alive) continue;
      if (inside_combat_range(dist2(p.x, p.y, e.x, e.y))) {
        p.alive = false; e.alive = false; e.reveal = 0;
        sparks.push(new Spark((p.x + e.x) / 2, (p.y + e.y) / 2));
        hits++; casualties += 2; break;
      }
    }
  }
  if (hits > 0) sfx("hit");
  for (let i = sparks.length - 1; i >= 0; i--) {
    sparks[i].age++;
    if (sparks[i].age > 18) sparks.splice(i, 1);
  }
}

function process_play(): void {
  elapsed++;
  cursor_x += input_x() * CURSOR_STEP;
  cursor_y += input_y() * CURSOR_STEP;
  cursor_x = clamp_q8(cursor_x, 4 * FP, 315 * FP);
  cursor_y = clamp_q8(cursor_y, 12 * FP, 235 * FP);
  if (ping_timer > 0) ping_timer--;
  if (reveal_sound_timer > 0) reveal_sound_timer--;
  if (a_pressed() && ping_timer == 0) emit_ping();
  steer(players, cursor_x, cursor_y);
  update_ai();
  steer(enemies, ai_x, ai_y);
  update_reveal();
  resolve_combat();
  const pc = count_alive(players), ec = count_alive(enemies);
  if (pc != last_player_count || ec != last_enemy_count) {
    trace("battle p=" + pc.toString() + " e=" + ec.toString());
    last_player_count = pc; last_enemy_count = ec;
  }
  if (ec == 0) { state = WIN; trace("outcome=win frames=" + elapsed.toString()); sfx("fanfare"); }
  else if (pc == 0) { state = LOSE; trace("outcome=lose frames=" + elapsed.toString()); sfx("death"); }
}

function cart_ready(): void {
  logic_self_test();
  use_palette("GAMEBOY");
  reset_game();
  trace("state=title");
}

function cart_process(): void {
  if (state == TITLE) {
    if (a_pressed() || start_pressed()) { reset_game(); state = PLAY; trace("state=play p=60 e=60"); }
  } else if (state == PLAY) process_play();
  else if (a_pressed() || start_pressed()) { state = TITLE; trace("state=title"); }
}

function draw_worm(w: Worm, color: i32, index: i32): void {
  const x = w.x / FP, y = w.y / FP;
  const tx = x - w.vx * 4 / FP, ty = y - w.vy * 4 / FP;
  if (w.vx != 0 || w.vy != 0) px_line(x, y, tx, ty, color);
  px_pixel(x, y, color);
  if (((index + frame() / 8) & 7) == 0) px_pixel(x, y - 1, color);
}

function draw_play(): void {
  // Sparse attractor trail turns movement into a readable command gesture.
  for (let i = 1; i <= 4; i++) {
    const x = cursor_x / FP - input_x() * i * 5;
    const y = cursor_y / FP - input_y() * i * 5;
    if (((frame() / 3 + i) & 1) == 0) px_pixel(x, y, 1);
  }
  for (let i = 0; i < pings.length; i++) {
    const p = pings[i], r = p.radius / FP;
    if (r > 16) px_circle_outline(p.x / FP, p.y / FP, r - 16, 1);
    if (r > 8) px_circle_outline(p.x / FP, p.y / FP, r - 8, 1);
    px_circle_outline(p.x / FP, p.y / FP, r, 2);
  }
  for (let i = 0; i < players.length; i++) if (players[i].alive) draw_worm(players[i], 2, i);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]; if (!e.alive || e.reveal == 0) continue;
    draw_worm(e, e.reveal > 120 ? 3 : e.reveal > 60 ? 2 : 1, i);
  }
  for (let i = 0; i < sparks.length; i++) {
    const s = sparks[i], x = s.x / FP, y = s.y / FP, d = s.age / 5 + 1;
    const c = s.age < 9 ? 3 : 1;
    px_pixel(x + d, y, c); px_pixel(x - d, y, c); px_pixel(x, y + d, c);
  }
  const cx = cursor_x / FP, cy = cursor_y / FP;
  const pulse = 4 + <i32>((frame() / 6) % 3);
  px_circle_outline(cx, cy, pulse, 3);
  px_line(cx - 2, cy, cx + 2, cy, 3); px_line(cx, cy - 2, cx, cy + 2, 3);
  const ready = 40 * (120 - ping_timer) / 120;
  px_rect(4, 4, ready, 4, ping_timer == 0 ? 2 : 1);
  px_rect_outline(4, 4, 40, 4, 1);
  px_text(4, 12, "TIDE " + count_alive(players).toString(), 2);
  px_text(259, 12, "ECHO " + count_alive(enemies).toString(), 1);
  px_text_centered(160, 4, ping_timer == 0 ? "A:SONAR READY" : "RECHARGING", ping_timer == 0 ? 3 : 1);
}

function draw_title(): void {
  px_text_centered(160, 48, "WORMTIDE", 3, 2);
  px_text_centered(160, 74, "ECHOES IN THE DARK", 2);
  for (let i = 0; i < 17; i++) {
    const x = 89 + i * 4, y = 119 + ((i * 7) % 17) - 8;
    px_pixel(x, y, 2); if ((i & 3) == 0) px_pixel(231 - i * 4, 120 - ((i * 5) % 15), 1);
  }
  const r = 18 + <i32>((frame() / 4) % 28);
  px_circle_outline(160, 120, r, r > 35 ? 1 : 2);
  px_text_centered(160, 174, "60 SIGNALS. 60 SHADOWS.", 1);
  if (((frame() / 30) & 1) == 0) px_text_centered(160, 204, "A / START: DESCEND", 3);
}

function draw_end(): void {
  const won = state == WIN;
  px_text_centered(160, 66, won ? "THE DARK ANSWERS" : "THE TIDE GOES QUIET", 3, 2);
  px_text_centered(160, 108, won ? "VICTORY" : "DEFEATED", won ? 2 : 1);
  px_text_centered(160, 139, "TIME " + (elapsed / 60).toString() + "s", 2);
  px_text_centered(160, 154, "LOST " + casualties.toString() + "  PINGS " + pings_fired.toString(), 1);
  if (((frame() / 30) & 1) == 0) px_text_centered(160, 198, "A / START: SURFACE", 3);
}

function cart_draw(): void {
  clear(0);
  if (state == TITLE) draw_title();
  else if (state == PLAY) draw_play();
  else draw_end();
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
