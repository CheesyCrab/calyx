// launcher (ABI v1.6 SYSTEM cart, T17) — the console's home screen,
// an ordinary Sunny cart that additionally imports calyx.sys.
//
// XMB-shaped, night-sky themed: a drifting starfield and flowing
// ribbons behind a horizontal category rail and the selected category's
// vertical depth column of cart icons sourced from each cart's 64×64 mark.
// Both axes glide on eased fixed-point integers, edge presses bump, A
// flashes and sys_launches. Every move ticks a tone — sound is part of
// the verified event stream, not presenter garnish. Headless, the
// scripted cart list comes from the feed's `carts` key and the launch
// lands in the dump's `sys` events — so the golden pins category and
// selection movement, icon rendering, info-record decode, launch intent,
// and sfx (ABI §4b/§6a v1.2). All animation is integer math off the frame
// counter and the blessed LCG: same run, same hashes, anywhere.

import {
  run_start, run_update,
  frame, trace,
  clear, px_rect, px_hline, px_vline, px_text,
  px_rect_outline, px_circle, px_circle_outline,
  px_text_centered, text_width,
  blit_sprite, COLOR_KEY,
  up_pressed, down_pressed, left_pressed, right_pressed,
  a_pressed, b_pressed, start_pressed,
  seed, rand_range, sfx,
  BLACK, WHITE, DARK_BLUE, NAVY, BLUE, CYAN, YELLOW, LIGHT_GRAY, DARK_GRAY,
} from "../../../sdk/assembly/index";
import {
  InputMethod, cart_count, cart_info, cart_icon, input_method, launch,
} from "../../../sdk/assembly/sys";

const ICON_STEP: i32 = 50;
const ICON_X: i32 = 56;
const ICON_Y: i32 = 93;
const SELECTED_ICON_SIZE: i32 = 64;
const NEAR_ICON_SIZE: i32 = 32;
const FAR_ICON_SIZE: i32 = 16;
const CATEGORY_STEP: i32 = 104;
const CX: i32 = 160;
const RAIL_X: i32 = 80;
const CATEGORY_LABEL_WIDTH: i32 = 92;
const CART_LABEL_WIDTH: i32 = 192;
const MAX_CATEGORY_DOTS: i32 = 15;

// sin(2πk/32) × 100 — the one trig table everything waves with.
const WAVE: i32[] = [
  0, 20, 38, 56, 71, 83, 92, 98, 100, 98, 92, 83, 71, 56, 38, 20,
  0, -20, -38, -56, -71, -83, -92, -98, -100, -98, -92, -83, -71,
  -56, -38, -20,
];
// bracket breathing: ±px over a slow 4-beat
const BREATH: i32[] = [0, 1, 2, 1];

// Solid-color depth ramps for SWEETIE_16 icon indices. Neighbor icons keep
// filled shapes; depth comes from darker related colors, never screen-door
// dithering across their faces. Index 0 remains the transparent color key.
const DIM_NEAR: StaticArray<u8> = [
  0, 14, 2, 2, 3, 4, 5, 8, 9, 10, 2, 10, 11, 12, 15, 2,
];
const DIM_FAR: StaticArray<u8> = [
  0, 15, 2, 2, 2, 3, 4, 9, 10, 2, 2, 2, 10, 11, 2, 2,
];

const N_STARS: i32 = 44;

let count: i32 = 0;
let sel: i32 = 0;
let names: string[] = [];
let cart_categories: string[] = [];
let category_labels: string[] = [];
let icons64: StaticArray<u8>[] = [];
let icons32: StaticArray<u8>[] = [];
let icons16: StaticArray<u8>[] = [];

// Product categories are ordered intentionally; third-party categories
// follow in stable lexical order. Each category remembers its own selected
// row for this launcher session.
let categories: string[] = [];
let category_carts: i32[][] = [];
let category_sel: i32[] = [];
let category: i32 = 0;

// starfield: x in 1/16 px (advanced incrementally, so no f*speed
// product to overflow), twinkle phase, drift speed (1..3 = parallax)
let star_x16 = new StaticArray<i32>(N_STARS);
let star_y = new StaticArray<i32>(N_STARS);
let star_p = new StaticArray<i32>(N_STARS);
let star_v = new StaticArray<i32>(N_STARS);

// Vertical cart-column camera in 1/16 px. The small boot offset lets the
// selected row rise into place without starting completely off-screen.
let cam16: i32 = -64 * 16;
// category-strip camera in 1/16 px
let category_cam16: i32 = -80 * 16;
// independent edge-bump offsets in 1/16 px, decaying on their own axes
let category_bump16: i32 = 0;
let row_bump16: i32 = 0;
// launch flash countdown
let flash: i32 = 0;
let help_open: bool = false;
let has_meaningful_input: bool = false;

let f: i32 = 0;

function iabs(v: i32): i32 { return v < 0 ? -v : v; }

function ease_camera16(current16: i32, target16: i32): i32 {
  const diff16 = target16 - current16;
  const stepped16 = current16 + (diff16 >> 3);
  return iabs(target16 - stepped16) <= 8 ? target16 : stepped16;
}

function decay_bump16(offset16: i32): i32 {
  return (offset16 * 2) / 3;
}

function category_rank(name: string): i32 {
  if (name == "Games") return 0;
  if (name == "Stories") return 1;
  if (name == "Challenges") return 2;
  if (name == "Demos") return 3;
  if (name == "Settings") return 4;
  return 5;
}

function lexical_before(a: string, b: string): bool {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    const ac = a.charCodeAt(i);
    const bc = b.charCodeAt(i);
    if (ac != bc) return ac < bc;
  }
  return a.length < b.length;
}

function category_before(a: string, b: string): bool {
  const ar = category_rank(a);
  const br = category_rank(b);
  return ar == br ? lexical_before(a, b) : ar < br;
}

function build_categories(): void {
  for (let i = 0; i < count; i++) {
    const name = cart_categories[i];
    let found = false;
    for (let c = 0; c < categories.length; c++) {
      if (categories[c] == name) { found = true; break; }
    }
    if (!found) categories.push(name);
  }
  // The catalog is host-sized, but category counts are ordinarily tiny.
  for (let i = 1; i < categories.length; i++) {
    const value = categories[i];
    let j = i;
    while (j > 0 && category_before(value, categories[j - 1])) {
      categories[j] = categories[j - 1];
      j--;
    }
    categories[j] = value;
  }
  for (let c = 0; c < categories.length; c++) {
    category_labels.push(fit_text(categories[c], CATEGORY_LABEL_WIDTH));
    const members: i32[] = [];
    for (let i = 0; i < count; i++) {
      if (cart_categories[i] == categories[c]) members.push(i);
    }
    category_carts.push(members);
    category_sel.push(0);
  }
}

function active_cart(): i32 {
  if (categories.length == 0) return 0;
  return category_carts[category][category_sel[category]];
}

function active_position(): i32 {
  return categories.length == 0 ? 0 : category_sel[category];
}

function fit_text(label: string, max_width: i32): string {
  if (text_width(label) <= max_width) return label;
  let end = label.length;
  while (end > 0 && text_width(label.substring(0, end) + "...") > max_width) {
    end--;
  }
  return end > 0 ? label.substring(0, end) + "..." : "...";
}

function scale_icon(source: StaticArray<u8>, size: i32, dim_level: i32): StaticArray<u8> {
  const result = new StaticArray<u8>(size * size);
  for (let y = 0; y < size; y++) {
    const sy = (y * 64) / size;
    for (let x = 0; x < size; x++) {
      const sx = (x * 64) / size;
      let color = source[sy * 64 + sx];
      if (color != 0 && dim_level > 0) {
        color = color < 16
          ? (dim_level == 1 ? DIM_NEAR[color] : DIM_FAR[color])
          : <u8>DARK_GRAY;
      }
      result[y * size + x] = color;
    }
  }
  return result;
}

function cart_ready(): void {
  count = cart_count();
  for (let i = 0; i < count; i++) {
    const info = cart_info(i);
    if (info != null) {
      names.push(info.name);
      cart_categories.push(info.category.length > 0 ? info.category : "Games");
    } else {
      names.push("?");
      cart_categories.push("Games");
    }
    const icon = new StaticArray<u8>(4096);
    cart_icon(i, icon);
    icons64.push(scale_icon(icon, SELECTED_ICON_SIZE, 0));
    icons32.push(scale_icon(icon, NEAR_ICON_SIZE, 1));
    icons16.push(scale_icon(icon, FAR_ICON_SIZE, 2));
  }
  // cart_info decodes through a shared ABI buffer. Finish copying all
  // metadata before text measurement allocates UTF-8 scratch storage.
  for (let i = 0; i < names.length; i++) {
    names[i] = fit_text(names[i], CART_LABEL_WIDTH);
  }
  build_categories();
  seed(0xca1c);
  for (let i = 0; i < N_STARS; i++) {
    star_x16[i] = rand_range(0, 320 * 16);
    star_y[i] = rand_range(2, 208);
    star_p[i] = rand_range(0, 64);
    star_v[i] = rand_range(1, 4);
  }
}

function cart_process(): void {
  f = frame();
  const category_before_input = category;
  if (flash > 0) flash--;
  if (left_pressed() || right_pressed() || up_pressed() || down_pressed() ||
      a_pressed() || b_pressed() || start_pressed()) {
    has_meaningful_input = true;
  }
  if (count > 0) {
    if (help_open) {
      if (start_pressed() || b_pressed()) { help_open = false; sfx("blip"); }
    } else {
      let moved_category = false;
      if (left_pressed()) {
        if (category > 0) { category--; moved_category = true; sfx("blip"); }
        else { category_bump16 = -6 * 16; sfx("hit"); }
      } else if (right_pressed()) {
        if (category < categories.length - 1) {
          category++;
          moved_category = true;
          sfx("blip");
        }
        else { category_bump16 = 6 * 16; sfx("hit"); }
      }
      // One navigation axis per simulation tick prevents a diagonal D-pad transition
      // from also changing the remembered row in the destination category.
      if (!moved_category && up_pressed()) {
        if (category_sel[category] > 0) { category_sel[category]--; sfx("blip"); }
        else { row_bump16 = -4 * 16; sfx("hit"); }
      }
      if (!moved_category && !up_pressed() && down_pressed()) {
        if (category_sel[category] < category_carts[category].length - 1) {
          category_sel[category]++; sfx("blip");
        } else { row_bump16 = 4 * 16; sfx("hit"); }
      }
      if (start_pressed()) { help_open = true; sfx("powerup"); }
      if (a_pressed()) { flash = 10; sfx("powerup"); launch(active_cart()); }
    }
  }
  // Each category remembers an independent row. Carrying the previous
  // category's vertical camera into the new stack can put its selected card
  // above the list area, where it drops through the category rail. Category
  // changes already animate horizontally, so establish the new row camera
  // immediately and reserve vertical easing for movement within one stack.
  if (category != category_before_input) {
    cam16 = active_position() * ICON_STEP * 16;
    row_bump16 = 0;
  }
  sel = active_cart();
  // ease the camera toward the selection; snap when close
  const target = active_position() * ICON_STEP * 16;
  cam16 = ease_camera16(cam16, target);
  const category_target = category * CATEGORY_STEP * 16;
  category_cam16 = ease_camera16(category_cam16, category_target);
  category_bump16 = decay_bump16(category_bump16);
  row_bump16 = decay_bump16(row_bump16);
  // drift the stars (leftward, v/16 px per simulation tick, wrap at 320)
  for (let i = 0; i < N_STARS; i++) {
    star_x16[i] = (star_x16[i] - star_v[i] + 320 * 16) % (320 * 16);
  }
}

function wave8(phase8: i32): i32 {
  const p = phase8 & 255;
  const i = (p >> 3) & 31;
  const frac = p & 7;
  return WAVE[i] + ((WAVE[(i + 1) & 31] - WAVE[i]) * frac) / 8;
}

function draw_sky(): void {
  clear(DARK_BLUE);
  // parallax starfield: faster stars are nearer and brighter
  for (let i = 0; i < N_STARS; i++) {
    if (((f + star_p[i]) & 63) < 6) continue; // twinkle off-beat
    const x = star_x16[i] >> 4;
    px_rect(x, star_y[i], 1, 1, star_v[i] == 3 ? LIGHT_GRAY : DARK_GRAY);
  }
  // One broad, shallow sheet avoids the repeated sine-line silhouette that
  // reads as a bundle of snakes. Variable thickness and a sparse indexed fill
  // imply translucent silk without alpha.
  const nav_phase = category_cam16 / 128;
  const phase = (f >> 2) + nav_phase;
  const drift = (wave8((f >> 3) + 37) * 13) / 100;
  for (let s = 0; s < 160; s++) {
    const x = s * 2;
    const center = 126 + drift + (wave8(s + phase) * 24) / 100;
    const half = 9 + (wave8(s * 2 - phase + 83) * 3) / 100;
    draw_wave_sheet_slice(x, center, half, s + (f >> 3));
  }
}

function draw_wave_sheet_slice(x: i32, y: i32, half: i32, phase: i32): void {
  for (let dy = -half; dy <= half; dy++) {
    if (((phase + dy) & 3) != 0) px_rect(x, y + dy, 2, 1, NAVY);
  }
  if ((phase & 7) < 4) px_rect(x, y - half - 1, 2, 1, DARK_GRAY);
}

function draw_mark(x: i32, y: i32, color: i32, scale: i32 = 1): void {
  // Compact indexed adaptation of the canonical four-petal Calyx mark.
  px_rect(x + 5 * scale, y, 3 * scale, 4 * scale, color);
  px_rect(x + 4 * scale, y + 2 * scale, 5 * scale, 3 * scale, color);
  px_rect(x + 5 * scale, y + 9 * scale, 3 * scale, 4 * scale, color);
  px_rect(x + 4 * scale, y + 8 * scale, 5 * scale, 3 * scale, color);
  px_rect(x, y + 5 * scale, 4 * scale, 3 * scale, color);
  px_rect(x + 2 * scale, y + 4 * scale, 3 * scale, 5 * scale, color);
  px_rect(x + 9 * scale, y + 5 * scale, 4 * scale, 3 * scale, color);
  px_rect(x + 8 * scale, y + 4 * scale, 3 * scale, 5 * scale, color);
  px_rect(x + 5 * scale, y + 5 * scale, 3 * scale, 3 * scale, DARK_BLUE);
  px_rect(x + 6 * scale, y + 6 * scale, scale, scale, color);
}

function draw_title(): void {
  draw_mark(14, 6, YELLOW, 2);
  px_text(50, 9, "CALYX", WHITE, 2);
  const b = BREATH[(f >> 3) & 3];
  px_hline(50, 34, 56 + b * 2, CYAN);
}

function draw_categories(): void {
  for (let c = 0; c < categories.length; c++) {
    const x = RAIL_X + c * CATEGORY_STEP - category_cam16 / 16 + category_bump16 / 16;
    if (x < -60 || x > 380) continue;
    px_text_centered(x, 48, category_labels[c], c == category ? WHITE : DARK_GRAY);
    if (c == category) px_hline(x - 14, 62, 28, CYAN);
  }
}

// A cart's vertical XMB row for the current camera; /16 (not >>4) keeps
// negative edge bumps symmetric because integer division rounds to zero.
function icon_y(position: i32): i32 {
  return ICON_Y + position * ICON_STEP - cam16 / 16 + row_bump16 / 16;
}

function draw_row(): void {
  const members = category_carts[category];
  const active = active_position();
  // Paint far-to-near so the focused row always wins during a glide.
  for (let depth = 2; depth >= 0; depth--) {
    for (let p = 0; p < members.length; p++) {
      if (iabs(p - active) != depth) continue;
      const i = members[p];
      const raw_y = icon_y(p);
      if (depth == 0) {
        blit_sprite(icons64[i], SELECTED_ICON_SIZE, SELECTED_ICON_SIZE, ICON_X, raw_y, COLOR_KEY);
        draw_brackets(ICON_X, raw_y, SELECTED_ICON_SIZE);
        px_text(ICON_X + 80, raw_y + 27, names[i], WHITE);
        px_circle(44, raw_y + 24, 2, CYAN);
      } else if (depth == 1) {
        const iy = clamp_row_y(raw_y + 16, 68, 174);
        const ix = ICON_X + 16;
        blit_sprite(icons32[i], NEAR_ICON_SIZE, NEAR_ICON_SIZE, ix, iy, COLOR_KEY);
        px_text(ICON_X + 64, iy + 11, names[i], DARK_GRAY);
        px_circle_outline(44, iy + 16, 2, DARK_GRAY);
      } else {
        const iy = clamp_row_y(raw_y + 16, 64, 184);
        const ix = ICON_X + 16;
        blit_sprite(icons16[i], 16, 16, ix, iy, COLOR_KEY);
        px_rect(43, iy + 7, 2, 2, DARK_GRAY);
      }
    }
  }
  if (flash > 0) {
    // Ring at the selected icon's true row; a mid-glide launch keeps it
    // attached to that icon while the host clips expanding edges.
    const e = (10 - flash) * 3;
    const iy = icon_y(active_position());
    px_rect_outline(ICON_X - 4 - e, iy - 4 - e,
      SELECTED_ICON_SIZE + 8 + 2 * e, SELECTED_ICON_SIZE + 8 + 2 * e, CYAN);
  }
}

function clamp_row_y(value: i32, low: i32, high: i32): i32 {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

function draw_brackets(x: i32, iy: i32, size: i32): void {
  const b = BREATH[(f >> 3) & 3];
  const x0 = x - 4 - b;
  const y0 = iy - 4 - b;
  const x1 = x + size + 3 + b;
  const y1 = iy + size + 3 + b;
  const l = 7;
  px_hline(x0, y0, l, WHITE); px_vline(x0, y0, l, WHITE);
  px_hline(x1 - l + 1, y0, l, WHITE); px_vline(x1, y0, l, WHITE);
  px_hline(x0, y1, l, WHITE); px_vline(x0, y1 - l + 1, l, WHITE);
  px_hline(x1 - l + 1, y1, l, WHITE); px_vline(x1, y1 - l + 1, l, WHITE);
}

function draw_category_dots(): void {
  const spacing = 9;
  const visible = categories.length < MAX_CATEGORY_DOTS
    ? categories.length
    : MAX_CATEGORY_DOTS;
  let first = category - visible / 2;
  if (first < 0) first = 0;
  if (first + visible > categories.length) first = categories.length - visible;
  const start_x = CX - ((visible - 1) * spacing) / 2;
  for (let slot = 0; slot < visible; slot++) {
    const c = first + slot;
    const x = start_x + slot * spacing;
    if (c == category) px_circle(x, 204, 2, CYAN);
    else px_circle_outline(x, 204, 2, DARK_GRAY);
  }
}

function draw_footer(): void {
  px_rect(0, 216, 320, 24, BLACK);
  if (!has_meaningful_input || input_method() == InputMethod.TOUCH) return;
  px_hline(0, 218, 320, NAVY);
  const method = input_method();
  if (method == InputMethod.CONTROLLER) {
    px_text_centered(CX, 226, "DPAD NAV  (A) PLAY  START HELP", LIGHT_GRAY);
  } else {
    px_text_centered(CX, 226, "ARROWS NAV  Z PLAY  ENTER HELP", LIGHT_GRAY);
  }
}

function draw_help(): void {
  px_rect(24, 56, 272, 160, DARK_BLUE);
  px_rect_outline(24, 56, 272, 160, CYAN);
  px_text_centered(CX, 68, "CONTROLS", WHITE, 2);
  const method = input_method();
  if (method == InputMethod.CONTROLLER) {
    px_text_centered(CX, 100, "DPAD  CATEGORY / SELECT", LIGHT_GRAY);
    px_text_centered(CX, 116, "A  PLAY", LIGHT_GRAY);
    px_text_centered(CX, 132, "START OR B  CLOSE HELP", LIGHT_GRAY);
    px_text_centered(CX, 156, "BACK  RETURN HOME FROM CART", LIGHT_GRAY);
    px_text_centered(CX, 172, "GUIDE  QUIT CALYX", LIGHT_GRAY);
  } else if (method == InputMethod.TOUCH) {
    px_text_centered(CX, 100, "SWIPE  CATEGORY / SELECT", LIGHT_GRAY);
    px_text_centered(CX, 116, "TAP A  PLAY", LIGHT_GRAY);
    px_text_centered(CX, 132, "TAP ?  CLOSE HELP", LIGHT_GRAY);
    px_text_centered(CX, 156, "HOME  RETURN FROM CART", LIGHT_GRAY);
  } else {
    px_text_centered(CX, 100, "LEFT RIGHT  CATEGORY", LIGHT_GRAY);
    px_text_centered(CX, 116, "UP DOWN  SELECT", LIGHT_GRAY);
    px_text_centered(CX, 132, "Z  PLAY     ENTER OR X  CLOSE", LIGHT_GRAY);
    px_text_centered(CX, 156, "BACKSPACE  RETURN HOME FROM CART", LIGHT_GRAY);
    px_text_centered(CX, 172, "ESCAPE  QUIT CALYX", LIGHT_GRAY);
  }
  px_text_centered(CX, 194, "CALYX 1.0.0-rc.1  /  ABI v1.6", DARK_GRAY);
}

function cart_draw(): void {
  draw_sky();

  if (count == 0) {
    draw_title();
    px_text_centered(CX, 150, "NO CARTS INSTALLED", LIGHT_GRAY);
    px_text_centered(CX, 168, "drop a cart folder into --carts", DARK_GRAY);
    draw_footer();
    trace("carts=0");
    return;
  }

  draw_categories();
  draw_row();
  draw_category_dots();
  // Product identity stays above animated/list content on every frame.
  draw_title();
  draw_footer();
  if (help_open) draw_help();

  trace(
    "carts=" + count.toString() +
    " cat=" + categories[category] + "/" + category.toString() +
    " sel=" + active_position().toString() + " cart=" + sel.toString() +
    " help=" + (help_open ? "ON" : "OFF") +
    " input=" + input_method().toString(),
  );
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
