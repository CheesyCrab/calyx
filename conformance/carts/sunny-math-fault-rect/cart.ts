import { Rect } from "../../../sdk/assembly/index";

export function start(): void {}

export function update(): void {
  new Rect(0.0, 0.0, 1.0, 1.0).grown(-1.0);
}
