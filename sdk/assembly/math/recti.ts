import { Rect } from "./rect";
import { Vec2 } from "./vec2";
import { Vec2i } from "./vec2i";

const I32_MIN_I64: i64 = -2147483648;
const I32_MAX_I64: i64 = 2147483647;

@inline
function i32_result(value: i64): i32 {
  assert(value >= I32_MIN_I64 && value <= I32_MAX_I64);
  return <i32>value;
}

@inline
function checked_add(a: i64, b: i64): i64 {
  const result = a + b;
  if (b > 0) assert(result >= a);
  else if (b < 0) assert(result <= a);
  return result;
}

@inline
function checked_subtract(a: i64, b: i64): i64 {
  const result = a - b;
  if (b > 0) assert(result <= a);
  else if (b < 0) assert(result >= a);
  return result;
}

class RectiEdges {
  constructor(
    public left: i64,
    public top: i64,
    public right: i64,
    public bottom: i64,
  ) {}
}

@inline
function edges(rect: Recti): RectiEdges {
  const x = <i64>rect.position.x;
  const y = <i64>rect.position.y;
  const x2 = checked_add(x, <i64>rect.size.x);
  const y2 = checked_add(y, <i64>rect.size.y);
  i32_result(x2);
  i32_result(y2);
  return new RectiEdges(
    x < x2 ? x : x2,
    y < y2 ? y : y2,
    x > x2 ? x : x2,
    y > y2 ? y : y2,
  );
}

@inline
function rect_from_edges(left: i64, top: i64, right: i64, bottom: i64): Recti {
  assert(right >= left && bottom >= top);
  const width = checked_subtract(right, left);
  const height = checked_subtract(bottom, top);
  return new Recti(i32_result(left), i32_result(top), i32_result(width), i32_result(height));
}

export class Recti {
  position: Vec2i;
  size: Vec2i;

  constructor(x: i32 = 0, y: i32 = 0, width: i32 = 0, height: i32 = 0) {
    this.position = new Vec2i(x, y);
    this.size = new Vec2i(width, height);
    edges(this);
  }

  left(): i32 { return i32_result(edges(this).left); }
  right(): i32 { return i32_result(edges(this).right); }
  top(): i32 { return i32_result(edges(this).top); }
  bottom(): i32 { return i32_result(edges(this).bottom); }

  center(): Vec2 {
    const e = edges(this);
    return new Vec2(
      <f64>checked_add(e.left, e.right) / 2.0,
      <f64>checked_add(e.top, e.bottom) / 2.0,
    );
  }

  normalized(): Recti {
    const e = edges(this);
    return rect_from_edges(e.left, e.top, e.right, e.bottom);
  }

  is_empty(): bool {
    const e = edges(this);
    return e.left == e.right || e.top == e.bottom;
  }

  contains_point(point: Vec2i): bool {
    const e = edges(this);
    const x = <i64>point.x;
    const y = <i64>point.y;
    if (e.left == e.right || e.top == e.bottom) return false;
    return x >= e.left && x < e.right && y >= e.top && y < e.bottom;
  }

  contains_rect(other: Recti): bool {
    const a = edges(this);
    const b = edges(other);
    return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom;
  }

  intersects(other: Recti): bool {
    const a = edges(this);
    const b = edges(other);
    if (a.right <= a.left || a.bottom <= a.top
      || b.right <= b.left || b.bottom <= b.top) return false;
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  intersection(other: Recti): Recti {
    const a = edges(this);
    const b = edges(other);
    const left = a.left > b.left ? a.left : b.left;
    const top = a.top > b.top ? a.top : b.top;
    const right = a.right < b.right ? a.right : b.right;
    const bottom = a.bottom < b.bottom ? a.bottom : b.bottom;
    if (right <= left || bottom <= top) return rect_from_edges(left, top, left, top);
    return rect_from_edges(left, top, right, bottom);
  }

  union(other: Recti): Recti {
    const a = edges(this);
    const b = edges(other);
    return rect_from_edges(
      a.left < b.left ? a.left : b.left,
      a.top < b.top ? a.top : b.top,
      a.right > b.right ? a.right : b.right,
      a.bottom > b.bottom ? a.bottom : b.bottom,
    );
  }

  translated(offset: Vec2i): Recti {
    edges(this);
    return new Recti(
      i32_result(checked_add(<i64>this.position.x, <i64>offset.x)),
      i32_result(checked_add(<i64>this.position.y, <i64>offset.y)),
      this.size.x,
      this.size.y,
    );
  }

  grown(amount: i32): Recti {
    const e = edges(this);
    assert(amount >= 0);
    const delta = <i64>amount;
    return rect_from_edges(
      checked_subtract(e.left, delta),
      checked_subtract(e.top, delta),
      checked_add(e.right, delta),
      checked_add(e.bottom, delta),
    );
  }

  shrunk(amount: i32): Recti {
    const e = edges(this);
    assert(amount >= 0);
    const delta = <i64>amount;
    const width = checked_subtract(e.right, e.left);
    const height = checked_subtract(e.bottom, e.top);
    const center_x = checked_add(e.left, width / 2);
    const center_y = checked_add(e.top, height / 2);
    const left = checked_add(e.left, delta);
    const top = checked_add(e.top, delta);
    const right = checked_subtract(e.right, delta);
    const bottom = checked_subtract(e.bottom, delta);
    const exhausted_x = delta >= width - width / 2;
    const exhausted_y = delta >= height - height / 2;
    return rect_from_edges(
      exhausted_x ? center_x : left,
      exhausted_y ? center_y : top,
      exhausted_x ? center_x : right,
      exhausted_y ? center_y : bottom,
    );
  }

  equals(other: Recti): bool {
    edges(this); edges(other);
    return this.position.x == other.position.x && this.position.y == other.position.y
      && this.size.x == other.size.x && this.size.y == other.size.y;
  }

  to_rect(): Rect {
    edges(this);
    return new Rect(<f64>this.position.x, <f64>this.position.y, <f64>this.size.x, <f64>this.size.y);
  }
}
