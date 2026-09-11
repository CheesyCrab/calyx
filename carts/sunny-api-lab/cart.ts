// Sunny API Lab — interactive, self-documenting ordinary-cart API tour.

import {
  run_start, run_update,
  frame, width, height, clear, px_pixel, px_rect, px_hline, px_vline,
  px_text, blit_sprite, blit_sprite_scaled, blit_sprite_region, clip_rect, reset_clip, tone, trace,
  px_line, px_rect_outline, px_circle, px_circle_outline,
  px_text_centered, px_text_wrapped, text_width, text_line_height,
  btn, input_x, input_y,
  up_held, down_held, left_held, right_held, a_held, b_held, start_held,
  up_pressed, down_pressed, left_pressed, right_pressed, a_pressed, b_pressed, start_pressed,
  up_released, down_released, left_released, right_released, a_released, b_released, start_released,
  clamp_x, clamp_y, wrap_x, wrap_y, is_on_screen,
  seed, rand, rand_range, rand_state,
  note_to_freq, set_drums, set_melody, set_voice, set_bpm,
  play_music, stop_music, sfx, sfx_note,
  use_palette,
  clamp, wrap, Vec2, Vec3, Rect,
  FLIP_X, FLIP_Y, COLOR_KEY,
  BLACK, WHITE, DARK_BLUE, PURPLE, RED, ORANGE, YELLOW, LIGHT_GREEN,
  GREEN, TEAL, NAVY, BLUE, LIGHT_BLUE, CYAN, LIGHT_GRAY, DARK_GRAY,
} from "../../sdk/assembly/index";

const LABS: string[] = [
  "CANVAS", "TEXT", "INPUT", "SPRITE", "SCREEN", "RANDOM", "AUDIO", "LIFECYCLE", "PALETTE",
  "MATH",
];
const SUBTITLES: string[] = [
  "PIXELS TO CIRCLES", "MEASURE CENTER WRAP", "LEVELS AXES EDGES",
  "SCALE REGION CLIP", "DEVICE + BOUNDS", "SEEDED REPLAY",
  "TONE SFX MUSIC", "START UPDATE FRAME", "INDEXED + START-ONLY",
  "GUEST-SIDE VALUES",
];
const ARROW_W: i32 = 16;
const ARROW_H: i32 = 12;
const ARROW: StaticArray<u8> = [
  0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,6,6,0,0,0,0,0,0,
  0,0,0,5,5,5,0,0,6,6,6,0,0,0,0,0,
  12,12,12,12,12,12,12,12,6,6,6,6,0,0,0,0,
  12,12,12,12,12,12,12,12,6,6,6,6,6,0,0,0,
  12,12,12,12,12,12,12,12,6,6,6,6,6,6,0,0,
  12,12,12,12,12,12,12,12,6,6,6,6,6,0,0,0,
  12,12,12,12,12,12,12,12,6,6,6,6,0,0,0,0,
  0,0,0,0,0,0,0,0,6,6,6,0,0,0,0,0,
  0,0,0,0,0,0,0,0,6,6,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
];

let in_lab = false;
let selected: i32 = 0;
let variant: i32 = 0;
let rng_a: u32 = 0;
let rng_b: i32 = 0;
let rng_c: i32 = 0;
let rng_resets: i32 = 0;
let music_on = false;
let ready_pending = false;
let input_b_exit_pending = false;
let last_event = "boot";
let rng_first_a: u32 = 0;
let rng_first_b: i32 = 0;
let rng_first_c: i32 = 0;
let rng_match = false;

function trace_event(event: string): void {
  last_event = event;
  trace("manual event=" + event + " view=" + (in_lab ? "lab" : "index") +
    " page=" + LABS[selected] + " variant=" + variant.toString());
}

function reset_rng(): void {
  seed(0x5eed1234);
  rng_a = rand();
  rng_b = rand_range(-20, 21);
  rng_c = rand_range(100, 1000);
  if (rng_resets == 0) {
    rng_first_a = rng_a;
    rng_first_b = rng_b;
    rng_first_c = rng_c;
  }
  rng_match = rng_a == rng_first_a && rng_b == rng_first_b && rng_c == rng_first_c;
  rng_resets++;
}

function cart_ready(): void {
  // The default named palette is intentionally a no-op at the ABI boundary.
  use_palette("SWEETIE_16");
  reset_rng();
  set_drums(120, [
    [1,0,0,0,1,0,0,0],
    [0,0,1,0,0,0,1,0],
    [1,1,1,1,1,1,1,1],
  ]);
  set_melody(0, ["C4", "E4", "G4", "C5:2"]);
  set_voice(0, "triangle");
  ready_pending = true;
}

function lab_variant_count(page: i32): i32 {
  if (page == 0 || page == 1) return 3;
  if (page == 3) return 6;
  if (page == 6) return 6;
  return 1;
}

function previous_index(index: i32, count: i32): i32 {
  return (index + count - 1) % count;
}

function next_index(index: i32, count: i32): i32 {
  return (index + 1) % count;
}

function activate(): void {
  if (selected == 5) {
    reset_rng();
  }
  if (selected == 6) {
    if (variant == 0) sfx("coin");
    else if (variant == 1) sfx_note("C5", 12, "sine");
    else if (variant == 2) tone(330, 18, 55, 1);
    else if (variant == 3) { set_bpm(120); play_music(); music_on = true; }
    else if (variant == 4) { set_bpm(180); play_music(); music_on = true; }
    else { stop_music(); music_on = false; }
  }
  trace_event("activate");
}

function close_lab(): void {
  if (music_on) { stop_music(); music_on = false; }
  in_lab = false;
  variant = 0;
  input_b_exit_pending = false;
  trace_event("index");
}

function cart_process(): void {
  if (ready_pending) {
    trace_event("ready");
    ready_pending = false;
  }
  if (!in_lab) {
    if (up_pressed()) {
      selected = previous_index(selected, LABS.length);
      trace_event("select");
    } else if (down_pressed()) {
      selected = next_index(selected, LABS.length);
      trace_event("select");
    }
    if (a_pressed()) {
      in_lab = true;
      variant = 0;
      input_b_exit_pending = false;
      trace_event("open");
    }
    return;
  }

  // The Input page renders B pressed, held, and released before returning.
  if (selected == 2) {
    if (input_b_exit_pending && !b_held() && !b_released()) {
      close_lab();
      return;
    }
    if (b_pressed()) {
      input_b_exit_pending = true;
      trace_event("input-b");
    }
  } else if (b_pressed()) {
    close_lab();
    return;
  }
  const count = lab_variant_count(selected);
  if (left_pressed()) {
    variant = previous_index(variant, count);
    trace_event("example");
  } else if (right_pressed()) {
    variant = next_index(variant, count);
    trace_event("example");
  }
  if (a_pressed() && (selected == 5 || selected == 6)) activate();
  if (start_pressed() && selected == 6) {
    if (music_on) { stop_music(); music_on = false; }
    else { play_music(); music_on = true; }
    trace_event("music-toggle");
  }
}

function draw_chrome(title: string, signature: string): void {
  clear(BLACK);
  px_rect(0, 0, 320, 29, DARK_BLUE);
  px_text(7, 5, "SUNNY API LAB", WHITE);
  px_text(232, 5, (selected + 1).toString() + "/" + LABS.length.toString(), LIGHT_GRAY);
  px_text(7, 34, title, CYAN, 2);
  px_text(7, 60, signature, LIGHT_GRAY);
  px_hline(7, 76, 306, DARK_GRAY);
  px_rect(0, 216, 320, 24, DARK_BLUE);
  const examples = lab_variant_count(selected) > 1 ? "< > EXAMPLE" : "";
  const action = selected == 5 ? "   A RESEED" : selected == 6 ? "   A PLAY" : "";
  const exit = selected == 2 ? "B TEST, RELEASE -> INDEX" : "   B INDEX";
  px_text(7, 220, examples + action + exit, LIGHT_GRAY);
}

function draw_sunny_mark(cx: i32, cy: i32): void {
  px_circle(cx, cy, 4, YELLOW);
  px_pixel(cx, cy, WHITE);
  const ray = 7 + ((frame() / 12) & 1);
  px_hline(cx - ray, cy, 3, CYAN);
  px_hline(cx + ray - 2, cy, 3, GREEN);
  px_vline(cx, cy - ray, 3, LIGHT_BLUE);
  px_vline(cx, cy + ray - 2, 3, ORANGE);
}

function draw_menu(): void {
  clear(BLACK);
  px_rect(0, 0, 320, 38, DARK_BLUE);
  px_text(8, 6, "SUNNY API LAB", WHITE, 2);
  px_text(8, 42, "INTERACTIVE SUNNY MANUAL", CYAN);
  for (let i = 0; i < LABS.length; i++) {
    const y = 58 + i * 16;
    if (i == selected) px_rect(5, y - 3, 310, 16, DARK_BLUE);
    px_text(10, y, (i == selected ? "> " : "  ") + LABS[i], i == selected ? YELLOW : WHITE);
    px_text(118, y, SUBTITLES[i], i == selected ? LIGHT_GREEN : DARK_GRAY);
  }
  draw_sunny_mark(291, 48);
  px_rect(0, 220, 320, 20, DARK_BLUE);
  px_text(8, 223, "UP/DOWN TOPIC   A OPEN", LIGHT_GRAY);
}

function draw_canvas(): void {
  draw_chrome("CANVAS", "host pixels + runs; Sunny lines, outlines, circles");
  if (variant == 0) {
    px_rect_outline(14, 87, 55, 49, DARK_GRAY);
    px_pixel(40, 106, YELLOW);
    px_rect(37, 103, 7, 7, DARK_BLUE);
    px_pixel(40, 106, YELLOW);
    px_text_centered(41, 143, "PIXEL", WHITE);

    px_rect_outline(79, 87, 61, 49, DARK_GRAY);
    px_rect(91, 99, 37, 25, RED);
    px_text_centered(110, 143, "RECT", WHITE);

    px_rect_outline(150, 87, 70, 49, DARK_GRAY);
    px_hline(159, 100, 52, YELLOW);
    px_vline(184, 94, 35, LIGHT_GREEN);
    px_text_centered(185, 143, "H/V LINE", WHITE);

    px_rect(298, 95, 38, 31, PURPLE);
    px_text(238, 101, "RECT ->", LIGHT_GRAY);
    px_text(238, 117, "PAST EDGE", LIGHT_GRAY);
    px_text(238, 143, "SCREEN CLIPS", CYAN);
  } else if (variant == 1) {
    px_line(22, 122, 94, 87, CYAN);
    px_line(22, 87, 94, 122, LIGHT_BLUE);
    px_rect_outline(114, 88, 72, 38, ORANGE, 3);
    px_text_centered(58, 137, "PX_LINE", WHITE);
    px_text_centered(150, 137, "RECT OUTLINE", WHITE);
    px_text(22, 163, "GUEST-SIDE GEOMETRY BUILDS ON HOST PIXELS", LIGHT_GRAY);
  } else {
    px_circle(60, 108, 22, PURPLE);
    px_circle_outline(132, 108, 25, GREEN, 3);
    px_circle_outline(205, 108, 32, YELLOW);
    px_text_centered(60, 143, "FILLED", WHITE);
    px_text_centered(132, 143, "3 PX RING", WHITE);
    px_text_centered(205, 151, "1 PX RING", WHITE);
    px_text(22, 177, "RADIUS + STROKE WIDTH ARE EXACT INTEGERS", LIGHT_GRAY);
  }
}

function draw_text_lab(): void {
  draw_chrome("TEXT", "px_text centered wrapped width line_height scale");
  const sample = variant == 0 ? "m6x11 METRICS" : variant == 1 ? "WIDE W / slim i" : "SCALE TWO";
  const scale = variant == 2 ? 2 : 1;
  px_text(18, 88, sample, WHITE, scale);
  const w = text_width(sample, scale);
  const measure_y = 89 + text_line_height(scale);
  px_hline(18, measure_y, w, YELLOW);
  px_vline(18, measure_y - 2, 5, YELLOW);
  px_vline(18 + w - 1, measure_y - 2, 5, YELLOW);
  px_text(18, 110 + text_line_height(scale), "MEASURED width=" + w.toString() +
    " line=" + text_line_height(scale).toString(), LIGHT_GREEN);
  px_rect_outline(196, 86, 98, 38, DARK_GRAY);
  px_vline(245, 86, 38, DARK_GRAY);
  px_text_centered(245, 97, "CENTER", CYAN);
  px_text(199, 126, "VISIBLE MIDLINE", DARK_GRAY);
  px_rect_outline(14, 154, 292, 52, DARK_GRAY);
  px_text(18, 157, "WRAP BOX 285 PX", CYAN);
  px_text_wrapped(18, 174, "Greedy wrapping uses pinned host advances.", LIGHT_GRAY, 285);
}

function draw_state_light(x: i32, y: i32, on: bool, color: i32): void {
  if (on) px_rect(x, y, 7, 7, color);
  else px_rect_outline(x, y, 7, 7, DARK_GRAY);
}

function draw_button_state(
  x: i32, y: i32, name: string, held: bool, pressed: bool, released: bool,
): void {
  px_text(x, y, name, WHITE);
  draw_state_light(x + 48, y + 2, pressed, ORANGE);
  draw_state_light(x + 61, y + 2, held, YELLOW);
  draw_state_light(x + 74, y + 2, released, CYAN);
}

function active_buttons(): string {
  let names = "";
  if (up_held()) names += "UP ";
  if (down_held()) names += "DOWN ";
  if (left_held()) names += "LEFT ";
  if (right_held()) names += "RIGHT ";
  if (a_held()) names += "A ";
  if (b_held()) names += "B ";
  if (start_held()) names += "START";
  return names.length == 0 ? "NONE" : names;
}

function draw_input_lab(): void {
  draw_chrome("INPUT", "btn axes + held / pressed / released");
  px_text(13, 85, "MASK " + btn().toString() + " = " + active_buttons(), YELLOW);
  px_text(13, 102, "AXES X=" + input_x().toString() + " Y=" + input_y().toString(), LIGHT_GREEN);
  px_text(123, 102, "LIGHTS: P PRESS  H HOLD  R RELEASE", LIGHT_GRAY);
  draw_button_state(13, 124, "UP", up_held(), up_pressed(), up_released());
  draw_button_state(110, 124, "DOWN", down_held(), down_pressed(), down_released());
  draw_button_state(215, 124, "LEFT", left_held(), left_pressed(), left_released());
  draw_button_state(13, 143, "RIGHT", right_held(), right_pressed(), right_released());
  draw_button_state(110, 143, "A", a_held(), a_pressed(), a_released());
  draw_button_state(215, 143, "B", b_held(), b_pressed(), b_released());
  draw_button_state(13, 162, "START", start_held(), start_pressed(), start_released());
  px_text(110, 162, "B RELEASE RETURNS TO INDEX", DARK_GRAY);

  const cx = 263, cy = 193;
  px_text(13, 188, "LIVE AXIS CURSOR", CYAN);
  px_rect_outline(232, 177, 63, 33, DARK_GRAY);
  px_hline(238, cy, 51, DARK_GRAY);
  px_vline(cx, 182, 23, DARK_GRAY);
  px_rect(cx - 2 + input_x() * 20, cy - 2 + input_y() * 9, 5, 5, YELLOW);
}

function draw_sprite_lab(): void {
  draw_chrome("SPRITE", "blit_sprite / scaled / region + clip_rect");
  if (variant >= 4) {
    const clipping = variant == 5;
    px_text(18, 88, clipping ? "CLIP AN OVERSIZED SPRITE TO A PANEL" : "SOURCE REGION: ARROWHEAD ONLY", CYAN);
    px_rect_outline(58, 108, 204, 68, DARK_GRAY);
    if (clipping) {
      clip_rect(60, 110, 200, 64);
      blit_sprite_scaled(ARROW, ARROW_W, ARROW_H, 30, 88, 288, 144, COLOR_KEY);
      reset_clip();
    } else {
      blit_sprite_region(ARROW, ARROW_W, ARROW_H, 8, 0, 8, 12, 112, 112, 64, 60, COLOR_KEY);
    }
    px_text_centered(160, 184, clipping ? "reset_clip() RESTORES THE SCREEN" : "sx=8 sy=0 rw=8 rh=12 -> 64x60", YELLOW);
    px_text_centered(160, 201, "NEAREST-NEIGHBOR; INDEXED OUTPUT", LIGHT_GRAY);
    return;
  }
  const flags = variant == 0 ? COLOR_KEY : variant == 1 ? COLOR_KEY | FLIP_X :
    variant == 2 ? COLOR_KEY | FLIP_Y : COLOR_KEY | FLIP_X | FLIP_Y;
  const label = variant == 0 ? "NORMAL: POINTS RIGHT" : variant == 1 ? "FLIP_X: POINTS LEFT" :
    variant == 2 ? "FLIP_Y: FIN MOVES DOWN" : "FLIP_X|Y: LEFT + FIN DOWN";
  px_rect_outline(17, 88, 93, 73, DARK_GRAY);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 8; x++) {
      px_rect(22 + x * 10, 93 + y * 10, 10, 10, ((x + y) & 1) == 0 ? DARK_BLUE : DARK_GRAY);
    }
  }
  blit_sprite(ARROW, ARROW_W, ARROW_H, 55, 112, flags | COLOR_KEY);
  px_text_centered(64, 165, "BLIT 1:1", WHITE);

  px_rect_outline(126, 88, 176, 73, DARK_GRAY);
  px_rect_outline(178, 93, 68, 52, DARK_GRAY);
  blit_sprite_scaled(ARROW, ARROW_W, ARROW_H, 180, 95, 64, 48, flags);
  px_text_centered(214, 165, "4X NEAREST BLIT", WHITE);

  px_text_centered(160, 184, label, YELLOW);
  px_text_centered(160, 201, "ORANGE FIN PROVES Y FLIP; INDEX 0 IS CLEAR", LIGHT_GRAY);
}

function draw_screen_lab(): void {
  draw_chrome("SCREEN", "width height frame clamp wrap is_on_screen");
  const raw = (frame() * 3 + 250) % 390 - 35;
  const clamped = clamp_x(raw, 10);
  const wrapped = wrap_x(raw);
  px_text(16, 86, "DEVICE " + width().toString() + "x" + height().toString() +
    "  FRAME " + frame().toString(), WHITE);
  const raw_state = raw < 0 ? "OFF LEFT" : raw >= width() ? "OFF RIGHT" : "VISIBLE";
  px_text(16, 103, "RAW X=" + raw.toString() + "  " + raw_state, RED);

  px_text(16, 126, "CLAMP X=" + clamped.toString(), YELLOW);
  px_hline(10, 145, 300, DARK_GRAY);
  px_rect(clamped - 3, 140, 7, 11, YELLOW);

  px_text(16, 158, "WRAP  X=" + wrapped.toString(), CYAN);
  px_hline(10, 177, 300, DARK_GRAY);
  px_circle(wrapped, 177, 4, CYAN);

  px_text(16, 190, "is_on_screen(raw)? " +
    (is_on_screen(raw, 170) ? "YES" : "NO"), raw_state == "VISIBLE" ? GREEN : RED);
  px_text(166, 190, "Y CLAMP=" + clamp_y(260, 8).toString() +
    " WRAP=" + wrap_y(-12).toString(), LIGHT_GRAY);
}

function draw_random_lab(): void {
  draw_chrome("RANDOM", "seed rand rand_range rand_state");
  px_rect_outline(12, 84, 296, 96, DARK_GRAY);
  px_text(18, 88, "SEQUENCE AFTER SEED 0x5EED1234", CYAN);
  px_text(108, 106, "FIRST", LIGHT_GRAY);
  px_text(219, 106, "NOW", LIGHT_GRAY);
  px_text(18, 124, "rand()", WHITE);
  px_text(88, 124, rng_first_a.toString(), WHITE);
  px_text(199, 124, rng_a.toString(), YELLOW);
  px_text(18, 142, "[-20,20]", WHITE);
  px_text(108, 142, rng_first_b.toString(), WHITE);
  px_text(219, 142, rng_b.toString(), YELLOW);
  px_text(18, 160, "[100,999]", WHITE);
  px_text(108, 160, rng_first_c.toString(), WHITE);
  px_text(219, 160, rng_c.toString(), YELLOW);
  px_text(18, 187, "A RESEED  REPLAY MATCH " + (rng_match ? "YES" : "NO") +
    "  count=" + rng_resets.toString(), rng_match ? LIGHT_GREEN : RED);
  px_text(18, 202, "STATE=" + rand_state().toString() + "  BOUNDS SHOWN INCLUSIVE", LIGHT_GRAY);
}

function draw_audio_lab(): void {
  draw_chrome("AUDIO", "tone note sfx drums melody voice bpm play stop");
  const names: string[] = ["SFX: COIN", "NOTE: C5 SINE", "RAW TONE: 330HZ",
    "MUSIC: 120 BPM", "MUSIC: 180 BPM", "STOP MUSIC"];
  for (let i = 0; i < names.length; i++) {
    const y = 85 + i * 18;
    if (i == variant) px_rect(13, y - 3, 210, 16, DARK_BLUE);
    px_text(18, y, (i == variant ? "> " : "  ") + names[i], i == variant ? YELLOW : LIGHT_GRAY);
  }
  px_text(232, 89, "A PLAY", CYAN);
  px_text(232, 108, "START", CYAN);
  px_text(232, 123, "MUSIC ON/OFF", CYAN);
  px_text(232, 151, "C4=" + note_to_freq("C4").toString() + "HZ", LIGHT_GREEN);
  px_text(232, 170, music_on ? "PLAYING" : "STOPPED", music_on ? GREEN : RED);
  px_text(232, 187, "BEAT", LIGHT_GRAY);
  for (let i = 0; i < 9; i++) {
    const h = ((frame() + i * 7) % 18) + 2;
    px_vline(237 + i * 8, 211 - h, h, music_on ? CYAN : DARK_GRAY);
  }
}

function draw_lifecycle_lab(): void {
  draw_chrome("LIFECYCLE", "run_start(ready); run_update(process, draw)");
  px_rect_outline(13, 86, 294, 118, DARK_GRAY);
  px_text(22, 92, "START ONCE", CYAN);
  px_rect(112, 88, 76, 24, BLUE);
  px_text_centered(150, 94, "READY", WHITE);
  px_text(205, 94, "count 1", LIGHT_GREEN);

  px_text(22, 124, "UPDATE 60 HZ", CYAN);
  px_rect(22, 142, 68, 25, TEAL);
  px_text_centered(56, 148, "PROCESS", WHITE);
  px_line(91, 154, 112, 154, YELLOW);
  px_rect(113, 142, 62, 25, DARK_BLUE);
  px_text_centered(144, 148, "MUSIC", WHITE);
  px_line(176, 154, 197, 154, YELLOW);
  px_rect(198, 142, 62, 25, PURPLE);
  px_text_centered(229, 148, "DRAW", WHITE);
  px_text(267, 148, "END", LIGHT_GRAY);

  px_text(22, 176, "PROCESS=" + (frame() + 1).toString() +
    "  DRAW=" + (frame() + 1).toString(), LIGHT_GREEN);
  px_text(22, 191, "TRACE EVENT: " + last_event, YELLOW);
}

function draw_palette_lab(): void {
  draw_chrome("PALETTE", "indices 0..15; use_palette(name) during start");
  for (let i = 0; i < 16; i++) {
    const x = 18 + (i % 8) * 35;
    const y = 88 + (i / 8) * 39;
    px_rect(x, y, 29, 29, i);
    px_text(x + 3, y + 8, i.toString(), i == 1 || i == 6 || i == 7 || i == 13 ? BLACK : WHITE);
  }
  px_text(18, 171, "NAMED COLORS ARE INDEX CONSTANTS", LIGHT_GREEN);
  px_text(18, 189, "CUSTOM BANKS: set_palette_bytes()", CYAN);
  px_text(18, 204, "TRUE COLOR: use_true_color() IN START", LIGHT_GRAY);
}

function draw_math_lab(): void {
  draw_chrome("MATH", "guest-side scalar vectors and half-open bounds");
  const a = new Vec2(3.0, 4.0);
  const normalized = a.normalized();
  const cross = new Vec3(1.0, 0.0, 0.0).cross(new Vec3(0.0, 1.0, 0.0));
  const bounds = new Rect(2.0, 3.0, 8.0, 5.0);

  px_text(15, 86, "clamp(14,0,10) = " + clamp<i32>(14, 0, 10).toString(), YELLOW);
  px_text(15, 104, "wrap(-1,0,8)  = " + wrap<i32>(-1, 0, 8).toString(), CYAN);
  px_text(15, 126, "Vec2(3,4) dot (2,1) = " + a.dot(new Vec2(2.0, 1.0)).toString(), WHITE);
  px_text(15, 144, "normalized = (" + normalized.x.toString() + ", " +
    normalized.y.toString() + ")", LIGHT_GREEN);
  px_text(15, 166, "Vec3 X cross Y = (" + cross.x.toString() + ", " +
    cross.y.toString() + ", " + cross.z.toString() + ")", ORANGE);
  px_text(15, 188, "Rect [2,10) contains x=9: " +
    (bounds.contains_point(new Vec2(9.0, 4.0)) ? "YES" : "NO"), GREEN);
  px_text(15, 204, "right edge x=10: " +
    (bounds.contains_point(new Vec2(10.0, 4.0)) ? "YES" : "NO"), LIGHT_GRAY);
}

function cart_draw(): void {
  if (!in_lab) draw_menu();
  else if (selected == 0) draw_canvas();
  else if (selected == 1) draw_text_lab();
  else if (selected == 2) draw_input_lab();
  else if (selected == 3) draw_sprite_lab();
  else if (selected == 4) draw_screen_lab();
  else if (selected == 5) draw_random_lab();
  else if (selected == 6) draw_audio_lab();
  else if (selected == 7) draw_lifecycle_lab();
  else if (selected == 8) draw_palette_lab();
  else draw_math_lab();
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
