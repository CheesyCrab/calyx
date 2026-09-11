// Calyx Boot — Sunny wakes as the kernel; Calyx assembles around it.

import {
  run_start, run_update,
  frame, trace,
  clear, px_hline, px_vline, px_circle, px_circle_outline,
  set_palette_bytes,
  up_pressed, down_pressed, left_pressed, right_pressed,
  a_pressed, b_pressed, start_pressed,
  sfx,
  BLACK, WHITE, ORANGE, YELLOW, DARK_GRAY,
} from "../../../sdk/assembly/index";
import { exit } from "../../../sdk/assembly/sys";
import {
  LOGO_SIZE,
  CALYX_PANEL_SPANS,
  SUNNY_SMALL_SIZE,
  SUNNY_SMALL_PETAL_SPANS,
  SUNNY_SMALL_CARDINAL_RAYS_SPANS,
  SUNNY_SMALL_DIAGONAL_A_SPANS,
  SUNNY_SMALL_DIAGONAL_B_SPANS,
  SUNNY_SHRINK_72_SIZE, SUNNY_SHRINK_72_SPANS,
  SUNNY_SHRINK_44_SIZE, SUNNY_SHRINK_44_SPANS,
  SUNNY_SHRINK_24_SIZE, SUNNY_SHRINK_24_SPANS,
} from "./logo_assets";

const EXIT_FRAME: i32 = 95;
const SKIP_FRAME: i32 = 56;
const TILE_X: i32 = 58;
const TILE_Y: i32 = 8;
const CX: i32 = 160;
const CY: i32 = 110;

const BRAND_RGB: StaticArray<u8> = [
  0x1a, 0x1c, 0x2c, 0xf4, 0xf4, 0xf4, 0x33, 0x3c, 0x57, 0x5d, 0x27, 0x5d,
  0xb1, 0x3e, 0x53, 0xd6, 0xa6, 0x2a, 0xf7, 0xc8, 0x43, 0xa7, 0xf0, 0x70,
  0x38, 0xb7, 0x64, 0x25, 0x71, 0x79, 0x29, 0x36, 0x6f, 0x3b, 0x5d, 0xc9,
  0x41, 0xa6, 0xf6, 0x73, 0xef, 0xf7, 0x94, 0xb0, 0xc2, 0x56, 0x6c, 0x86,
];

const CONTACTS: i32[] = [38, 40, 38, 40];
const GLYPH_S: i32[] = [31, 16, 16, 31, 1, 1, 31];
const GLYPH_U: i32[] = [17, 17, 17, 17, 17, 17, 14];
const GLYPH_N: i32[] = [17, 25, 25, 21, 19, 19, 17];
const GLYPH_Y: i32[] = [17, 17, 10, 4, 4, 4, 4];
const GLYPH_C: i32[] = [14, 17, 16, 16, 16, 17, 14];
const GLYPH_A: i32[] = [14, 17, 17, 31, 17, 17, 17];
const GLYPH_L: i32[] = [16, 16, 16, 16, 16, 16, 31];
const GLYPH_X: i32[] = [17, 17, 10, 4, 10, 17, 17];
const WORD_SUNNY: i32[] = [0, 1, 2, 2, 3];
const WORD_CALYX: i32[] = [4, 5, 6, 3, 7];

let f: i32 = 0;
let released: bool = false;

function any_pressed(): bool {
  return up_pressed() || down_pressed() || left_pressed() || right_pressed() ||
    a_pressed() || b_pressed() || start_pressed();
}

function cart_ready(): void {
  set_palette_bytes(BRAND_RGB, 16);
}

function cart_process(): void {
  f = frame();
  if (f == 3) sfx("blip");
  if (f == 10) sfx("powerup");
  if (f == 38) sfx("hit");
  if (f == 40) sfx("hit");
  if (f == 48) sfx("fanfare");
  if (!released && (f == EXIT_FRAME || (f >= SKIP_FRAME && any_pressed()))) {
    released = true;
    exit();
  }
}

function panel_offset(rotation: i32, amount: i32): i32[] {
  if (rotation == 0) return [0, -amount];
  if (rotation == 1) return [amount, 0];
  if (rotation == 2) return [0, amount];
  return [-amount, 0];
}

function gold_radius(): i32 {
  if (f < 48) return -1;
  return 16 + (f - 48) * 32;
}

function span_length(spans: StaticArray<i32>, offset: i32): i32 {
  return spans[offset + 2] - spans[offset + 1] + 1;
}

function recolor_hline(x: i32, y: i32, length: i32): void {
  const radius = gold_radius();
  const dy = y >= CY ? y - CY : CY - y;
  const half_width = radius - dy;
  if (half_width < 0) return;
  const left = x > CX - half_width ? x : CX - half_width;
  const right_edge = x + length - 1;
  const right = right_edge < CX + half_width ? right_edge : CX + half_width;
  if (right >= left) px_hline(left, y, right - left + 1, ORANGE);
}

function recolor_vline(x: i32, y: i32, length: i32): void {
  const radius = gold_radius();
  const dx = x >= CX ? x - CX : CX - x;
  const half_height = radius - dx;
  if (half_height < 0) return;
  const top = y > CY - half_height ? y : CY - half_height;
  const bottom_edge = y + length - 1;
  const bottom = bottom_edge < CY + half_height ? bottom_edge : CY + half_height;
  if (bottom >= top) px_vline(x, top, bottom - top + 1, ORANGE);
}

function draw_rotated(
  spans: StaticArray<i32>, rotation: i32, dx: i32, dy: i32, color: i32,
): void {
  for (let i = 0; i < spans.length; i += 3) {
    const y = spans[i];
    const x0 = spans[i + 1];
    const x1 = spans[i + 2];
    const length = x1 - x0 + 1;
    if (rotation == 0) {
      const line_x = TILE_X + x0 + dx;
      const line_y = TILE_Y + y + dy;
      px_hline(line_x, line_y, length, color);
      if (f < 51) recolor_hline(line_x, line_y, length);
    } else if (rotation == 1) {
      const line_x = TILE_X + LOGO_SIZE - 1 - y + dx;
      const line_y = TILE_Y + x0 + dy;
      px_vline(line_x, line_y, length, color);
      if (f < 51) recolor_vline(line_x, line_y, length);
    } else if (rotation == 2) {
      const line_x = TILE_X + LOGO_SIZE - 1 - x1 + dx;
      const line_y = TILE_Y + LOGO_SIZE - 1 - y + dy;
      px_hline(line_x, line_y, length, color);
      if (f < 51) recolor_hline(line_x, line_y, length);
    } else {
      const line_x = TILE_X + y + dx;
      const line_y = TILE_Y + LOGO_SIZE - 1 - x1 + dy;
      px_vline(line_x, line_y, length, color);
      if (f < 51) recolor_vline(line_x, line_y, length);
    }
  }
}

function draw_sunny_rotated(
  spans: StaticArray<i32>, rotation: i32, color: i32,
): void {
  const ox = CX - SUNNY_SMALL_SIZE / 2;
  const oy = CY - SUNNY_SMALL_SIZE / 2;
  for (let i = 0; i < spans.length; i += 3) {
    const y = spans[i];
    const x0 = spans[i + 1];
    const x1 = spans[i + 2];
    const length = x1 - x0 + 1;
    if (rotation == 0) {
      px_hline(ox + x0, oy + y, length, color);
    } else if (rotation == 1) {
      px_vline(ox + SUNNY_SMALL_SIZE - 1 - y, oy + x0, length, color);
    } else if (rotation == 2) {
      px_hline(ox + SUNNY_SMALL_SIZE - 1 - x1,
        oy + SUNNY_SMALL_SIZE - 1 - y, length, color);
    } else {
      px_vline(ox + y, oy + SUNNY_SMALL_SIZE - 1 - x1, length, color);
    }
  }
}

function draw_sunny_flat(spans: StaticArray<i32>, color: i32): void {
  const ox = CX - SUNNY_SMALL_SIZE / 2;
  const oy = CY - SUNNY_SMALL_SIZE / 2;
  for (let i = 0; i < spans.length; i += 3) {
    px_hline(ox + spans[i + 1], oy + spans[i],
      span_length(spans, i), color);
  }
}

function draw_centered_mask(spans: StaticArray<i32>, size: i32, color: i32): void {
  const ox = CX - size / 2;
  const oy = CY - size / 2;
  for (let i = 0; i < spans.length; i += 3) {
    px_hline(ox + spans[i + 1], oy + spans[i],
      span_length(spans, i), color);
  }
}

function draw_sunny(): void {
  if (f >= 42) {
    if (f < 44) draw_centered_mask(SUNNY_SHRINK_72_SPANS, SUNNY_SHRINK_72_SIZE, YELLOW);
    else if (f < 46) draw_centered_mask(SUNNY_SHRINK_44_SPANS, SUNNY_SHRINK_44_SIZE, YELLOW);
    else if (f < 48) draw_centered_mask(SUNNY_SHRINK_24_SPANS, SUNNY_SHRINK_24_SIZE, YELLOW);
    return;
  }
  // The petals clock in one-by-one like a warm boot spinner.
  if (f >= 2) {
    draw_sunny_rotated(SUNNY_SMALL_PETAL_SPANS, 0, YELLOW);
  }
  if (f >= 4) {
    draw_sunny_rotated(SUNNY_SMALL_PETAL_SPANS, 1, YELLOW);
  }
  if (f >= 6) {
    draw_sunny_rotated(SUNNY_SMALL_PETAL_SPANS, 2, YELLOW);
  }
  if (f >= 8) {
    draw_sunny_rotated(SUNNY_SMALL_PETAL_SPANS, 3, YELLOW);
  }
  if (f >= 10) {
    draw_sunny_flat(SUNNY_SMALL_CARDINAL_RAYS_SPANS, YELLOW);
  }
  if (f >= 12) {
    draw_sunny_flat(SUNNY_SMALL_DIAGONAL_A_SPANS, YELLOW);
  }
  if (f >= 14) {
    draw_sunny_flat(SUNNY_SMALL_DIAGONAL_B_SPANS, YELLOW);
  }
}

function approach(rotation: i32): i32 {
  const contact = CONTACTS[rotation];
  if (f >= contact) return 0;
  const remaining = contact - f;
  if (remaining == 1) return 10;
  return (remaining * remaining) / 4;
}

function draw_terminal_dot(rotation: i32, dx: i32, dy: i32, color: i32): void {
  let x = CX;
  let y = TILE_Y + 5;
  if (rotation == 1) { x = TILE_X + LOGO_SIZE - 5; y = CY; }
  else if (rotation == 2) { x = CX; y = TILE_Y + LOGO_SIZE - 5; }
  else if (rotation == 3) { x = TILE_X + 5; y = CY; }
  px_circle(x + dx, y + dy, 2, color);
}

function draw_calyx_assembly(): void {
  for (let rotation = 0; rotation < 4; rotation++) {
    const contact = CONTACTS[rotation];
    if (f < contact - 16) continue;
    const amount = approach(rotation);
    const delta = panel_offset(rotation, amount);
    draw_rotated(CALYX_PANEL_SPANS, rotation, delta[0], delta[1],
      f >= 51 ? ORANGE : DARK_GRAY);
    if (f >= contact) {
      const dot_distance = rotation == 0 || rotation == 2 ?
        (TILE_Y + LOGO_SIZE - 5 - CY) : (TILE_X + LOGO_SIZE - 5 - CX);
      draw_terminal_dot(rotation, delta[0], delta[1],
        gold_radius() >= dot_distance ? ORANGE : DARK_GRAY);
    }
  }
}

function draw_ignition(): void {
  if (f < 46 || f >= 50) return;
  const radius = 6 + (f - 46) * 8;
  px_circle_outline(CX, CY, radius, ORANGE);
  if (radius > 2) px_circle_outline(CX, CY, radius - 1, WHITE);
  if (radius > 4) px_circle_outline(CX, CY, radius - 3, ORANGE);
}

function draw_field(): void {
  if (f >= 48 && f < 81) {
    const radius = 8 + (f - 48) * 5;
    px_circle_outline(CX, CY, radius, WHITE);
    if (radius > 3) px_circle_outline(CX, CY, radius - 2, ORANGE);
  }
  if (f >= 52 && f < 84) {
    const radius = 8 + (f - 52) * 5;
    px_circle_outline(CX, CY, radius, ORANGE);
  }
}

function glyph_row(glyph: i32, row: i32): i32 {
  if (glyph == 0) return GLYPH_S[row];
  if (glyph == 1) return GLYPH_U[row];
  if (glyph == 2) return GLYPH_N[row];
  if (glyph == 3) return GLYPH_Y[row];
  if (glyph == 4) return GLYPH_C[row];
  if (glyph == 5) return GLYPH_A[row];
  if (glyph == 6) return GLYPH_L[row];
  return GLYPH_X[row];
}

function word_glyph(word: i32, position: i32): i32 {
  return word == 0 ? WORD_SUNNY[position] : WORD_CALYX[position];
}

function word_color(word: i32): i32 {
  if (word == 0) return YELLOW;
  return ORANGE;
}

function draw_word_sweep(from_word: i32, to_word: i32, sweep: i32): void {
  const origin_x = 127;
  const origin_y = 220;
  const edge: i32[] = [-1, 0, 1, 2, 1, 0, -1];
  for (let position = 0; position < 5; position++) {
    const old_glyph = word_glyph(from_word, position);
    const new_glyph = word_glyph(to_word, position);
    for (let column = 0; column < 5; column++) {
      for (let row = 0; row < 7; row++) {
        const changed = position * 7 + column <= sweep + edge[row];
        const glyph = changed ? new_glyph : old_glyph;
        if ((glyph_row(glyph, row) & (16 >> column)) != 0) {
          const material = changed ? to_word : from_word;
          const weight = material == 0 ? 2 : 3;
          px_hline(origin_x + position * 14 + column * 2,
            origin_y + row * 2, weight, word_color(material));
          px_hline(origin_x + position * 14 + column * 2,
            origin_y + row * 2 + 1, weight, word_color(material));
          if (material != 0) {
            px_hline(origin_x + position * 14 + column * 2,
              origin_y + row * 2 + 2, weight, word_color(material));
          }
        }
      }
    }
  }
}

function draw_identity_mold(): void {
  if (f < 48) draw_word_sweep(0, 0, 34);
  else if (f < 70) draw_word_sweep(0, 1, ((f - 48) * 36) / 22 - 1);
  else draw_word_sweep(1, 1, 34);
}

function phase_name(): string {
  if (f < 18) return "SUNNY BLOOM";
  if (f < 40) return "CALYX ASSEMBLY";
  if (f < 48) return "CORE TRANSFER";
  return "CALYX HOLD";
}

function cart_draw(): void {
  clear(BLACK);
  draw_calyx_assembly();
  draw_field();
  draw_sunny();
  draw_ignition();
  px_circle(CX, CY, f < 2 ? 2 : 3, YELLOW);
  draw_identity_mold();
  trace("boot phase=" + phase_name() + " frame=" + f.toString());
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
