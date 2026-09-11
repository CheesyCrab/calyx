// Seaway Dig — high-fidelity Sunny adaptation of the shipped Godot cart.

import {
  run_start, run_update, frame, clear,
  px_pixel, px_rect, px_rect_outline, px_line, px_text, px_text_centered,
  blit_sprite, COLOR_KEY, FLIP_X,
  text_width, text_line_height,
  set_palette_bytes,
  trace, input_x, input_y, a_pressed, b_pressed, start_pressed,
  seed, rand_range, set_drums, play_music, sfx,
  BLACK, WHITE, DARK_GRAY, LIGHT_GRAY, DARK_BLUE, NAVY,
  CYAN, LIGHT_BLUE, YELLOW, LIGHT_GREEN,
} from "../../sdk/assembly/index";

// The first sixteen entries preserve SWEETIE-16 exactly so the established
// UI color constants remain valid. The upper bank is cart-local material art:
// a compact set of water, earth, salt, stone, timber, and figure ramps.
const SEAWAY_RGB: StaticArray<u8> = [
  0x00,0x00,0x00, 0xff,0xff,0xff, 0x1a,0x1c,0x2c, 0x5d,0x27,0x5d,
  0xb1,0x3e,0x53, 0xef,0x7d,0x57, 0xff,0xcd,0x75, 0xa7,0xf0,0x70,
  0x38,0xb7,0x64, 0x25,0x71,0x79, 0x29,0x36,0x6f, 0x3b,0x5d,0xc9,
  0x41,0xa6,0xf6, 0x73,0xef,0xf7, 0x94,0xb0,0xc2, 0x56,0x6c,0x86,
  0x12,0x2c,0x49, 0x1d,0x59,0x78, 0x2d,0x85,0x9a, 0xb8,0xef,0xdf,
  0x5a,0x35,0x2c, 0x8f,0x52,0x3e, 0xc5,0x79,0x57, 0x3d,0x70,0x76,
  0x66,0xa5,0xa4, 0xb9,0xd8,0xc5, 0x2f,0x38,0x49, 0x52,0x60,0x70,
  0x82,0x91,0x9d, 0x83,0x4d,0x2f, 0xc1,0x60,0x36, 0xf0,0xc8,0x78,
];

const WATER_DEEP = 16, WATER_MID = 17, WATER_SHOAL = 18, WATER_FOAM = 19;
const EARTH_DARK = 20, EARTH_MID = 21, EARTH_LIGHT = 22;
const SALT_DARK = 23, SALT_MID = 24, SALT_LIGHT = 25;
const ROCK_DARK = 26, ROCK_MID = 27, ROCK_LIGHT = 28;
const WOOD = 29, RUST = 30, LAMP = 31;

const BARGE_IDLE: StaticArray<u8> = [
  0,0,0,0,30,31,30,0,0,0,0,
  0,29,29,29,29,29,29,29,30,0,0,
  26,26,26,26,26,26,26,26,26,26,0,
  0,26,26,26,26,26,26,26,26,26,26,
  0,0,19,19,0,0,0,0,0,0,0,
  0,18,18,0,0,0,0,0,0,0,0,
];
const BARGE_NORTH_A: StaticArray<u8> = [
  0,0,26,0,0,
  0,26,26,26,0,
  26,26,29,26,26,
  26,29,31,29,26,
  26,29,29,29,26,
  26,30,30,30,26,
  26,26,26,26,26,
  0,26,26,26,0,
  19,19,0,19,19,
  0,18,0,18,0,
  0,0,18,0,0,
];
const BARGE_NORTH_B: StaticArray<u8> = [
  0,0,26,0,0,
  0,26,26,26,0,
  26,26,29,26,26,
  26,29,31,29,26,
  26,29,29,29,26,
  26,30,30,30,26,
  26,26,26,26,26,
  0,26,26,26,0,
  19,0,0,0,19,
  18,18,0,18,18,
  0,18,0,18,0,
];
const PLAYER_A: StaticArray<u8> = [
  0,1,1,1,1,1,0,0,
  0,0,0,22,0,0,0,0,
  0,26,26,26,26,26,0,0,
  31,26,13,13,13,26,0,0,
  0,26,13,13,13,26,0,0,
  0,26,26,26,26,26,0,0,
  0,26,0,0,0,26,0,0,
  16,16,16,16,16,16,16,0,
];
const PLAYER_B: StaticArray<u8> = [
  0,1,1,1,1,1,0,0,
  0,0,0,22,0,0,0,0,
  0,26,26,26,26,26,0,0,
  31,26,13,13,13,26,0,0,
  0,26,13,13,13,26,0,0,
  0,26,26,26,26,26,0,0,
  0,0,26,0,26,0,0,0,
  16,16,16,16,16,16,16,0,
];
const TITLE = 0, HELP = 1, PLAY = 2;
const DIG = 0, OVERVIEW = 1;
const EMPTY = 0, DIRT = 1, SALT = 2, ROCK = 3, WATER = 4;
const FOLLOW = 0, WALKING = 1, DIGGING = 2;
const MAP_W = 60, MAP_H = 120, TILE = 8, UNIT = 60;
const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;
const SCREEN_TW = 40, SCREEN_TH = 30;
const ZONE_NAMES: string[] = [
  "Tlilcaida", "The Kraparch", "Coastal Mountains", "Coastal Plain", "The Strait",
];
const ZONE_START: StaticArray<i32> = [84, 54, 30, 12, 0];
const ZONE_END: StaticArray<i32> = [120, 84, 54, 30, 12];
const ZONE_SPEED10: StaticArray<i32> = [10, 9, 7, 12, 10];

class Worker {
  x: i32; y: i32; vx: i32 = 0; vy: i32 = 0;
  state: i32 = FOLLOW; tx: i32 = -1; ty: i32 = -1; timer: i32 = 0; away_timer: i32 = 0;
  constructor(x: i32, y: i32) { this.x = x; this.y = y; }
  reset(): void {
    this.state = FOLLOW; this.tx = -1; this.ty = -1; this.timer = 0; this.away_timer = 0;
  }
}

class Barge {
  x: i32; y: i32; dir: i32; moving: bool;
  constructor(x: i32, y: i32, dir: i32, moving: bool = false) {
    this.x = x; this.y = y; this.dir = dir; this.moving = moving;
  }
}

let map = new StaticArray<u8>(MAP_W * MAP_H);
let worker_work = new StaticArray<i32>(MAP_W * MAP_H);
let worker_work_total = new StaticArray<i32>(MAP_W * MAP_H);
let state = TITLE, view = DIG, help_page = 0;
let player_x = tile_to_units(30), player_y = tile_to_units(115);
let camera_x = 0, camera_y = 720, camera_tx = 0, camera_ty = 720;
let dig_timer = 0, dig_total = 0, dig_tx = -1, dig_ty = -1;
let water_dirty = true, tiles_cleared = 0;
let waters_connected = false, canal_complete = false;
let complete_timer = 0, milestone_timer = 0, milestone_text = "";
let bottleneck = 0, barge_timer = 0;
let workers: Worker[] = [], barges: Barge[] = [];
let overview_scroll = 0, overview_remainder = 0;
let zone_idx = 0, zone_timer = 0, zone_name = "";
let debug_mode = false, crew_close = false, crew_mode_timer = 0;
let first_claim_traced = false, first_team_traced = false, last_bottleneck = -1;

function index(x: i32, y: i32): i32 { return y * MAP_W + x; }
function inside(x: i32, y: i32): bool { return x >= 0 && x < MAP_W && y >= 0 && y < MAP_H; }
function tile(x: i32, y: i32): i32 { return <i32>map[index(x, y)]; }
function put(x: i32, y: i32, value: i32): void { map[index(x, y)] = <u8>value; }

function tile_to_units(tile_coord: i32): i32 { return tile_coord * TILE * UNIT; }
function tile_center_units(tile_coord: i32): i32 { return (tile_coord * TILE + 4) * UNIT; }
function units_to_tile(value: i32): i32 { return value / UNIT / TILE; }

function player_distance2_to_tile(x: i32, y: i32): i32 {
  const gx = tile_center_units(x);
  const gy = tile_center_units(y);
  const ddx = gx - player_x;
  const ddy = gy - player_y;
  return ddx * ddx + ddy * ddy;
}

function move_toward_i(value: i32, target: i32, step: i32): i32 {
  if (value < target) return value + step > target ? target : value + step;
  if (value > target) return value - step < target ? target : value - step;
  return value;
}

function clamp_i(value: i32, low: i32, high: i32): i32 {
  return value < low ? low : (value > high ? high : value);
}

function zone_at(row: i32): i32 {
  for (let i = 0; i < 5; i++) if (row >= ZONE_START[i] && row < ZONE_END[i]) return i;
  return 4;
}

function zone_settle_y(age: i32): i32 {
  if (age <= 90) return 40;
  const q = age >= 138 ? 48 : age - 90;
  return 40 - (q * q * 26) / (48 * 48);
}

function zone_settle_x(age: i32, name: string): i32 {
  if (age <= 90) return 160;
  const q = age >= 138 ? 48 : age - 90;
  const resting_center = 316 - text_width(name) / 2;
  return 160 + (resting_center - 160) * q * q / (48 * 48);
}

function barge_better(distance: i32, center: i32, best_distance: i32, best_center: i32): bool {
  return distance < best_distance || (distance == best_distance && center < best_center);
}

function close_target(dx: i32, dy: i32): bool {
  const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
  return adx <= 1 && ady <= 1 && (adx != 0 || ady != 0);
}

function team_effort(count: i32): i32 { return count <= 1 ? 10 : count == 2 ? 17 : 22; }

function dig_frames(kind: i32, zone: i32, debug: bool): i32 {
  const base = kind == DIRT ? 12 : kind == SALT ? 9 : 48;
  let speed = ZONE_SPEED10[zone]; if (debug) speed *= 5;
  const frames = (base * 10 + speed - 1) / speed;
  return frames < 1 ? 1 : frames;
}

function logic_self_test(): void {
  assert(zone_at(119) == 0 && zone_at(84) == 0 && zone_at(83) == 1);
  assert(zone_at(54) == 1 && zone_at(53) == 2 && zone_at(0) == 4);
  assert(dig_frames(DIRT, 0, false) == 12 && dig_frames(ROCK, 2, true) == 14);
  assert(zone_settle_y(90) == 40 && zone_settle_y(138) == 14);
  assert(zone_settle_x(90, "The Kraparch") == 160);
  assert(zone_settle_x(138, "The Kraparch") == 316 - text_width("The Kraparch") / 2);
  assert(barge_better(1, 8, 2, 0) && barge_better(2, 3, 2, 4));
  assert(close_target(1, 0) && close_target(1, 1) && !close_target(0, 0) && !close_target(2, 1));
  assert(team_effort(1) == 10 && team_effort(2) == 17 && team_effort(3) == 22);
  trace("logic=zones,dig,easing,barge-tie,close-radius,team-effort");
}

function roll_tile(row: i32): i32 {
  const z = zone_at(row), r = rand_range(0, 100);
  if (z == 0) return r < 85 ? DIRT : ROCK;
  if (z == 1) return r < 80 ? SALT : ROCK;
  if (z == 2) return r < 60 ? ROCK : DIRT;
  if (z == 3) return r < 90 ? DIRT : ROCK;
  return r < 95 ? SALT : ROCK;
}

function generate_map(): void {
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    put(x, y, roll_tile(y)); worker_work[index(x, y)] = 0; worker_work_total[index(x, y)] = 0;
  }
  for (let y = MAP_H - 3; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) put(x, y, WATER);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) put(30 + dx, 115 + dy, EMPTY);
  for (let y = 0; y < 2; y++) for (let x = 0; x < MAP_W; x++) put(x, y, WATER);
}

function spawn_worker(x: i32, y: i32): void {
  workers.push(new Worker(x + rand_range(-16, 17) * UNIT, y + rand_range(-16, 17) * UNIT));
}

function spawn_barge(moving: bool = false): void {
  const x = rand_range(4 * TILE, (MAP_W - 4) * TILE) * UNIT;
  const dir = rand_range(0, 2) == 0 ? -1 : 1;
  barges.push(new Barge(x, tile_to_units(MAP_H - 2), dir, moving));
}

function snap_camera(): void {
  const px = player_x / UNIT, py = player_y / UNIT;
  camera_tx = (px / (SCREEN_TW * TILE)) * SCREEN_TW * TILE;
  camera_ty = (py / (SCREEN_TH * TILE)) * SCREEN_TH * TILE;
  if (camera_tx > WORLD_W - 320) camera_tx = WORLD_W - 320;
  if (camera_ty > WORLD_H - 240) camera_ty = WORLD_H - 240;
  if (camera_tx < 0) camera_tx = 0; if (camera_ty < 0) camera_ty = 0;
}

function reset_game(): void {
  seed(0x5ea7a9d1); generate_map();
  player_x = tile_to_units(30); player_y = tile_to_units(115);
  snap_camera(); camera_x = camera_tx; camera_y = camera_ty;
  dig_timer = 0; dig_total = 0; dig_tx = -1; dig_ty = -1; water_dirty = true; tiles_cleared = 0;
  waters_connected = false; canal_complete = false; complete_timer = 0;
  milestone_timer = 0; milestone_text = ""; bottleneck = 0; barge_timer = 0;
  barges = []; spawn_barge(); spawn_barge(); spawn_barge();
  workers = []; spawn_worker(player_x, player_y); spawn_worker(player_x, player_y); spawn_worker(player_x, player_y);
  view = DIG; overview_scroll = 0; overview_remainder = 0;
  debug_mode = false; crew_close = false; crew_mode_timer = 0;
  zone_idx = zone_at(units_to_tile(player_y)); zone_name = ZONE_NAMES[zone_idx]; zone_timer = 138;
  first_claim_traced = false; first_team_traced = false; last_bottleneck = -1;
}

function slide_camera(): void {
  camera_x = move_toward_i(camera_x, camera_tx, 10);
  camera_y = move_toward_i(camera_y, camera_ty, 10);
}
function camera_sliding(): bool { return camera_x != camera_tx || camera_y != camera_ty; }

function complete_dig(): void {
  if (inside(dig_tx, dig_ty) && tile(dig_tx, dig_ty) != EMPTY && tile(dig_tx, dig_ty) != WATER) {
    put(dig_tx, dig_ty, EMPTY); tiles_cleared++; water_dirty = true; sfx("hit");
    if (tiles_cleared % 20 == 0 && workers.length < 30) spawn_worker(player_x, player_y);
  }
  dig_tx = -1; dig_ty = -1;
}

function has_open_neighbor(x: i32, y: i32): bool {
  return (inside(x + 1, y) && (tile(x + 1, y) == EMPTY || tile(x + 1, y) == WATER)) ||
    (inside(x - 1, y) && (tile(x - 1, y) == EMPTY || tile(x - 1, y) == WATER)) ||
    (inside(x, y + 1) && (tile(x, y + 1) == EMPTY || tile(x, y + 1) == WATER)) ||
    (inside(x, y - 1) && (tile(x, y - 1) == EMPTY || tile(x, y - 1) == WATER));
}

function claimed(x: i32, y: i32, except: Worker): bool {
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i]; if (w != except && w.tx == x && w.ty == y) return true;
  }
  return false;
}

function claim_count(x: i32, y: i32, except: Worker): i32 {
  let count = 0;
  for (let i = 0; i < workers.length; i++) {
    const other = workers[i];
    if (other != except && other.tx == x && other.ty == y) count++;
  }
  return count;
}

function assert_unique_claims(): void {
  for (let i = 0; i < workers.length; i++) if (workers[i].tx >= 0)
    assert(claim_count(workers[i].tx, workers[i].ty, workers[i]) <= 2, "worker target overstaffed");
}

function find_target(w: Worker): void {
  const px = units_to_tile(player_x), py = units_to_tile(player_y);
  let best = 0x7fffffff, bx = -1, by = -1;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (crew_close && !close_target(dx, dy)) continue;
    const x = px + dx, y = py + dy;
    if (!inside(x, y) || tile(x, y) == EMPTY || tile(x, y) == WATER || claimed(x, y, w) || !has_open_neighbor(x, y)) continue;
    const d2 = player_distance2_to_tile(x, y);
    if (d2 < best) { best = d2; bx = x; by = y; }
  }
  // When every exposed tile is already claimed, up to two helpers may join
  // the nearest job. Unique work remains the first choice.
  if (bx < 0) for (let i = 0; i < workers.length; i++) {
    const other = workers[i], x = other.tx, y = other.ty;
    if (x < 0 || !inside(x, y) || tile(x, y) == EMPTY || tile(x, y) == WATER) continue;
    const dx = x - px, dy = y - py;
    if (crew_close && !close_target(dx, dy)) continue;
    if (claim_count(x, y, w) >= 3) continue;
    const d2 = player_distance2_to_tile(x, y);
    if (d2 < best) { best = d2; bx = x; by = y; }
  }
  if (bx >= 0) {
    w.tx = bx; w.ty = by; w.state = WALKING;
    if (!first_claim_traced) { first_claim_traced = true; trace("worker-claim=" + bx.toString() + "," + by.toString()); }
  }
}

function move_axis(w: Worker, gx: i32, gy: i32, speed: i32): void {
  const dx = gx - w.x, dy = gy - w.y;
  if (dx == 0 && dy == 0) { w.vx = 0; w.vy = 0; return; }
  const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
  const norm = adx > ady ? adx : ady;
  w.vx = dx * speed / norm; w.vy = dy * speed / norm;
  w.x += w.vx; w.y += w.vy;
}

function worker_work_units(kind: i32, zone: i32): i32 {
  const base = kind == DIRT ? 120 : kind == SALT ? 90 : 480;
  const speed = ZONE_SPEED10[zone];
  return ((base * 10 + speed - 1) / speed) * 10;
}

function update_worker_labor(): void {
  for (let i = 0; i < workers.length; i++) {
    const lead = workers[i];
    if (lead.state != DIGGING || lead.tx < 0) continue;
    let earlier = false;
    for (let j = 0; j < i; j++) if (workers[j].state == DIGGING &&
      workers[j].tx == lead.tx && workers[j].ty == lead.ty) { earlier = true; break; }
    if (earlier) continue;
    const k = index(lead.tx, lead.ty);
    let count = 0;
    for (let j = i; j < workers.length; j++) if (workers[j].state == DIGGING &&
      workers[j].tx == lead.tx && workers[j].ty == lead.ty) count++;
    if (count > 1 && !first_team_traced) {
      first_team_traced = true;
      trace("worker-team=" + count.toString() + " target=" + lead.tx.toString() + "," + lead.ty.toString());
    }
    // Tenths of a worker-frame: 1.0x, 1.7x, then 2.2x for a three-person team.
    const effort = team_effort(count);
    worker_work[k] -= effort;
    for (let j = 0; j < workers.length; j++) if (workers[j].tx == lead.tx && workers[j].ty == lead.ty)
      workers[j].timer = worker_work[k];
    if (worker_work[k] <= 0) {
      put(lead.tx, lead.ty, EMPTY); tiles_cleared++; water_dirty = true;
      worker_work[k] = 0; worker_work_total[k] = 0;
      for (let j = 0; j < workers.length; j++) if (workers[j].tx == lead.tx && workers[j].ty == lead.ty)
        workers[j].reset();
    }
  }
}

function update_workers(): void {
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i], dx = player_x - w.x, dy = player_y - w.y;
    const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
    const pd = adx > ady ? adx : ady;
    if (pd > 160 * UNIT && w.state == FOLLOW) {
      w.x = player_x + rand_range(-16, 17) * UNIT; w.y = player_y + rand_range(-16, 17) * UNIT; w.reset(); continue;
    }
    if (w.state != FOLLOW && pd > 64 * UNIT) {
      w.away_timer++;
      // Two seconds is enough to finish normal/fast material, but not rock.
      if (w.away_timer >= 120) { w.reset(); continue; }
    } else w.away_timer = 0;
    if (w.state == FOLLOW) {
      if (pd > 8 * UNIT) move_axis(w, player_x, player_y, pd > 40 * UNIT ? 120 : 50);
      else { w.vx = 0; w.vy = 0; }
      find_target(w);
    } else if (w.state == WALKING) {
      if (!inside(w.tx, w.ty) || tile(w.tx, w.ty) == EMPTY || tile(w.tx, w.ty) == WATER) { w.reset(); continue; }
      const gx = tile_center_units(w.tx), gy = tile_center_units(w.ty);
      const txd = gx - w.x, tyd = gy - w.y;
      if ((txd < 0 ? -txd : txd) < 4 * UNIT && (tyd < 0 ? -tyd : tyd) < 4 * UNIT) {
        const k = index(w.tx, w.ty);
        if (worker_work[k] <= 0) {
          worker_work[k] = worker_work_units(tile(w.tx, w.ty), zone_at(w.ty));
          worker_work_total[k] = worker_work[k];
        }
        w.state = DIGGING; w.timer = worker_work[k]; w.vx = 0; w.vy = 0;
      } else move_axis(w, gx, gy, 50);
    } else {
      if (!inside(w.tx, w.ty) || tile(w.tx, w.ty) == EMPTY || tile(w.tx, w.ty) == WATER) w.reset();
    }
  }
  update_worker_labor();
  assert_unique_claims();
}

function flood_water(): void {
  if (!water_dirty) return; water_dirty = false;
  const queue: i32[] = []; const seen = new StaticArray<u8>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (tile(x, y) == WATER) {
    const k = index(x, y); seen[k] = 1; queue.push(k);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi], x = k % MAP_W, y = k / MAP_W;
    const nx: StaticArray<i32> = [x + 1, x - 1, x, x];
    const ny: StaticArray<i32> = [y, y, y + 1, y - 1];
    for (let d = 0; d < 4; d++) {
      if (!inside(nx[d], ny[d])) continue; const nk = index(nx[d], ny[d]);
      if (seen[nk] != 0 || tile(nx[d], ny[d]) != EMPTY) continue;
      seen[nk] = 1; put(nx[d], ny[d], WATER); queue.push(nk);
    }
  }
}

function calc_bottleneck(): i32 {
  let minw = MAP_W;
  for (let y = 2; y < MAP_H - 3; y++) {
    let count = 0; for (let x = 0; x < MAP_W; x++) if (tile(x, y) == WATER) count++;
    if (count < minw) minw = count;
  }
  return minw;
}

function show_milestone(text: string): void { milestone_text = text; milestone_timer = 210; trace("milestone=" + text); }

function check_milestones(): void {
  if (!waters_connected) for (let x = 0; x < MAP_W; x++) if (tile(x, 2) == WATER) {
    waters_connected = true; show_milestone("THE WATERS MEET!"); sfx("fanfare"); break;
  }
  if (waters_connected && !canal_complete && bottleneck >= 5) {
    // Completion owns its own multi-phase banner. Reusing the milestone
    // overlay here drew two copies of the same message over one another.
    canal_complete = true; complete_timer = 0; milestone_timer = 0;
    trace("complete tiles=" + tiles_cleared.toString() + " workers=" + workers.length.toString()); sfx("fanfare");
  }
}

function update_barges(): void {
  barge_timer--;
  if (barge_timer <= 0) {
    barge_timer = 120;
    if (waters_connected) {
      bottleneck = calc_bottleneck();
      if (bottleneck != last_bottleneck) {
        last_bottleneck = bottleneck; trace("bottleneck=" + bottleneck.toString());
      }
      const target = bottleneck * 3 < 20 ? bottleneck * 3 : 20;
      let moving = 0; for (let i = 0; i < barges.length; i++) if (barges[i].moving) moving++;
      // Release the boats already waiting in Tlilcaida before adding traffic.
      // Two departures per pulse make an opened/widened route visibly wake up.
      let additions = target - moving; if (additions > 2) additions = 2;
      for (let n = 0; n < additions; n++) {
        let released = false;
        for (let i = 0; i < barges.length; i++) if (!barges[i].moving) {
          barges[i].moving = true; released = true; break;
        }
        if (!released) spawn_barge(true);
        moving++;
        trace("barge=moving count=" + moving.toString());
      }
    }
  }
  for (let i = 0; i < barges.length; i++) {
    const b = barges[i];
    if (!b.moving) {
      b.x += b.dir * 5;
      if (b.x < TILE * UNIT || b.x > (MAP_W - 2) * TILE * UNIT) b.dir = -b.dir;
      continue;
    }
    const tx = units_to_tile(b.x), ty = units_to_tile(b.y), nexty = ty - 1;
    if (nexty < 0) { b.y = tile_to_units(MAP_H - 2); b.x = rand_range(4 * TILE, (MAP_W - 4) * TILE) * UNIT; continue; }
    let found = false, bestx = tx, bestd = 999, bestc = 999;
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx + dx; if (!inside(x, nexty) || tile(x, nexty) != WATER) continue;
      const d = dx < 0 ? -dx : dx, c0 = x - 30, c = c0 < 0 ? -c0 : c0;
      if (barge_better(d, c, bestd, bestc)) { bestd = d; bestc = c; bestx = x; found = true; }
    }
    if (found) {
      const gx = tile_center_units(bestx), diff = gx - b.x;
      let steer = diff * 3; if (steer > 20) steer = 20; if (steer < -20) steer = -20;
      b.x += steer;
      if ((diff < 0 ? -diff : diff) < TILE * UNIT * 3 / 2) b.y -= 20;
    } else {
      b.x += b.dir * 10;
      if (b.x < TILE * UNIT || b.x > (MAP_W - 2) * TILE * UNIT) b.dir = -b.dir;
    }
  }
}

function begin_dig(tx: i32, ty: i32): void {
  dig_tx = tx; dig_ty = ty;
  dig_timer = dig_frames(tile(tx, ty), zone_at(ty), debug_mode); dig_total = dig_timer;
}

function process_dig(): void {
  if (camera_sliding()) { slide_camera(); update_workers(); flood_water(); return; }
  if (dig_timer > 0) {
    dig_timer--; if (dig_timer == 0) complete_dig();
    update_workers(); flood_water(); check_milestones(); return;
  }
  let ix = input_x(), iy = input_y();
  // Resolve diagonals as an orthogonal staircase so every excavated tile stays
  // four-neighbor connected to the flood (the source's continuous collision
  // naturally has the same property at tile boundaries).
  if (ix != 0 && iy != 0) { if ((frame() & 1) == 0) ix = 0; else iy = 0; }
  if (ix != 0 || iy != 0) {
    let nx = player_x + ix * 80, ny = player_y + iy * 80;
    nx = clamp_i(nx, 0, (WORLD_W - TILE) * UNIT);
    ny = clamp_i(ny, 0, (WORLD_H - TILE) * UNIT);
    const tx = units_to_tile(nx), ty = units_to_tile(ny), t = tile(tx, ty);
    if (t == EMPTY || t == WATER) { player_x = nx; player_y = ny; }
    else begin_dig(tx, ty);
    snap_camera(); if (camera_sliding()) slide_camera();
  }
  update_workers(); flood_water(); check_milestones();
  const z = zone_at(units_to_tile(player_y));
  if (z != zone_idx) { zone_idx = z; zone_name = ZONE_NAMES[z]; zone_timer = 138; trace("zone=" + zone_name); }
}

function process_play(): void {
  if (zone_timer > 0) zone_timer--; if (milestone_timer > 0) milestone_timer--;
  if (crew_mode_timer > 0) crew_mode_timer--;
  if (canal_complete) complete_timer++;
  update_barges();
  if (b_pressed()) { debug_mode = !debug_mode; trace("debug=" + (debug_mode ? "5x" : "off")); }
  if (a_pressed()) {
    crew_close = !crew_close; crew_mode_timer = 90;
    if (crew_close) {
      const px = units_to_tile(player_x), py = units_to_tile(player_y);
      for (let i = 0; i < workers.length; i++) if (workers[i].tx >= 0) {
        const dx = workers[i].tx - px, dy = workers[i].ty - py;
        if (!close_target(dx, dy)) workers[i].reset();
      }
    }
    trace("crew-mode=" + (crew_close ? "close" : "roam"));
  }
  if (start_pressed()) {
    if (view == DIG) {
      view = OVERVIEW; overview_scroll = units_to_tile(player_y) * 3 - 120;
      overview_scroll = clamp_i(overview_scroll, 0, 120);
      trace("view=overview");
    } else { view = DIG; trace("view=dig"); }
    return;
  }
  if (view == OVERVIEW) {
    overview_remainder += input_y() * 200;
    overview_scroll += overview_remainder / 60; overview_remainder %= 60;
    overview_scroll = clamp_i(overview_scroll, 0, 120);
    return;
  }
  process_dig();
}

function cart_ready(): void {
  set_palette_bytes(SEAWAY_RGB, 32);
  reset_game(); logic_self_test();
  let dirt=0,salt=0,rock=0;
  for(let i=0;i<MAP_W*MAP_H;i++){if(map[i]==DIRT)dirt++;else if(map[i]==SALT)salt++;else if(map[i]==ROCK)rock++;}
  trace("map dirt="+dirt.toString()+" salt="+salt.toString()+" rock="+rock.toString());
  trace("state=title");
}
function cart_process(): void {
  if (state == TITLE) {
    if (a_pressed()) {
      reset_game(); state = PLAY;
      set_drums(120, [[1,0,0,0,1,0,0,0],[0,0,1,0,0,0,1,0],[1,1,1,1,1,1,1,1]]); play_music();
      trace("state=play");
    } else if (start_pressed()) { help_page = 0; state = HELP; trace("state=help page=1"); }
  } else if (state == HELP) {
    if (b_pressed()) { state = TITLE; trace("state=title"); }
    else if (a_pressed() || start_pressed()) {
      help_page++; if (help_page >= 2) { state = TITLE; trace("state=title"); }
      else trace("state=help page=2");
    }
  } else process_play();
}

function tile_color(t: i32): i32 {
  return t == DIRT ? EARTH_MID : t == SALT ? SALT_MID : t == ROCK ? ROCK_MID : t == WATER ? WATER_MID : BLACK;
}

function material_hash(x: i32, y: i32): i32 {
  return (x * 37 + y * 61 + x * y * 3) & 255;
}

function draw_world_tile(x: i32, y: i32): void {
  const t = tile(x, y), sx = x * TILE - camera_x, sy = y * TILE - camera_y;
  const h = material_hash(x, y);
  if (t == WATER) {
    px_rect(sx, sy, TILE, TILE, WATER_MID);
    const flow_y = 7 - ((frame() / 5 + h) & 7);
    const flow_x = 1 + ((h >> 3) & 5);
    if ((h & 7) < 4) {
      px_pixel(sx + flow_x, sy + flow_y, WATER_SHOAL);
      if (flow_y > 0) px_pixel(sx + flow_x, sy + flow_y - 1, WATER_SHOAL);
      if ((h & 15) == 1 && flow_x < 7 && flow_y > 1) px_pixel(sx + flow_x + 1, sy + flow_y - 2, WATER_FOAM);
    }
    return;
  }
  if (t == DIRT) {
    px_rect(sx, sy, TILE, TILE, EARTH_MID);
    if ((h & 1) == 0) px_line(sx + 1, sy + 7, sx + 6, sy + 7, EARTH_DARK);
    px_pixel(sx + 1 + (h & 3), sy + 2 + ((h >> 2) & 3), EARTH_LIGHT);
    if ((h & 7) == 3) px_pixel(sx + 6, sy + 5, EARTH_DARK);
    return;
  }
  if (t == SALT) {
    px_rect(sx, sy, TILE, TILE, SALT_MID);
    if ((h & 3) == 0) px_rect(sx, sy + 6, TILE, 2, SALT_DARK);
    const cx = sx + 2 + (h & 3), cy = sy + 2 + ((h >> 2) & 3);
    px_pixel(cx, cy, SALT_LIGHT);
    if ((h & 7) == 1) { px_pixel(cx - 1, cy, SALT_LIGHT); px_pixel(cx, cy - 1, SALT_LIGHT); }
    return;
  }
  if (t == ROCK) {
    px_rect(sx, sy, TILE, TILE, ROCK_MID);
    px_line(sx + 1, sy + 7, sx + 7, sy + 7, ROCK_DARK);
    px_line(sx + 7, sy + 2, sx + 7, sy + 7, ROCK_DARK);
    if ((h & 1) == 0) {
      px_line(sx + 1, sy + 2, sx + 4, sy + 2, ROCK_LIGHT);
      px_pixel(sx + 4, sy + 3, ROCK_DARK);
    } else {
      px_line(sx + 2, sy + 1, sx + 2, sy + 4, ROCK_LIGHT);
      px_pixel(sx + 3, sy + 4, ROCK_DARK);
    }
  }
}

function draw_dig_effect(fx: i32, fy: i32, phase: i32, salt: i32): void {
  const flash = ((frame() + salt) & 7) < 2;
  if (phase >= 1) {
    px_pixel(fx + 4, fy + 1, ROCK_DARK); px_pixel(fx + 4, fy + 2, ROCK_DARK);
    px_pixel(fx + 4, fy + 3, ROCK_DARK); px_pixel(fx + 4, fy + 4, ROCK_DARK);
    px_pixel(fx + 3, fy + 5, ROCK_DARK); px_pixel(fx + 2, fy + 6, ROCK_DARK);
  }
  if (phase >= 2) {
    px_pixel(fx + 5, fy + 5, ROCK_DARK); px_pixel(fx + 6, fy + 5, ROCK_DARK);
    px_pixel(fx + 7, fy + 6, ROCK_DARK);
    px_pixel(fx + 1, fy + 1, flash ? LAMP : EARTH_LIGHT);
    px_pixel(fx + 7, fy + 2, flash ? WHITE : ROCK_LIGHT);
  }
  if (phase >= 3) {
    px_pixel(fx + ((frame() / 2 + salt) & 7), fy - 1, LAMP);
    px_pixel(fx - 1, fy + 2 + ((frame() + salt) & 3), EARTH_LIGHT);
  }
}

function draw_player(): void {
  const x = player_x / UNIT - camera_x, y = player_y / UNIT - camera_y;
  const sprite = ((frame() / 6) & 1) == 0 ? PLAYER_A : PLAYER_B;
  blit_sprite(sprite, 8, 8, x - 3, y - 5, COLOR_KEY | (input_x() < 0 ? FLIP_X : 0));
}

function draw_barge(b: Barge, number: i32): void {
  const x = b.x / UNIT - camera_x, y = b.y / UNIT - camera_y;
  if (x < -12 || x > 332 || y < -12 || y > 252) return;
  if (b.moving) {
    const sprite = ((frame() / 5 + number) & 1) == 0 ? BARGE_NORTH_A : BARGE_NORTH_B;
    blit_sprite(sprite, 5, 11, x - 2, y - 5, COLOR_KEY);
  } else {
    blit_sprite(BARGE_IDLE, 11, 6, x - 5, y - 3, COLOR_KEY | (b.dir < 0 ? FLIP_X : 0));
  }
}

function draw_title(): void {
  clear(DARK_BLUE);
  // Bounded canal vignette: strait, cut, workers, and a tiny barge.
  px_rect(54, 44, 212, 34, WATER_DEEP); px_rect(148, 78, 24, 65, WATER_MID); px_rect(54, 143, 212, 22, WATER_DEEP);
  for (let i = 0; i < 7; i++) { px_pixel(139 + (i * 13) % 42, 99 + (i * 17) % 36, LAMP); px_pixel(140 + (i * 13) % 42, 100 + (i * 17) % 36, RUST); }
  for (let i = 0; i < 5; i++) px_line(151 + (i * 5), 84 + i * 11, 155 + (i * 5), 84 + i * 11, WATER_SHOAL);
  px_rect(153, 57, 10, 3, ROCK_DARK); px_rect(155, 56, 6, 2, WOOD); px_pixel(158, 55, LAMP);
  px_text_centered(160, 20, "SEAWAY DIG", WHITE, 2);
  px_text_centered(160, 177, "DIG THE SERIAN SEAWAY", CYAN);
  if (((frame() / 30) & 1) == 0) px_text_centered(160, 202, "A: BEGIN", LIGHT_GRAY);
  px_text_centered(160, 220, "START: HOW TO PLAY", DARK_GRAY);
}

function draw_help(): void {
  clear(DARK_BLUE); px_text_centered(160, 24, help_page == 0 ? "HOW TO PLAY" : "TERRAIN", WHITE, 2);
  if (help_page == 0) {
    const lines: string[] = ["WALK INTO TERRAIN TO DIG", "WATER FLOWS BEHIND YOU", "WORKERS DIG NEARBY TILES", "", "D-PAD: MOVE", "A: CREW ROAM / CLOSE", "START: OVERVIEW MAP", "B: DEBUG 5X", "", "CONNECT RIVER TO STRAIT", "THEN WIDEN THE CANAL"];
    for (let i = 0; i < lines.length; i++) if (lines[i].length > 0) px_text_centered(160, 55 + i * 14, lines[i], LIGHT_GRAY);
  } else {
    const names: string[] = ["DIRT - FAST", "SALT - FAST", "ROCK - SLOW", "WATER - CANAL", "BARGES", "WORKERS", "YOU"];
    const cols: StaticArray<i32> = [EARTH_MID,SALT_MID,ROCK_MID,WATER_MID,WOOD,RUST,WHITE];
    for (let i = 0; i < names.length; i++) { px_rect(78, 55 + i * 19, 8, 8, cols[i]); px_text(94, 55 + i * 19, names[i], LIGHT_GRAY); }
  }
  px_text_centered(160, 220, "A/START: NEXT   B: BACK", DARK_GRAY);
}

function draw_minimap(): void {
  px_rect(0, 0, 20, 240, NAVY); px_rect(19, 0, 1, 240, DARK_GRAY);
  for (let sy = 0; sy < 240; sy++) {
    const my = sy / 2; for (let dx = 0; dx < 16; dx++) {
      const t = tile(22 + dx, my); if (t != EMPTY) px_pixel(2 + dx, sy, tile_color(t));
    }
  }
  if (((frame() / 15) & 1) == 0) px_rect(2 + (units_to_tile(player_x) - 22), units_to_tile(player_y) * 2, 2, 2, WHITE);
  for (let i = 0; i < workers.length; i++) {
    const wx = units_to_tile(workers[i].x) - 22, wy = units_to_tile(workers[i].y) * 2;
    if (wx >= 0 && wx < 16 && wy >= 0 && wy < 240) px_pixel(2 + wx, wy, YELLOW);
  }
}

function draw_milestone(): void {
  if (milestone_timer <= 0) return;
  const age = 210 - milestone_timer;
  let y = 120; if (age < 18) y = 140 - age * 20 / 18;
  const phase = milestone_timer < 60 ? (milestone_timer * 4 + 59) / 60 : 4;
  // Ordered dither stands in for the source alpha fade.
  for (let yy = y - 20; yy < y + 20; yy++) for (let x = 0; x < 320; x++) if (((x + yy) & 3) < phase) px_pixel(x, yy, BLACK);
  if (phase > 0) px_text_centered(160, y - text_line_height(2) / 2, milestone_text, WHITE, 2);
}

function draw_complete(): void {
  if (!canal_complete) return;
  if (complete_timer < 120) {
    px_text_centered(160, 92, "SEAWAY COMPLETE!", WHITE, 2);
    px_text_centered(160, 126, "TILES CLEARED: " + tiles_cleared.toString(), CYAN);
  } else if (complete_timer < 180) {
    const y = 92 - (complete_timer - 120) * 58 / 60;
    px_text_centered(160, y, "SEAWAY COMPLETE!", LIGHT_GRAY);
  } else px_text_centered(160, 34, "SEAWAY COMPLETE!", LIGHT_GRAY);
}

function zone_label_color(zone: i32): i32 {
  return zone == 0 ? EARTH_LIGHT : zone == 1 ? SALT_LIGHT : zone == 2 ? ROCK_LIGHT : zone == 3 ? LAMP : WATER_FOAM;
}

function px_text_shadow(x: i32, y: i32, text: string, color: i32): void {
  px_text(x + 1, y + 1, text, WATER_DEEP);
  px_text(x, y, text, color);
}

function px_text_centered_shadow(x: i32, y: i32, text: string, color: i32): void {
  px_text_centered(x + 1, y + 1, text, WATER_DEEP);
  px_text_centered(x, y, text, color);
}

function draw_worker_figure(w: Worker): void {
  const x = w.x / UNIT - camera_x, y = w.y / UNIT - camera_y;
  const facing = w.vx < 0 ? -1 : 1;
  // Helmet + face + coat + separated boots: a compact human silhouette rather
  // than the former three-pixel body, which could read as a swimming fish.
  px_rect(x - 2, y - 6, 5, 2, ROCK_LIGHT);
  px_pixel(x + facing * 2, y - 5, LAMP);
  px_rect(x - 1, y - 4, 3, 2, SALT_LIGHT);
  px_rect(x - 2, y - 2, 5, 3, RUST);
  px_pixel(x - 1, y + 1, ROCK_DARK); px_pixel(x + 1, y + 1, ROCK_DARK);
  px_pixel(x - 1, y + 2, ROCK_DARK); px_pixel(x + 1, y + 2, ROCK_DARK);
  if (w.state == DIGGING) {
    px_line(x + facing * 2, y - 1, x + facing * 4, y + 2, WOOD);
    px_pixel(x + facing * 4, y + 3, ROCK_LIGHT);
  } else {
    px_pixel(x - 3, y - 1, SALT_LIGHT); px_pixel(x + 3, y - 1, SALT_LIGHT);
  }
}

function draw_dig(): void {
  clear(BLACK);
  const sx = camera_x / TILE - 1 < 0 ? 0 : camera_x / TILE - 1;
  const sy = camera_y / TILE - 1 < 0 ? 0 : camera_y / TILE - 1;
  const ex = (camera_x + 320) / TILE + 2 > MAP_W ? MAP_W : (camera_x + 320) / TILE + 2;
  const ey = (camera_y + 240) / TILE + 2 > MAP_H ? MAP_H : (camera_y + 240) / TILE + 2;
  for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) {
    const t = tile(x, y); if (t == EMPTY) continue;
    draw_world_tile(x, y);
  }
  if (dig_timer > 0 && dig_tx >= 0) {
    const phase = dig_total > 0 ? 4 - dig_timer * 4 / dig_total : 1;
    draw_dig_effect(dig_tx * TILE - camera_x, dig_ty * TILE - camera_y, phase, dig_tx * 5 + dig_ty * 11);
  }
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (w.state == DIGGING && w.tx >= 0) {
      const fx=w.tx*TILE-camera_x, fy=w.ty*TILE-camera_y;
      const k=index(w.tx,w.ty), total=worker_work_total[k];
      const phase = total > 0 ? 1 + (total - worker_work[k]) * 3 / total : 4;
      draw_dig_effect(fx, fy, phase, i * 17 + w.tx * 3);
    }
    let stacked = false;
    const worker_tile_x = units_to_tile(w.x), worker_tile_y = units_to_tile(w.y);
    for (let j = 0; j < i; j++) {
      if (units_to_tile(workers[j].x) == worker_tile_x && units_to_tile(workers[j].y) == worker_tile_y) {
        stacked = true; break;
      }
    }
    if (!stacked) draw_worker_figure(w);
  }
  for (let i = 0; i < barges.length; i++) draw_barge(barges[i], i);
  draw_player();
  draw_minimap();
  px_text_shadow(24,14,"CREW "+workers.length.toString()+(crew_close?" CLOSE":""),LIGHT_GRAY);
  if (crew_mode_timer > 0)
    px_text_shadow(24,26,crew_close?"CREW: CLOSE":"CREW: ROAM",LIGHT_GREEN);
  if (zone_timer > 0) {
    const age=138-zone_timer;
    const zx=zone_settle_x(age,zone_name),zy=zone_settle_y(age);
    px_text_centered_shadow(zx,zy,zone_name,zone_label_color(zone_idx));
  } else {
    const zw=text_width(zone_name), zx=316-zw;
    px_text_shadow(zx,14,zone_name,zone_label_color(zone_idx));
  }
  if(debug_mode){let f=0,wc=0,d=0;for(let i=0;i<workers.length;i++){if(workers[i].state==FOLLOW)f++;else if(workers[i].state==WALKING)wc++;else d++;}
    px_text(24,192,"TILE "+units_to_tile(player_x).toString()+","+units_to_tile(player_y).toString(),LIGHT_GREEN);
    px_text(24,204,"F:"+f.toString()+" W:"+wc.toString()+" D:"+d.toString(),LIGHT_GREEN);
    px_text(24,216,"BN:"+bottleneck.toString()+"  5X",LIGHT_GREEN);}
  draw_milestone(); draw_complete();
}

function draw_overview(): void {
  clear(NAVY); const ox=40, off=overview_scroll;
  const sy=off/3>0?off/3-1:0, ey=(off+240)/3+2<MAP_H?(off+240)/3+2:MAP_H;
  for(let y=sy;y<ey;y++)for(let x=0;x<MAP_W;x++){const t=tile(x,y);if(t!=EMPTY)px_rect(ox+x*4,y*3-off,4,3,tile_color(t));}
  for(let z=0;z<5;z++){const my=(ZONE_START[z]+ZONE_END[z])/2*3-off;if(my>4&&my<168)px_text_shadow(3,my,ZONE_NAMES[z],zone_label_color(z));}
  if(((frame()/15)&1)==0)px_rect(ox+units_to_tile(player_x)*4,units_to_tile(player_y)*3-off,4,3,WHITE);
  for(let i=0;i<workers.length;i++){const y=units_to_tile(workers[i].y)*3-off;if(y>=0&&y<240)px_pixel(ox+units_to_tile(workers[i].x)*4,y,YELLOW);}
  for(let i=0;i<barges.length;i++){const y=units_to_tile(barges[i].y)*3-off;if(y>=0&&y<240)px_rect(ox+units_to_tile(barges[i].x)*4,y,3,2,LIGHT_BLUE);}
  if(off>0)px_text_centered(310,4,"^",WHITE);if(off<120)px_text_centered(310,204,"v",WHITE);
  if(!waters_connected)px_text_centered_shadow(160,184,"GOAL: CONNECT THE WATERS",LAMP);
  else if(!canal_complete){px_text_centered_shadow(160,181,"WIDEN THE CANAL",WHITE);px_rect(120,199,80,6,DARK_BLUE);px_rect(120,199,bottleneck*16,6,WATER_SHOAL);px_rect_outline(120,199,80,6,LIGHT_GRAY);}
  else px_text_centered_shadow(160,184,"SEAWAY COMPLETE!",LIGHT_GREEN);
  px_text_centered_shadow(160,222,"START: BACK",LIGHT_GRAY);
}

function cart_draw(): void {
  if(state==TITLE)draw_title();else if(state==HELP)draw_help();else if(view==DIG)draw_dig();else draw_overview();
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
