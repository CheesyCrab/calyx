// Split-Flap Fortunes — Roy's optimistic, slightly suspect transit oracle.

import {
  run_start, run_update,
  clear, px_rect, px_rect_outline, px_hline, px_line, px_circle,
  px_text, px_text_centered, trace,
  a_pressed, b_pressed, left_pressed, right_pressed, up_pressed, down_pressed,
  frame, seed, shuffle_i32, sfx_note,
  BLACK, WHITE, DARK_BLUE, RED, ORANGE, YELLOW,
  LIGHT_GREEN, LIGHT_GRAY, DARK_GRAY,
} from "../../sdk/assembly/index";

const COLS: i32 = 14;
const ROWS: i32 = 4;
const FLAP_W: i32 = 13;
const FLAP_H: i32 = 29;
const GAP_X: i32 = 2;
const GAP_Y: i32 = 4;
const BOARD_X: i32 = 100;
const BOARD_Y: i32 = 42;
const FLIP_FRAMES: i32 = 3;
const CHAR_SET: string = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?'-";

const LABELS: string[] = ["LEAVE", "BOUND", "VIA", "STATE"];

// Four board rows plus Roy reaction index. Values are deliberately capped at
// fourteen characters so the final message never truncates or shrinks.
const ROUTES: string[][] = [
  ["SECOND GUESS", "GOOD TROUBLE", "SMALL KINDNESS", "EXPECT DELAYS", "0"],
  ["PERFECTION", "SOMETHING REAL", "FIRST DRAFT", "NOW BOARDING", "1"],
  ["OLD ROUTINES", "FRESH AIR", "SCENIC ROUTE", "ON TIME", "7"],
  ["EXPLANATIONS", "A QUIET HOUR", "NO APOLOGY", "CLEARED", "5"],
  ["LONELY HABITS", "BETTER COMPANY", "ONE HELLO", "APPROACHING", "9"],
  ["THE WORST", "A SMALL WIN", "TRYING AGAIN", "ON REQUEST", "3"],
  ["PERFECT TIMING", "A GOOD START", "FIVE MINUTES", "NOW BOARDING", "1"],
  ["OLD GRUDGE", "LESS BAGGAGE", "LETTING GO", "CANCELLED", "4"],
  ["TOO MUCH NOISE", "YOUR OWN VOICE", "QUIET ROUTE", "PLATFORM 2", "7"],
  ["FEAR OF ASKING", "NEEDED HELP", "OUT LOUD", "ON REQUEST", "3"],
  ["WRONG TURN", "BETTER VIEW", "LONG WAY ROUND", "REROUTED", "2"],
  ["THE OLD PLAN", "OPEN COUNTRY", "PLAN B", "REROUTED", "2"],
  ["SITTING STILL", "SOME MOMENTUM", "ONE SMALL STEP", "NOW BOARDING", "6"],
  ["SELF CRITIC", "ROOM TO LEARN", "BAD FIRST TRY", "ALL SERVICES", "6"],
  ["BEING CERTAIN", "HONEST WONDER", "ONE QUESTION", "OPEN RETURN", "8"],
  ["BORROWED RULES", "YOUR OWN WAY", "SIDE DOOR", "CLEARED", "5"],
  ["EMPTY HANDS", "SOMETHING MADE", "SCRAP AND TAPE", "LOCAL SERVICE", "7"],
  ["HIDING OUT", "WARM COMPANY", "SHARED SNACKS", "APPROACHING", "9"],
  ["THE BIG ANSWER", "NEXT QUESTION", "LISTENING", "CHANGE HERE", "8"],
  ["YESTERDAY", "NEXT TUESDAY", "REST TODAY", "SLIGHT DELAY", "0"],
  ["ALL OR NOTHING", "ENOUGH FOR NOW", "WHAT YOU HAVE", "ON TIME", "8"],
  ["SAFE ROUTE", "A GOOD STORY", "ONE BAD IDEA", "NOW BOARDING", "1"],
  ["CLOSED DOORS", "OPEN WINDOW", "LOOKING UP", "REROUTED", "2"],
  ["DOING IT ALONE", "A HELPING HAND", "ASKING NICELY", "ON REQUEST", "3"],
];

const ROY_LINES: string[][] = [
  ["NO SHAME", "IN WAITING", "WHERE IT'S", "WARM."],
  ["THAT'S YOU,", "I RECKON.", "", ""],
  ["STILL COUNTS", "AS GOING.", "", ""],
  ["MIGHT HAVE TO", "ASK OUT LOUD.", "", ""],
  ["PROBABLY FOR", "THE BEST.", "", ""],
  ["PACK LIGHT.", "LEAVE ROOM.", "", ""],
  ["A SMALL STEP", "MAKES A TRIP.", "", ""],
  ["GOOD ROUTE.", "ODD TIMETABLE.", "", ""],
  ["YOU HAVE TIME", "NOT FOREVER.", "", ""],
  ["HMM.", "I'D TAKE IT.", "", ""],
];

let current: string[] = [];
let target: string[] = [];
let route: i32 = 0;
let flip_clock: i32 = 0;
let roy_open: bool = false;
let route_bag: i32[] = [];
let bag_cursor: i32 = 0;
let bag_seeded: bool = false;
let history: i32[] = [];
let history_cursor: i32 = 0;

function cell_char(line: string, col: i32): string {
  return col < line.length ? line.charAt(col) : " ";
}

function set_route(index: i32): void {
  route = (index + ROUTES.length) % ROUTES.length;
  const rows = ROUTES[route];
  for (let row = 0; row < ROWS; row++) {
    const line = rows[row];
    for (let col = 0; col < COLS; col++) {
      target[row * COLS + col] = cell_char(line, col);
    }
  }
}

function cart_ready(): void {
  for (let i = 0; i < COLS * ROWS; i++) {
    current.push(" ");
    target.push(" ");
  }
  set_route(0);
  history.push(0);
}

function refill_bag(skip_current: bool): void {
  route_bag = [];
  for (let i = 0; i < ROUTES.length; i++) {
    if (!skip_current || i != route) route_bag.push(i);
  }
  shuffle_i32(route_bag);
  if (route_bag.length > 1 && route_bag[0] == route) {
    const last = route_bag.length - 1;
    const value = route_bag[0];
    route_bag[0] = route_bag[last];
    route_bag[last] = value;
  }
  bag_cursor = 0;
}

function dispense_route(): void {
  if (history_cursor < history.length - 1) {
    history_cursor++;
    set_route(history[history_cursor]);
    return;
  }
  if (!bag_seeded) {
    // Button timing varies the bag between sessions while remaining a pure,
    // replayable function of the verified frame/input stream.
    seed(0x726f7900 ^ <u32>frame());
    refill_bag(true);
    bag_seeded = true;
  } else if (bag_cursor >= route_bag.length) {
    refill_bag(false);
  }
  const next = route_bag[bag_cursor++];
  set_route(next);
  history.push(next);
  history_cursor = history.length - 1;
}

function previous_route(): void {
  if (history_cursor <= 0) return;
  history_cursor--;
  set_route(history[history_cursor]);
}

function is_settled(): bool {
  for (let i = 0; i < current.length; i++) {
    if (current[i] != target[i]) return false;
  }
  return true;
}

function step_flaps(): void {
  let changed = false;
  for (let i = 0; i < current.length; i++) {
    if (current[i] == target[i]) continue;
    let ci = CHAR_SET.indexOf(current[i]);
    if (ci < 0) ci = 0;
    current[i] = CHAR_SET.charAt((ci + 1) % CHAR_SET.length);
    changed = true;
  }
  if (changed) sfx_note("C2", 3, "triangle");
}

function cart_process(): void {
  if (roy_open) {
    if (b_pressed()) roy_open = false;
    return;
  }
  if (b_pressed() && is_settled()) {
    roy_open = true;
    return;
  }

  if (a_pressed() || right_pressed() || down_pressed()) dispense_route();
  else if (left_pressed() || up_pressed()) previous_route();

  flip_clock++;
  if (flip_clock >= FLIP_FRAMES) {
    flip_clock = 0;
    step_flaps();
  }
}

function draw_flap(row: i32, col: i32, ch: string): void {
  const x = BOARD_X + col * (FLAP_W + GAP_X);
  const y = BOARD_Y + row * (FLAP_H + GAP_Y);
  const moving = ch != target[row * COLS + col];
  px_rect(x, y, FLAP_W, FLAP_H, BLACK);
  px_rect(x + 1, y + 1, FLAP_W - 2, FLAP_H / 2 - 1,
    moving ? DARK_GRAY : DARK_BLUE);
  px_rect_outline(x, y, FLAP_W, FLAP_H, moving ? ORANGE : DARK_GRAY);
  px_text_centered(x + FLAP_W / 2, y + 3, ch, moving ? YELLOW : WHITE, 2);
  // One physical seam crosses the printed card; the larger glyph tolerates
  // the single-pixel break while keeping the mechanism visually explicit.
  px_hline(x + 1, y + FLAP_H / 2, FLAP_W - 2, DARK_GRAY);
  px_rect(x, y + FLAP_H / 2 - 1, 2, 3, DARK_GRAY);
  px_rect(x + FLAP_W - 2, y + FLAP_H / 2 - 1, 2, 3, DARK_GRAY);
}

function draw_board(): void {
  px_rect(5, 34, 310, 143, BLACK);
  px_rect_outline(5, 34, 310, 143, DARK_GRAY);
  px_rect_outline(7, 36, 306, 139, ORANGE);
  px_circle(11, 40, 1, LIGHT_GRAY);
  px_circle(309, 40, 1, LIGHT_GRAY);
  px_circle(11, 171, 1, LIGHT_GRAY);
  px_circle(309, 171, 1, LIGHT_GRAY);

  for (let row = 0; row < ROWS; row++) {
    const y = BOARD_Y + row * (FLAP_H + GAP_Y);
    px_rect(12, y, 80, FLAP_H, DARK_BLUE);
    px_rect_outline(12, y, 80, FLAP_H, row == 3 ? LIGHT_GREEN : DARK_GRAY);
    px_text_centered(52, y + 3, LABELS[row],
      row == 3 ? LIGHT_GREEN : LIGHT_GRAY, 2);
    for (let col = 0; col < COLS; col++) {
      draw_flap(row, col, current[row * COLS + col]);
    }
  }
}

function draw_roy_modal(): void {
  const blink = ((frame() + route * 17) % 181) < 7;

  px_rect(10, 27, 300, 205, BLACK);
  px_rect_outline(10, 27, 300, 205, ORANGE);
  px_rect_outline(12, 29, 296, 201, DARK_GRAY);
  px_text(21, 38, "ROY / TRANSIT OPERATOR", LIGHT_GRAY);
  px_text(258, 38, "B CLOSE", YELLOW);

  // Operator portrait and uniform shoulders.
  px_rect(20, 57, 95, 158, DARK_BLUE);
  px_rect_outline(20, 57, 95, 158, LIGHT_GRAY);
  px_rect(30, 180, 75, 34, DARK_BLUE);
  px_line(43, 180, 32, 213, LIGHT_GRAY);
  px_line(92, 180, 103, 213, LIGHT_GRAY);

  // Ears, head, patches, and a generously official muzzle.
  px_rect(23, 112, 16, 13, WHITE);
  px_rect(96, 112, 16, 13, WHITE);
  px_line(37, 114, 29, 105, YELLOW);
  px_line(98, 114, 106, 105, YELLOW);
  px_rect(34, 100, 67, 82, WHITE);
  px_rect_outline(34, 100, 67, 82, DARK_GRAY);
  px_rect(37, 108, 20, 24, DARK_GRAY);
  px_rect(80, 153, 18, 23, DARK_GRAY);
  px_rect(43, 144, 49, 29, ORANGE);
  px_rect_outline(43, 144, 49, 29, RED);
  px_circle(55, 157, 3, RED);
  px_circle(80, 157, 3, RED);
  if (blink) {
    px_hline(50, 134, 7, BLACK);
    px_hline(78, 134, 7, BLACK);
  } else {
    px_rect(52, 128, 4, 7, BLACK);
    px_rect(79, 128, 4, 7, BLACK);
    px_rect(52, 128, 1, 2, WHITE);
    px_rect(79, 128, 1, 2, WHITE);
  }
  px_hline(62, 166, 11, RED);

  // Roy takes the hat extremely seriously.
  px_rect(38, 83, 59, 19, DARK_BLUE);
  px_rect_outline(38, 83, 59, 19, LIGHT_GRAY);
  px_rect(48, 73, 39, 12, DARK_BLUE);
  px_rect_outline(48, 73, 39, 12, LIGHT_GRAY);
  px_rect(65, 76, 7, 6, ORANGE);
  px_hline(29, 103, 77, ORANGE);
  px_rect(29, 183, 77, 29, BLACK);
  px_rect_outline(29, 183, 77, 29, ORANGE);
  px_text_centered(67, 186, "ROY", WHITE, 2);

  // The optional interpretation gets the same 2x readability as the board.
  px_rect(122, 59, 177, 120, LIGHT_GRAY);
  px_rect_outline(122, 59, 177, 120, WHITE);
  px_line(122, 137, 113, 145, LIGHT_GRAY);
  px_line(113, 145, 122, 145, LIGHT_GRAY);
  const reaction = I32.parseInt(ROUTES[route][4]);
  for (let line = 0; line < 4; line++) {
    px_text(128, 69 + line * 25, ROY_LINES[reaction][line], BLACK, 2);
  }

  px_rect(122, 187, 177, 26, DARK_BLUE);
  px_rect_outline(122, 187, 177, 26, LIGHT_GREEN);
  px_text_centered(210, 195, ROUTES[route][3], LIGHT_GREEN);
}

function cart_draw(): void {
  clear(DARK_BLUE);
  px_rect(0, 0, 320, 31, BLACK);
  px_rect(0, 28, 320, 3, ORANGE);
  px_text(9, 8, "FORTUNE TERMINAL", WHITE);
  px_text(231, 8, "ROUTE", DARK_GRAY);
  px_text(279, 8, (route + 1).toString() + "/24", YELLOW);
  px_circle(304, 24, 2, is_settled() ? LIGHT_GREEN : ORANGE);

  draw_board();
  if (is_settled()) {
    px_text_centered(160, 193, "A / ARROWS: ANOTHER ROUTE", LIGHT_GRAY);
    px_text_centered(160, 216, "B: ASK ROY", YELLOW);
  } else {
    px_text_centered(160, 205, "PLEASE STAND BY...", ORANGE);
  }
  if (roy_open) draw_roy_modal();
  trace("route=" + route.toString() + " settled=" + (is_settled() ? "1" : "0") +
    " roy=" + (roy_open ? "1" : "0") + " first=" + current[0]);
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
