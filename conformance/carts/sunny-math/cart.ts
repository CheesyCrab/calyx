// Direct conformance for Sunny scalar math. The assertions are the value
// oracle; traces retain successful case labels in the completed frame record.

import {
  BLACK,
  WHITE,
  Rect,
  Recti,
  Vec2,
  Vec2i,
  Vec3,
  ceil_i32,
  clamp,
  clear,
  floor_i32,
  frame,
  inverse_lerp,
  lerp,
  move_toward,
  near_equal,
  px_text,
  remap,
  round_i32,
  run_start,
  run_update,
  saturate,
  sign,
  trace,
  wrap,
  wrap_angle_positive,
  wrap_angle_signed,
} from "../../../sdk/assembly/index";

const CASE_COUNT: i32 = 213;

function check(condition: bool, label: string): void {
  assert(condition, label);
  trace(label);
}

function run_cases(): void {
  check(clamp<i32>(-3, -2, 4) == -2, "01 clamp i32 low");
  check(clamp<i32>(4, -2, 4) == 4, "02 clamp i32 high");
  check(clamp<i64>(9, -2, 4) == 4, "03 clamp i64 high");
  check(clamp<f64>(0.25, 0.0, 1.0) == 0.25, "04 clamp f64 inside");
  check(saturate(-0.25) == 0.0, "05 saturate low");
  check(saturate(1.25) == 1.0, "06 saturate high");
  check(sign<i32>(-9) == -1, "07 sign i32 negative");
  check(sign<i32>(0) == 0, "08 sign i32 zero");
  check(sign<i64>(9) == 1, "09 sign i64 positive");
  check(sign<f64>(0.0) == 0, "10 sign f64 zero");
  check(sign<f64>(3.5) == 1, "11 sign f64 positive");
  check(wrap<i32>(-1, 0, 8) == 7, "12 wrap i32 below");
  check(wrap<i32>(8, 0, 8) == 0, "13 wrap i32 max");
  check(wrap<i32>(-5, -3, 4) == 2, "14 wrap i32 nonzero min");
  check(wrap<i64>(-9, -4, 4) == -1, "15 wrap i64 below");
  check(wrap<f64>(8.5, 0.0, 8.0) == 0.5, "16 wrap f64 above");
  check(lerp(2.0, 10.0, 0.25) == 4.0, "17 lerp inside");
  check(lerp(2.0, 10.0, 1.5) == 14.0, "18 lerp extrapolate");
  check(inverse_lerp(2.0, 2.0, 9.0) == 0.0, "19 inverse lerp zero width");
  check(inverse_lerp(2.0, 10.0, 4.0) == 0.25, "20 inverse lerp inside");
  check(remap(0.0, 10.0, 100.0, 200.0, 2.5) == 125.0, "21 remap inside");
  check(remap(2.0, 2.0, 100.0, 200.0, 9.0) == 100.0, "22 remap zero width");
  check(move_toward(2.0, 10.0, 3.0) == 5.0, "23 move toward positive");
  check(move_toward(9.0, 10.0, 3.0) == 10.0, "24 move toward clamp");
  check(move_toward(10.0, 2.0, 3.0) == 7.0, "25 move toward negative");
  check(move_toward(2.0, 10.0, 0.0) == 2.0, "26 move toward zero delta");
  check(
    wrap_angle_positive(-Math.PI / 2.0) == 3.0 * Math.PI / 2.0,
    "27 wrap angle positive negative",
  );
  check(wrap_angle_positive(Math.PI * 2.0) == 0.0, "28 wrap angle positive tau");
  check(
    wrap_angle_signed(3.0 * Math.PI / 2.0) == -Math.PI / 2.0,
    "29 wrap angle signed high",
  );
  check(wrap_angle_signed(Math.PI) == -Math.PI, "30 wrap angle signed pi");
  check(wrap_angle_signed(-Math.PI) == -Math.PI, "31 wrap angle signed negative pi");
  check(near_equal(1.0, 1.0000005), "32 near equal default");
  check(near_equal(1.0, 1.125, 0.125), "33 near equal inclusive");
  check(floor_i32(-1.2) == -2, "34 floor negative");
  check(ceil_i32(-1.2) == -1, "35 ceil negative");
  check(round_i32(-1.5) == -1, "36 round negative tie");
  check(round_i32(1.5) == 2, "37 round positive tie");
  check(round_i32(2147483647.0) == i32.MAX_VALUE, "38 round i32 max");
  check(round_i32(-2147483648.0) == i32.MIN_VALUE, "39 round i32 min");
  check(round_i32(Math.sqrt(2.0) * 1_000_000.0) == 1_414_214,
        "FP-01 sqrt quantized");
  check(round_i32(Math.sin(Math.PI / 6.0) * 1_000_000.0) == 500_000,
        "FP-02 sin quantized");
  check(round_i32(Math.cos(Math.PI / 3.0) * 1_000_000.0) == 500_000,
        "FP-03 cos quantized");
  check(round_i32(Math.tan(Math.PI / 4.0) * 1_000_000.0) == 1_000_000,
        "FP-04 tan quantized");
  check(round_i32(Math.atan2(1.0, -1.0) * 1_000_000.0) == 2_356_194,
        "FP-05 atan2 quantized");
  check(round_i32(Math.log(10.0) * 1_000_000.0) == 2_302_585,
        "FP-06 log quantized");
  check(
    wrap<f64>(-1.0, 1.0, 100000000000000000000.0) == 1.0,
    "40 wrap f64 rounded span",
  );

  const value_source = new Vec2(6.0, -8.0);
  const clone2 = value_source.clone();
  check(clone2 !== value_source && clone2.equals(new Vec2(6.0, -8.0)), "V2-01 vec2 clone result");
  check(value_source.add(new Vec2(2.0, 4.0)).equals(new Vec2(8.0, -4.0)), "V2-02 vec2 add result");
  check(value_source.subtract(new Vec2(2.0, 4.0)).equals(new Vec2(4.0, -12.0)), "V2-03 vec2 subtract result");
  check(value_source.multiply(new Vec2(2.0, 4.0)).equals(new Vec2(12.0, -32.0)), "V2-04 vec2 multiply result");
  check(value_source.divide(new Vec2(2.0, 4.0)).equals(new Vec2(3.0, -2.0)), "V2-05 vec2 divide result");
  check(value_source.scaled(2.0).equals(new Vec2(12.0, -16.0)), "V2-06 vec2 scaled result");
  check(value_source.divided_by_scalar(2.0).equals(new Vec2(3.0, -4.0)), "V2-07 vec2 scalar divide result");
  check(value_source.negated().equals(new Vec2(-6.0, 8.0)), "V2-08 vec2 negated result");
  check(value_source.equals(new Vec2(6.0, -8.0)), "V2-09 vec2 value methods immutable");
  check(value_source.dot(new Vec2(2.0, 4.0)) == -20.0, "V2-10 vec2 dot result");
  check(value_source.cross(new Vec2(2.0, 4.0)) == 40.0, "V2-11 vec2 cross result");
  check(value_source.length_squared() == 100.0, "V2-12 vec2 length squared result");
  check(value_source.length() == 10.0, "V2-13 vec2 length result");
  check(value_source.normalized().near_equals(new Vec2(0.6, -0.8)), "V2-14 vec2 normalized result");
  check(new Vec2().normalized().equals(new Vec2()), "V2-15 vec2 zero normalized result");
  check(value_source.distance_squared_to(new Vec2(9.0, -4.0)) == 25.0, "V2-16 vec2 distance squared result");
  check(value_source.distance_to(new Vec2(9.0, -4.0)) == 5.0, "V2-17 vec2 distance result");
  check(value_source.lerp_to(new Vec2(10.0, 0.0), 0.25).equals(new Vec2(7.0, -6.0)), "V2-18 vec2 lerp result");
  check(new Vec2().move_toward(new Vec2(3.0, 4.0), 2.0).near_equals(new Vec2(1.2, 1.6)), "V2-19 vec2 move step result");
  check(new Vec2().move_toward(new Vec2(3.0, 4.0), 5.0).equals(new Vec2(3.0, 4.0)), "V2-20 vec2 move snap result");
  check(value_source.move_toward(value_source, 2.0).equals(value_source), "V2-21 vec2 move zero-distance result");
  check(value_source.move_toward(new Vec2(9.0, -4.0), 0.0).equals(value_source), "V2-21b vec2 move zero-delta result");
  check(value_source.clamp_length(5.0).near_equals(new Vec2(3.0, -4.0)), "V2-22 vec2 clamp result");
  check(value_source.clamp_length(10.0).equals(value_source), "V2-23 vec2 clamp unchanged result");
  check(new Vec2().clamp_length(0.0).equals(new Vec2()), "V2-24 vec2 clamp zero result");
  check(value_source.clamp_length(0.0).equals(new Vec2()), "V2-24b vec2 clamp to zero result");
  check(value_source.equals(new Vec2(6.0, -8.0)) && !value_source.equals(new Vec2(6.0, 8.0)), "V2-25 vec2 equals results");
  check(value_source.near_equals(new Vec2(6.0000005, -8.0000005)) && !value_source.near_equals(new Vec2(6.01, -8.0)), "V2-26 vec2 near equals results");

  const mut2 = new Vec2(1.0, 2.0);
  check(mut2.add_in_place(new Vec2(2.0, 3.0)) === mut2 && mut2.equals(new Vec2(3.0, 5.0)), "54 vec2 mutate add");
  check(mut2.subtract_in_place(new Vec2(1.0, 1.0)) === mut2 && mut2.equals(new Vec2(2.0, 4.0)), "55 vec2 mutate subtract");
  check(mut2.scale_in_place(2.0) === mut2 && mut2.equals(new Vec2(4.0, 8.0)), "56 vec2 mutate scale");
  check(mut2.divide_scalar_in_place(4.0) === mut2 && mut2.equals(new Vec2(1.0, 2.0)), "57 vec2 mutate divide");
  check(mut2.normalize_in_place() === mut2 && mut2.near_equals(new Vec2(0.4472135954999579, 0.8944271909999159)), "58 vec2 mutate normalize");
  const zero_mut2 = new Vec2();
  check(zero_mut2.normalize_in_place() === zero_mut2 && zero_mut2.equals(new Vec2()), "V2-27 vec2 mutate zero normalize");

  const mut2i = new Vec2i(1, 2);
  check(mut2i.add_in_place(new Vec2i(2, 3)) === mut2i && mut2i.equals(new Vec2i(3, 5)), "59 vec2i mutate add");
  check(mut2i.subtract_in_place(new Vec2i(1, 1)) === mut2i && mut2i.equals(new Vec2i(2, 4)), "60 vec2i mutate subtract");
  check(mut2i.scale_in_place(2) === mut2i && mut2i.equals(new Vec2i(4, 8)), "61 vec2i mutate scale");
  check(mut2i.divide_scalar_in_place(4) === mut2i && mut2i.equals(new Vec2i(1, 2)), "62 vec2i mutate divide");

  const mut3 = new Vec3(1.0, 2.0, 3.0);
  check(mut3.add_in_place(new Vec3(1.0, 1.0, 1.0)) === mut3 && mut3.equals(new Vec3(2.0, 3.0, 4.0)), "63 vec3 mutate add");
  check(mut3.subtract_in_place(new Vec3(1.0, 1.0, 1.0)) === mut3 && mut3.equals(new Vec3(1.0, 2.0, 3.0)), "64 vec3 mutate subtract");
  check(mut3.scale_in_place(2.0) === mut3 && mut3.equals(new Vec3(2.0, 4.0, 6.0)), "65 vec3 mutate scale");
  check(mut3.divide_scalar_in_place(2.0) === mut3 && mut3.equals(new Vec3(1.0, 2.0, 3.0)), "66 vec3 mutate divide");
  check(mut3.normalize_in_place() === mut3 && mut3.near_equals(new Vec3(0.2672612419124244, 0.5345224838248488, 0.8017837257372732)), "67 vec3 mutate normalize");

  const halves = new Vec2(-1.5, -2.5);
  check(halves.floor_to_i().equals(new Vec2i(-2, -3)), "68 vec2 floor negative halves");
  check(halves.ceil_to_i().equals(new Vec2i(-1, -2)), "69 vec2 ceil negative halves");
  check(halves.round_to_i().equals(new Vec2i(-1, -2)), "70 vec2 round negative halves");

  check(((new Vec2(1.0, 2.0) + new Vec2(3.0, 4.0)) - new Vec2(1.0, 1.0)).equals(new Vec2(3.0, 5.0)) && (-new Vec2(1.0, 2.0)).equals(new Vec2(-1.0, -2.0)) && (new Vec2(3.0, 4.0) * 2.0).equals(new Vec2(6.0, 8.0)) && (new Vec2(3.0, 4.0) / 2.0).equals(new Vec2(1.5, 2.0)), "71 vec2 operators");
  check(((new Vec2i(1, 2) + new Vec2i(3, 4)) - new Vec2i(1, 1)).equals(new Vec2i(3, 5)) && (-new Vec2i(1, 2)).equals(new Vec2i(-1, -2)) && (new Vec2i(3, 4) * 2).equals(new Vec2i(6, 8)) && (new Vec2i(7, -7) / 2).equals(new Vec2i(3, -3)), "72 vec2i operators");
  check(((new Vec3(1.0, 2.0, 3.0) + new Vec3(3.0, 4.0, 5.0)) - new Vec3(1.0, 1.0, 1.0)).equals(new Vec3(3.0, 5.0, 7.0)) && (-new Vec3(1.0, 2.0, 3.0)).equals(new Vec3(-1.0, -2.0, -3.0)) && (new Vec3(1.0, 2.0, 3.0) * 2.0).equals(new Vec3(2.0, 4.0, 6.0)) && (new Vec3(1.0, 2.0, 3.0) / 2.0).equals(new Vec3(0.5, 1.0, 1.5)), "73 vec3 operators");
  const set2 = new Vec2();
  const copy2 = new Vec2();
  check(set2.set(1.0, 2.0) === set2 && copy2.copy_from(set2) === copy2 && copy2.equals(set2), "77 vec2 set copy mutation");
  const set2i = new Vec2i();
  const copy2i = new Vec2i();
  check(set2i.set(1, 2) === set2i && copy2i.copy_from(set2i) === copy2i && copy2i.equals(set2i), "78 vec2i set copy mutation");
  const set3 = new Vec3();
  const copy3 = new Vec3();
  check(set3.set(1.0, 2.0, 3.0) === set3 && copy3.copy_from(set3) === copy3 && copy3.equals(set3), "79 vec3 set copy mutation");

  const value2i = new Vec2i(6, -8);
  const clone2i = value2i.clone();
  check(clone2i !== value2i && clone2i.equals(new Vec2i(6, -8)), "V2I-01 vec2i clone result");
  check(value2i.add(new Vec2i(2, 4)).equals(new Vec2i(8, -4)), "V2I-02 vec2i add result");
  check(value2i.subtract(new Vec2i(2, 4)).equals(new Vec2i(4, -12)), "V2I-03 vec2i subtract result");
  check(value2i.multiply(new Vec2i(2, 4)).equals(new Vec2i(12, -32)), "V2I-04 vec2i multiply result");
  check(value2i.divide(new Vec2i(2, 4)).equals(new Vec2i(3, -2)), "V2I-05 vec2i divide result");
  check(value2i.scaled(2).equals(new Vec2i(12, -16)), "V2I-06 vec2i scaled result");
  check(value2i.divided_by_scalar(2).equals(new Vec2i(3, -4)), "V2I-07 vec2i scalar divide result");
  check(value2i.negated().equals(new Vec2i(-6, 8)), "V2I-08 vec2i negated result");
  check(value2i.dot(new Vec2i(2, 4)) == -20, "V2I-09 vec2i dot result");
  check(value2i.cross(new Vec2i(2, 4)) == 40, "V2I-10 vec2i cross result");
  check(value2i.length_squared() == 100, "V2I-11 vec2i length squared result");
  check(value2i.length() == 10.0, "V2I-12 vec2i length result");
  check(value2i.distance_squared_to(new Vec2i(9, -4)) == 25, "V2I-13 vec2i distance squared result");
  check(value2i.distance_to(new Vec2i(9, -4)) == 5.0, "V2I-14 vec2i distance result");
  check(value2i.equals(new Vec2i(6, -8)) && !value2i.equals(new Vec2i(6, 8)), "V2I-15 vec2i equals results");
  check(value2i.to_vec2().equals(new Vec2(6.0, -8.0)), "V2I-16 vec2i conversion result");
  check(value2i.equals(new Vec2i(6, -8)), "V2I-17 vec2i value methods immutable");
  check(new Vec2i(50000, 50000).dot(new Vec2i(50000, 50000)) == 5000000000, "V2I-18 vec2i dot i64");
  check(new Vec2i(50000, 50000).cross(new Vec2i(-50000, 50000)) == 5000000000, "V2I-19 vec2i cross i64");
  check(new Vec2i(50000, 50000).distance_squared_to(new Vec2i(-50000, -50000)) == 20000000000, "V2I-20 vec2i distance i64");

  const value3 = new Vec3(2.0, -3.0, 6.0);
  const clone3 = value3.clone();
  check(clone3 !== value3 && clone3.equals(new Vec3(2.0, -3.0, 6.0)), "V3-01 vec3 clone result");
  check(value3.add(new Vec3(1.0, 2.0, -2.0)).equals(new Vec3(3.0, -1.0, 4.0)), "V3-02 vec3 add result");
  check(value3.subtract(new Vec3(1.0, 2.0, -2.0)).equals(new Vec3(1.0, -5.0, 8.0)), "V3-03 vec3 subtract result");
  check(value3.multiply(new Vec3(1.0, 2.0, -2.0)).equals(new Vec3(2.0, -6.0, -12.0)), "V3-04 vec3 multiply result");
  check(value3.divide(new Vec3(2.0, -3.0, 3.0)).equals(new Vec3(1.0, 1.0, 2.0)), "V3-05 vec3 divide result");
  check(value3.scaled(2.0).equals(new Vec3(4.0, -6.0, 12.0)), "V3-06 vec3 scaled result");
  check(value3.divided_by_scalar(2.0).equals(new Vec3(1.0, -1.5, 3.0)), "V3-07 vec3 scalar divide result");
  check(value3.negated().equals(new Vec3(-2.0, 3.0, -6.0)), "V3-08 vec3 negated result");
  check(value3.dot(new Vec3(1.0, 2.0, 3.0)) == 14.0, "V3-09 vec3 dot result");
  check(value3.cross(new Vec3(1.0, 2.0, 3.0)).equals(new Vec3(-21.0, 0.0, 7.0)), "V3-10 vec3 cross result");
  check(value3.length_squared() == 49.0, "V3-11 vec3 length squared result");
  check(value3.length() == 7.0, "V3-12 vec3 length result");
  check(value3.normalized().near_equals(new Vec3(2.0 / 7.0, -3.0 / 7.0, 6.0 / 7.0)), "V3-13 vec3 normalized result");
  check(new Vec3().normalized().equals(new Vec3()), "V3-14 vec3 zero normalized result");
  check(value3.distance_squared_to(new Vec3(2.0, 1.0, 3.0)) == 25.0, "V3-15 vec3 distance squared result");
  check(value3.distance_to(new Vec3(2.0, 1.0, 3.0)) == 5.0, "V3-16 vec3 distance result");
  check(value3.lerp_to(new Vec3(4.0, 1.0, 2.0), 0.5).equals(new Vec3(3.0, -1.0, 4.0)), "V3-17 vec3 lerp result");
  check(new Vec3().move_toward(new Vec3(0.0, 3.0, 4.0), 2.0).near_equals(new Vec3(0.0, 1.2, 1.6)), "V3-18 vec3 move step result");
  check(new Vec3().move_toward(new Vec3(0.0, 3.0, 4.0), 5.0).equals(new Vec3(0.0, 3.0, 4.0)), "V3-19 vec3 move snap result");
  check(value3.move_toward(value3, 2.0).equals(value3), "V3-20 vec3 move zero-distance result");
  check(value3.move_toward(new Vec3(2.0, 1.0, 3.0), 0.0).equals(value3), "V3-20b vec3 move zero-delta result");
  check(value3.clamp_length(3.5).near_equals(new Vec3(1.0, -1.5, 3.0)), "V3-21 vec3 clamp result");
  check(value3.clamp_length(7.0).equals(value3), "V3-22 vec3 clamp unchanged result");
  check(new Vec3().clamp_length(0.0).equals(new Vec3()), "V3-23 vec3 clamp zero result");
  check(value3.clamp_length(0.0).equals(new Vec3()), "V3-23b vec3 clamp to zero result");
  check(value3.equals(new Vec3(2.0, -3.0, 6.0)) && !value3.equals(new Vec3(2.0, 3.0, 6.0)), "V3-24 vec3 equals results");
  check(value3.near_equals(new Vec3(2.0000005, -3.0000005, 6.0000005)) && !value3.near_equals(new Vec3(2.01, -3.0, 6.0)), "V3-25 vec3 near equals results");
  check(value3.equals(new Vec3(2.0, -3.0, 6.0)), "V3-26 vec3 value methods immutable");
  const zero_mut3 = new Vec3();
  check(zero_mut3.normalize_in_place() === zero_mut3 && zero_mut3.equals(new Vec3()), "V3-27 vec3 mutate zero normalize");

  const signed_rect = new Rect(10.0, 20.0, -4.0, -6.0);
  const normalized_rect = new Rect(6.0, 14.0, 4.0, 6.0);
  check(signed_rect.position.equals(new Vec2(10.0, 20.0)) && signed_rect.size.equals(new Vec2(-4.0, -6.0)), "82 rect preserves signed extents");
  check(!signed_rect.equals(normalized_rect), "83 rect equality structural");
  check(signed_rect.normalized().equals(normalized_rect), "84 rect normalized");
  check(signed_rect.contains_point(new Vec2(6.0, 14.0)) && signed_rect.contains_rect(new Rect(7.0, 15.0, 1.0, 1.0)), "85 rect negative relations normalize");
  check(normalized_rect.contains_point(new Vec2(6.0, 14.0)), "86 rect includes left top");
  check(!normalized_rect.contains_point(new Vec2(10.0, 15.0)), "87 rect excludes right");
  check(!normalized_rect.contains_point(new Vec2(7.0, 20.0)), "88 rect excludes bottom");
  check(!new Rect(2.0, 3.0, 0.0, 4.0).contains_point(new Vec2(2.0, 3.0)), "89 rect empty contains no point");
  check(!new Rect(0.0, 0.0, 2.0, 2.0).intersects(new Rect(2.0, 0.0, 2.0, 2.0)), "90 rect x edge touch");
  check(!new Rect(0.0, 0.0, 2.0, 2.0).intersects(new Rect(0.0, 2.0, 2.0, 2.0)), "91 rect y edge touch");
  check(!new Rect(0.0, 0.0, 2.0, 2.0).intersects(new Rect(2.0, 2.0, 2.0, 2.0)), "92 rect corner touch");
  check(new Rect(0.0, 0.0, 3.0, 3.0).intersection(new Rect(2.0, 1.0, 3.0, 3.0)).equals(new Rect(2.0, 1.0, 1.0, 2.0)), "93 rect positive intersection");
  check(new Rect(0.0, 0.0, 2.0, 2.0).intersection(new Rect(5.0, 1.0, 2.0, 2.0)).equals(new Rect(5.0, 1.0, 0.0, 0.0)), "94 rect x disjoint anchor");
  check(new Rect(0.0, 0.0, 2.0, 2.0).intersection(new Rect(1.0, 5.0, 2.0, 2.0)).equals(new Rect(1.0, 5.0, 0.0, 0.0)), "95 rect y disjoint anchor");
  check(new Rect(0.0, 0.0, 2.0, 2.0).intersection(new Rect(5.0, 6.0, 2.0, 2.0)).equals(new Rect(5.0, 6.0, 0.0, 0.0)), "96 rect both disjoint anchor");

  const outer_rect = new Rect(0.0, 0.0, 10.0, 10.0);
  const inside_empty_rect = new Rect(3.0, 4.0, 0.0, 0.0);
  const outside_empty_rect = new Rect(12.0, 13.0, 0.0, 0.0);
  check(outer_rect.contains_rect(inside_empty_rect) && !outer_rect.contains_rect(outside_empty_rect), "97 rect anchored empty containment");
  check(outer_rect.union(inside_empty_rect).equals(outer_rect), "98 rect inside empty union");
  check(outer_rect.union(outside_empty_rect).equals(new Rect(0.0, 0.0, 12.0, 13.0)), "99 rect outside empty union");
  check(outside_empty_rect.union(outer_rect).equals(new Rect(0.0, 0.0, 12.0, 13.0)), "100 rect empty receiver union");
  check(signed_rect.translated(new Vec2(2.0, -3.0)).equals(new Rect(12.0, 17.0, -4.0, -6.0)), "101 rect translation preserves extents");
  check(signed_rect.grown(0.0).equals(normalized_rect), "102 rect zero grow normalizes");
  check(new Rect(1.0, 2.0, 4.0, 6.0).grown(2.0).equals(new Rect(-1.0, 0.0, 8.0, 10.0)), "103 rect grow");
  check(new Rect(1.0, 2.0, 8.0, 10.0).shrunk(2.0).equals(new Rect(3.0, 4.0, 4.0, 6.0)), "104 rect shrink");
  check(new Rect(1.0, 2.0, 3.0, 8.0).shrunk(2.0).equals(new Rect(2.5, 4.0, 0.0, 4.0)), "105 rect one-axis over-shrink");
  check(new Rect(1.0, 2.0, 3.0, 5.0).shrunk(9.0).equals(new Rect(2.5, 4.5, 0.0, 0.0)), "106 rect two-axis over-shrink");
  check(new Rect(1.0, 2.0, 3.0, 4.0).near_equals(new Rect(1.125, 1.875, 3.125, 3.875), 0.125), "107 rect near equality inclusive");

  const signed_recti = new Recti(10, 20, -5, -7);
  const normalized_recti = new Recti(5, 13, 5, 7);
  check(signed_recti.position.equals(new Vec2i(10, 20)) && signed_recti.size.equals(new Vec2i(-5, -7)), "108 recti preserves signed extents");
  check(!signed_recti.equals(normalized_recti) && signed_recti.normalized().equals(normalized_recti), "109 recti structural and normalized");
  check(signed_recti.contains_point(new Vec2i(5, 13)) && signed_recti.contains_rect(new Recti(6, 14, 1, 1)), "110 recti negative relations normalize");
  check(normalized_recti.contains_point(new Vec2i(5, 13)) && !normalized_recti.contains_point(new Vec2i(10, 14)) && !normalized_recti.contains_point(new Vec2i(6, 20)), "111 recti half-open points");
  check(!new Recti(2, 3, 0, 4).contains_point(new Vec2i(2, 3)), "112 recti empty contains no point");
  check(!new Recti(0, 0, 2, 2).intersects(new Recti(2, 0, 2, 2)) && !new Recti(0, 0, 2, 2).intersects(new Recti(0, 2, 2, 2)) && !new Recti(0, 0, 2, 2).intersects(new Recti(2, 2, 2, 2)), "113 recti edge touches");
  check(new Recti(0, 0, 3, 3).intersection(new Recti(2, 1, 3, 3)).equals(new Recti(2, 1, 1, 2)), "114 recti positive intersection");
  check(new Recti(0, 0, 2, 2).intersection(new Recti(5, 1, 2, 2)).equals(new Recti(5, 1, 0, 0)), "115 recti x disjoint anchor");
  check(new Recti(0, 0, 2, 2).intersection(new Recti(1, 5, 2, 2)).equals(new Recti(1, 5, 0, 0)), "116 recti y disjoint anchor");
  check(new Recti(0, 0, 2, 2).intersection(new Recti(5, 6, 2, 2)).equals(new Recti(5, 6, 0, 0)), "117 recti both disjoint anchor");

  const outer_recti = new Recti(0, 0, 10, 10);
  const inside_empty_recti = new Recti(3, 4, 0, 0);
  const outside_empty_recti = new Recti(12, 13, 0, 0);
  check(outer_recti.contains_rect(inside_empty_recti) && !outer_recti.contains_rect(outside_empty_recti), "118 recti anchored empty containment");
  check(outer_recti.union(inside_empty_recti).equals(outer_recti), "119 recti inside empty union");
  check(outer_recti.union(outside_empty_recti).equals(new Recti(0, 0, 12, 13)) && outside_empty_recti.union(outer_recti).equals(new Recti(0, 0, 12, 13)), "120 recti outside empty union");
  check(signed_recti.translated(new Vec2i(2, -3)).equals(new Recti(12, 17, -5, -7)), "121 recti translation preserves extents");
  check(signed_recti.grown(0).equals(normalized_recti), "122 recti zero grow normalizes");
  check(new Recti(1, 2, 4, 6).grown(2).equals(new Recti(-1, 0, 8, 10)), "123 recti grow");
  check(new Recti(1, 2, 8, 10).shrunk(2).equals(new Recti(3, 4, 4, 6)), "124 recti shrink");
  check(new Recti(-4, -5, 5, 8).shrunk(3).equals(new Recti(-2, -2, 0, 2)), "125 recti one-axis odd floor center");
  check(new Recti(-4, -5, 5, 7).shrunk(9).equals(new Recti(-2, -2, 0, 0)), "126 recti two-axis odd floor centers");

  const conversion_rect = new Rect(1.5, -1.5, -2.0, 0.5);
  check(conversion_rect.floor_to_i().equals(new Recti(-1, -2, 2, 1)), "127 rect floor normalized edges");
  check(conversion_rect.ceil_to_i().equals(new Recti(0, -1, 2, 0)), "128 rect ceil normalized edges");
  check(conversion_rect.round_to_i().equals(new Recti(0, -1, 2, 0)), "129 rect round normalized edges");
  const subpixel_rect = new Rect(-0.4, -0.4, 0.8, 0.8);
  check(subpixel_rect.floor_to_i().equals(new Recti(-1, -1, 1, 1)), "130 rect floor subpixel");
  check(subpixel_rect.ceil_to_i().equals(new Recti(0, 0, 1, 1)), "131 rect ceil subpixel");
  check(subpixel_rect.round_to_i().equals(new Recti(0, 0, 0, 0)), "132 rect round subpixel");
  check(new Recti(-3, 4, 5, 6).to_rect().equals(new Rect(-3.0, 4.0, 5.0, 6.0)), "133 recti exact to rect");
  check(normalized_rect.left() == 6.0 && normalized_rect.top() == 14.0 && normalized_rect.right() == 10.0 && normalized_rect.bottom() == 20.0 && normalized_rect.center().equals(new Vec2(8.0, 17.0)), "134 rect edges and center");
  const rect_relation_probe = new Rect(9.0, 19.0, 2.0, 2.0);
  check(signed_rect.intersects(rect_relation_probe) == normalized_rect.intersects(rect_relation_probe) && signed_rect.intersection(rect_relation_probe).equals(normalized_rect.intersection(rect_relation_probe)) && signed_rect.union(rect_relation_probe).equals(normalized_rect.union(rect_relation_probe)), "135 rect negative all set relations");
  check(normalized_recti.left() == 5 && normalized_recti.top() == 13 && normalized_recti.right() == 10 && normalized_recti.bottom() == 20 && normalized_recti.center().equals(new Vec2(7.5, 16.5)), "136 recti edges and exact center");
  const recti_relation_probe = new Recti(9, 19, 2, 2);
  check(signed_recti.intersects(recti_relation_probe) == normalized_recti.intersects(recti_relation_probe) && signed_recti.intersection(recti_relation_probe).equals(normalized_recti.intersection(recti_relation_probe)) && signed_recti.union(recti_relation_probe).equals(normalized_recti.union(recti_relation_probe)), "137 recti negative all set relations");
  check(signed_rect.shrunk(0.0).equals(normalized_rect), "138 rect zero shrink normalizes");
  check(signed_recti.shrunk(0).equals(normalized_recti), "139 recti zero shrink normalizes");
  check(inside_empty_rect.contains_rect(new Rect(3.0, 4.0, 0.0, 0.0)), "140 rect empty receiver four-edge containment");
  check(inside_empty_recti.contains_rect(new Recti(3, 4, 0, 0)), "141 recti empty receiver four-edge containment");
  const intersection_probe_rect = new Rect(0.0, 0.0, 2.0, 2.0);
  const both_empty_rect = new Rect(1.0, 1.0, 0.0, 0.0);
  check(!both_empty_rect.intersects(intersection_probe_rect) && !intersection_probe_rect.intersects(both_empty_rect), "142 rect both-axis empty never intersects");
  const width_empty_rect = new Rect(1.0, 0.0, 0.0, 2.0);
  check(!width_empty_rect.intersects(intersection_probe_rect) && !intersection_probe_rect.intersects(width_empty_rect), "143 rect width-empty never intersects");
  const height_empty_rect = new Rect(0.0, 1.0, 2.0, 0.0);
  check(!height_empty_rect.intersects(intersection_probe_rect) && !intersection_probe_rect.intersects(height_empty_rect), "144 rect height-empty never intersects");
  const intersection_probe_recti = new Recti(0, 0, 2, 2);
  const both_empty_recti = new Recti(1, 1, 0, 0);
  check(!both_empty_recti.intersects(intersection_probe_recti) && !intersection_probe_recti.intersects(both_empty_recti), "145 recti both-axis empty never intersects");
  const width_empty_recti = new Recti(1, 0, 0, 2);
  check(!width_empty_recti.intersects(intersection_probe_recti) && !intersection_probe_recti.intersects(width_empty_recti), "146 recti width-empty never intersects");
  const height_empty_recti = new Recti(0, 1, 2, 0);
  check(!height_empty_recti.intersects(intersection_probe_recti) && !intersection_probe_recti.intersects(height_empty_recti), "147 recti height-empty never intersects");
}

function cart_ready(): void {}

function cart_process(): void {
  if (frame() == 0) run_cases();
}

function cart_draw(): void {
  clear(BLACK);
  px_text(4, 4, "SCALAR CASES " + CASE_COUNT.toString(), WHITE);
}

export function start(): void { run_start(cart_ready); }
export function update(): void { run_update(cart_process, cart_draw); }
