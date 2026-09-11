import { Vec3 } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  const value = new Vec3(0.0, 0.0, 0.0);
  value.z = Infinity;
  value.near_equals(new Vec3(1.0, 0.0, 0.0));
}
