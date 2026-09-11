import { saturate } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  saturate(Infinity);
}
