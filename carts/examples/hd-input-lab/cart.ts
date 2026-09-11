// Calyx Resonator — a no-fail arcade instrument that proves the HD field and
// every extended control through play. Its flat geometric machinery is the
// finished visual language; no illustration pass is implied.

import {
  run_start, run_update_30, frame, width, height,
  clear, px_rect, px_rect_outline, px_hline, px_vline,
  px_text, px_text_centered, set_palette_bytes,
  up_held, down_held, left_held, right_held,
  a_held, b_held, x_held, y_held, l_held, r_held,
  a_pressed, b_pressed, x_pressed, y_pressed,
  l_pressed, r_pressed, start_pressed,
  tone, trace,
  BLACK, WHITE, DARK_BLUE, RED, ORANGE, YELLOW, LIGHT_GREEN,
  GREEN, NAVY, LIGHT_BLUE, CYAN, LIGHT_GRAY, DARK_GRAY,
} from "../../../sdk/assembly/index";

const ROUND_FRAMES: i32 = 2700;
const RESET_FRAMES: i32 = 2880;
const TRAIL: i32 = 14;
const PARTICLES: i32 = 24;

// Physical TG5050 face-button diamond: X top, A right, B bottom, Y left.
const PETAL_Y: i32 = 0;
const PETAL_X: i32 = 1;
const PETAL_A: i32 = 2;
const PETAL_B: i32 = 3;

const CALYX_HD_PALETTE: StaticArray<u8> = [
  0x00, 0x00, 0x00,  0xf4, 0xf1, 0xde,  0x1a, 0x1c, 0x2c,  0x3b, 0x1f, 0x4d,
  0xb1, 0x3e, 0x53,  0xef, 0x7d, 0x57,  0xd6, 0xa6, 0x2a,  0xa7, 0xf0, 0x70,
  0x38, 0xb7, 0x64,  0x25, 0x71, 0x79,  0x29, 0x36, 0x6f,  0x3b, 0x5d, 0xc9,
  0x41, 0xa6, 0xf6,  0x73, 0xef, 0xf7,  0x94, 0xb0, 0xc2,  0x56, 0x6c, 0x86,
];

let orb_x: i32 = 640;
let orb_y: i32 = 360;
let orb_vx: i32 = 6;
let orb_vy: i32 = -4;
let score: i32 = 0;
let combo: i32 = 0;
let bloom: i32 = 0;
let round_f: i32 = 0;
let show_data: bool = false;
let left_vane: i32 = 0;
let right_vane: i32 = 0;
let impact: i32 = 0;
let particle_slot: i32 = 0;

let petal_pulse = new StaticArray<i32>(4);
let petal_awake = new StaticArray<i32>(4);
let trail_x = new StaticArray<i32>(TRAIL);
let trail_y = new StaticArray<i32>(TRAIL);
let particle_x = new StaticArray<i32>(PARTICLES);
let particle_y = new StaticArray<i32>(PARTICLES);
let particle_vx = new StaticArray<i32>(PARTICLES);
let particle_vy = new StaticArray<i32>(PARTICLES);
let particle_life = new StaticArray<i32>(PARTICLES);
let particle_color = new StaticArray<i32>(PARTICLES);

function abs(v: i32): i32 { return v < 0 ? -v : v; }
function clamp(v: i32, lo: i32, hi: i32): i32 {
  return v < lo ? lo : v > hi ? hi : v;
}

function reset_round(): void {
  orb_x = width() / 2;
  orb_y = height() / 2;
  orb_vx = 6;
  orb_vy = -4;
  score = 0;
  combo = 0;
  bloom = 0;
  round_f = 0;
  impact = 0;
  for (let i: i32 = 0; i < 4; i++) petal_awake[i] = 0;
  for (let i: i32 = 0; i < TRAIL; i++) {
    trail_x[i] = orb_x;
    trail_y[i] = orb_y;
  }
  for (let i: i32 = 0; i < PARTICLES; i++) particle_life[i] = 0;
}

function cart_ready(): void {
  set_palette_bytes(CALYX_HD_PALETTE, 16);
  reset_round();
  trace("calyx-resonator ready " + width().toString() + "x" + height().toString());
}

function spawn_sparks(color: i32): void {
  for (let i: i32 = 0; i < 6; i++) {
    const p = particle_slot;
    particle_slot = (particle_slot + 1) % PARTICLES;
    particle_x[p] = orb_x;
    particle_y[p] = orb_y;
    particle_vx[p] = ((i * 5 + combo * 3) % 9) - 4;
    particle_vy[p] = ((i * 7 + combo * 2) % 9) - 4;
    if (particle_vx[p] == 0 && particle_vy[p] == 0) particle_vy[p] = -3;
    particle_life[p] = 18 + i * 2;
    particle_color[p] = color;
  }
}

function near(petal: i32): bool {
  const cx = width() / 2;
  const cy = height() / 2;
  if (petal == PETAL_Y) return abs(orb_x - (cx - 205)) + abs(orb_y - cy) < 270;
  if (petal == PETAL_A) return abs(orb_x - (cx + 205)) + abs(orb_y - cy) < 270;
  if (petal == PETAL_X) return abs(orb_x - cx) + abs(orb_y - (cy - 155)) < 240;
  return abs(orb_x - cx) + abs(orb_y - (cy + 155)) < 240;
}

function strike(petal: i32, color: i32, freq: i32, flags: i32): void {
  petal_pulse[petal] = 10;
  const hit = near(petal);
  if (hit) {
    combo++;
    score += 10 + combo * 3;
    if (bloom < 8) bloom++;
    petal_awake[petal] = 1;
    impact = 12;
    spawn_sparks(color);
  } else {
    combo = 0;
  }
  if (petal == PETAL_Y) orb_vx = abs(orb_vx) + 1;
  else if (petal == PETAL_A) orb_vx = -abs(orb_vx) - 1;
  else if (petal == PETAL_X) orb_vy = abs(orb_vy) + 1;
  else orb_vy = -abs(orb_vy) - 1;
  orb_vx = clamp(orb_vx, -11, 11);
  orb_vy = clamp(orb_vy, -9, 9);
  tone(hit ? freq : freq / 2, hit ? 7 : 3, hit ? 42 : 24, flags);
}

function strike_vane(left: bool): void {
  const hit = left ? orb_x < 390 : orb_x > width() - 390;
  if (left) {
    left_vane = 10;
    orb_vx = abs(orb_vx) + 2;
  } else {
    right_vane = 10;
    orb_vx = -abs(orb_vx) - 2;
  }
  orb_vx = clamp(orb_vx, -12, 12);
  if (hit) {
    combo++;
    score += 15 + combo * 3;
    if (bloom < 8) bloom++;
    impact = 12;
    spawn_sparks(left ? CYAN : YELLOW);
  } else combo = 0;
  tone(hit ? (left ? 294 : 392) : 147, hit ? 8 : 3, hit ? 44 : 22, left ? 4 : 8);
}

function update_particles(): void {
  for (let i: i32 = 0; i < PARTICLES; i++) {
    if (particle_life[i] <= 0) continue;
    particle_x[i] += particle_vx[i];
    particle_y[i] += particle_vy[i];
    particle_vy[i] += 1;
    particle_life[i]--;
  }
}

function cart_process(): void {
  round_f++;
  if (round_f >= RESET_FRAMES) reset_round();
  if (start_pressed()) {
    show_data = !show_data;
    tone(880, 4, 30, 13);
  }

  if (x_pressed()) strike(PETAL_X, RED, 523, 1);
  if (y_pressed()) strike(PETAL_Y, CYAN, 659, 5);
  if (b_pressed()) strike(PETAL_B, LIGHT_GREEN, 784, 9);
  if (a_pressed()) strike(PETAL_A, YELLOW, 988, 13);
  if (l_pressed()) strike_vane(true);
  if (r_pressed()) strike_vane(false);

  if ((frame() & 3) == 0) {
    if (left_held()) orb_vx--;
    if (right_held()) orb_vx++;
    if (up_held()) orb_vy--;
    if (down_held()) orb_vy++;
    orb_vx = clamp(orb_vx, -12, 12);
    orb_vy = clamp(orb_vy, -10, 10);
  }

  for (let i: i32 = TRAIL - 1; i > 0; i--) {
    trail_x[i] = trail_x[i - 1];
    trail_y[i] = trail_y[i - 1];
  }
  trail_x[0] = orb_x;
  trail_y[0] = orb_y;

  if (round_f < ROUND_FRAMES) {
    orb_x += orb_vx;
    orb_y += orb_vy;
    if (orb_x < 166) { orb_x = 166; orb_vx = abs(orb_vx); combo = 0; }
    if (orb_x > width() - 166) { orb_x = width() - 166; orb_vx = -abs(orb_vx); combo = 0; }
    if (orb_y < 116) { orb_y = 116; orb_vy = abs(orb_vy); combo = 0; }
    if (orb_y > height() - 82) { orb_y = height() - 82; orb_vy = -abs(orb_vy); combo = 0; }
  }

  if (left_vane > 0) left_vane--;
  if (right_vane > 0) right_vane--;
  if (impact > 0) impact--;
  for (let i: i32 = 0; i < 4; i++) if (petal_pulse[i] > 0) petal_pulse[i]--;
  update_particles();
}

function step_diamond(cx: i32, cy: i32, rx: i32, ry: i32, color: i32): void {
  const bands: i32 = 7;
  const bh = ry / bands;
  for (let i: i32 = 0; i < bands; i++) {
    const half = rx * (i + 1) / bands;
    px_rect(cx - half, cy - ry + i * bh, half * 2 + 1, bh + 1, color);
    px_rect(cx - half, cy + ry - (i + 1) * bh, half * 2 + 1, bh + 1, color);
  }
}

function draw_petal(id: i32, cx: i32, cy: i32, rx: i32, ry: i32, color: i32, label: string): void {
  step_diamond(cx, cy, rx + 7, ry + 7, DARK_BLUE);
  const awake = petal_awake[id] > 0 || petal_pulse[id] > 0;
  step_diamond(cx, cy, rx, ry, awake ? color : NAVY);
  if (petal_pulse[id] > 0) {
    px_rect_outline(cx - rx - 14, cy - ry - 14, rx * 2 + 29, ry * 2 + 29, WHITE, 3);
  }
  px_text_centered(cx, cy - 9, label, awake ? BLACK : LIGHT_GRAY, 3);
}

function draw_vane(left: bool, pulse: i32): void {
  const base = left ? 54 : width() - 144;
  const fill = pulse > 0 ? WHITE : DARK_BLUE;
  for (let i: i32 = 0; i < 6; i++) {
    const inset = i < 3 ? (2 - i) * 9 : (i - 3) * 9;
    px_rect(base + inset, 164 + i * 68, 90 - inset, 60, fill);
    px_hline(base + inset + 8, 174 + i * 68, 68 - inset, pulse > 0 ? YELLOW : NAVY);
  }
  px_vline(left ? 150 : width() - 151, 150, 430, pulse > 0 ? CYAN : YELLOW);
  px_text_centered(left ? 100 : width() - 100, 548, left ? "L" : "R", pulse > 0 ? BLACK : WHITE, 3);
}

function draw_background(): void {
  clear(BLACK);
  px_rect(0, 0, width(), 72, DARK_BLUE);
  px_rect(0, height() - 54, width(), 54, DARK_BLUE);
  px_hline(0, 72, width(), NAVY);
  px_hline(0, height() - 55, width(), YELLOW);
  for (let i: i32 = 0; i < 34; i++) {
    const x = (73 + i * 197) % width();
    const y = 92 + (31 + i * 83) % (height() - 174);
    const twinkle = ((frame() / 8 + i) % 5) == 0;
    px_rect(x, y, twinkle ? 4 : 2, twinkle ? 4 : 2, twinkle ? CYAN : NAVY);
  }
  px_hline(180, 112, width() - 360, DARK_BLUE);
  px_hline(180, height() - 84, width() - 360, DARK_BLUE);
}

function draw_trail_and_orb(): void {
  for (let i: i32 = TRAIL - 1; i >= 0; i--) {
    const size = i < 4 ? 10 - i * 2 : 3;
    const color = i < 3 ? WHITE : i < 8 ? YELLOW : ORANGE;
    px_rect(trail_x[i] - size / 2, trail_y[i] - size / 2, size, size, color);
  }
  if (impact > 0) {
    const radius = (12 - impact) * 8 + 26;
    px_rect_outline(orb_x - radius, orb_y - radius, radius * 2, radius * 2, CYAN, 2);
  }
  px_rect(orb_x - 15, orb_y - 15, 31, 31, YELLOW);
  px_rect(orb_x - 9, orb_y - 9, 19, 19, WHITE);
  px_rect(orb_x - 3, orb_y - 3, 7, 7, CYAN);
}

function draw_particles(): void {
  for (let i: i32 = 0; i < PARTICLES; i++) {
    if (particle_life[i] <= 0) continue;
    const size = particle_life[i] > 18 ? 6 : particle_life[i] > 8 ? 4 : 2;
    px_rect(particle_x[i], particle_y[i], size, size, particle_color[i]);
  }
}

function draw_data(): void {
  if (!show_data) return;
  px_rect(390, 578, 500, 72, BLACK);
  px_rect_outline(390, 578, 500, 72, CYAN, 2);
  px_text_centered(640, 588, "LIVE CONTROL DATA", CYAN, 2);
  px_text_centered(640, 618,
    (up_held() ? "U" : "-") + (down_held() ? "D" : "-") +
    (left_held() ? "L" : "-") + (right_held() ? "R" : "-") + "   " +
    (a_held() ? "A" : "-") + (b_held() ? "B" : "-") +
    (x_held() ? "X" : "-") + (y_held() ? "Y" : "-") + "   " +
    (l_held() ? "L" : "-") + (r_held() ? "R" : "-"), WHITE, 2);
}

function cart_draw(): void {
  draw_background();
  const cx = width() / 2;
  const cy = height() / 2 + 8;

  draw_vane(true, left_vane);
  draw_vane(false, right_vane);
  draw_petal(PETAL_Y, cx - 205, cy, 128, 56, RED, "Y");
  draw_petal(PETAL_A, cx + 205, cy, 128, 56, LIGHT_GREEN, "A");
  draw_petal(PETAL_X, cx, cy - 155, 56, 100, CYAN, "X");
  draw_petal(PETAL_B, cx, cy + 155, 56, 100, YELLOW, "B");
  px_rect(cx - 38, cy - 38, 77, 77, DARK_BLUE);
  px_rect(cx - 25, cy - 25, 51, 51, bloom >= 8 ? WHITE : YELLOW);
  px_rect(cx - 7, cy - 7, 15, 15, CYAN);

  draw_trail_and_orb();
  draw_particles();

  px_text(24, 18, "CAL/X RESONATOR", YELLOW, 3);
  const remain = round_f < ROUND_FRAMES ? (ROUND_FRAMES - round_f) / 60 : 0;
  px_text_centered(cx, 18, "00:" + (remain < 10 ? "0" : "") + remain.toString(), WHITE, 3);
  px_text(width() - 210, 18, "X" + combo.toString() + "  " + score.toString(), LIGHT_GREEN, 3);

  if (round_f >= ROUND_FRAMES) {
    px_rect(360, 270, 560, 190, BLACK);
    px_rect_outline(360, 270, 560, 190, YELLOW, 4);
    px_text_centered(cx, 298, score > 1800 ? "SUPERNOVA" : score > 900 ? "RADIANT" : "BRIGHT", WHITE, 5);
    px_text_centered(cx, 378, "THE FLOWER HOLDS", CYAN, 2);
  } else if (round_f < 360 && !show_data) {
    px_text_centered(cx, height() - 38,
      "DPAD NUDGE   FACE PETALS   L/R VANES   START DATA", LIGHT_GRAY, 2);
  }
  draw_data();
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update_30(cart_process, cart_draw); }
