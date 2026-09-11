// A first Calyx cart. Search for CUSTOMIZE, make one change, and rebuild.

import {
  run_start, run_update,
  width, height, clear, px_circle, px_circle_outline, px_text_centered,
  input_x, input_y, a_pressed, clamp, sfx,
  BLACK, WHITE, DARK_BLUE, CYAN, YELLOW, ORANGE,
} from "./sunny/index";

// CUSTOMIZE: try another title, speed, or pair of colors.
const TITLE = "MY CALYX CART";
const SPEED: i32 = 2;
const HERO_COLOR: i32 = YELLOW;
const PULSE_COLOR: i32 = ORANGE;

let x: i32 = 160;
let y: i32 = 120;
let pulse: i32 = 0;

function ready(): void {
  x = width() / 2;
  y = height() / 2;
  pulse = 0;
}

function process(): void {
  x = clamp<i32>(x + input_x() * SPEED, 8, width() - 8);
  y = clamp<i32>(y + input_y() * SPEED, 30, height() - 8);
  if (a_pressed()) {
    pulse = 18;
    sfx("coin");
  } else if (pulse > 0) {
    pulse--;
  }
}

function draw(): void {
  clear(BLACK);
  px_text_centered(width() / 2, 8, TITLE, WHITE, 2);
  px_text_centered(width() / 2, 224, "D-PAD MOVE   A PULSE", CYAN);
  if (pulse > 0) px_circle_outline(x, y, 8 + (18 - pulse), PULSE_COLOR);
  px_circle(x, y, 7, HERO_COLOR);
  px_circle(x, y, 2, DARK_BLUE);
}

export function start(): void { run_start(ready); }
export function update(): void { run_update(process, draw); }
