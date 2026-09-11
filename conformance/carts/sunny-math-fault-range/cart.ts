import { clamp } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  clamp<i32>(0, 2, 1);
}
