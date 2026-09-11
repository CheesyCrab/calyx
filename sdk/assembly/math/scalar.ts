// Sunny scalar math. Supported generic instantiations are exactly i32, i64,
// and f64. Direct conformance pins these supported uses; callers must not
// instantiate the generic helpers with other types.

const PI: f64 = Math.PI;
const TAU: f64 = Math.PI * 2.0;
const I32_MIN_F64: f64 = -2147483648.0;
const I32_MAX_F64: f64 = 2147483647.0;

@inline
function assert_finite<T>(value: T): void {
  if (isFloat<T>()) assert(isFinite<f64>(<f64>value));
}

@inline
function checked_add<T>(a: T, b: T): T {
  const result = a + b;
  if (b > 0) {
    assert(result >= a);
  } else if (b < 0) {
    assert(result <= a);
  }
  return result;
}

@inline
function checked_subtract<T>(a: T, b: T): T {
  const result = a - b;
  if (b > 0) {
    assert(result <= a);
  } else if (b < 0) {
    assert(result >= a);
  }
  return result;
}

export function clamp<T>(value: T, low: T, high: T): T {
  assert_finite<T>(value);
  assert_finite<T>(low);
  assert_finite<T>(high);
  assert(low <= high);
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function saturate(value: f64): f64 {
  return clamp<f64>(value, 0.0, 1.0);
}

export function sign<T>(value: T): i32 {
  assert_finite<T>(value);
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}

export function wrap<T>(value: T, min: T, max: T): T {
  assert_finite<T>(value);
  assert_finite<T>(min);
  assert_finite<T>(max);
  assert(max > min);

  if (isFloat<T>()) {
    const float_value = <f64>value;
    const float_min = <f64>min;
    const float_max = <f64>max;
    const span = float_max - float_min;
    assert(isFinite<f64>(span));
    const offset = float_value - float_min;
    assert(isFinite<f64>(offset));
    let remainder = offset % span;
    assert(isFinite<f64>(remainder));
    if (remainder < 0.0) {
      remainder += span;
      assert(isFinite<f64>(remainder));
    }
    if (remainder >= span) remainder = 0.0;
    const result = remainder + float_min;
    assert(isFinite<f64>(result));
    assert(result >= float_min && result < float_max);
    return <T>result;
  }

  const span = checked_subtract<T>(max, min);
  assert(span > 0);
  const offset = checked_subtract<T>(value, min);
  let remainder = offset % span;
  if (remainder < 0) remainder = checked_add<T>(remainder, span);
  return checked_add<T>(remainder, min);
}

export function lerp(a: f64, b: f64, t: f64): f64 {
  assert_finite<f64>(a);
  assert_finite<f64>(b);
  assert_finite<f64>(t);
  const delta = b - a;
  assert(isFinite<f64>(delta));
  const offset = delta * t;
  assert(isFinite<f64>(offset));
  const result = a + offset;
  assert(isFinite<f64>(result));
  return result;
}

export function inverse_lerp(a: f64, b: f64, value: f64): f64 {
  assert_finite<f64>(a);
  assert_finite<f64>(b);
  assert_finite<f64>(value);
  if (a == b) return 0.0;
  const span = b - a;
  assert(isFinite<f64>(span));
  const offset = value - a;
  assert(isFinite<f64>(offset));
  const result = offset / span;
  assert(isFinite<f64>(result));
  return result;
}

export function remap(
  in_min: f64,
  in_max: f64,
  out_min: f64,
  out_max: f64,
  value: f64,
): f64 {
  assert_finite<f64>(in_min);
  assert_finite<f64>(in_max);
  assert_finite<f64>(out_min);
  assert_finite<f64>(out_max);
  assert_finite<f64>(value);
  const t = inverse_lerp(in_min, in_max, value);
  assert(isFinite<f64>(t));
  const result = lerp(out_min, out_max, t);
  assert(isFinite<f64>(result));
  return result;
}

export function move_toward(value: f64, target: f64, max_delta: f64): f64 {
  assert_finite<f64>(value);
  assert_finite<f64>(target);
  assert_finite<f64>(max_delta);
  assert(max_delta >= 0.0);
  const delta = target - value;
  assert(isFinite<f64>(delta));
  if (delta >= -max_delta && delta <= max_delta) return target;
  const result = delta > 0.0 ? value + max_delta : value - max_delta;
  assert(isFinite<f64>(result));
  return result;
}

export function wrap_angle_signed(radians: f64): f64 {
  assert_finite<f64>(radians);
  const result = wrap<f64>(radians, -PI, PI);
  assert(isFinite<f64>(result));
  return result;
}

export function wrap_angle_positive(radians: f64): f64 {
  assert_finite<f64>(radians);
  const result = wrap<f64>(radians, 0.0, TAU);
  assert(isFinite<f64>(result));
  return result;
}

export function near_equal(
  a: f64,
  b: f64,
  tolerance: f64 = 0.000001,
): bool {
  assert_finite<f64>(a);
  assert_finite<f64>(b);
  assert_finite<f64>(tolerance);
  assert(tolerance >= 0.0);
  const difference = a - b;
  assert(isFinite<f64>(difference));
  const magnitude = difference < 0.0 ? -difference : difference;
  assert(isFinite<f64>(magnitude));
  return magnitude <= tolerance;
}

@inline
function quantized_i32(result: f64): i32 {
  assert(isFinite<f64>(result));
  assert(result >= I32_MIN_F64 && result <= I32_MAX_F64);
  return <i32>result;
}

export function floor_i32(value: f64): i32 {
  assert_finite<f64>(value);
  return quantized_i32(Math.floor(value));
}

export function ceil_i32(value: f64): i32 {
  assert_finite<f64>(value);
  return quantized_i32(Math.ceil(value));
}

export function round_i32(value: f64): i32 {
  assert_finite<f64>(value);
  return quantized_i32(Math.round(value));
}
