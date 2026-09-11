import { ceil_i32, floor_i32, lerp, near_equal, round_i32 } from "./scalar";
import { Vec2i } from "./vec2i";

@inline
function finite(value: f64): f64 {
  assert(isFinite<f64>(value));
  return value;
}

export class Vec2 {
  constructor(public x: f64 = 0.0, public y: f64 = 0.0) {
    finite(x);
    finite(y);
  }

  clone(): Vec2 { finite(this.x); finite(this.y); return new Vec2(this.x, this.y); }
  set(x: f64, y: f64): Vec2 { this.x = finite(x); this.y = finite(y); return this; }
  copy_from(v: Vec2): Vec2 { return this.set(v.x, v.y); }
  add(v: Vec2): Vec2 { return new Vec2(finite(finite(this.x) + finite(v.x)), finite(finite(this.y) + finite(v.y))); }
  subtract(v: Vec2): Vec2 { return new Vec2(finite(finite(this.x) - finite(v.x)), finite(finite(this.y) - finite(v.y))); }
  multiply(v: Vec2): Vec2 { return new Vec2(finite(finite(this.x) * finite(v.x)), finite(finite(this.y) * finite(v.y))); }

  divide(v: Vec2): Vec2 {
    finite(this.x); finite(this.y); finite(v.x); finite(v.y);
    assert(v.x != 0.0 && v.y != 0.0);
    return new Vec2(finite(this.x / v.x), finite(this.y / v.y));
  }

  scaled(s: f64): Vec2 { finite(s); return new Vec2(finite(finite(this.x) * s), finite(finite(this.y) * s)); }
  divided_by_scalar(s: f64): Vec2 { finite(s); assert(s != 0.0); return new Vec2(finite(finite(this.x) / s), finite(finite(this.y) / s)); }
  negated(): Vec2 { return new Vec2(finite(-finite(this.x)), finite(-finite(this.y))); }
  add_in_place(v: Vec2): Vec2 {
    const x = finite(finite(this.x) + finite(v.x));
    const y = finite(finite(this.y) + finite(v.y));
    this.x = x;
    this.y = y;
    return this;
  }

  subtract_in_place(v: Vec2): Vec2 {
    const x = finite(finite(this.x) - finite(v.x));
    const y = finite(finite(this.y) - finite(v.y));
    this.x = x;
    this.y = y;
    return this;
  }

  scale_in_place(s: f64): Vec2 {
    finite(s);
    const x = finite(finite(this.x) * s);
    const y = finite(finite(this.y) * s);
    this.x = x;
    this.y = y;
    return this;
  }

  divide_scalar_in_place(s: f64): Vec2 {
    finite(s);
    assert(s != 0.0);
    const x = finite(finite(this.x) / s);
    const y = finite(finite(this.y) / s);
    this.x = x;
    this.y = y;
    return this;
  }

  dot(v: Vec2): f64 {
    const xx = finite(finite(this.x) * finite(v.x));
    const yy = finite(finite(this.y) * finite(v.y));
    return finite(xx + yy);
  }

  cross(v: Vec2): f64 {
    const xy = finite(finite(this.x) * finite(v.y));
    const yx = finite(finite(this.y) * finite(v.x));
    return finite(xy - yx);
  }

  length_squared(): f64 { const result = this.dot(this); assert(result >= 0.0); return result; }
  length(): f64 { return finite(Math.sqrt(this.length_squared())); }

  normalized(): Vec2 {
    const squared = this.length_squared();
    if (squared == 0.0) return new Vec2();
    return this.divided_by_scalar(finite(Math.sqrt(squared)));
  }

  normalize_in_place(): Vec2 {
    const squared = this.length_squared();
    if (squared == 0.0) {
      this.x = 0.0;
      this.y = 0.0;
      return this;
    }
    const divisor = finite(Math.sqrt(squared));
    assert(divisor != 0.0);
    const x = finite(finite(this.x) / divisor);
    const y = finite(finite(this.y) / divisor);
    this.x = x;
    this.y = y;
    return this;
  }
  distance_squared_to(v: Vec2): f64 { return this.subtract(v).length_squared(); }
  distance_to(v: Vec2): f64 { return finite(Math.sqrt(this.distance_squared_to(v))); }
  lerp_to(v: Vec2, t: f64): Vec2 { finite(this.x); finite(this.y); finite(v.x); finite(v.y); finite(t); return new Vec2(lerp(this.x, v.x, t), lerp(this.y, v.y, t)); }

  move_toward(v: Vec2, max_delta: f64): Vec2 {
    finite(max_delta);
    assert(max_delta >= 0.0);
    const delta = v.subtract(this);
    const distance = delta.length();
    if (distance == 0.0 || distance <= max_delta) return v.clone();
    return this.add(delta.scaled(finite(max_delta / distance)));
  }

  clamp_length(max_length: f64): Vec2 {
    finite(max_length);
    assert(max_length >= 0.0);
    const current = this.length();
    if (current <= max_length || current == 0.0) return this.clone();
    return this.scaled(finite(max_length / current));
  }

  equals(v: Vec2): bool { finite(this.x); finite(this.y); finite(v.x); finite(v.y); return this.x == v.x && this.y == v.y; }
  near_equals(v: Vec2, tolerance: f64 = 0.000001): bool {
    finite(this.x); finite(this.y); finite(v.x); finite(v.y); finite(tolerance);
    assert(tolerance >= 0.0);
    return near_equal(this.x, v.x, tolerance) && near_equal(this.y, v.y, tolerance);
  }
  floor_to_i(): Vec2i { return new Vec2i(floor_i32(finite(this.x)), floor_i32(finite(this.y))); }
  ceil_to_i(): Vec2i { return new Vec2i(ceil_i32(finite(this.x)), ceil_i32(finite(this.y))); }
  round_to_i(): Vec2i { return new Vec2i(round_i32(finite(this.x)), round_i32(finite(this.y))); }

  @operator("+") static add_operator(left: Vec2, right: Vec2): Vec2 { return left.add(right); }
  @operator("-") static subtract_operator(left: Vec2, right: Vec2): Vec2 { return left.subtract(right); }
  @operator.prefix("-") static negate_operator(value: Vec2): Vec2 { return value.negated(); }
  @operator("*") static scale_operator(left: Vec2, right: f64): Vec2 { return left.scaled(right); }
  @operator("/") static divide_operator(left: Vec2, right: f64): Vec2 { return left.divided_by_scalar(right); }
}
