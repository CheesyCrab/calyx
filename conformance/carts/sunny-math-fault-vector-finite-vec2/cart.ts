import { Vec2 } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  const value = new Vec2(0.0, 0.0);
  value.y = NaN;
  value.near_equals(new Vec2(1.0, 0.0));
}
