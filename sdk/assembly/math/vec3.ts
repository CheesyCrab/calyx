import { lerp, near_equal } from "./scalar";

@inline
function finite(value: f64): f64 {
  assert(isFinite<f64>(value));
  return value;
}

export class Vec3 {
  constructor(public x: f64 = 0.0, public y: f64 = 0.0, public z: f64 = 0.0) { finite(x); finite(y); finite(z); }

  clone(): Vec3 { finite(this.x); finite(this.y); finite(this.z); return new Vec3(this.x, this.y, this.z); }
  set(x: f64, y: f64, z: f64): Vec3 { this.x = finite(x); this.y = finite(y); this.z = finite(z); return this; }
  copy_from(v: Vec3): Vec3 { return this.set(v.x, v.y, v.z); }
  add(v: Vec3): Vec3 { return new Vec3(finite(finite(this.x) + finite(v.x)), finite(finite(this.y) + finite(v.y)), finite(finite(this.z) + finite(v.z))); }
  subtract(v: Vec3): Vec3 { return new Vec3(finite(finite(this.x) - finite(v.x)), finite(finite(this.y) - finite(v.y)), finite(finite(this.z) - finite(v.z))); }
  multiply(v: Vec3): Vec3 { return new Vec3(finite(finite(this.x) * finite(v.x)), finite(finite(this.y) * finite(v.y)), finite(finite(this.z) * finite(v.z))); }

  divide(v: Vec3): Vec3 {
    finite(this.x); finite(this.y); finite(this.z); finite(v.x); finite(v.y); finite(v.z);
    assert(v.x != 0.0 && v.y != 0.0 && v.z != 0.0);
    return new Vec3(finite(this.x / v.x), finite(this.y / v.y), finite(this.z / v.z));
  }

  scaled(s: f64): Vec3 { finite(s); return new Vec3(finite(finite(this.x) * s), finite(finite(this.y) * s), finite(finite(this.z) * s)); }
  divided_by_scalar(s: f64): Vec3 { finite(s); assert(s != 0.0); return new Vec3(finite(finite(this.x) / s), finite(finite(this.y) / s), finite(finite(this.z) / s)); }
  negated(): Vec3 { return new Vec3(finite(-finite(this.x)), finite(-finite(this.y)), finite(-finite(this.z))); }
  add_in_place(v: Vec3): Vec3 {
    const x = finite(finite(this.x) + finite(v.x));
    const y = finite(finite(this.y) + finite(v.y));
    const z = finite(finite(this.z) + finite(v.z));
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  subtract_in_place(v: Vec3): Vec3 {
    const x = finite(finite(this.x) - finite(v.x));
    const y = finite(finite(this.y) - finite(v.y));
    const z = finite(finite(this.z) - finite(v.z));
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  scale_in_place(s: f64): Vec3 {
    finite(s);
    const x = finite(finite(this.x) * s);
    const y = finite(finite(this.y) * s);
    const z = finite(finite(this.z) * s);
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  divide_scalar_in_place(s: f64): Vec3 {
    finite(s);
    assert(s != 0.0);
    const x = finite(finite(this.x) / s);
    const y = finite(finite(this.y) / s);
    const z = finite(finite(this.z) / s);
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  dot(v: Vec3): f64 {
    const xx = finite(finite(this.x) * finite(v.x));
    const yy = finite(finite(this.y) * finite(v.y));
    const zz = finite(finite(this.z) * finite(v.z));
    return finite(finite(xx + yy) + zz);
  }

  cross(v: Vec3): Vec3 {
    finite(this.x); finite(this.y); finite(this.z); finite(v.x); finite(v.y); finite(v.z);
    const x = finite(finite(this.y * v.z) - finite(this.z * v.y));
    const y = finite(finite(this.z * v.x) - finite(this.x * v.z));
    const z = finite(finite(this.x * v.y) - finite(this.y * v.x));
    return new Vec3(x, y, z);
  }

  length_squared(): f64 { const result = this.dot(this); assert(result >= 0.0); return result; }
  length(): f64 { return finite(Math.sqrt(this.length_squared())); }

  normalized(): Vec3 {
    const squared = this.length_squared();
    if (squared == 0.0) return new Vec3();
    return this.divided_by_scalar(finite(Math.sqrt(squared)));
  }

  normalize_in_place(): Vec3 {
    const squared = this.length_squared();
    if (squared == 0.0) {
      this.x = 0.0;
      this.y = 0.0;
      this.z = 0.0;
      return this;
    }
    const divisor = finite(Math.sqrt(squared));
    assert(divisor != 0.0);
    const x = finite(finite(this.x) / divisor);
    const y = finite(finite(this.y) / divisor);
    const z = finite(finite(this.z) / divisor);
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  distance_squared_to(v: Vec3): f64 { return this.subtract(v).length_squared(); }
  distance_to(v: Vec3): f64 { return finite(Math.sqrt(this.distance_squared_to(v))); }
  lerp_to(v: Vec3, t: f64): Vec3 { finite(this.x); finite(this.y); finite(this.z); finite(v.x); finite(v.y); finite(v.z); finite(t); return new Vec3(lerp(this.x, v.x, t), lerp(this.y, v.y, t), lerp(this.z, v.z, t)); }

  move_toward(v: Vec3, max_delta: f64): Vec3 {
    finite(max_delta);
    assert(max_delta >= 0.0);
    const delta = v.subtract(this);
    const distance = delta.length();
    if (distance == 0.0 || distance <= max_delta) return v.clone();
    return this.add(delta.scaled(finite(max_delta / distance)));
  }

  clamp_length(max_length: f64): Vec3 {
    finite(max_length);
    assert(max_length >= 0.0);
    const current = this.length();
    if (current <= max_length || current == 0.0) return this.clone();
    return this.scaled(finite(max_length / current));
  }

  equals(v: Vec3): bool { finite(this.x); finite(this.y); finite(this.z); finite(v.x); finite(v.y); finite(v.z); return this.x == v.x && this.y == v.y && this.z == v.z; }
  near_equals(v: Vec3, tolerance: f64 = 0.000001): bool {
    finite(this.x); finite(this.y); finite(this.z);
    finite(v.x); finite(v.y); finite(v.z); finite(tolerance);
    assert(tolerance >= 0.0);
    return near_equal(this.x, v.x, tolerance) && near_equal(this.y, v.y, tolerance) && near_equal(this.z, v.z, tolerance);
  }

  @operator("+") static add_operator(left: Vec3, right: Vec3): Vec3 { return left.add(right); }
  @operator("-") static subtract_operator(left: Vec3, right: Vec3): Vec3 { return left.subtract(right); }
  @operator.prefix("-") static negate_operator(value: Vec3): Vec3 { return value.negated(); }
  @operator("*") static scale_operator(left: Vec3, right: f64): Vec3 { return left.scaled(right); }
  @operator("/") static divide_operator(left: Vec3, right: f64): Vec3 { return left.divided_by_scalar(right); }
}
