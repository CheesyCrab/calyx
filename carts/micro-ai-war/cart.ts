// Micro AI War — tactile doctrine-building deterministic auto-battler.

import {
  run_start, run_update, frame, clear,
  px_pixel, px_rect, px_rect_outline, px_line, px_circle, px_circle_outline,
  px_text, px_text_centered, trace,
  blit_sprite, set_palette_bytes,
  a_pressed, b_pressed, start_pressed,
  up_pressed, down_pressed, left_pressed, right_pressed,
  seed, rand_range, sfx,
  sign, Vec2i,
  BLACK, WHITE, DARK_BLUE, PURPLE, RED, ORANGE, YELLOW,
  LIGHT_GREEN, GREEN, BLUE, CYAN, LIGHT_GRAY, DARK_GRAY,
} from "../../sdk/assembly/index";
import { TITLE_ART, TITLE_ART_W, TITLE_ART_H } from "./title_asset";

const TITLE: i32 = 0;
const MUSTER: i32 = 1;
const DOCTRINE: i32 = 2;
const BATTLE: i32 = 3;
const RESULTS: i32 = 4;

const FOOT: i32 = 0;
const BOW: i32 = 1;
const RIDER: i32 = 2;
const ROLE_COUNT: i32 = 3;

const ALLY_PINNED: i32 = 0;
const FOE_ALONE: i32 = 1;
const THREAT_HIGH: i32 = 2;
const WOUNDED: i32 = 3;
const LINE_BROKEN: i32 = 4;
const SENSE_COUNT: i32 = 5;

const PRESS: i32 = 0;
const SCREEN: i32 = 1;
const FOCUS: i32 = 2;
const RALLY: i32 = 3;
const WITHDRAW: i32 = 4;
const ORDER_COUNT: i32 = 5;

const FP: i32 = 256;
const SUPPLY: i32 = 62;
const BATTLE_LIMIT: i32 = 1800;
const OVERTIME_LIMIT: i32 = 2400;
const OVERTIME_THRESHOLD: i32 = 4;
const COMMIT_FRAMES: i32 = 30;
const FIELD_TOP: i32 = 24;
const FIELD_BOTTOM: i32 = 222;
const INTRO_PAN_END: i32 = 120;
const INTRO_SETTLE_END: i32 = 150;
const INTRO_COUNTDOWN_END: i32 = 270;
const INTRO_TOTAL: i32 = 280;

const ROLE_NAMES: string[] = ["FOOT", "BOW", "RIDER"];
const ROLE_COSTS: StaticArray<i32> = [1, 2, 3];
const ROLE_HP: StaticArray<i32> = [24, 16, 20];
const ROLE_SPEED: StaticArray<i32> = [112, 100, 190];
const SENSE_NAMES: string[] = [
  "ALLY PRESSED", "ENEMY EXPOSED", "OUTNUMBERED", "BADLY HURT", "FAR FROM GROUP",
];
const ORDER_NAMES: string[] = ["ADVANCE", "PROTECT ALLY", "FOCUS FIRE", "REGROUP", "FALL BACK"];
const PRESET_NAMES: string[] = ["BALANCED", "GUARD", "HUNTER"];
const ROLE_CUES: string[] = ["HOLD", "RANGE", "CHARGE"];
const LIMB_COLORS: StaticArray<i32> = [YELLOW, LIGHT_GREEN, ORANGE, LIGHT_GRAY];
const NODE_X: StaticArray<i32> = [0, 8, 8, 112, 112, 216, 216, 112];
const NODE_Y: StaticArray<i32> = [20, 68, 106, 68, 106, 68, 106, 150];

// SWEETIE-16 remains exact in indices 0-15 so the established console UI is
// untouched. The upper bank is a cart-local battlefield ramp.
const WAR_RGB: StaticArray<u8> = [
  0x00,0x00,0x00, 0xff,0xff,0xff, 0x1a,0x1c,0x2c, 0x5d,0x27,0x5d,
  0xb1,0x3e,0x53, 0xef,0x7d,0x57, 0xff,0xcd,0x75, 0xa7,0xf0,0x70,
  0x38,0xb7,0x64, 0x25,0x71,0x79, 0x29,0x36,0x6f, 0x3b,0x5d,0xc9,
  0x41,0xa6,0xf6, 0x73,0xef,0xf7, 0x94,0xb0,0xc2, 0x56,0x6c,0x86,
  0x24,0x31,0x20, 0x3b,0x50,0x2e, 0x55,0x6b,0x3c, 0x43,0x32,0x25,
  0x68,0x4b,0x31, 0xc4,0xa8,0x63, 0xd8,0xa0,0x6f, 0xb7,0xc2,0xc8,
  0x71,0x41,0x2b, 0x2b,0x7a,0x9b, 0x58,0xb8,0xc8, 0x9e,0x3f,0x3f,
  0xe0,0x6c,0x56, 0x7b,0x5a,0x3b, 0xaa,0x7a,0x4e, 0x6d,0x24,0x32,
];
const GRASS_DARK: i32 = 16;
const GRASS: i32 = 17;
const GRASS_LIGHT: i32 = 18;
const DIRT_DARK: i32 = 19;
const DIRT: i32 = 20;
const STRAW: i32 = 21;
const SKIN: i32 = 22;
const STEEL: i32 = 23;
const LEATHER: i32 = 24;
const ALLY_DARK: i32 = 25;
const ALLY_LIGHT: i32 = 26;
const FOE_DARK: i32 = 27;
const FOE_LIGHT: i32 = 28;
const HORSE_DARK: i32 = 29;
const HORSE_LIGHT: i32 = 30;
const BLOOD: i32 = 31;
const DISTANCE_FROM = new Vec2i();
const DISTANCE_TO = new Vec2i();

class Unit {
  team: i32;
  role: i32;
  x: i32;
  y: i32;
  lane_y: i32;
  hp: i32;
  max_hp: i32;
  cooldown: i32 = 0;
  target: i32 = -1;
  branch: i32 = 3;
  order: i32 = PRESS;
  commit: i32 = 0;
  alive: bool = true;
  unsupported_marked: bool = false;
  attack_flash: i32 = 0;
  hit_flash: i32 = 0;
  death_age: i32 = 0;

  constructor(team: i32, role: i32, x: i32, y: i32) {
    this.team = team;
    this.role = role;
    this.x = x;
    this.y = y;
    this.lane_y = y;
    this.max_hp = ROLE_HP[role];
    this.hp = this.max_hp;
  }
}

let state: i32 = TITLE;
let muster_counts: i32[] = [24, 10, 6];
let muster_role: i32 = 0;

let senses: i32[] = [ALLY_PINNED, FOE_ALONE, THREAT_HIGH];
let orders: i32[] = [SCREEN, FOCUS, RALLY];
let fallback_order: i32 = PRESS;
let limb_active: bool[] = [true, true, true];
let preset: i32 = 0;
let doctrine_custom: bool = false;
let node: i32 = 0;
let tray_open: bool = false;
let tray_index: i32 = 0;
let snap_timer: i32 = 0;
let reject_timer: i32 = 0;

let units: Unit[] = [];
let battle_frame: i32 = 0;
let intro_frame: i32 = 0;
let branch_ticks: i32[] = [0, 0, 0, 0];
let unsupported_riders: i32 = 0;
let outcome: string = "";
let player_start_count: i32 = 0;
let enemy_start_count: i32 = 0;
let battle_paused: bool = false;

function iabs(v: i32): i32 { return v < 0 ? -v : v; }
function pixels_to_q8(pixels: i32): i32 { return pixels * FP; }
function q8_to_pixels(value: i32): i32 { return value / FP; }

function q8_axis_step(delta: i32, speed: i32, scale: i32): i32 {
  return <i32>((<i64>delta * speed) / scale);
}

function dist2(ax: i32, ay: i32, bx: i32, by: i32): i64 {
  return DISTANCE_FROM.set(ax, ay).distance_squared_to(DISTANCE_TO.set(bx, by));
}

function within(a: Unit, b: Unit, pixels: i32): bool {
  const r = <i64>(pixels * FP);
  return dist2(a.x, a.y, b.x, b.y) <= r * r;
}

function supply_used(): i32 {
  let used = 0;
  for (let r = 0; r < ROLE_COUNT; r++) used += muster_counts[r] * ROLE_COSTS[r];
  return used;
}

function total_muster(): i32 {
  return muster_counts[0] + muster_counts[1] + muster_counts[2];
}

function role_name(role: i32): string { return ROLE_NAMES[role]; }
function sense_name(value: i32): string { return SENSE_NAMES[value]; }
function order_name(value: i32): string { return ORDER_NAMES[value]; }

function sense_description(value: i32): string {
  if (value == ALLY_PINNED) return "WHEN AN ALLY IN THIS UNIT GROUP IS ATTACKED.";
  if (value == FOE_ALONE) return "WHEN A NEARBY ENEMY HAS NO SUPPORT.";
  if (value == THREAT_HIGH) return "WHEN NEARBY ENEMIES OUTNUMBER ALLIES.";
  if (value == WOUNDED) return "WHEN THIS UNIT FALLS BELOW HALF HEALTH.";
  return "WHEN THIS UNIT STRAYS FROM ITS ROLE GROUP.";
}

function order_description(value: i32): string {
  if (value == PRESS) return "MOVE TOWARD THE NEAREST USEFUL TARGET.";
  if (value == SCREEN) return "INTERPOSE FOR A PRESSED ALLY IN ITS GROUP.";
  if (value == FOCUS) return "CONCENTRATE ON AN EXPOSED OR WEAK TARGET.";
  if (value == RALLY) return "RETURN TOWARD THIS UNIT TYPE'S FORMATION.";
  return "CREATE DISTANCE FROM THE NEAREST THREAT.";
}

function short_sense(value: i32): string {
  if (value == ALLY_PINNED) return "ALLY";
  if (value == FOE_ALONE) return "EXPOSED";
  if (value == THREAT_HIGH) return "OUTNUM";
  if (value == WOUNDED) return "WOUNDED";
  return "SCATTERED";
}

function short_order(value: i32): string {
  if (value == PRESS) return "ADVANCE";
  if (value == SCREEN) return "PROTECT";
  if (value == FOCUS) return "FOCUS";
  if (value == RALLY) return "REGROUP";
  return "RETREAT";
}

function load_preset(value: i32): void {
  preset = value;
  doctrine_custom = false;
  limb_active = [true, true, true];
  if (value == 0) {
    senses = [ALLY_PINNED, FOE_ALONE, THREAT_HIGH];
    orders = [SCREEN, FOCUS, RALLY];
    fallback_order = PRESS;
  } else if (value == 1) {
    senses = [THREAT_HIGH, ALLY_PINNED, WOUNDED];
    orders = [RALLY, SCREEN, WITHDRAW];
    fallback_order = SCREEN;
  } else {
    senses = [FOE_ALONE, LINE_BROKEN, WOUNDED];
    orders = [FOCUS, RALLY, WITHDRAW];
    fallback_order = PRESS;
  }
  trace("doctrine=" + PRESET_NAMES[value]);
}

function doctrine_name(): string {
  return doctrine_custom ? "CUSTOM" : PRESET_NAMES[preset];
}

function handle_muster(): void {
  if (left_pressed() && muster_role > 0) { muster_role--; sfx("blip"); }
  if (right_pressed() && muster_role < ROLE_COUNT - 1) { muster_role++; sfx("blip"); }
  if (a_pressed()) {
    const next = supply_used() + ROLE_COSTS[muster_role];
    if (next <= SUPPLY) { muster_counts[muster_role]++; sfx("coin"); }
    else { reject_timer = 12; sfx("hit"); }
  }
  if (b_pressed()) {
    if (muster_counts[muster_role] > 0) { muster_counts[muster_role]--; sfx("blip"); }
    else { reject_timer = 12; sfx("hit"); }
  }
  if (start_pressed() && total_muster() > 0) {
    state = DOCTRINE;
    node = 0;
    tray_open = false;
    trace("state=doctrine muster=" + muster_counts[0].toString() + "," +
      muster_counts[1].toString() + "," + muster_counts[2].toString());
    sfx("powerup");
  }
}

function handle_title(): void {
  if (a_pressed() || start_pressed()) {
    state = MUSTER;
    trace("state=muster");
    sfx("fanfare");
  }
}

function node_is_sense(value: i32): bool { return value == 1 || value == 3 || value == 5; }
function node_is_order(value: i32): bool { return value == 2 || value == 4 || value == 6 || value == 7; }
function node_limb(value: i32): i32 { return value <= 2 ? 0 : value <= 4 ? 1 : 2; }

function move_node(): void {
  if (node == 0) {
    if (down_pressed()) node = 3;
  } else if (node == 7) {
    if (up_pressed()) node = 4;
  } else if (node_is_sense(node)) {
    if (up_pressed()) node = 0;
    if (down_pressed()) node++;
    if (left_pressed() && node > 1) node -= 2;
    if (right_pressed() && node < 5) node += 2;
  } else {
    if (up_pressed()) node--;
    if (down_pressed()) node = 7;
    if (left_pressed() && node > 2) node -= 2;
    if (right_pressed() && node < 6) node += 2;
  }
}

function open_tray(): void {
  tray_open = true;
  if (node_is_sense(node)) tray_index = senses[node_limb(node)];
  else if (node == 7) tray_index = fallback_order;
  else tray_index = orders[node_limb(node)];
  sfx("blip");
}

function commit_tray(): void {
  if (node_is_sense(node)) {
    const limb = node_limb(node);
    senses[limb] = tray_index;
    limb_active[limb] = true;
  } else if (node == 7) {
    fallback_order = tray_index;
  } else {
    const limb = node_limb(node);
    orders[limb] = tray_index;
    limb_active[limb] = true;
  }
  doctrine_custom = true;
  tray_open = false;
  snap_timer = 12;
  sfx("coin");
  trace("snap node=" + node.toString() + " piece=" + tray_index.toString());
}

function handle_doctrine(): void {
  if (snap_timer > 0) snap_timer--;
  if (tray_open) {
    const count = node_is_sense(node) ? SENSE_COUNT : ORDER_COUNT;
    if (left_pressed()) { tray_index = (tray_index + count - 1) % count; sfx("blip"); }
    if (right_pressed()) { tray_index = (tray_index + 1) % count; sfx("blip"); }
    if (a_pressed()) commit_tray();
    else if (b_pressed()) { tray_open = false; sfx("blip"); }
    return;
  }
  move_node();
  if (a_pressed()) {
    if (node == 0) {
      load_preset((preset + 1) % 3);
      snap_timer = 12;
      sfx("powerup");
    } else open_tray();
  }
  if (b_pressed()) {
    if (node == 0) {
      state = MUSTER;
      trace("state=muster");
    } else if (node != 7) {
      const limb = node_limb(node);
      limb_active[limb] = false;
      doctrine_custom = true;
      sfx("hit");
      trace("limb_removed=" + limb.toString());
    }
  }
  if (start_pressed()) start_battle();
}

function spawn_team(team: i32, counts: i32[]): void {
  for (let role = 0; role < ROLE_COUNT; role++) {
    for (let n = 0; n < counts[role]; n++) {
      let col = 0, row = 0, px = 0, py = 0;
      if (role == FOOT) {
        col = n / 6; row = n % 6;
        px = team == 0 ? 63 - col * 8 : 257 + col * 8;
        py = 72 + row * 19;
      } else if (role == BOW) {
        col = n / 5; row = n % 5;
        px = team == 0 ? 34 - col * 8 : 286 + col * 8;
        py = 43 + row * 18;
      } else {
        col = n / 3; row = n % 3;
        px = team == 0 ? 50 - col * 9 : 270 + col * 9;
        py = 174 + row * 17 + col * 4;
      }
      px += rand_range(-1, 2); py += rand_range(-1, 2);
      units.push(new Unit(team, role, pixels_to_q8(px), pixels_to_q8(py)));
    }
  }
}

function start_battle(): void {
  seed(0x6d696372);
  units = [];
  spawn_team(0, muster_counts);
  const cpu_counts: i32[] = [24, 10, 6];
  spawn_team(1, cpu_counts);
  player_start_count = total_muster();
  enemy_start_count = 40;
  battle_frame = 0;
  intro_frame = 0;
  branch_ticks = [0, 0, 0, 0];
  unsupported_riders = 0;
  battle_paused = false;
  outcome = "";
  state = BATTLE;
  trace("state=battle doctrine=" + doctrine_name() + " p=" + player_start_count.toString() +
    " e=" + enemy_start_count.toString());
  sfx("fanfare");
}

function count_alive(team: i32): i32 {
  let count = 0;
  for (let i = 0; i < units.length; i++) if (units[i].alive && units[i].team == team) count++;
  return count;
}

function count_role_alive(team: i32, role: i32): i32 {
  let count = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.alive && u.team == team && u.role == role) count++;
  }
  return count;
}

function health_alive(team: i32): i32 {
  let hp = 0;
  for (let i = 0; i < units.length; i++) if (units[i].alive && units[i].team == team) hp += units[i].hp;
  return hp;
}

function nearest_enemy(index: i32): i32 {
  const u = units[index];
  let best = -1;
  let best_d: i64 = <i64>0x7fffffff * <i64>0x7fffffff;
  for (let i = 0; i < units.length; i++) {
    const other = units[i];
    if (!other.alive || other.team == u.team) continue;
    const d = dist2(u.x, u.y, other.x, other.y);
    if (d < best_d) { best_d = d; best = i; }
  }
  return best;
}

function ally_centroid(team: i32): i64 {
  let sx: i64 = 0, sy: i64 = 0, count: i64 = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.alive || u.team != team) continue;
    sx += u.x; sy += u.y; count++;
  }
  if (count == 0) return (<i64>(160 * FP) << 32) | <u32>(120 * FP);
  return (<i64>(<i32>(sx / count)) << 32) | <u32>(<i32>(sy / count));
}

function role_centroid(team: i32, role: i32): i64 {
  let sx: i64 = 0, sy: i64 = 0, count: i64 = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.alive || u.team != team || u.role != role) continue;
    sx += u.x; sy += u.y; count++;
  }
  if (count == 0) return ally_centroid(team);
  return (<i64>(<i32>(sx / count)) << 32) | <u32>(<i32>(sy / count));
}

function isolated_enemy(index: i32): i32 {
  const u = units[index];
  let best = -1;
  let best_d: i64 = <i64>0x7fffffff * <i64>0x7fffffff;
  for (let i = 0; i < units.length; i++) {
    const foe = units[i];
    if (!foe.alive || foe.team == u.team) continue;
    if (!within(u, foe, 96)) continue;
    let supported = false;
    for (let j = 0; j < units.length; j++) {
      if (i == j) continue;
      const friend = units[j];
      if (friend.alive && friend.team == foe.team && within(foe, friend, 24)) {
        supported = true; break;
      }
    }
    const d = dist2(u.x, u.y, foe.x, foe.y);
    if (!supported && d < best_d) { best = i; best_d = d; }
  }
  return best;
}

function threatened_ally(index: i32): i32 {
  const u = units[index];
  let best = -1;
  let best_hp = 999;
  for (let i = 0; i < units.length; i++) {
    const ally = units[i];
    if (!ally.alive || ally.team != u.team || i == index) continue;
    if (ally.role != u.role) continue;
    if (!within(u, ally, 48)) continue;
    let pressed = false;
    for (let j = 0; j < units.length; j++) {
      const foe = units[j];
      if (foe.alive && foe.team != u.team && within(ally, foe, 16)) { pressed = true; break; }
    }
    if (pressed && ally.hp < best_hp) { best = i; best_hp = ally.hp; }
  }
  return best;
}

function condition_true(index: i32, condition: i32): bool {
  const u = units[index];
  if (condition == ALLY_PINNED) return threatened_ally(index) >= 0;
  if (condition == FOE_ALONE) return isolated_enemy(index) >= 0;
  if (condition == WOUNDED) return u.hp * 2 <= u.max_hp;
  if (condition == LINE_BROKEN) {
    const c = role_centroid(u.team, u.role);
    const cx = <i32>(c >> 32), cy = <i32>c;
    const r = <i64>(42 * FP);
    return dist2(u.x, u.y, cx, cy) > r * r;
  }
  let friends = 0, foes = 0;
  for (let i = 0; i < units.length; i++) {
    if (i == index || !units[i].alive || !within(u, units[i], 32)) continue;
    if (units[i].team == u.team) friends++; else foes++;
  }
  return foes > friends + 1;
}

function cpu_condition(index: i32, limb: i32): i32 {
  if (limb == 0) return THREAT_HIGH;
  if (limb == 1) return ALLY_PINNED;
  return WOUNDED;
}

function cpu_order(limb: i32): i32 {
  if (limb == 0) return RALLY;
  if (limb == 1) return SCREEN;
  return WITHDRAW;
}

function choose_doctrine(index: i32): void {
  const u = units[index];
  u.branch = 3;
  u.order = u.team == 0 ? fallback_order : SCREEN;
  for (let limb = 0; limb < 3; limb++) {
    if (u.team == 0 && !limb_active[limb]) continue;
    const condition = u.team == 0 ? senses[limb] : cpu_condition(index, limb);
    if (condition_true(index, condition)) {
      u.branch = limb;
      u.order = u.team == 0 ? orders[limb] : cpu_order(limb);
      break;
    }
  }
  u.commit = COMMIT_FRAMES;
  u.unsupported_marked = false;
}

function focus_target(index: i32): i32 {
  const u = units[index];
  let best = nearest_enemy(index);
  let best_score = 0x7fffffff;
  for (let i = 0; i < units.length; i++) {
    const foe = units[i];
    if (!foe.alive || foe.team == u.team) continue;
    if (!within(u, foe, 100)) continue;
    const dx = q8_to_pixels(iabs(foe.x - u.x));
    const dy = q8_to_pixels(iabs(foe.y - u.y));
    const score = foe.hp * 18 + dx + dy + (foe.role == BOW ? -12 : 0);
    if (score < best_score) { best_score = score; best = i; }
  }
  return best;
}

function choose_target(index: i32): i32 {
  const u = units[index];
  if (u.order == FOCUS) {
    const lone = isolated_enemy(index);
    return lone >= 0 ? lone : focus_target(index);
  }
  if (u.order == SCREEN) {
    const ally_index = threatened_ally(index);
    if (ally_index >= 0) {
      const ally = units[ally_index];
      let best = -1;
      let best_d: i64 = <i64>0x7fffffff * <i64>0x7fffffff;
      for (let i = 0; i < units.length; i++) {
        const foe = units[i];
        if (!foe.alive || foe.team == u.team) continue;
        const d = dist2(ally.x, ally.y, foe.x, foe.y);
        if (d < best_d) { best_d = d; best = i; }
      }
      if (best >= 0) return best;
    }
  }
  return nearest_enemy(index);
}

function move_unit(index: i32): void {
  const u = units[index];
  if (!u.alive) return;
  if (u.commit <= 0) choose_doctrine(index); else u.commit--;
  if (u.team == 0) branch_ticks[u.branch]++;
  if (u.target < 0 || u.target >= units.length || !units[u.target].alive) u.target = choose_target(index);
  if (u.target < 0) return;
  const target = units[u.target];
  let gx = target.x, gy = target.y;
  if (u.order == RALLY) {
    const c = role_centroid(u.team, u.role); gx = <i32>(c >> 32); gy = <i32>c;
  } else if (u.order == WITHDRAW) {
    gx = u.x + sign(u.x - target.x) * 48 * FP;
    gy = u.y + sign(u.y - target.y) * 32 * FP;
  }
  let dx = gx - u.x, dy = gy - u.y;
  const target_d = dist2(u.x, u.y, target.x, target.y);
  if (u.role == BOW) {
    const near = <i64>(25 * FP), ready = <i64>(38 * FP);
    if (target_d < near * near) { dx = -dx; dy = -dy; }
    else if (target_d <= ready * ready) { dx = 0; dy = 0; }
  }
  let speed = ROLE_SPEED[u.role];
  if (u.order == RALLY) speed = speed * 3 / 4;
  if (u.order == WITHDRAW) speed = speed * 5 / 4;
  const scale = iabs(dx) > iabs(dy) ? iabs(dx) : iabs(dy);
  let mx = scale > 0 ? q8_axis_step(dx, speed, scale) : 0;
  let my = scale > 0 ? q8_axis_step(dy, speed, scale) : 0;
  for (let i = 0; i < units.length; i++) {
    if (i == index) continue;
    const other = units[i];
    if (!other.alive) continue;
    const gap = other.team == u.team ? 12 : 9;
    if (!within(u, other, gap)) continue;
    let away_x = sign(u.x - other.x), away_y = sign(u.y - other.y);
    if (away_x == 0 && away_y == 0) {
      away_x = ((index + i) & 1) == 0 ? -1 : 1;
      away_y = index < i ? -1 : 1;
    }
    const strength = other.team == u.team ? 80 : 64;
    mx += away_x * strength;
    my += away_y * strength;
  }
  // A weak memory of deployment depth keeps the line broad without locking
  // units to a grid or overriding their doctrine.
  my += sign(u.lane_y - u.y) * 20;
  u.x += mx; u.y += my;
  if (u.x < pixels_to_q8(5)) u.x = pixels_to_q8(5);
  if (u.x > pixels_to_q8(314)) u.x = pixels_to_q8(314);
  if (u.y < pixels_to_q8(FIELD_TOP + 3)) u.y = pixels_to_q8(FIELD_TOP + 3);
  if (u.y > pixels_to_q8(FIELD_BOTTOM - 3)) u.y = pixels_to_q8(FIELD_BOTTOM - 3);
}

function ally_near(index: i32, pixels: i32): bool {
  const u = units[index];
  for (let i = 0; i < units.length; i++) {
    if (i != index && units[i].alive && units[i].team == u.team && within(u, units[i], pixels)) return true;
  }
  return false;
}

function attack_unit(index: i32): void {
  const u = units[index];
  if (!u.alive) return;
  if (u.cooldown > 0) { u.cooldown--; return; }
  if (u.target < 0 || u.target >= units.length || !units[u.target].alive) return;
  const foe = units[u.target];
  const range = u.role == BOW ? 43 : 10;
  if (!within(u, foe, range)) return;
  let damage = u.role == RIDER ? 3 : u.role == FOOT ? 2 : 1;
  if (u.role == FOOT && foe.role == RIDER) damage++;
  if (u.role == BOW && foe.role == FOOT) damage++;
  if (u.role == RIDER && foe.role == BOW) damage += 2;
  foe.hp -= damage;
  u.attack_flash = 7;
  foe.hit_flash = 8;
  u.cooldown = u.role == BOW ? 52 : u.role == RIDER ? 64 : 48;
  if (u.team == 0 && u.role == RIDER && !u.unsupported_marked && !ally_near(index, 28)) {
    unsupported_riders++;
    u.unsupported_marked = true;
  }
  if (foe.hp <= 0) {
    foe.alive = false;
    foe.hp = 0;
    foe.death_age = 180;
    u.target = -1;
    sfx("hit");
  }
}

function finish_battle(): void {
  const p = count_alive(0), e = count_alive(1);
  if (p == 0 && e == 0) outcome = "DRAW";
  else if (e == 0) outcome = "VICTORY";
  else if (p == 0) outcome = "DEFEAT";
  else if (p > e) outcome = "VICTORY";
  else if (e > p) outcome = "DEFEAT";
  else {
    const php = health_alive(0), ehp = health_alive(1);
    outcome = php > ehp ? "VICTORY" : ehp > php ? "DEFEAT" : "DRAW";
  }
  state = RESULTS;
  trace("state=results outcome=" + outcome + " frames=" + battle_frame.toString() +
    " p=" + p.toString() + " e=" + e.toString() +
    " unsupported=" + unsupported_riders.toString());
  sfx(outcome == "VICTORY" ? "fanfare" : outcome == "DEFEAT" ? "death" : "powerup");
}

function handle_battle(): void {
  if (intro_frame < INTRO_TOTAL) {
    if (a_pressed() || start_pressed()) {
      intro_frame = INTRO_TOTAL;
      trace("battle_intro=skipped");
      sfx("powerup");
      return;
    }
    intro_frame++;
    if (intro_frame == INTRO_SETTLE_END ||
        intro_frame == INTRO_SETTLE_END + 40 ||
        intro_frame == INTRO_SETTLE_END + 80) sfx("blip");
    if (intro_frame == INTRO_COUNTDOWN_END) sfx("powerup");
    if (intro_frame == INTRO_TOTAL) {
      trace("battle_intro=complete");
    }
    return;
  }
  if (start_pressed()) {
    battle_paused = !battle_paused;
    trace(battle_paused ? "battle=paused" : "battle=resumed");
    sfx("blip");
    return;
  }
  if (battle_paused) return;
  battle_frame++;
  for (let i = 0; i < units.length; i++) {
    if (units[i].attack_flash > 0) units[i].attack_flash--;
    if (units[i].hit_flash > 0) units[i].hit_flash--;
    if (units[i].death_age > 0) units[i].death_age--;
  }
  for (let i = 0; i < units.length; i++) move_unit(i);
  for (let i = 0; i < units.length; i++) attack_unit(i);
  const player_alive = count_alive(0), enemy_alive = count_alive(1);
  if (player_alive == 0 || enemy_alive == 0) {
    finish_battle();
  } else if (battle_frame >= BATTLE_LIMIT) {
    const smaller_army = player_alive < enemy_alive ? player_alive : enemy_alive;
    if (smaller_army > OVERTIME_THRESHOLD || battle_frame >= OVERTIME_LIMIT) finish_battle();
  }
}

function handle_results(): void {
  if (a_pressed()) {
    state = DOCTRINE; node = 0; tray_open = false;
    trace("state=doctrine from=results"); sfx("blip");
  } else if (start_pressed()) {
    start_battle();
  } else if (b_pressed()) {
    state = MUSTER; trace("state=muster from=results"); sfx("blip");
  }
}

function cart_ready(): void {
  set_palette_bytes(WAR_RGB, 32);
  load_preset(0);
  trace("state=title");
}

function cart_process(): void {
  if (reject_timer > 0) reject_timer--;
  if (state == TITLE) handle_title();
  else if (state == MUSTER) handle_muster();
  else if (state == DOCTRINE) handle_doctrine();
  else if (state == BATTLE) handle_battle();
  else handle_results();
}

function team_dark(team: i32): i32 { return team == 0 ? ALLY_DARK : FOE_DARK; }
function team_light(team: i32): i32 { return team == 0 ? ALLY_LIGHT : FOE_LIGHT; }

function draw_shadow(x: i32, y: i32, radius: i32): void {
  px_line(x - radius, y, x + radius, y, GRASS_DARK);
  if (radius > 3) px_line(x - radius + 2, y + 1, x + radius - 2, y + 1, GRASS_DARK);
}

function draw_foot(x: i32, y: i32, team: i32, facing: i32, striking: bool): void {
  const dark = team_dark(team), light = team_light(team);
  draw_shadow(x, y + 6, 4);
  px_line(x - 1, y + 2, x - 1, y + 5, LEATHER);
  px_line(x + 1, y + 2, x + 1, y + 5, LEATHER);
  px_rect(x - 2, y - 3, 5, 6, dark);
  px_rect(x - 1, y - 3, 3, 3, light);
  px_rect(x - 1, y - 6, 3, 3, SKIN);
  px_line(x - 2, y - 6, x + 2, y - 6, STEEL);
  const shield_x = x - facing * 3;
  px_line(shield_x - 1, y - 2, shield_x + 1, y - 2, light);
  px_line(shield_x - 2, y - 1, shield_x - 1, y + 1, light);
  px_line(shield_x + 2, y - 1, shield_x + 1, y + 1, light);
  px_pixel(shield_x, y + 2, light);
  px_pixel(shield_x, y, STEEL);
  const reach = striking ? 9 : 6;
  px_line(x + facing * 2, y - 3, x + facing * reach, y + (striking ? 0 : 2), STEEL);
  px_pixel(x + facing * reach, y + (striking ? 0 : 2), STRAW);
}

function draw_bow(x: i32, y: i32, team: i32, facing: i32, shooting: bool): void {
  const dark = team_dark(team), light = team_light(team);
  draw_shadow(x, y + 6, 3);
  px_line(x - 1, y + 2, x - 1, y + 5, LEATHER);
  px_line(x + 1, y + 2, x + 1, y + 5, LEATHER);
  px_rect(x - 2, y - 3, 4, 6, dark);
  px_pixel(x, y - 2, light);
  px_rect(x - 1, y - 6, 3, 3, SKIN);
  px_pixel(x, y - 7, LEATHER);
  const bow_x = x + facing * 3;
  px_line(bow_x - facing * 2, y - 5, bow_x + facing, y - 2, STRAW);
  px_line(bow_x + facing, y - 2, bow_x - facing * 2, y + 2, STRAW);
  px_line(bow_x - facing * 2, y - 5, bow_x - facing * 2, y + 2, LEATHER);
  if (shooting) {
    px_line(x + facing * 3, y - 1, x + facing * 10, y - 1, STEEL);
    px_pixel(x + facing * 11, y - 1, STRAW);
  }
}

function draw_rider(x: i32, y: i32, team: i32, facing: i32, charging: bool): void {
  const dark = team_dark(team), light = team_light(team);
  draw_shadow(x, y + 6, 6);
  px_rect(x - 4, y, 9, 4, HORSE_DARK);
  px_rect(x - 2, y, 5, 2, HORSE_LIGHT);
  px_rect(x + facing * 4, y - 2, 3, 4, HORSE_DARK);
  px_pixel(x + facing * 6, y - 3, HORSE_LIGHT);
  px_pixel(x - 3, y + 5, LEATHER); px_pixel(x + 3, y + 5, LEATHER);
  px_rect(x - 1, y - 5, 3, 5, dark);
  px_pixel(x, y - 4, light);
  px_rect(x - 1, y - 7, 3, 2, SKIN);
  px_line(x - 2, y - 7, x + 2, y - 7, STEEL);
  const reach = charging ? 12 : 8;
  px_line(x + facing, y - 5, x + facing * reach, y - 2, STEEL);
  px_pixel(x + facing * reach, y - 2, STRAW);
}

function draw_unit(u: Unit, view_x: i32 = 0, entry_x: i32 = 0, step_y: i32 = 0): void {
  const x = q8_to_pixels(u.x) + view_x + entry_x, y = q8_to_pixels(u.y) + step_y;
  if (!u.alive) {
    if (u.death_age > 0) {
      px_line(x - 4, y + 3, x + 4, y + 3, GRASS_DARK);
      px_rect(x - 2, y + 1, 5, 2, team_dark(u.team));
      px_pixel(x + 3, y + 2, BLOOD);
      px_line(x - 3, y, x + 3, y + 4, LEATHER);
    }
    return;
  }
  let facing = u.team == 0 ? 1 : -1;
  if (u.target >= 0 && u.target < units.length && units[u.target].alive) {
    facing = sign(units[u.target].x - u.x);
    if (facing == 0) facing = u.team == 0 ? 1 : -1;
  }
  if (u.role == FOOT) draw_foot(x, y, u.team, facing, u.attack_flash > 0);
  else if (u.role == BOW) draw_bow(x, y, u.team, facing, u.attack_flash > 0);
  else draw_rider(x, y, u.team, facing, u.attack_flash > 0);
  if (u.hit_flash > 0) {
    px_pixel(x - 2, y - 2, WHITE); px_pixel(x + 2, y, BLOOD);
    px_pixel(x, y + 2, WHITE);
  }
  draw_branch_mark(x, y - (u.role == RIDER ? 11 : 10), u.branch);
  if (u.hit_flash > 0 && u.hp < u.max_hp) {
    const width = u.role == RIDER ? 11 : 9;
    px_rect(x - width / 2, y + 8, width, 2, DIRT_DARK);
    px_rect(x - width / 2, y + 8, width * u.hp / u.max_hp, 2, team_light(u.team));
  }
}

function draw_title(): void {
  blit_sprite(TITLE_ART, TITLE_ART_W, TITLE_ART_H, 0, 0);
  px_rect(0, 0, 320, 12, BLACK);
  px_rect(0, 194, 320, 46, BLACK);
  px_text_centered(161, 22, "MICRO AI WAR", BLACK, 2);
  px_text_centered(160, 20, "MICRO AI WAR", STRAW, 2);
  px_text_centered(160, 49, "COMMAND. COMMIT. CONQUER.", LIGHT_GRAY);
  px_text_centered(160, 201, "A CALYX STRATEGY CART", DARK_GRAY);
  if (((frame() / 30) & 1) == 0) px_text_centered(160, 222, "A / START: MUSTER", WHITE);
}

function draw_branch_mark(x: i32, y: i32, branch: i32): void {
  const color = LIMB_COLORS[branch];
  px_line(x - 2, y, x - 2, y + 4, LEATHER);
  px_line(x - 1, y, x + 2, y, color);
  if (branch == 0) px_pixel(x + 2, y + 1, color);
  else if (branch == 1) px_line(x, y + 1, x + 2, y + 1, color);
  else if (branch == 2) px_pixel(x, y + 1, color);
  else { px_pixel(x, y + 1, color); px_pixel(x + 1, y + 2, color); }
}

function draw_muster_card(role: i32, x: i32): void {
  const selected = muster_role == role;
  const y = selected ? 65 : 72;
  const color = role == FOOT ? LIGHT_GREEN : role == BOW ? YELLOW : ORANGE;
  px_rect(x, y, 86, 105, selected ? DARK_GRAY : DARK_BLUE);
  px_rect_outline(x, y, 86, 105, selected ? WHITE : color);
  px_text_centered(x + 43, y + 10, role_name(role), color);
  if (role == FOOT) draw_foot(x + 43, y + 42, 0, 1, false);
  else if (role == BOW) draw_bow(x + 43, y + 42, 0, 1, false);
  else draw_rider(x + 43, y + 42, 0, 1, false);
  px_text_centered(x + 43, y + 61, "x " + muster_counts[role].toString(), WHITE);
  px_text_centered(x + 43, y + 76, ROLE_CUES[role], color);
  px_text_centered(x + 43, y + 90, "COST " + ROLE_COSTS[role].toString(), LIGHT_GRAY);
  if (selected) {
    px_line(x + 32, y + 101, x + 54, y + 101, color);
    px_pixel(x + 29, y + 101, color); px_pixel(x + 57, y + 101, color);
  }
}

function draw_muster(): void {
  clear(BLACK);
  px_text_centered(160, 12, "MICRO AI WAR", WHITE, 2);
  px_text_centered(160, 39, "MUSTER", CYAN);
  px_text_centered(160, 52, "VS GUARD  24 / 10 / 6", RED);
  draw_muster_card(FOOT, 16);
  draw_muster_card(BOW, 117);
  draw_muster_card(RIDER, 218);
  const used = supply_used();
  px_text(8, 188, "SUPPLY", LIGHT_GRAY);
  px_rect(54, 190, 180, 6, DARK_GRAY);
  px_rect(54, 190, 180 * used / SUPPLY, 6, used == SUPPLY ? LIGHT_GREEN : CYAN);
  px_rect_outline(54, 190, 180, 6, WHITE);
  px_text(244, 188, used.toString() + "/" + SUPPLY.toString(), WHITE);
  px_text_centered(160, 210, "A ADD   B REMOVE", LIGHT_GRAY);
  px_text_centered(160, 226, "START: BUILD DOCTRINE", used > 0 ? CYAN : DARK_GRAY);
  if (reject_timer > 0) px_text_centered(160, 174, "SUPPLY LOCKED", RED);
}

function draw_trigger_piece(x: i32, y: i32, label: string, color: i32, selected: bool): void {
  const edge = selected ? WHITE : color;
  px_rect(x + 5, y, 86, 23, DARK_BLUE);
  px_rect(x + 2, y + 4, 92, 15, DARK_BLUE);
  px_line(x + 5, y, x + 90, y, edge);
  px_line(x + 2, y + 4, x + 2, y + 18, edge);
  px_line(x + 94, y + 4, x + 94, y + 18, edge);
  px_line(x + 5, y + 22, x + 90, y + 22, edge);
  px_line(x + 2, y + 4, x + 5, y, edge);
  px_line(x + 90, y, x + 94, y + 4, edge);
  px_line(x + 2, y + 18, x + 5, y + 22, edge);
  px_line(x + 90, y + 22, x + 94, y + 18, edge);
  px_text_centered(x + 48, y + 8, label, color);
  if (selected) {
    px_rect_outline(x - 3, y - 4, 102, 31, BLACK);
    px_rect_outline(x - 2, y - 3, 100, 29, WHITE);
  }
}

function draw_order_piece(x: i32, y: i32, label: string, color: i32, selected: bool): void {
  const edge = selected ? WHITE : color;
  px_rect(x, y, 96, 24, DARK_BLUE);
  px_rect_outline(x, y, 96, 24, edge);
  px_rect(x + 38, y - 3, 20, 4, DARK_BLUE);
  px_line(x + 38, y - 3, x + 57, y - 3, edge);
  px_line(x + 38, y - 3, x + 38, y, edge);
  px_line(x + 57, y - 3, x + 57, y, edge);
  px_text_centered(x + 48, y + 8, label, color);
  if (selected) {
    px_rect_outline(x - 3, y - 6, 102, 34, BLACK);
    px_rect_outline(x - 2, y - 5, 100, 32, WHITE);
  }
}

function node_selected(value: i32): bool { return !tray_open && node == value; }

function node_description(): string {
  if (node == 0) return "LOAD A COMPLETE STARTING PLAN.";
  if (node_is_sense(node)) return sense_description(senses[node_limb(node)]);
  if (node == 7) return order_description(fallback_order);
  return order_description(orders[node_limb(node)]);
}

function draw_doctrine(): void {
  clear(BLACK);
  px_text(6, 5, "CHOOSE DOCTRINE", CYAN);
  px_text(202, 5, "CPU DOCTRINE: GUARD", RED);
  const core_color = doctrine_custom ? PURPLE : CYAN;
  px_rect(112, 20, 96, 25, DARK_BLUE);
  px_rect_outline(112, 20, 96, 25, node_selected(0) ? WHITE : core_color);
  px_circle(120, 32, 3, core_color); px_circle(200, 32, 3, core_color);
  px_text_centered(160, 29, doctrine_name(), core_color);
  if (node_selected(0)) {
    px_rect_outline(109, 17, 102, 31, BLACK);
    px_rect_outline(110, 18, 100, 29, WHITE);
  }

  for (let limb = 0; limb < 3; limb++) {
    const tx = NODE_X[1 + limb * 2] + 48;
    const c = limb_active[limb] ? LIMB_COLORS[limb] : DARK_GRAY;
    px_line(160, 45, tx, 61, c);
    px_line(tx, 61, tx, 68, c);
    px_line(tx, 91, tx, 103, c);
    if (limb_active[limb]) {
      const trigger_label = tray_open && node == 1 + limb * 2 ? "CHOOSE PIECE" : sense_name(senses[limb]);
      const order_label = tray_open && node == 2 + limb * 2 ? "CHOOSE PIECE" : order_name(orders[limb]);
      draw_trigger_piece(NODE_X[1 + limb * 2], 68, trigger_label, c,
        node_selected(1 + limb * 2));
      draw_order_piece(NODE_X[2 + limb * 2], 106, order_label, c,
        node_selected(2 + limb * 2));
    } else {
      draw_trigger_piece(NODE_X[1 + limb * 2], 68, "NO CONDITION", DARK_GRAY,
        node_selected(1 + limb * 2));
      draw_order_piece(NODE_X[2 + limb * 2], 106, "NO ORDER", DARK_GRAY,
        node_selected(2 + limb * 2));
    }
    px_text_centered(tx, 94, (limb + 1).toString(), c);
  }
  px_line(160, 45, 160, 147, LIGHT_GRAY);
  px_rect(113, 132, 94, 14, BLACK);
  px_text_centered(160, 134, "DEFAULT ORDER", LIGHT_GRAY);
  draw_order_piece(112, 150, tray_open && node == 7 ? "CHOOSE PIECE" : order_name(fallback_order),
    LIGHT_GRAY, node_selected(7));

  if (snap_timer > 0) {
    const x = node == 0 ? 112 : NODE_X[node], y = node == 0 ? 20 : NODE_Y[node];
    px_rect_outline(x - 2, y - 5, 100, 32, WHITE);
  }
  if (tray_open) draw_piece_tray();
  else {
    const hint = node == 0 ? "A NEXT   B MUSTER   START DEPLOY" :
      node == 7 ? "A EDIT   START DEPLOY" : "A EDIT   B REMOVE   START DEPLOY";
    px_rect(0, 186, 320, 54, DARK_BLUE);
    px_line(0, 186, 320, 186, WHITE);
    px_text_centered(160, 196, node_description(), WHITE);
    px_text_centered(160, 226, hint, CYAN);
  }
}

function draw_piece_tray(): void {
  px_rect(0, 182, 320, 58, DARK_BLUE);
  px_line(0, 182, 320, 182, WHITE);
  px_text_centered(160, 187, "CHOOSE PIECE   A USE   B CANCEL", LIGHT_GRAY);
  const count = node_is_sense(node) ? SENSE_COUNT : ORDER_COUNT;
  const color = node == 7 ? LIGHT_GRAY : LIMB_COLORS[node_limb(node)];
  for (let offset = -1; offset <= 1; offset++) {
    const value = (tray_index + count + offset) % count;
    const x = 112 + offset * 104;
    if (node_is_sense(node)) draw_trigger_piece(x, 205, sense_name(value), color, offset == 0);
    else draw_order_piece(x, 205, order_name(value), color, offset == 0);
  }
  px_pixel(103, 217, LIGHT_GRAY); px_pixel(216, 217, LIGHT_GRAY);
}

function draw_ground_patch(cx: i32, cy: i32, radius: i32, color: i32, roughness: i32,
    view_x: i32): void {
  for (let dy = -radius; dy <= radius; dy++) {
    const taper = iabs(dy) * 3 / 4;
    let half = radius - taper;
    if (half < 2) half = 2;
    const offset = ((dy * 7 + roughness * 11) % 9) - 4;
    const left_chip = ((dy + roughness) & 3) == 0 ? 5 : 0;
    const right_chip = ((dy * 3 + roughness) & 7) == 0 ? 7 : 0;
    px_line(cx + view_x - half + offset + left_chip, cy + dy,
      cx + view_x + half + offset - right_chip, cy + dy, color);
  }
}

function draw_battlefield(view_x: i32 = 0): void {
  px_rect(0, FIELD_TOP, 320, FIELD_BOTTOM - FIELD_TOP, GRASS);
  px_rect(0, FIELD_TOP, 320, 5, GRASS_DARK);
  px_rect(0, FIELD_BOTTOM - 4, 320, 4, GRASS_DARK);

  // Trampled central ground: asymmetrical, chipped patches rather than a lane.
  draw_ground_patch(145, 112, 27, DIRT, 3, view_x);
  draw_ground_patch(180, 129, 22, DIRT_DARK, 7, view_x);
  draw_ground_patch(113, 132, 13, DIRT, 2, view_x);
  draw_ground_patch(209, 101, 10, DIRT, 5, view_x);
  draw_ground_patch(164, 143, 9, DIRT, 8, view_x);
  for (let i = 0; i < 18; i++) {
    const x = 104 + (i * 29) % 112 + view_x;
    const y = 89 + (i * 41) % 71;
    px_pixel(x, y, (i & 3) == 0 ? STRAW : GRASS_DARK);
  }

  // Old wheel ruts and irregular field edges sell place without becoming a grid.
  px_line(view_x, 184, 88 + view_x, 164, DIRT_DARK);
  px_line(view_x, 189, 91 + view_x, 168, DIRT);
  px_line(231 + view_x, 72, 319 + view_x, 49, DIRT_DARK);
  px_line(228 + view_x, 76, 319 + view_x, 53, DIRT);
  px_line(44 + view_x, 52, 101 + view_x, 61, GRASS_LIGHT);
  px_line(241 + view_x, 188, 300 + view_x, 179, GRASS_LIGHT);

  for (let i = 0; i < 26; i++) {
    const x = 7 + (i * 47) % 309 + view_x;
    const y = FIELD_TOP + 10 + (i * 71) % (FIELD_BOTTOM - FIELD_TOP - 20);
    const c = (i & 3) == 0 ? STRAW : GRASS_LIGHT;
    px_pixel(x, y, c);
    if ((i & 1) == 0) px_pixel(x + 1, y - 1, c);
  }
  for (let i = 0; i < 9; i++) {
    const x = 31 + (i * 83) % 277 + view_x;
    const y = 39 + (i * 53) % 162;
    px_pixel(x, y, STEEL);
    px_pixel(x + 1, y, DIRT_DARK);
  }

  // Army standards anchor the two sides as a battlefield, not a plot.
  px_line(13 + view_x, 40, 13 + view_x, 64, LEATHER);
  px_rect(14 + view_x, 41, 9, 7, ALLY_DARK);
  px_rect(14 + view_x, 41, 7, 3, ALLY_LIGHT);
  px_pixel(22 + view_x, 47, ALLY_DARK);
  px_line(306 + view_x, 40, 306 + view_x, 64, LEATHER);
  px_rect(297 + view_x, 41, 9, 7, FOE_DARK);
  px_rect(299 + view_x, 41, 7, 3, FOE_LIGHT);
  px_pixel(297 + view_x, 47, FOE_DARK);
}

function draw_battle_units(view_x: i32 = 0, ally_entry_x: i32 = 0, ally_step_y: i32 = 0): void {
  for (let i = 0; i < units.length; i++) {
    if (!units[i].alive) draw_unit(units[i], view_x, units[i].team == 0 ? ally_entry_x : 0,
      units[i].team == 0 ? ally_step_y : 0);
  }
  for (let y = FIELD_TOP; y < FIELD_BOTTOM; y++) {
    for (let i = 0; i < units.length; i++) {
      if (units[i].alive && q8_to_pixels(units[i].y) == y) {
        draw_unit(units[i], view_x, units[i].team == 0 ? ally_entry_x : 0,
          units[i].team == 0 ? ally_step_y : 0);
      }
    }
  }
}

function draw_battle(): void {
  let view_x = 0;
  let ally_entry_x = 0;
  let ally_step_y = 0;
  if (intro_frame < INTRO_PAN_END) {
    view_x = 70 * (INTRO_PAN_END - intro_frame) / INTRO_PAN_END;
    ally_entry_x = -32 * (INTRO_PAN_END - intro_frame) / INTRO_PAN_END;
    ally_step_y = ((intro_frame / 8) & 1) == 0 ? -1 : 1;
  }
  clear(BLACK);
  draw_battlefield(view_x);
  draw_battle_units(view_x, ally_entry_x, ally_step_y);
  px_rect(0, 0, 320, 23, BLACK);
  px_text(4, 7, "YOU " + count_alive(0).toString(), CYAN);
  px_text_centered(160, 7, "PLAN: " + doctrine_name(), WHITE);
  px_text(258, 7, count_alive(1).toString() + " GUARD", RED);
  px_rect(0, 223, 320, 17, BLACK);
  px_text(5, 228, intro_frame < INTRO_TOTAL ? "A / START SKIP" :
    battle_paused ? "START RESUME" : "START PAUSE", LIGHT_GRAY);
  if (intro_frame < INTRO_TOTAL) {
    px_text(267, 228, "READY", LIGHT_GRAY);
  } else if (battle_frame < BATTLE_LIMIT) {
    const remain = (BATTLE_LIMIT - battle_frame) / 60;
    px_text(244, 228, remain.toString() + "s LEFT", LIGHT_GRAY);
  } else {
    const overtime = (OVERTIME_LIMIT - battle_frame) / 60;
    px_text(264, 228, "OT " + overtime.toString() + "s", ORANGE);
  }
  if (battle_paused) {
    px_rect(102, 99, 116, 36, BLACK);
    px_rect_outline(102, 99, 116, 36, WHITE);
    px_text_centered(160, 106, "BATTLE PAUSED", YELLOW);
    px_text_centered(160, 121, "START: RESUME", WHITE);
  }
  if (intro_frame >= INTRO_SETTLE_END && intro_frame < INTRO_COUNTDOWN_END) {
    const count = 3 - (intro_frame - INTRO_SETTLE_END) / 40;
    px_rect(132, 94, 56, 46, BLACK);
    px_rect_outline(132, 94, 56, 46, STRAW);
    px_text_centered(160, 103, count.toString(), WHITE, 3);
  } else if (intro_frame >= INTRO_COUNTDOWN_END && intro_frame < INTRO_TOTAL) {
    px_rect(105, 99, 110, 36, BLACK);
    px_rect_outline(105, 99, 110, 36, STRAW);
    px_text_centered(160, 108, "FIGHT!", WHITE, 2);
  }
}

function branch_percent(limb: i32): i32 {
  const total = branch_ticks[0] + branch_ticks[1] + branch_ticks[2] + branch_ticks[3];
  return total == 0 ? 0 : branch_ticks[limb] * 100 / total;
}

function dominant_branch(): i32 {
  let best = 0;
  for (let i = 1; i < 4; i++) if (branch_ticks[i] > branch_ticks[best]) best = i;
  return best;
}

function branch_order_name(limb: i32): string {
  return limb == 3 ? order_name(fallback_order) : order_name(orders[limb]);
}

function branch_report_name(limb: i32): string {
  if (limb == 3) return "BASE>" + short_order(fallback_order);
  return short_sense(senses[limb]) + ">" + short_order(orders[limb]);
}

function draw_results(): void {
  clear(BLACK);
  const result_color = outcome == "VICTORY" ? LIGHT_GREEN : outcome == "DEFEAT" ? RED : YELLOW;
  px_text_centered(160, 12, outcome, result_color, 2);
  px_text_centered(160, 38, "DEBRIEF", CYAN);
  px_rect_outline(12, 57, 142, 62, CYAN);
  px_rect_outline(166, 57, 142, 62, RED);
  px_text_centered(83, 63, "SURVIVORS", CYAN);
  px_text_centered(237, 63, "CPU", RED);
  for (let role = 0; role < ROLE_COUNT; role++) {
    const y = 79 + role * 13;
    px_text(22, y, role_name(role), LIGHT_GRAY);
    px_text(126, y, count_role_alive(0, role).toString(), WHITE);
    px_text(176, y, role_name(role), DARK_GRAY);
    px_text(281, y, count_role_alive(1, role).toString(), WHITE);
  }
  px_text(14, 124, "DOCTRINE TIME", LIGHT_GRAY);
  for (let limb = 0; limb < 4; limb++) {
    const y = 140 + limb * 15;
    px_rect(16, y + 1, 8, 8, LIMB_COLORS[limb]);
    px_text(31, y, (limb == 3 ? "F " : (limb + 1).toString() + " ") + branch_report_name(limb),
      limb == 3 || limb_active[limb] ? WHITE : DARK_GRAY);
    const pct = branch_percent(limb);
    px_rect(152, y + 2, 90, 6, DARK_GRAY);
    px_rect(152, y + 2, 90 * pct / 100, 6, LIMB_COLORS[limb]);
    px_text(251, y, pct.toString() + "%", LIGHT_GRAY);
  }
  const dominant = dominant_branch();
  px_text_centered(160, 209, branch_report_name(dominant) + " LED " +
    branch_percent(dominant).toString() + "%", LIMB_COLORS[dominant]);
  px_text_centered(160, 229, "A TWEAK   START REMATCH   B MUSTER", LIGHT_GRAY);
}

function cart_draw(): void {
  if (state == TITLE) draw_title();
  else if (state == MUSTER) draw_muster();
  else if (state == DOCTRINE) draw_doctrine();
  else if (state == BATTLE) draw_battle();
  else draw_results();
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
