import { round_i32 } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  round_i32(2147483648.0);
}
