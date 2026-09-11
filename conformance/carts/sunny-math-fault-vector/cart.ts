import { Vec2 } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  new Vec2(1.0, 2.0).divide_scalar_in_place(0.0);
}
