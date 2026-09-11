import { ceil_i32, floor_i32, near_equal, round_i32 } from "./scalar";
import { Vec2 } from "./vec2";
import { Recti } from "./recti";

@inline
function finite(value: f64): f64 {
  assert(isFinite<f64>(value));
  return value;
}

class RectEdges {
  constructor(
    public left: f64,
    public top: f64,
    public right: f64,
    public bottom: f64,
  ) {}
}

@inline
function edges(rect: Rect): RectEdges {
  const x = finite(rect.position.x);
  const y = finite(rect.position.y);
  const width = finite(rect.size.x);
  const height = finite(rect.size.y);
  const x2 = finite(x + width);
  const y2 = finite(y + height);
  return new RectEdges(
    x < x2 ? x : x2,
    y < y2 ? y : y2,
    x > x2 ? x : x2,
    y > y2 ? y : y2,
  );
}

@inline
function rect_from_edges(left: f64, top: f64, right: f64, bottom: f64): Rect {
  finite(left); finite(top); finite(right); finite(bottom);
  assert(right >= left && bottom >= top);
  return new Rect(left, top, finite(right - left), finite(bottom - top));
}

@inline
function recti_from_edges(left: i32, top: i32, right: i32, bottom: i32): Recti {
  const width = <i64>right - <i64>left;
  const height = <i64>bottom - <i64>top;
  assert(width >= 0 && width <= i32.MAX_VALUE);
  assert(height >= 0 && height <= i32.MAX_VALUE);
  return new Recti(left, top, <i32>width, <i32>height);
}

export class Rect {
  position: Vec2;
  size: Vec2;

  constructor(x: f64 = 0.0, y: f64 = 0.0, width: f64 = 0.0, height: f64 = 0.0) {
    this.position = new Vec2(finite(x), finite(y));
    this.size = new Vec2(finite(width), finite(height));
    edges(this);
  }

  left(): f64 { return edges(this).left; }
  right(): f64 { return edges(this).right; }
  top(): f64 { return edges(this).top; }
  bottom(): f64 { return edges(this).bottom; }

  center(): Vec2 {
    const e = edges(this);
    const width = finite(e.right - e.left);
    const height = finite(e.bottom - e.top);
    return new Vec2(finite(e.left + finite(width / 2.0)), finite(e.top + finite(height / 2.0)));
  }

  normalized(): Rect {
    const e = edges(this);
    return rect_from_edges(e.left, e.top, e.right, e.bottom);
  }

  is_empty(): bool {
    const e = edges(this);
    return e.left == e.right || e.top == e.bottom;
  }

  contains_point(point: Vec2): bool {
    const e = edges(this);
    const x = finite(point.x);
    const y = finite(point.y);
    if (e.left == e.right || e.top == e.bottom) return false;
    return x >= e.left && x < e.right && y >= e.top && y < e.bottom;
  }

  contains_rect(other: Rect): bool {
    const a = edges(this);
    const b = edges(other);
    return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom;
  }

  intersects(other: Rect): bool {
    const a = edges(this);
    const b = edges(other);
    if (a.right <= a.left || a.bottom <= a.top
      || b.right <= b.left || b.bottom <= b.top) return false;
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  intersection(other: Rect): Rect {
    const a = edges(this);
    const b = edges(other);
    const left = a.left > b.left ? a.left : b.left;
    const top = a.top > b.top ? a.top : b.top;
    const right = a.right < b.right ? a.right : b.right;
    const bottom = a.bottom < b.bottom ? a.bottom : b.bottom;
    finite(left); finite(top); finite(right); finite(bottom);
    if (right <= left || bottom <= top) return new Rect(left, top, 0.0, 0.0);
    return rect_from_edges(left, top, right, bottom);
  }

  union(other: Rect): Rect {
    const a = edges(this);
    const b = edges(other);
    return rect_from_edges(
      a.left < b.left ? a.left : b.left,
      a.top < b.top ? a.top : b.top,
      a.right > b.right ? a.right : b.right,
      a.bottom > b.bottom ? a.bottom : b.bottom,
    );
  }

  translated(offset: Vec2): Rect {
    edges(this);
    const ox = finite(offset.x);
    const oy = finite(offset.y);
    return new Rect(
      finite(this.position.x + ox),
      finite(this.position.y + oy),
      finite(this.size.x),
      finite(this.size.y),
    );
  }

  grown(amount: f64): Rect {
    const e = edges(this);
    finite(amount);
    assert(amount >= 0.0);
    return rect_from_edges(
      finite(e.left - amount),
      finite(e.top - amount),
      finite(e.right + amount),
      finite(e.bottom + amount),
    );
  }

  shrunk(amount: f64): Rect {
    const e = edges(this);
    finite(amount);
    assert(amount >= 0.0);
    const width = finite(e.right - e.left);
    const height = finite(e.bottom - e.top);
    const center_x = finite(e.left + finite(width / 2.0));
    const center_y = finite(e.top + finite(height / 2.0));
    const left = finite(e.left + amount);
    const top = finite(e.top + amount);
    const right = finite(e.right - amount);
    const bottom = finite(e.bottom - amount);
    const exhausted_x = amount >= finite(width / 2.0);
    const exhausted_y = amount >= finite(height / 2.0);
    return rect_from_edges(
      exhausted_x ? center_x : left,
      exhausted_y ? center_y : top,
      exhausted_x ? center_x : right,
      exhausted_y ? center_y : bottom,
    );
  }

  equals(other: Rect): bool {
    edges(this); edges(other);
    return this.position.x == other.position.x && this.position.y == other.position.y
      && this.size.x == other.size.x && this.size.y == other.size.y;
  }

  near_equals(other: Rect, tolerance: f64 = 0.000001): bool {
    edges(this); edges(other); finite(tolerance);
    assert(tolerance >= 0.0);
    return near_equal(this.position.x, other.position.x, tolerance)
      && near_equal(this.position.y, other.position.y, tolerance)
      && near_equal(this.size.x, other.size.x, tolerance)
      && near_equal(this.size.y, other.size.y, tolerance);
  }

  floor_to_i(): Recti {
    const e = edges(this);
    return recti_from_edges(floor_i32(e.left), floor_i32(e.top), floor_i32(e.right), floor_i32(e.bottom));
  }

  ceil_to_i(): Recti {
    const e = edges(this);
    return recti_from_edges(ceil_i32(e.left), ceil_i32(e.top), ceil_i32(e.right), ceil_i32(e.bottom));
  }

  round_to_i(): Recti {
    const e = edges(this);
    return recti_from_edges(round_i32(e.left), round_i32(e.top), round_i32(e.right), round_i32(e.bottom));
  }
}
