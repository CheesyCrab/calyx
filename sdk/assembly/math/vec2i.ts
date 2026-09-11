import { Vec2 } from "./vec2";

const I32_MIN_I64: i64 = -2147483648;
const I32_MAX_I64: i64 = 2147483647;

@inline
function i32_result(value: i64): i32 {
  assert(value >= I32_MIN_I64 && value <= I32_MAX_I64);
  return <i32>value;
}

@inline
function add_i64(a: i64, b: i64): i64 {
  const result = a + b;
  if (b > 0) assert(result >= a);
  else if (b < 0) assert(result <= a);
  return result;
}

@inline
function subtract_i64(a: i64, b: i64): i64 {
  const result = a - b;
  if (b > 0) assert(result <= a);
  else if (b < 0) assert(result >= a);
  return result;
}

@inline
function multiply_i64(a: i64, b: i64): i64 {
  if (a == 0 || b == 0) return 0;
  assert(!(a == i64.MIN_VALUE && b == -1));
  assert(!(b == i64.MIN_VALUE && a == -1));
  const result = a * b;
  assert(result / b == a);
  return result;
}

export class Vec2i {
  constructor(public x: i32 = 0, public y: i32 = 0) {}

  clone(): Vec2i { return new Vec2i(this.x, this.y); }
  set(x: i32, y: i32): Vec2i { this.x = x; this.y = y; return this; }
  copy_from(v: Vec2i): Vec2i { return this.set(v.x, v.y); }
  add(v: Vec2i): Vec2i { return new Vec2i(i32_result(<i64>this.x + <i64>v.x), i32_result(<i64>this.y + <i64>v.y)); }
  subtract(v: Vec2i): Vec2i { return new Vec2i(i32_result(<i64>this.x - <i64>v.x), i32_result(<i64>this.y - <i64>v.y)); }
  multiply(v: Vec2i): Vec2i { return new Vec2i(i32_result(<i64>this.x * <i64>v.x), i32_result(<i64>this.y * <i64>v.y)); }

  divide(v: Vec2i): Vec2i {
    assert(v.x != 0 && v.y != 0);
    assert(!(this.x == i32.MIN_VALUE && v.x == -1));
    assert(!(this.y == i32.MIN_VALUE && v.y == -1));
    return new Vec2i(i32_result(<i64>this.x / <i64>v.x), i32_result(<i64>this.y / <i64>v.y));
  }

  scaled(s: i32): Vec2i { return new Vec2i(i32_result(<i64>this.x * <i64>s), i32_result(<i64>this.y * <i64>s)); }

  divided_by_scalar(s: i32): Vec2i {
    assert(s != 0);
    assert(!(this.x == i32.MIN_VALUE && s == -1));
    assert(!(this.y == i32.MIN_VALUE && s == -1));
    return new Vec2i(i32_result(<i64>this.x / <i64>s), i32_result(<i64>this.y / <i64>s));
  }

  negated(): Vec2i { return new Vec2i(i32_result(-<i64>this.x), i32_result(-<i64>this.y)); }
  add_in_place(v: Vec2i): Vec2i {
    const x = i32_result(<i64>this.x + <i64>v.x);
    const y = i32_result(<i64>this.y + <i64>v.y);
    this.x = x;
    this.y = y;
    return this;
  }

  subtract_in_place(v: Vec2i): Vec2i {
    const x = i32_result(<i64>this.x - <i64>v.x);
    const y = i32_result(<i64>this.y - <i64>v.y);
    this.x = x;
    this.y = y;
    return this;
  }

  scale_in_place(s: i32): Vec2i {
    const x = i32_result(<i64>this.x * <i64>s);
    const y = i32_result(<i64>this.y * <i64>s);
    this.x = x;
    this.y = y;
    return this;
  }

  divide_scalar_in_place(s: i32): Vec2i {
    assert(s != 0);
    assert(!(this.x == i32.MIN_VALUE && s == -1));
    assert(!(this.y == i32.MIN_VALUE && s == -1));
    const x = i32_result(<i64>this.x / <i64>s);
    const y = i32_result(<i64>this.y / <i64>s);
    this.x = x;
    this.y = y;
    return this;
  }

  dot(v: Vec2i): i64 {
    return add_i64(multiply_i64(<i64>this.x, <i64>v.x), multiply_i64(<i64>this.y, <i64>v.y));
  }

  cross(v: Vec2i): i64 {
    return subtract_i64(multiply_i64(<i64>this.x, <i64>v.y), multiply_i64(<i64>this.y, <i64>v.x));
  }

  length_squared(): i64 {
    const result = this.dot(this);
    assert(result >= 0);
    return result;
  }

  length(): f64 { return Math.sqrt(<f64>this.length_squared()); }

  distance_squared_to(v: Vec2i): i64 {
    const dx = subtract_i64(<i64>this.x, <i64>v.x);
    const dy = subtract_i64(<i64>this.y, <i64>v.y);
    const result = add_i64(multiply_i64(dx, dx), multiply_i64(dy, dy));
    assert(result >= 0);
    return result;
  }

  distance_to(v: Vec2i): f64 { return Math.sqrt(<f64>this.distance_squared_to(v)); }
  equals(v: Vec2i): bool { return this.x == v.x && this.y == v.y; }
  to_vec2(): Vec2 { return new Vec2(<f64>this.x, <f64>this.y); }

  @operator("+") static add_operator(left: Vec2i, right: Vec2i): Vec2i { return left.add(right); }
  @operator("-") static subtract_operator(left: Vec2i, right: Vec2i): Vec2i { return left.subtract(right); }
  @operator.prefix("-") static negate_operator(value: Vec2i): Vec2i { return value.negated(); }
  @operator("*") static scale_operator(left: Vec2i, right: i32): Vec2i { return left.scaled(right); }
  @operator("/") static divide_operator(left: Vec2i, right: i32): Vec2i { return left.divided_by_scalar(right); }
}
