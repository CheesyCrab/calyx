// Horizon Burn — a deterministic globular rail-shmup prototype.
//
// Simulation lives in a bounded local spherical frame. Guest-side f64 is
// finite by construction; projection and drawing quantize to framebuffer
// integers. Nothing here promotes a 3D or entity API into Sunny.

import {
  run_start, run_update,
  frame, clear, px_pixel, px_rect, px_line, px_circle, px_circle_outline,
  px_text, px_text_centered, trace,
  input_x, input_y, a_held, a_pressed, b_held, b_pressed,
  left_pressed, right_pressed, start_pressed,
  seed, rand_range, sfx,
  lerp, round_i32,
  BLACK, WHITE, DARK_BLUE, PURPLE, RED, ORANGE, YELLOW,
  LIGHT_GREEN, GREEN, TEAL, NAVY, BLUE, LIGHT_BLUE, CYAN,
  LIGHT_GRAY, DARK_GRAY,
} from "../../sdk/assembly/index";

const TITLE: i32 = 0;
const PLAY: i32 = 1;
const VICTORY: i32 = 2;
const OVER: i32 = 3;
const OUTRO: i32 = 4;

const ROCK: i32 = 0;
const DRONE: i32 = 1;
const SWEEPER: i32 = 2;

const CRUISE: i32 = 0;
const BURN: i32 = 1;
const REDLINE: i32 = 2;

const CX: i32 = 160;
const CY: i32 = 180;
const GLOBE_R: i32 = 200;
const TAU: f64 = 6.283185307179586;
const HALF_PI: f64 = 1.5707963267948966;
const HORIZON_THETA: f64 = -0.98;
const ACTIVE_THETA: f64 = -0.65;
const PASS_THETA: f64 = 0.45;
const PLAYER_MIN_LON: f64 = -0.78;
const PLAYER_MAX_LON: f64 = 0.78;
const PLAYER_MIN_THETA: f64 = -0.21;
const PLAYER_MAX_THETA: f64 = 0.13;
const BOSS_START: i32 = 3150;
const MAX_THREATS: i32 = 24;
const MAX_ENEMY_SHOTS: i32 = 24;
const BOSS_WING_HP: i32 = 24;
const BOSS_CORE_HP: i32 = 92;
const UPGRADE_THRESHOLDS: StaticArray<i32> = [
  15, 36, 60, 113, 165, 225, 330, 450, 540,
];

class Threat {
  kind: i32;
  theta: f64;
  base_lon: f64;
  lon: f64;
  speed: f64;
  age: i32;
  seed_value: i32;
  preflash: i32;
  shots_fired: i32;
  tracking: f64;
  aggression: i32;

  constructor(kind: i32, lon: f64, speed: f64, tracking: f64, aggression: i32) {
    this.kind = kind;
    this.theta = HORIZON_THETA;
    this.base_lon = lon;
    this.lon = lon;
    this.speed = speed;
    this.age = 0;
    this.seed_value = rand_range(1, 65536);
    this.preflash = 0;
    this.shots_fired = 0;
    this.tracking = tracking;
    this.aggression = aggression;
  }
}

class Shot {
  lon: f64;
  theta: f64;
  dlon: f64;
  dtheta: f64;
  pierce: i32;
  pea: bool;

  constructor(
    lon: f64, theta: f64, dlon: f64, dtheta: f64,
    pierce: i32 = 0, pea: bool = false,
  ) {
    this.lon = lon;
    this.theta = theta;
    this.dlon = dlon;
    this.dtheta = dtheta;
    this.pierce = pierce;
    this.pea = pea;
  }
}

class DustMote {
  lon: f64;
  theta: f64;
  age: i32;

  constructor(lon: f64, theta: f64) {
    this.lon = lon;
    this.theta = theta;
    this.age = 0;
  }
}

class Spark {
  x: i32;
  y: i32;
  dx: i32;
  dy: i32;
  life: i32;
  color: i32;

  constructor(x: i32, y: i32, dx: i32, dy: i32, life: i32, color: i32) {
    this.x = x;
    this.y = y;
    this.dx = dx;
    this.dy = dy;
    this.life = life;
    this.color = color;
  }
}

let state: i32 = TITLE;
let play_frame: i32 = 0;
let player_lon: f64 = 0.0;
let player_theta: f64 = 0.02;
let world_roll: f64 = 0.0;
let selected_difficulty: i32 = BURN;
let integrity: i32 = 3;
let score: i32 = 0;
let dust: i32 = 0;
let weapon_level: i32 = 0;
let split_level: i32 = 0;
let rapid_level: i32 = 0;
let pierce_level: i32 = 0;
let upgrade_flash: i32 = 0;
let upgrade_banner: string = "";
let focus_witnessed: bool = false;
let pierce_witnessed: bool = false;
let horizon_hit_witnessed: bool = false;
let left_edge_witnessed: bool = false;
let right_edge_witnessed: bool = false;
let top_edge_witnessed: bool = false;
let bottom_edge_witnessed: bool = false;
let focus_phase: i32 = 0;
let focus_render_frames: i32 = 0;
let focus_world_steps: i32 = 0;
let focus_measure_reported: bool = false;
let invulnerable: i32 = 0;
let spawn_grace: i32 = 0;
let fire_cooldown: i32 = 0;
let hit_flash: i32 = 0;
let boss_spawned: bool = false;
let boss_active: bool = false;
let boss_defeated: bool = false;
let boss_age: i32 = 0;
let boss_lon: f64 = 0.0;
let boss_theta: f64 = -0.46;
let boss_left_hp: i32 = 0;
let boss_right_hp: i32 = 0;
let boss_core_hp: i32 = 0;
let boss_hit_flash: i32 = 0;
let boss_shot_clock: i32 = 0;
let boss_exploding: bool = false;
let outro_frame: i32 = 0;
let peak_threats: i32 = 0;
let threats: Threat[] = [];
let player_shots: Shot[] = [];
let enemy_shots: Shot[] = [];
let dust_motes: DustMote[] = [];
let sparks: Spark[] = [];

function clamp_f64(value: f64, low: f64, high: f64): f64 {
  return value < low ? low : value > high ? high : value;
}

function project_x(theta: f64, lon: f64): i32 {
  return CX + round_i32(<f64>GLOBE_R * Math.cos(theta) * Math.sin(lon));
}

function project_y(theta: f64): i32 {
  return CY + round_i32(<f64>GLOBE_R * Math.sin(theta));
}

function project_depth(theta: f64, lon: f64): f64 {
  return Math.cos(theta) * Math.cos(lon);
}

function approach_progress(theta: f64): f64 {
  return clamp_f64(
    (theta - HORIZON_THETA) / (PASS_THETA - HORIZON_THETA),
    0.0, 1.0,
  );
}

function surface_distance_sq(
  lon0: f64, theta0: f64, lon1: f64, theta1: f64,
): f64 {
  const mean_theta = (theta0 + theta1) * 0.5;
  const dx = (lon0 - lon1) * <f64>GLOBE_R * Math.cos(mean_theta);
  const dy = (theta0 - theta1) * <f64>GLOBE_R;
  return dx * dx + dy * dy;
}

function reset_game(): void {
  play_frame = 0;
  player_lon = 0.0;
  player_theta = 0.02;
  world_roll = 0.0;
  integrity = 3;
  score = 0;
  dust = 0;
  weapon_level = 0;
  split_level = 0;
  rapid_level = 0;
  pierce_level = 0;
  upgrade_flash = 0;
  upgrade_banner = "";
  focus_witnessed = false;
  pierce_witnessed = false;
  horizon_hit_witnessed = false;
  left_edge_witnessed = false;
  right_edge_witnessed = false;
  top_edge_witnessed = false;
  bottom_edge_witnessed = false;
  focus_phase = 0;
  focus_render_frames = 0;
  focus_world_steps = 0;
  focus_measure_reported = false;
  invulnerable = 0;
  spawn_grace = 110;
  fire_cooldown = 0;
  hit_flash = 0;
  boss_spawned = false;
  boss_active = false;
  boss_defeated = false;
  boss_age = 0;
  boss_lon = 0.0;
  boss_theta = -0.46;
  boss_left_hp = 0;
  boss_right_hp = 0;
  boss_core_hp = 0;
  boss_hit_flash = 0;
  boss_shot_clock = 0;
  boss_exploding = false;
  outro_frame = 0;
  peak_threats = 0;
  threats = [];
  player_shots = [];
  enemy_shots = [];
  dust_motes = [];
  sparks = [];
}

function begin_game(): void {
  reset_game();
  state = PLAY;
  trace(
    "horizon-burn state=play difficulty=" + difficulty_name() +
    " multiplier=" + score_multiplier_tenths().toString(),
  );
  sfx("powerup");
}

function spawn_threat(
  kind: i32, lon: f64, speed: f64,
  tracking: f64 = 0.0, aggression: i32 = 0,
): void {
  if (threats.length >= MAX_THREATS) return;
  threats.push(new Threat(kind, lon, speed, tracking, aggression));
  if (threats.length > peak_threats) peak_threats = threats.length;
}

function difficulty_name(): string {
  return selected_difficulty == CRUISE
    ? "CRUISE" : selected_difficulty == BURN ? "BURN" : "REDLINE";
}

function score_multiplier_tenths(): i32 {
  return selected_difficulty == CRUISE ? 10 : selected_difficulty == BURN ? 15 : 20;
}

function spawn_formation(index: i32): void {
  const phase = index / 7 > 5 ? 5 : index / 7;
  let kind = ROCK;
  if (phase == 1 || phase == 3) kind = DRONE;
  else if (phase >= 2) kind = index % 3;
  const speed = 0.0090 + <f64>phase * 0.00035 + <f64>(index % 3) * 0.00035;
  const base_lon = <f64>((index * 37) % 15 - 7) / 10.0;
  const other_lon = clamp_f64(
    -base_lon * 0.72 + (base_lon >= 0.0 ? -0.12 : 0.12), -0.76, 0.76,
  );
  const support_kind = kind == ROCK ? DRONE : ROCK;
  const flank_kind = kind == DRONE ? ROCK : DRONE;
  const center_kind = phase == 0 ? ROCK : DRONE;
  const center_tracking = phase < 3 ? 0.0012 : phase < 5 ? 0.0024 : 0.0034;
  const center_lon = player_lon * (phase < 3 ? 0.20 : 0.42);

  spawn_threat(kind, base_lon, speed, kind == DRONE ? center_tracking * 0.45 : 0.0, phase);
  spawn_threat(support_kind, other_lon, speed + 0.0003, 0.0, phase);
  if (selected_difficulty >= BURN) {
    const flank = (index & 1) == 0 ? -0.62 : 0.62;
    spawn_threat(flank_kind, flank, speed + 0.0005, 0.0, phase);
    spawn_threat(center_kind, center_lon, speed + 0.00065, center_tracking, phase);
    const pressure_lon = clamp_f64(-base_lon * 0.34, -0.46, 0.46);
    spawn_threat(
      phase >= 2 ? DRONE : ROCK, pressure_lon,
      speed + 0.00078, phase >= 2 ? center_tracking * 0.8 : 0.0, phase,
    );
  }
  if (selected_difficulty == REDLINE) {
    spawn_threat(ROCK, -0.76, speed + 0.0008, 0.0, phase);
    spawn_threat(DRONE, 0.76, speed + 0.0009, center_tracking * 0.7, phase);
  }
}

function spawn_schedule(): void {
  if (play_frame < 45 || play_frame > 2980) return;
  if ((play_frame - 45) % 56 != 0) return;
  const formation = (play_frame - 45) / 56;
  if (formation == 0) trace("horizon-burn phase=rock-run");
  if (formation == 7) trace("horizon-burn phase=drone-wing");
  if (formation == 14) trace("horizon-burn phase=sweeper-cross");
  if (formation == 21) trace("horizon-burn phase=converging-hunters");
  if (formation == 28) trace("horizon-burn phase=armed-storm");
  if (formation == 35) trace("horizon-burn phase=final-gauntlet");
  spawn_formation(formation);
}

function fire_player_volley(): void {
  const count = split_level == 0 ? 1 : split_level == 1 ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const centered = <f64>i - <f64>(count - 1) * 0.5;
    const v_shot = split_level >= 3;
    const offset = centered * (v_shot ? 0.012 : 0.022);
    const drift = centered * (v_shot ? 0.0026 : 0.0007);
    player_shots.push(new Shot(
      player_lon + offset, player_theta - 0.05, drift, -0.045, pierce_level,
      v_shot && i != 1,
    ));
  }
  fire_cooldown = 6 - rapid_level;
  sfx("blip");
}

function update_player(): void {
  if (invulnerable > 0) invulnerable--;
  if (spawn_grace > 0) spawn_grace--;
  if (upgrade_flash > 0) upgrade_flash--;
  if (fire_cooldown > 0) fire_cooldown--;
  if (hit_flash > 0) hit_flash--;

  const focused = b_held();
  const lateral_speed: f64 = focused ? 0.0075 : 0.024;
  const vertical_speed: f64 = focused ? 0.004 : 0.013;
  const ix = input_x();
  const iy = input_y();
  if (focused && !focus_witnessed) {
    focus_witnessed = true;
    trace("horizon-burn focus=locked world=third weapon=disabled");
  }
  player_lon = clamp_f64(
    player_lon + <f64>ix * lateral_speed,
    PLAYER_MIN_LON, PLAYER_MAX_LON,
  );
  player_theta = clamp_f64(
    player_theta + <f64>iy * vertical_speed,
    PLAYER_MIN_THETA, PLAYER_MAX_THETA,
  );
  if (!left_edge_witnessed && player_lon <= PLAYER_MIN_LON + 0.001) {
    left_edge_witnessed = true;
    trace("horizon-burn envelope=left x=" + project_x(player_theta, player_lon).toString());
  }
  if (!right_edge_witnessed && player_lon >= PLAYER_MAX_LON - 0.001) {
    right_edge_witnessed = true;
    trace("horizon-burn envelope=right x=" + project_x(player_theta, player_lon).toString());
  }
  if (!top_edge_witnessed && player_theta <= PLAYER_MIN_THETA + 0.001) {
    top_edge_witnessed = true;
    trace("horizon-burn envelope=top y=" + project_y(player_theta).toString());
  }
  if (!bottom_edge_witnessed && player_theta >= PLAYER_MAX_THETA - 0.001) {
    bottom_edge_witnessed = true;
    trace("horizon-burn envelope=bottom y=" + project_y(player_theta).toString());
  }
  if (!focused && a_held() && fire_cooldown == 0) {
    fire_player_volley();
  }
}

function fire_enemy(t: Threat): void {
  if (enemy_shots.length >= MAX_ENEMY_SHOTS) return;
  const travel_frames: f64 = 76.0;
  const dlon = (player_lon - t.lon) / travel_frames;
  enemy_shots.push(new Shot(t.lon, t.theta + 0.025, dlon, 0.019));
  t.shots_fired++;
  t.preflash = 0;
  sfx("hit");
}

function spawn_boss(): void {
  boss_spawned = true;
  boss_active = true;
  boss_age = 0;
  boss_lon = 0.0;
  boss_theta = -0.82;
  boss_left_hp = BOSS_WING_HP;
  boss_right_hp = BOSS_WING_HP;
  boss_core_hp = BOSS_CORE_HP;
  boss_hit_flash = 0;
  boss_shot_clock = 90;
  trace(
    "horizon-burn boss=arrive hp=" + boss_total_hp().toString() +
    " peak_threats=" + peak_threats.toString(),
  );
  sfx("powerup");
}

function boss_total_hp(): i32 {
  return boss_left_hp + boss_right_hp + boss_core_hp;
}

function fire_boss_pulse(origin_lon: f64, aim_offset: f64 = 0.0): void {
  if (enemy_shots.length >= MAX_ENEMY_SHOTS) return;
  const travel_frames: f64 = 82.0;
  enemy_shots.push(new Shot(
    origin_lon, boss_theta + 0.035,
    (player_lon + aim_offset - origin_lon) / travel_frames, 0.018,
  ));
}

function update_boss(): void {
  if (!boss_spawned && play_frame >= BOSS_START) spawn_boss();
  if (!boss_active) return;
  boss_age++;
  if (boss_hit_flash > 0) boss_hit_flash--;
  if (boss_theta < -0.46) boss_theta += 0.004;
  const wounded = boss_left_hp == 0 || boss_right_hp == 0;
  const sweep_speed: f64 = wounded ? 0.020 : 0.013;
  boss_lon = Math.sin(<f64>boss_age * sweep_speed) * (wounded ? 0.43 : 0.34);
  if (boss_shot_clock > 0) boss_shot_clock--;
  if (boss_shot_clock == 0 && boss_age > 70) {
    if (boss_left_hp > 0) fire_boss_pulse(boss_lon - 0.13, -0.08);
    if (boss_right_hp > 0) fire_boss_pulse(boss_lon + 0.13, 0.08);
    if (wounded || selected_difficulty == REDLINE) fire_boss_pulse(boss_lon);
    const base_delay = selected_difficulty == CRUISE ? 84 : selected_difficulty == BURN ? 60 : 46;
    boss_shot_clock = wounded ? base_delay - 12 : base_delay;
    sfx("hit");
  }
}

function defeat_boss(): void {
  const x = project_x(boss_theta, boss_lon);
  const y = project_y(boss_theta);
  boss_active = false;
  boss_defeated = true;
  boss_exploding = true;
  outro_frame = 0;
  score += 5000 * score_multiplier_tenths() / 10;
  burst_at(x, y, WHITE, 10);
  threats = [];
  enemy_shots = [];
  player_shots = [];
  state = OUTRO;
  trace("horizon-burn boss=defeated frame=" + play_frame.toString());
  trace("horizon-burn outro=begin weapons=locked");
  sfx("explosion");
}

function hit_boss(shot: Shot): bool {
  if (!boss_active || project_depth(boss_theta, boss_lon) <= 0.0) return false;
  let zone = -1;
  if (
    boss_left_hp > 0 &&
    surface_distance_sq(shot.lon, shot.theta, boss_lon - 0.13, boss_theta) < 121.0
  ) zone = 0;
  else if (
    boss_right_hp > 0 &&
    surface_distance_sq(shot.lon, shot.theta, boss_lon + 0.13, boss_theta) < 121.0
  ) zone = 1;
  else if (
    boss_core_hp > 0 &&
    surface_distance_sq(shot.lon, shot.theta, boss_lon, boss_theta) < 144.0
  ) zone = 2;
  if (zone < 0) return false;

  if (zone == 0) {
    boss_left_hp--;
    if (boss_left_hp == 0) trace("horizon-burn boss=left-wing-broken");
  } else if (zone == 1) {
    boss_right_hp--;
    if (boss_right_hp == 0) trace("horizon-burn boss=right-wing-broken");
  } else {
    boss_core_hp--;
  }
  boss_hit_flash = 5;
  const hit_x = project_x(shot.theta, shot.lon);
  const hit_y = project_y(shot.theta);
  burst_at(hit_x, hit_y, WHITE, 3);
  for (let mote = 0; mote < 2; mote++) {
    if (dust_motes.length >= 48) {
      dust++;
      check_weapon_upgrade();
    } else {
      dust_motes.push(new DustMote(
        shot.lon + <f64>(mote * 2 - 1) * 0.006, shot.theta,
      ));
    }
  }
  if (boss_age % 5 == 0) sfx("coin");
  if (boss_total_hp() <= 0) defeat_boss();
  return true;
}

function update_threats(): void {
  for (let i = threats.length - 1; i >= 0; i--) {
    const t = threats[i];
    t.age++;
    t.theta += t.speed;
    if (t.kind == DRONE) {
      if (t.tracking > 0.0) {
        t.base_lon = lerp(t.base_lon, player_lon, t.tracking);
        t.base_lon = clamp_f64(t.base_lon, -0.80, 0.80);
      }
      t.lon = t.base_lon + Math.sin(<f64>t.age * 0.024) * 0.11;
      const cruise_can_fire = selected_difficulty != CRUISE || t.seed_value % 3 != 0;
      if (t.preflash == 0 && cruise_can_fire) {
        if (t.shots_fired == 0 && t.theta > -0.30) {
          t.preflash = 36;
        } else if (
          t.shots_fired == 1 && (t.seed_value & 1) == 0 && t.theta > -0.02 &&
          (selected_difficulty == REDLINE ||
            (selected_difficulty == BURN && t.aggression >= 4))
        ) {
          t.preflash = 28;
        } else if (
          selected_difficulty == REDLINE && t.shots_fired == 2 &&
          t.aggression >= 5 && t.seed_value % 3 == 0 && t.theta > 0.16
        ) {
          t.preflash = 20;
        }
      }
      if (t.preflash > 0) {
        t.preflash--;
        if (t.preflash == 1) fire_enemy(t);
      }
    } else if (t.kind == SWEEPER) {
      const direction: f64 = t.base_lon < 0.0 ? 1.0 : -1.0;
      t.lon = t.base_lon + direction * Math.sin(<f64>t.age * 0.027) * 0.68;
      t.lon = clamp_f64(t.lon, -0.88, 0.88);
    }
    if (t.theta > PASS_THETA) threats.splice(i, 1);
  }
}

function update_shots(): void {
  for (let i = player_shots.length - 1; i >= 0; i--) {
    const shot = player_shots[i];
    shot.lon += shot.dlon;
    shot.theta += shot.dtheta;
    if (shot.theta < -1.42) player_shots.splice(i, 1);
  }
  for (let i = enemy_shots.length - 1; i >= 0; i--) {
    const shot = enemy_shots[i];
    shot.lon += shot.dlon;
    shot.theta += shot.dtheta;
    if (shot.theta > 1.12 || shot.lon < -1.0 || shot.lon > 1.0) {
      enemy_shots.splice(i, 1);
    }
  }
}

function burst_at(x: i32, y: i32, color: i32, count: i32): void {
  const capped = sparks.length > 42 ? 2 : count;
  for (let i = 0; i < capped; i++) {
    sparks.push(new Spark(
      x, y,
      rand_range(-2, 3), rand_range(-2, 3),
      rand_range(10, 24), color,
    ));
  }
}

function update_sparks(): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.x += spark.dx;
    spark.y += spark.dy;
    spark.life--;
    if (spark.life <= 0) sparks.splice(i, 1);
  }
}

function roman(level: i32): string {
  return level == 1 ? "I" : level == 2 ? "II" : "III";
}

function upgrade_name(level: i32): string {
  if (level == 7) return "V-SHOT";
  const kind = (level - 1) % 3;
  const tier = (level - 1) / 3 + 1;
  const name = kind == 0 ? "SPLIT" : kind == 1 ? "RAPID" : "PIERCE";
  return name + " " + roman(tier);
}

function next_upgrade_threshold(): i32 {
  return weapon_level < 9 ? <i32>UPGRADE_THRESHOLDS[weapon_level] : 9999;
}

function check_weapon_upgrade(): void {
  while (weapon_level < 9 && dust >= next_upgrade_threshold()) {
    weapon_level++;
    const kind = (weapon_level - 1) % 3;
    if (kind == 0) split_level++;
    else if (kind == 1) rapid_level++;
    else pierce_level++;
    upgrade_flash = 90;
    upgrade_banner = upgrade_name(weapon_level);
    trace(
      "horizon-burn upgrade=" + upgrade_name(weapon_level) +
      " dust=" + dust.toString() + " frame=" + play_frame.toString() +
      " levels=" + split_level.toString() + "/" + rapid_level.toString() +
      "/" + pierce_level.toString(),
    );
    sfx("powerup");
  }
}

function spawn_dust(t: Threat): void {
  const count = t.kind == ROCK ? 3 : t.kind == DRONE ? 4 : 5;
  for (let i = 0; i < count; i++) {
    if (dust_motes.length >= 48) {
      dust++;
      continue;
    }
    const offset = <f64>(i * 2 - count + 1) * 0.008;
    dust_motes.push(new DustMote(t.lon + offset, t.theta - <f64>(i & 1) * 0.01));
  }
  check_weapon_upgrade();
}

function update_dust(): void {
  for (let i = dust_motes.length - 1; i >= 0; i--) {
    const mote = dust_motes[i];
    mote.age++;
    const pull = 0.075 + <f64>mote.age * 0.0025;
    mote.lon = lerp(mote.lon, player_lon, pull);
    mote.theta = lerp(mote.theta, player_theta, pull);
    if (
      mote.age >= 34 ||
      surface_distance_sq(mote.lon, mote.theta, player_lon, player_theta) < 20.0
    ) {
      dust++;
      dust_motes.splice(i, 1);
      check_weapon_upgrade();
    }
  }
}

function threat_hit_radius(t: Threat): f64 {
  return t.kind == ROCK ? 9.0 : t.kind == DRONE ? 8.0 : 10.0;
}

function threat_contact_radius(t: Threat): f64 {
  return t.kind == ROCK ? 4.0 : t.kind == DRONE ? 3.0 : 5.0;
}

function hit_player(cause: string): void {
  if (invulnerable > 0) return;
  integrity--;
  invulnerable = 100;
  hit_flash = 18;
  burst_at(project_x(player_theta, player_lon), project_y(player_theta), RED, 12);
  trace(
    "horizon-burn player-hit integrity=" + integrity.toString() +
    " frame=" + play_frame.toString() + " cause=" + cause,
  );
  sfx(integrity <= 0 ? "death" : "explosion");
  if (integrity <= 0) {
    state = OVER;
    trace("horizon-burn state=over score=" + score.toString());
  }
}

function destroy_threat(index: i32): void {
  const t = threats[index];
  const x = project_x(t.theta, t.lon);
  const y = project_y(t.theta);
  const base_score = t.kind == ROCK ? 100 : t.kind == DRONE ? 250 : 350;
  score += base_score * score_multiplier_tenths() / 10;
  if (!horizon_hit_witnessed && t.theta <= ACTIVE_THETA) {
    horizon_hit_witnessed = true;
    trace(
      "horizon-burn visible-horizon-hit kind=" + t.kind.toString() +
      " theta_milli=" + round_i32(t.theta * 1000.0).toString(),
    );
  }
  burst_at(x, y, WHITE, 4);
  burst_at(x, y, t.kind == ROCK ? ORANGE : CYAN, 10);
  spawn_dust(t);
  threats.splice(index, 1);
  sfx("explosion");
}

function check_collisions(): void {
  for (let si = player_shots.length - 1; si >= 0; si--) {
    const shot = player_shots[si];
    let spent = false;
    if (hit_boss(shot)) {
      if (state != PLAY) return;
      if (shot.pierce > 0) shot.pierce--;
      else spent = true;
    }
    if (spent) {
      player_shots.splice(si, 1);
      continue;
    }
    for (let ti = threats.length - 1; ti >= 0; ti--) {
      const t = threats[ti];
      if (project_depth(t.theta, t.lon) <= 0.0) continue;
      const radius = threat_hit_radius(t) + 2.0;
      if (surface_distance_sq(shot.lon, shot.theta, t.lon, t.theta) < radius * radius) {
        destroy_threat(ti);
        if (shot.pierce > 0) {
          shot.pierce--;
          if (!pierce_witnessed) {
            pierce_witnessed = true;
            trace("horizon-burn pierce=continued frame=" + play_frame.toString());
          }
        } else {
          spent = true;
          break;
        }
      }
    }
    if (spent) {
      player_shots.splice(si, 1);
    }
  }

  if (invulnerable == 0 && spawn_grace == 0) {
    for (let i = enemy_shots.length - 1; i >= 0; i--) {
      if (surface_distance_sq(
        enemy_shots[i].lon, enemy_shots[i].theta,
        player_lon, player_theta,
      ) < 16.0) {
        enemy_shots.splice(i, 1);
        hit_player("pulse");
        break;
      }
    }
  }

  if (invulnerable == 0 && spawn_grace == 0) {
    for (let i = threats.length - 1; i >= 0; i--) {
      const t = threats[i];
      if (t.theta <= ACTIVE_THETA) continue;
      const radius = threat_contact_radius(t) + 2.0;
      if (surface_distance_sq(t.lon, t.theta, player_lon, player_theta) < radius * radius) {
        threats.splice(i, 1);
        hit_player("contact-" + t.kind.toString());
        break;
      }
    }
  }
}

function process_title(): void {
  if (left_pressed() && selected_difficulty > CRUISE) {
    selected_difficulty--;
    trace("horizon-burn difficulty=" + difficulty_name());
    sfx("blip");
  }
  if (right_pressed() && selected_difficulty < REDLINE) {
    selected_difficulty++;
    trace("horizon-burn difficulty=" + difficulty_name());
    sfx("blip");
  }
  if (a_pressed() || start_pressed()) begin_game();
}

function process_play(): void {
  update_player();
  let world_step = true;
  if (b_held()) {
    focus_phase = (focus_phase + 1) % 3;
    world_step = focus_phase == 0;
    if (!focus_measure_reported) {
      focus_render_frames++;
      if (world_step) focus_world_steps++;
      if (focus_render_frames == 60) {
        focus_measure_reported = true;
        trace(
          "horizon-burn focus-measure renders=60 world_steps=" +
          focus_world_steps.toString(),
        );
      }
    }
  } else {
    focus_phase = 0;
  }
  if (!world_step) return;

  play_frame++;
  world_roll += 0.010 + <f64>input_x() * 0.006;
  spawn_schedule();
  update_threats();
  update_boss();
  update_shots();
  update_sparks();
  update_dust();
  check_collisions();
  if (state != PLAY) return;

  if (play_frame % 300 == 0) {
    trace(
      "horizon-burn state=play frame=" + play_frame.toString() +
      " integrity=" + integrity.toString() +
      " score=" + score.toString() +
      " threats=" + threats.length.toString() +
      " dust=" + dust.toString() +
      " weapon=" + weapon_level.toString() +
      " player_x=" + project_x(player_theta, player_lon).toString() +
      " player_y=" + project_y(player_theta).toString(),
    );
  }
}

function process_result(): void {
  update_sparks();
  update_dust();
  if (b_pressed()) {
    state = TITLE;
    trace("horizon-burn state=title difficulty=" + difficulty_name());
  } else if (a_pressed() || start_pressed()) {
    begin_game();
  }
}

function outro_burst(offset_x: i32, offset_y: i32, color: i32, count: i32): void {
  burst_at(
    project_x(boss_theta, boss_lon) + offset_x,
    project_y(boss_theta) + offset_y,
    color, count,
  );
}

function process_outro(): void {
  outro_frame++;
  world_roll += 0.004;
  player_theta = lerp(player_theta, 0.04, 0.012);
  update_sparks();
  update_dust();

  if (outro_frame == 18) {
    outro_burst(-18, 4, CYAN, 14);
    sfx("explosion");
  } else if (outro_frame == 38) {
    outro_burst(18, 3, ORANGE, 14);
    sfx("explosion");
  } else if (outro_frame == 62) {
    outro_burst(-5, -7, WHITE, 18);
    sfx("death");
  } else if (outro_frame == 92) {
    outro_burst(0, 1, YELLOW, 24);
    sfx("explosion");
  } else if (outro_frame == 120) {
    boss_exploding = false;
    outro_burst(0, 0, WHITE, 28);
    trace("horizon-burn outro=warden-disintegrated");
  } else if (outro_frame == 158) {
    sfx("fanfare");
  } else if (outro_frame >= 180) {
    state = VICTORY;
    trace("horizon-burn state=victory score=" + score.toString());
  }
}

function draw_stars(): void {
  for (let i = 0; i < 46; i++) {
    const x = (i * 73 + 19) % 320;
    const y = (i * 37 + 11) % 220;
    const twinkle = ((frame() / 24 + i) % 5) == 0;
    px_pixel(x, y, twinkle ? LIGHT_GRAY : DARK_GRAY);
  }
}

function draw_globe_grid(anim_frame: i32): void {
  px_circle(CX, CY, GLOBE_R, DARK_BLUE);

  // Racing contours stream from the crest toward the ship. Their projected
  // acceleration makes the globe itself carry the forward-speed fantasy.
  for (let band = 0; band < 9; band++) {
    const phase = <f64>((anim_frame * 9 + band * 67) % 603) / 603.0;
    const theta = HORIZON_THETA + 0.04 + phase * 1.34;
    let previous_x = 0;
    let previous_y = 0;
    let have_previous = false;
    for (let step = -18; step <= 18; step++) {
      const lon = <f64>step * 0.075;
      const depth = project_depth(theta, lon);
      if (depth <= 0.0) {
        have_previous = false;
        continue;
      }
      const x = project_x(theta, lon);
      const y = project_y(theta);
      if (have_previous) {
        const color = phase > 0.78 ? TEAL : phase > 0.48 ? BLUE : NAVY;
        px_line(previous_x, previous_y, x, y, color);
      }
      previous_x = x;
      previous_y = y;
      have_previous = true;
    }
  }

  const spacing: f64 = 0.42;
  const roll = state == TITLE ? <f64>anim_frame * 0.003 : world_roll;
  const phase = ((roll % spacing) + spacing) % spacing;
  const pursuit_yaw = state == PLAY ? -player_lon * 0.26 : 0.0;
  for (let meridian = -4; meridian <= 4; meridian++) {
    const lon = <f64>meridian * spacing + phase + pursuit_yaw;
    let previous_x = 0;
    let previous_y = 0;
    let have_previous = false;
    for (let step = -18; step <= 18; step++) {
      const theta = <f64>step * 0.075;
      if (project_depth(theta, lon) <= 0.0) {
        have_previous = false;
        continue;
      }
      const x = project_x(theta, lon);
      const y = project_y(theta);
      if (have_previous) px_line(previous_x, previous_y, x, y, NAVY);
      previous_x = x;
      previous_y = y;
      have_previous = true;
    }
  }

  // Flow marks move from horizon to foreground and make forward drift explicit.
  for (let i = 0; i < 17; i++) {
    const phase = (<f64>((anim_frame * 7 + i * 53) % 420) / 420.0);
    const theta = HORIZON_THETA + phase * 1.38;
    const lon = <f64>((i * 47) % 101 - 50) / 72.0;
    if (project_depth(theta, lon) > 0.0) {
      const x = project_x(theta, lon);
      const y = project_y(theta);
      const trail = 1 + round_i32(phase * 3.0);
      px_line(x, y - trail, x, y, phase > 0.62 ? TEAL : NAVY);
      if (phase > 0.84) px_pixel(x, y, LIGHT_BLUE);
    }
  }
  px_circle_outline(CX, CY, GLOBE_R, BLUE, 2);
}

function threat_scale(t: Threat): i32 {
  const progress = approach_progress(t.theta);
  const limb = 0.88 + 0.12 * Math.cos(t.lon);
  return 3 + round_i32(progress * 15.0 * limb);
}

function draw_rock(t: Threat, x: i32, y: i32, r: i32): void {
  const color = t.theta <= ACTIVE_THETA ? YELLOW : ORANGE;
  if (r > 4) px_circle(x, y, r - 2, DARK_BLUE);
  const spin = <f64>t.age * 0.035;
  let first_x = 0;
  let first_y = 0;
  let previous_x = 0;
  let previous_y = 0;
  for (let i = 0; i < 7; i++) {
    const bit = (t.seed_value >> (i * 2)) & 3;
    const radius = r - 1 + bit;
    const angle = spin + <f64>i * TAU / 7.0;
    const vx = x + round_i32(Math.cos(angle) * <f64>radius);
    const vy = y + round_i32(Math.sin(angle) * <f64>radius);
    if (i == 0) {
      first_x = vx;
      first_y = vy;
    } else {
      px_line(previous_x, previous_y, vx, vy, color);
    }
    previous_x = vx;
    previous_y = vy;
  }
  px_line(previous_x, previous_y, first_x, first_y, color);
  if (r >= 8) px_pixel(x + r / 3, y - r / 4, YELLOW);
}

function draw_drone_shape(x: i32, y: i32, r: i32, flash: bool): void {
  const color = flash ? WHITE : RED;
  if (r > 5) px_circle(x, y, r / 2, DARK_BLUE);
  px_line(x - r, y - r / 3, x, y + r, color);
  px_line(x, y + r, x + r, y - r / 3, color);
  px_line(x - r, y - r / 3, x - r / 3, y, PURPLE);
  px_line(x + r / 3, y, x + r, y - r / 3, PURPLE);
  px_pixel(x, y, CYAN);
}

function draw_drone(t: Threat, x: i32, y: i32, r: i32): void {
  const flash = t.preflash > 0 && (t.preflash / 5) % 2 == 0;
  draw_drone_shape(x, y, r, flash);
}

function draw_sweeper(t: Threat, x: i32, y: i32, r: i32): void {
  if (r > 4) {
    for (let dy = -r + 2; dy <= r - 2; dy++) {
      const half = r - 2 - (dy < 0 ? -dy : dy);
      px_line(x - half, y + dy, x + half, y + dy, DARK_BLUE);
    }
  }
  px_line(x, y - r, x - r, y, PURPLE);
  px_line(x - r, y, x, y + r, PURPLE);
  px_line(x, y + r, x + r, y, PURPLE);
  px_line(x + r, y, x, y - r, PURPLE);
  px_line(x - r - 2, y, x + r + 2, y, RED);
  px_pixel(x, y, WHITE);
}

function draw_boss(): void {
  if (!boss_active && !boss_exploding) return;
  const shake = boss_exploding ? (outro_frame / 3) % 3 - 1 : 0;
  const x = project_x(boss_theta, boss_lon) + shake;
  const y = project_y(boss_theta) - shake;
  const flash = boss_exploding
    ? (outro_frame / 3) % 2 == 0
    : boss_hit_flash > 0 && (boss_hit_flash & 1) == 1;
  const body_color = flash ? WHITE : RED;
  const edge_color = flash ? CYAN : PURPLE;
  const telegraph = boss_shot_clock > 0 && boss_shot_clock < 22 && (boss_shot_clock / 3) % 2 == 0;

  if (boss_left_hp > 0) {
    px_line(x - 8, y, x - 27, y - 7, body_color);
    px_line(x - 27, y - 7, x - 20, y + 9, edge_color);
    px_line(x - 20, y + 9, x - 6, y + 5, body_color);
    px_pixel(x - 19, y + 1, telegraph ? YELLOW : CYAN);
  } else {
    px_line(x - 7, y + 1, x - 14, y + 7, DARK_GRAY);
    px_pixel(x - 16, y + 8, ORANGE);
  }
  if (boss_right_hp > 0) {
    px_line(x + 8, y, x + 27, y - 7, body_color);
    px_line(x + 27, y - 7, x + 20, y + 9, edge_color);
    px_line(x + 20, y + 9, x + 6, y + 5, body_color);
    px_pixel(x + 19, y + 1, telegraph ? YELLOW : CYAN);
  } else {
    px_line(x + 7, y + 1, x + 14, y + 7, DARK_GRAY);
    px_pixel(x + 16, y + 8, ORANGE);
  }
  px_circle(x, y, 8, DARK_BLUE);
  px_circle_outline(x, y, 9, body_color);
  px_line(x - 6, y - 4, x, y + 8, edge_color);
  px_line(x, y + 8, x + 6, y - 4, edge_color);
  px_circle(x, y + 1, telegraph ? 3 : 2, telegraph ? YELLOW : WHITE);
  if (boss_exploding) {
    const blast_r = 10 + (outro_frame % 24) / 3;
    px_circle_outline(x, y, blast_r, outro_frame < 70 ? ORANGE : WHITE);
  }
}

function draw_threats(): void {
  // Four quantized depth passes guarantee far-to-near overlap.
  for (let band = 0; band < 4; band++) {
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      const depth = project_depth(t.theta, t.lon);
      if (depth <= 0.0) continue;
      const draw_band = <i32>clamp_f64(Math.floor(depth * 4.0), 0.0, 3.0);
      if (draw_band != band) continue;
      const x = project_x(t.theta, t.lon);
      const y = project_y(t.theta);
      const r = threat_scale(t);
      if (t.theta <= ACTIVE_THETA) {
        const tell_r = r + ((t.age / 8) & 1);
        if (t.kind == ROCK) {
          px_circle_outline(x, y, tell_r, YELLOW);
        } else if (t.kind == DRONE) {
          px_line(x - tell_r, y - 1, x, y + tell_r, YELLOW);
          px_line(x, y + tell_r, x + tell_r, y - 1, YELLOW);
        } else {
          px_line(x - tell_r, y, x + tell_r, y, YELLOW);
          px_pixel(x, y - 1, WHITE);
        }
      } else if (t.kind == ROCK) {
        draw_rock(t, x, y, r);
      } else if (t.kind == DRONE) {
        draw_drone(t, x, y, r);
      } else {
        draw_sweeper(t, x, y, r);
      }
    }
  }
}

function draw_shots(): void {
  for (let i = 0; i < player_shots.length; i++) {
    const shot = player_shots[i];
    if (project_depth(shot.theta, shot.lon) <= 0.0) continue;
    const x = project_x(shot.theta, shot.lon);
    const y = project_y(shot.theta);
    const progress = approach_progress(shot.theta);
    if (shot.pea) {
      px_pixel(x, y, WHITE);
      px_pixel(x, y + 1, CYAN);
      continue;
    }
    const length = 1 + round_i32(progress * 6.0);
    px_line(x, y, x, y + length, CYAN);
    if (progress > 0.28) px_pixel(x, y, WHITE);
    if (progress > 0.68) {
      px_pixel(x - 1, y + 1, WHITE);
      px_pixel(x + 1, y + 1, WHITE);
    }
  }
  for (let i = 0; i < enemy_shots.length; i++) {
    const shot = enemy_shots[i];
    if (project_depth(shot.theta, shot.lon) <= 0.0) continue;
    const x = project_x(shot.theta, shot.lon);
    const y = project_y(shot.theta);
    const progress = approach_progress(shot.theta);
    const radius = 1 + round_i32(progress * 2.0);
    const wake = 1 + round_i32(progress * 4.0);
    px_line(x, y - wake, x, y, RED);
    px_circle(x, y, radius, ORANGE);
    if (progress > 0.35) px_pixel(x, y, WHITE);
  }
}

function draw_dust(): void {
  for (let i = 0; i < dust_motes.length; i++) {
    const mote = dust_motes[i];
    if (project_depth(mote.theta, mote.lon) <= 0.0) continue;
    const x = project_x(mote.theta, mote.lon);
    const y = project_y(mote.theta);
    const player_x = project_x(player_theta, player_lon);
    const player_y = project_y(player_theta);
    const tail_x = x - (player_x > x ? 2 : player_x < x ? -2 : 0);
    const tail_y = y - (player_y > y ? 2 : player_y < y ? -2 : 0);
    px_line(tail_x, tail_y, x, y, YELLOW);
    px_pixel(x, y, mote.age > 20 ? WHITE : LIGHT_GREEN);
  }
}

function draw_player(): void {
  const x = project_x(player_theta, player_lon);
  const y = project_y(player_theta);
  const grace_ghost = invulnerable > 0 && (invulnerable / 5) % 2 == 0;
  const focus = b_held() && state == PLAY;
  const color = hit_flash > 0 ? RED : grace_ghost ? LIGHT_BLUE : WHITE;
  const bank = state == PLAY ? input_x() : 0;
  const nose_x = x + bank * 3;
  const left_y = y + 6 - bank * 2;
  const right_y = y + 6 + bank * 2;
  px_line(nose_x, y - 7, x - 6, left_y, color);
  px_line(x - 6, left_y, x, y + 3, grace_ghost ? DARK_GRAY : LIGHT_BLUE);
  px_line(x, y + 3, x + 6, right_y, grace_ghost ? DARK_GRAY : LIGHT_BLUE);
  px_line(x + 6, right_y, nose_x, y - 7, color);
  const exhaust = focus ? 7 : bank != 0 ? 13 : 10;
  px_line(x - 3, y + 5, x - 2, y + exhaust, ORANGE);
  px_line(x + 3, y + 5, x + 2, y + exhaust, ORANGE);
  if (focus) {
    px_circle_outline(x, y + 1, 3, CYAN);
    px_pixel(x, y + 1, WHITE);
  }
}

function draw_sparks(): void {
  for (let i = 0; i < sparks.length; i++) {
    const spark = sparks[i];
    px_pixel(spark.x, spark.y, spark.life < 7 ? DARK_GRAY : spark.color);
    if (spark.life > 14) px_pixel(spark.x + 1, spark.y, spark.color);
  }
}

function draw_hud(): void {
  px_rect(0, 0, 320, 17, BLACK);
  px_rect(0, 217, 320, 23, BLACK);
  px_text(7, 4, "SCORE " + score.toString(), WHITE);
  const center_label = b_held() && state == PLAY ? "FOCUS x0.33" : difficulty_name();
  const center_color = b_held() && state == PLAY
    ? YELLOW : selected_difficulty == REDLINE ? RED : CYAN;
  px_text_centered(CX, 4, center_label, center_color);
  px_text(221, 4, "HULL", LIGHT_GRAY);
  for (let i = 0; i < 3; i++) {
    px_rect(264 + i * 15, 5, 10, 6, i < integrity ? LIGHT_GREEN : DARK_GRAY);
  }
  let progress = play_frame < BOSS_START ? 80 * play_frame / BOSS_START : 80;
  if (boss_active) {
    const max_hp = BOSS_WING_HP * 2 + BOSS_CORE_HP;
    progress = 80 + 19 * (max_hp - boss_total_hp()) / max_hp;
  } else if (boss_defeated) {
    progress = 99;
  }
  px_text(3, 220, "DUST " + dust.toString(), YELLOW);
  px_text(75, 220, "S" + split_level.toString(), split_level > 0 ? CYAN : DARK_GRAY);
  px_text(108, 220, "R" + rapid_level.toString(), rapid_level > 0 ? CYAN : DARK_GRAY);
  px_text(141, 220, "P" + pierce_level.toString(), pierce_level > 0 ? CYAN : DARK_GRAY);
  px_rect(216, 226, 99, 3, DARK_GRAY);
  px_rect(216, 226, progress, 3, TEAL);
  px_rect(215 + progress, 224, 3, 7, WHITE);
  if (boss_active) {
    const boss_hp = boss_total_hp();
    const boss_width = 140 * boss_hp / (BOSS_WING_HP * 2 + BOSS_CORE_HP);
    px_rect(78, 18, 164, 13, BLACK);
    px_text(82, 20, "WARDEN", YELLOW);
    px_rect(132, 22, 104, 4, DARK_GRAY);
    px_rect(132, 22, boss_width * 104 / 140, 4, RED);
    for (let mark = 1; mark < 7; mark++) px_pixel(132 + mark * 14, 22, BLACK);
  }
}

function draw_title(): void {
  draw_globe_grid(<i32>frame());
  const drift = Math.sin(<f64>frame() * 0.013) * 0.08;
  draw_drone_shape(project_x(-0.42, -0.32 + drift), project_y(-0.42), 6, false);
  draw_drone_shape(project_x(-0.50, 0.28 + drift), project_y(-0.50), 5, false);
  for (let i = 0; i < 7; i++) {
    const theta = 0.10 - <f64>i * 0.075;
    const x = project_x(theta, 0.02);
    const y = project_y(theta);
    px_pixel(x, y, i < 2 ? WHITE : CYAN);
  }
  px_rect(31, 26, 258, 48, BLACK);
  px_text_centered(CX, 33, "HORIZON BURN", WHITE, 2);
  px_text_centered(CX, 61, "RIDE THE CURVATURE", CYAN);
  px_rect(29, 163, 262, 65, BLACK);
  px_text_centered(CX, 169, "D-PAD CARVE   A FIRE   B FOCUS/LOCK", LIGHT_BLUE);
  px_text_centered(CX, 182, "THREAT DENSITY", LIGHT_GRAY);
  px_text_centered(83, 196, selected_difficulty == CRUISE ? "[CRUISE]" : "CRUISE", selected_difficulty == CRUISE ? YELLOW : DARK_GRAY);
  px_text_centered(CX, 196, selected_difficulty == BURN ? "[BURN]" : "BURN", selected_difficulty == BURN ? YELLOW : DARK_GRAY);
  px_text_centered(239, 196, selected_difficulty == REDLINE ? "[REDLINE]" : "REDLINE", selected_difficulty == REDLINE ? YELLOW : DARK_GRAY);
  px_text_centered(CX, 211, "< > SELECT   A / START LAUNCH", WHITE);
}

function draw_result(title: string, color: i32): void {
  draw_globe_grid(play_frame);
  draw_threats();
  draw_shots();
  draw_player();
  draw_sparks();
  px_rect(40, 77, 240, 82, BLACK);
  px_text_centered(CX, 88, title, color, 2);
  px_text_centered(CX, 116, difficulty_name() + "  SCORE " + score.toString(), WHITE);
  px_text_centered(
    CX, 130,
    "DUST " + dust.toString() + "  S" + split_level.toString() +
    " R" + rapid_level.toString() + " P" + pierce_level.toString(),
    YELLOW,
  );
  px_text_centered(CX, 145, "A RETRY   B DIFFICULTY", LIGHT_BLUE);
}

function draw_play(): void {
  draw_globe_grid(play_frame);
  draw_boss();
  draw_threats();
  draw_shots();
  draw_dust();
  draw_player();
  draw_sparks();
  draw_hud();
  if (play_frame < 150) {
    px_rect(89, 20, 142, 15, BLACK);
    px_text_centered(CX, 23, "THREATS ON HORIZON", YELLOW);
  }
  if (upgrade_flash > 0) {
    px_rect(94, 24, 132, 17, BLACK);
    px_text_centered(CX, 28, upgrade_banner + " ONLINE", YELLOW);
  }
}

function draw_outro(): void {
  draw_globe_grid(play_frame + outro_frame / 2);
  draw_boss();
  draw_dust();
  draw_player();
  draw_sparks();

  if (outro_frame >= 96 && outro_frame < 99) {
    px_rect(0, 0, 320, 240, WHITE);
  } else if (outro_frame >= 99 && outro_frame < 103) {
    px_rect(0, 0, 320, 240, LIGHT_GRAY);
  }

  if (outro_frame >= 130) {
    const panel_height = 2 + (outro_frame - 130) * 2 > 82
      ? 82 : 2 + (outro_frame - 130) * 2;
    px_rect(40, 118 - panel_height / 2, 240, panel_height, BLACK);
    if (outro_frame >= 156) {
      px_text_centered(CX, 88, "HORIZON SECURE", LIGHT_GREEN, 2);
    }
    if (outro_frame >= 166) {
      px_text_centered(CX, 116, difficulty_name() + "  SCORE " + score.toString(), WHITE);
    }
  }
}

function cart_ready(): void {
  seed(0x48b07a1);
  reset_game();
  state = TITLE;
  trace("horizon-burn state=title projection=orthographic-sphere");
}

function cart_process(): void {
  if (state == TITLE) process_title();
  else if (state == PLAY) process_play();
  else if (state == OUTRO) process_outro();
  else process_result();
}

function cart_draw(): void {
  clear(BLACK);
  draw_stars();
  if (state == TITLE) draw_title();
  else if (state == PLAY) draw_play();
  else if (state == OUTRO) draw_outro();
  else if (state == VICTORY) draw_result("HORIZON SECURE", LIGHT_GREEN);
  else draw_result("SHIP LOST", RED);
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
