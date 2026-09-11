// settings (ABI v1.6 SYSTEM cart, T17) — the console settings/About page.
//
// Transient by design: values live in cart memory for the session
// (persistent settings arrive with v2 persistence, ABI §4b). Up/down
// selects a row, left/right adjusts, START calls sys_exit — back to the
// launcher — which lands in the dump's `sys` events, so the golden pins
// navigation, value edits, and the exit intent.

import {
  run_start, run_update,
  frame, trace,
  clear, px_rect, px_rect_outline, px_hline, px_vline,
  px_circle, px_circle_outline, px_text, px_text_centered,
  tone,
  up_pressed, down_pressed, left_pressed, right_pressed,
  a_pressed, b_pressed, start_pressed,
  BLACK, WHITE, YELLOW, LIGHT_GRAY, DARK_GRAY, NAVY, GREEN, RED, CYAN,
} from "../../../sdk/assembly/index";
import { InputMethod, exit, input_method } from "../../../sdk/assembly/sys";

const ROWS: string[] = ["VOLUME", "SCANLINES", "TICK SOUND", "ABOUT CALYX"];

let sel: i32 = 0;
let volume: i32 = 7; // 0..10
let scanlines: bool = false;
let tick: bool = true;
let about_open: bool = false;
let tick_pulse: i32 = 0;

let f: i32 = 0;

function preview_tick(): void {
  tick_pulse = 8;
  if (tick && volume > 0) tone(620, 3, volume * 6);
}

function adjust(delta: i32): bool {
  if (sel == 0) {
    const before = volume;
    volume += delta;
    if (volume < 0) volume = 0;
    if (volume > 10) volume = 10;
    return volume != before;
  } else if (sel == 1) {
    scanlines = !scanlines;
    return true;
  } else if (sel == 2) {
    tick = !tick;
    return true;
  } else {
    about_open = true;
    return true;
  }
}

function cart_ready(): void {
  // transient — nothing to load (ABI §4b: settings are in-memory in v1)
}

function cart_process(): void {
  f = frame();
  if (tick_pulse > 0) tick_pulse--;
  if (start_pressed()) {
    exit();
    return;
  }
  if (about_open) {
    if (a_pressed() || b_pressed()) about_open = false;
    return;
  }
  let changed = false;
  // One action per simulation tick keeps diagonal/opposed input deterministic and keeps
  // a single physical press from both navigating and editing a new row.
  if (up_pressed()) {
    if (sel > 0) { sel--; changed = true; }
  } else if (down_pressed()) {
    if (sel < ROWS.length - 1) { sel++; changed = true; }
  } else if (left_pressed()) {
    changed = adjust(-1);
  } else if (right_pressed()) {
    changed = adjust(1);
  } else if (a_pressed() && sel == 3) {
    about_open = true;
    changed = true;
  }
  if (changed) preview_tick();
}

function onoff(v: bool): string {
  return v ? "ON" : "OFF";
}

function draw_mark(x: i32, y: i32, color: i32): void {
  // A larger indexed adaptation of the canonical four-petal Calyx mark.
  px_rect(x + 10, y, 6, 8, color);
  px_rect(x + 8, y + 4, 10, 6, color);
  px_rect(x + 10, y + 18, 6, 8, color);
  px_rect(x + 8, y + 16, 10, 6, color);
  px_rect(x, y + 10, 8, 6, color);
  px_rect(x + 4, y + 8, 6, 10, color);
  px_rect(x + 18, y + 10, 8, 6, color);
  px_rect(x + 16, y + 8, 6, 10, color);
  px_rect(x + 10, y + 10, 6, 6, BLACK);
  px_rect(x + 12, y + 12, 2, 2, color);
}

function draw_about(): void {
  px_rect(18, 48, 284, 160, DARK_GRAY);
  px_rect_outline(18, 48, 284, 160, CYAN);
  draw_mark(147, 60, YELLOW);
  px_text_centered(160, 94, "CHEESY CRAB CALYX", WHITE, 2);
  px_text_centered(160, 120, "PRODUCT 1.0.0 RELEASE CANDIDATE", LIGHT_GRAY);
  px_text_centered(160, 136, "CALYX ABI v1.6", CYAN);
  px_text_centered(160, 158, "CART SDK  SUNNY", LIGHT_GRAY);
  px_text_centered(160, 178, "A CHEESY CRAB PROJECT", YELLOW);
  px_text_centered(160, 194, "GAMES  SOFTWARE  WORLDS", LIGHT_GRAY);
}

function draw_footer(): void {
  const method = input_method();
  if (method == InputMethod.TOUCH) return;
  px_rect(0, 220, 320, 20, DARK_GRAY);
  if (method == InputMethod.CONTROLLER) {
    px_text_centered(160, 224,
      about_open
        ? "A/B CLOSE   START HOME"
        : sel == 3
          ? "DPAD MOVE   A OPEN   START HOME"
          : "DPAD MOVE / CHANGE   START HOME",
      BLACK);
  } else {
    px_text_centered(160, 224,
      about_open
        ? "Z/X CLOSE   ENTER HOME"
        : sel == 3
          ? "ARROWS MOVE   Z OPEN   ENTER HOME"
          : "ARROWS MOVE / CHANGE   ENTER HOME",
      BLACK);
  }
}

function draw_preview_scanlines(): void {
  if (!scanlines) return;
  for (let y = 78; y < 198; y += 4) px_hline(170, y, 128, BLACK);
}

function draw_preview(): void {
  const pulse_color = tick_pulse > 0 ? YELLOW : CYAN;
  px_rect(164, 56, 140, 150, NAVY);
  px_rect_outline(164, 56, 140, 150, pulse_color);
  px_text_centered(234, 64, "LIVE PREVIEW", WHITE);

  // A small console signal chamber: orbit, sweep, and level meter make every
  // preference visible without claiming to configure the host presenter.
  px_circle_outline(234, 119, 28, LIGHT_GRAY);
  px_circle_outline(234, 119, 18, DARK_GRAY);
  const orbit = f % 112;
  let ox: i32 = 0;
  let oy: i32 = 0;
  if (orbit < 28) { ox = orbit - 14; oy = -14; }
  else if (orbit < 56) { ox = 14; oy = orbit - 42; }
  else if (orbit < 84) { ox = 70 - orbit; oy = 14; }
  else { ox = -14; oy = 98 - orbit; }
  px_circle(234 + ox, 119 + oy, 2, pulse_color);
  px_hline(206, 119, 57, NAVY);
  px_vline(234, 91, 57, NAVY);
  draw_mark(221, 106, pulse_color);

  px_text(174, 158, "LEVEL", LIGHT_GRAY);
  for (let c = 0; c < 10; c++) {
    const filled = c < volume;
    const bar_h = 3 + c + (filled && tick_pulse > 0 ? 2 : 0);
    const color = c < volume ? GREEN : BLACK;
    px_rect(174 + c * 12, 184 - bar_h, 8, bar_h, color);
  }
  px_hline(174, 186, 116, DARK_GRAY);
  px_text(174, 190, scanlines ? "SCAN ON" : "SCAN OFF",
    scanlines ? GREEN : LIGHT_GRAY);
  px_text(246, 190, tick ? "TICK" : "MUTE", tick ? GREEN : RED);
  draw_preview_scanlines();
}

function cart_draw(): void {
  clear(BLACK);
  px_text_centered(160, 8, "PREFERENCES PREVIEW", WHITE, 2);
  px_text_centered(160, 32, "LOCAL ONLY - RESETS ON HOME", DARK_GRAY);
  px_hline(120 + (f % 80), 42, 8, CYAN);

  if (about_open) {
    draw_about();
  } else {
    draw_preview();
    for (let i = 0; i < ROWS.length; i++) {
      const y = 66 + i * 34;
      if (i == sel) px_rect(12, y - 6, 144, 27, DARK_GRAY);
      px_text(20, y, ROWS[i], i == sel ? YELLOW : LIGHT_GRAY);
      if (i == 0) {
        px_text(116, y, volume.toString(), volume > 0 ? GREEN : RED);
      } else if (i < 3) {
        const v = i == 1 ? scanlines : tick;
        px_text(112, y, onoff(v), v ? GREEN : RED);
      } else {
        px_text(104, y, "OPEN >", CYAN);
      }
    }
  }

  draw_footer();
  const method = input_method();
  trace(
    "sel=" + sel.toString() + " vol=" + volume.toString() +
    " scan=" + onoff(scanlines) + " tick=" + onoff(tick) +
    " about=" + (about_open ? "ON" : "OFF") +
    " input=" + method.toString(),
  );
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
