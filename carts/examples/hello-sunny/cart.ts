// hello-sunny — the canonical first Sunny cart.
//
// This is both a runnable example and the source used by tools/new_cart.py.
// Keep it readable: a new author should understand the shape before they know
// the whole SDK. Search for CUSTOMIZE when turning it into your own cart.

import {
  run_start, run_update,
  frame, width, height,
  clear, px_rect, px_rect_outline, px_line,
  px_circle, px_circle_outline, px_text, px_text_centered, trace,
  input_x, input_y, a_pressed, b_pressed,
  clamp, Vec2i, sfx,
  BLACK, WHITE, DARK_BLUE, DARK_GRAY, LIGHT_GRAY,
  YELLOW, ORANGE, CYAN, LIGHT_BLUE, GREEN,
} from "../../../sdk/assembly/index";

// CUSTOMIZE: title, speed, colors, and controls are safe first edits.
const TITLE = "HELLO SUNNY";
const MOVE_SPEED: i32 = 2;
const MOTE_RADIUS: i32 = 8;
const MOTE_MARGIN_X: i32 = 18;
const MOTE_MARGIN_Y: i32 = 57;
const PULSE_FRAMES: i32 = 16;

let mote = new Vec2i();
let mote_step = new Vec2i();
let pulse_timer: i32 = 0;
let pulse_count: i32 = 0;
let ready_pending: bool = false;

function reset_mote(): void {
  mote.set(width() / 2, height() / 2);
  pulse_timer = 0;
  pulse_count = 0;
}

function cart_ready(): void {
  reset_mote();
  ready_pending = true;
}

function cart_process(): void {
  if (ready_pending) {
    trace("hello-sunny ready x=" + mote.x.toString() + " y=" + mote.y.toString());
    ready_pending = false;
  }
  mote_step.set(input_x(), input_y()).scale_in_place(MOVE_SPEED);
  mote.add_in_place(mote_step);
  mote.set(
    clamp<i32>(mote.x, MOTE_MARGIN_X, width() - MOTE_MARGIN_X),
    clamp<i32>(mote.y, MOTE_MARGIN_Y, height() - MOTE_MARGIN_Y),
  );

  // B wins if both actions arrive together: reset is always unambiguous.
  if (b_pressed()) {
    reset_mote();
    sfx("blip");
    trace("hello-sunny reset x=" + mote.x.toString() + " y=" + mote.y.toString());
  } else if (a_pressed()) {
    pulse_timer = PULSE_FRAMES;
    pulse_count += 1;
    sfx("coin");
    trace("hello-sunny pulse=" + pulse_count.toString() +
      " x=" + mote.x.toString() + " y=" + mote.y.toString());
  } else if (pulse_timer > 0) {
    pulse_timer -= 1;
  }
}

function cart_draw(): void {
  const f = frame();
  clear(BLACK);

  px_rect(0, 0, width(), 43, DARK_BLUE);
  px_text_centered(width() / 2, 4, TITLE, WHITE, 2);
  px_text_centered(width() / 2, 29, "D-PAD MOVE   A PULSE   B RESET", LIGHT_GRAY);

  px_rect_outline(8, 48, width() - 16, 158, DARK_GRAY);
  px_line(16, 56, mote.x, mote.y, CYAN);
  px_line(width() - 16, 56, mote.x, mote.y, GREEN);

  // The pulse expands one integer pixel per simulation tick.
  if (pulse_timer > 0) {
    const age = PULSE_FRAMES - pulse_timer;
    const pulse_color = pulse_timer > PULSE_FRAMES / 2 ? ORANGE : LIGHT_BLUE;
    px_circle_outline(mote.x, mote.y, MOTE_RADIUS + 4 + age, pulse_color);
  }
  px_circle(mote.x, mote.y, MOTE_RADIUS, YELLOW);
  px_rect(mote.x - 3, mote.y - 3, 6, 6, WHITE);

  px_rect(0, 214, width(), 26, DARK_BLUE);
  px_text(9, 220, "X=" + mote.x.toString() + "  Y=" + mote.y.toString() +
    "  PULSES=" + pulse_count.toString() + "  FRAME=" + f.toString(), LIGHT_GRAY);
}

// Calyx calls these two exports. Sunny's runners handle frame/input bookkeeping
// and invoke the three small CartBase-shaped callbacks above.
export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
