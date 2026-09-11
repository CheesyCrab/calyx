// Sunny drawing tour. All art is embedded; no runtime files or PNG decoder.
import {
  run_start, run_update, use_true_color, rgba, clear_rgba, rgba_rect,
  rgba_pixel, rgba_text, clip_rect, reset_clip, blit_rgba, blit_rgba_region,
  blit_sprite_region, px_rect, px_text, left_pressed, right_pressed,
  a_pressed, b_pressed, trace, FLIP_X, FLIP_Y, COLOR_KEY,
} from "../../sdk/assembly/index";
import { BADGES, BADGES_W, BADGES_H } from "./badges";

const TITLES: string[] = ["FULL COLOR", "ALPHA COMPOSITING", "PNG INSIDE THE CART", "TINT + DRAW OPACITY", "REGIONS + SCALING", "CLIPPING RECTANGLES"];
const NOTES: string[] = [
  "Choose color once in start(). Resolution is an independent choice.",
  "Straight-alpha source-over. Draw order matters. Output stays opaque.",
  "PNG -> build-time converter -> RGBA bytes in this single WASM cart.",
  "Tint multiplies RGB. Draw opacity multiplies source alpha.",
  "Crop a source rectangle, scale with nearest-neighbor, then flip within it.",
  "The scissor persists until reset_clip(). Clear always fills the screen.",
];
const INDEXED: StaticArray<u8> = [0,0,6,0,0,6,6,6,6,6,6,6,0,6,6,6];
let page: i32 = 0;
let variant: i32 = 0;
const WHITE: i32 = 0xeef6ffff;
const MUTED: i32 = 0x9cafc9ff;
const CYAN: i32 = 0x71e8d7ff;
function note(): void { trace("drawing-lab page=" + page.toString() + " variant=" + variant.toString()); }
function ready(): void { use_true_color(); note(); }
function process(): void {
  if (right_pressed()) { page = (page + 1) % TITLES.length; variant = 0; note(); }
  else if (left_pressed()) { page = (page + TITLES.length - 1) % TITLES.length; variant = 0; note(); }
  else if (a_pressed()) { variant = 1 - variant; note(); }
  else if (b_pressed()) { page = 0; variant = 0; note(); }
}
function label(x: i32, y: i32, text: string, color: i32 = WHITE, scale: i32 = 2): void {
  rgba_text(x, y, text, color, scale);
}
function checker(x: i32, y: i32, w: i32, h: i32): void {
  for (let yy = 0; yy < h; yy += 24) for (let xx = 0; xx < w; xx += 24)
    rgba_rect(x + xx, y + yy, min<i32>(24,w-xx), min<i32>(24,h-yy),
      ((xx / 24 + yy / 24) & 1) == 0 ? 0x24374aff : 0x172638ff);
}
function badge(x: i32, y: i32, size: i32, tint: i32 = 0xffffff, opacity: i32 = 255, flags: i32 = 0, sx: i32 = 0): void {
  blit_rgba_region(BADGES, BADGES_W, BADGES_H, sx, 0, 16, 16, x, y, size, size, flags, tint, opacity);
}
function full_color(): void {
  label(76, 201, "256 RGB STEPS / NO PALETTE MATCHING", CYAN);
  for (let i = 0; i < 256; i++) {
    rgba_rect(80 + i * 3, 256, 3, 72, rgba(i, 48, 255-i));
    rgba_rect(80 + i * 3, 344, 3, 72, rgba(35, i, 180));
  }
  label(80, 449, "rgba(r,g,b,a) -> 0xRRGGBBAA", WHITE);
  label(80, 484, "clear_rgba() ignores alpha + clip", MUTED);
  rgba_rect(904, 252, 228, 164, variant == 0 ? rgba(239,132,97) : rgba(122,209,164));
  for (let i = 0; i < 32; i++) rgba_pixel(1000+i, 306+i, WHITE);
  label(904, 449, "rgba_rect", CYAN);
  label(904, 484, "+ rgba_pixel", MUTED);
}
function alpha(): void {
  checker(80, 246, 624, 240);
  const red = rgba(242,91,116,160), blue = rgba(61,158,255,160);
  if (variant == 0) {
    rgba_rect(128, 270, 288, 168, red); rgba_rect(320, 302, 288, 160, blue);
  } else {
    rgba_rect(320, 302, 288, 160, blue); rgba_rect(128, 270, 288, 168, red);
  }
  label(80, 201, "A REVERSES DRAW ORDER", CYAN);
  label(752, 264, "ALPHA 160 / 255", CYAN);
  label(752, 312, "Translucent panels", WHITE);
  label(752, 352, "Overlapping colors", WHITE);
  rgba_text(752, 410, "Text blends too", rgba(255,224,155,128), 3);
  label(80, 514, "Rounded integer source-over; encoded RGB bytes, no gamma conversion.", MUTED);
}
function png(): void {
  label(80, 201, "EMBEDDED BADGES.PNG / 32 x 16 / RGBA", CYAN);
  checker(80, 246, 480, 240);
  badge(104, 254, 224, 0xffffff, 255, 0, variant*16);
  blit_rgba(BADGES, BADGES_W, BADGES_H, 432, 360);
  label(366, 408, "1:1 sheet", MUTED);
  label(624, 250, "png2src.py --format rgba", WHITE);
  label(624, 298, "Preserves color + soft edges", MUTED);
  label(624, 338, "Emits StaticArray<u8>", MUTED);
  label(624, 378, "No runtime file access", MUTED);
  label(624, 418, "A selects the second badge", CYAN);
  label(80, 514, "blit_rgba() is 1:1; blit_rgba_region() also crops and scales.", MUTED);
}
function tint(): void {
  label(80, 201, "ONE SPRITE / THREE TINTS / TWO OPACITIES", CYAN);
  checker(80, 246, 1104, 240);
  const opacity = variant == 0 ? 255 : 96;
  badge(144, 266, 192, 0xffffff, opacity);
  badge(496, 266, 192, 0xff8877, opacity);
  badge(848, 266, 192, 0x77ccff, opacity);
  label(156, 500, "WHITE", WHITE); label(490, 500, "WARM TINT", WHITE); label(840, 500, "COOL TINT", WHITE);
  label(80, 550, "A: draw opacity " + opacity.toString() + "/255. Per-pixel alpha is retained.", MUTED);
}
function regions(): void {
  label(80, 201, "SOURCE RECTANGLES + NEAREST-NEIGHBOR + FLIPS", CYAN);
  badge(96, 272, 192, 0xffffff, 255, variant == 0 ? 0 : FLIP_X, 16);
  badge(376, 272, 192, 0xffffff, 255, variant == 0 ? 0 : FLIP_Y, 16);
  blit_rgba_region(BADGES, BADGES_W, BADGES_H, 20, 4, 8, 8, 648, 272, 192, 192);
  blit_sprite_region(INDEXED, 4, 4, 0, 0, 4, 4, 952, 292, 128, 128, COLOR_KEY, 0xffaacc, 192);
  label(96, 488, "A: FLIP_X", WHITE); label(376, 488, "A: FLIP_Y", WHITE);
  label(648, 488, "8x8 CROP", WHITE); label(928, 488, "INDEXED SRC", WHITE);
  label(80, 550, "Indexed assets still work: their palette colors can also be tinted + blended.", MUTED);
}
function clipping(): void {
  label(80, 201, "ONE PANEL / DRAW BEYOND ITS EDGES", CYAN);
  checker(80, 246, 624, 264);
  const x = 200, y = 286, w = 360, h = 168;
  rgba_rect(x-2,y-2,w+4,h+4,CYAN);
  rgba_rect(x,y,w,h,0x152237ff);
  if (variant == 0) clip_rect(x,y,w,h);
  badge(132, 264, 256);
  rgba_rect(424, 264, 200, 220, rgba(227,132,255,112));
  px_rect(260, 432, 160, 48, 6); // Legacy palette drawing shares the scissor.
  reset_clip();
  label(752, 272, variant == 0 ? "SCISSOR ON" : "SCISSOR OFF", CYAN);
  label(752, 320, "A toggles clipping", WHITE);
  label(752, 368, "Sprites + RGBA + indexed", MUTED);
  label(752, 408, "all use the same clip", MUTED);
  px_text(80, 540, "reset_clip(): this indexed text draws outside the panel", 1, 2);
}
function draw(): void {
  reset_clip(); clear_rgba(0x0b1424ff);
  label(48, 30, "SUNNY API LAB", MUTED, 2);
  label(1020, 30, "HD / RGBA", CYAN, 2);
  label(48, 78, TITLES[page], WHITE, 4);
  label(48, 139, NOTES[page], MUTED, 2);
  rgba_rect(48, 184, 1184, 410, 0x111f32ff);
  if (page == 0) full_color(); else if (page == 1) alpha();
  else if (page == 2) png(); else if (page == 3) tint();
  else if (page == 4) regions(); else clipping();
  label(48, 628, "LEFT / RIGHT  TOPIC     A  EXAMPLE     B  FIRST TOPIC", WHITE, 2);
  label(48, 669, "Same drawing API at 320x240 or HD. Color is chosen once at startup.", MUTED, 2);
  label(1130, 628, (page+1).toString() + " / 6", CYAN, 2);
}
export function start(): void { run_start(ready); }
export function update(): void { run_update(process, draw); }
