#!/usr/bin/env python3
"""Generate Sunny's embedded advance table from the canonical font.

Reads assets/fonts/m6x11-v1.json (the ABI-pinned artifact) and writes
sdk/assembly/font.ts. Sunny embeds ONLY the advances — the host owns the
glyph bitmaps (ABI §4 Drawing) — so guest-side measure/center/wrap needs
no host metrics call (ABI §4a).

    python tools/gen_font.py           # (re)write assembly/font.ts
    python tools/gen_font.py --check   # exit 1 if the file drifted
"""

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CANONICAL = HERE.parent.parent / "assets" / "fonts" / "m6x11-v1.json"
OUT = HERE.parent / "assembly" / "font.ts"

FIRST, LAST = 0x20, 0x7E  # the ABI glyph range


def render() -> str:
    data = json.loads(CANONICAL.read_text(encoding="utf-8"))
    glyphs = data["glyphs"]
    advances = [glyphs[str(c)]["advance"] for c in range(FIRST, LAST + 1)]

    rows = []
    for i in range(0, len(advances), 16):
        chunk = ", ".join(str(a) for a in advances[i : i + 16])
        rows.append(f"  {chunk},")
    table = "\n".join(rows)

    return f"""\
// GENERATED from assets/fonts/m6x11-v1.json by sdk/tools/gen_font.py —
// do not edit. Sunny embeds the m6x11 v{data["version"]} advance table
// only; the host owns the glyph bitmaps (ABI §4 Drawing). Guest-side
// measure/center/wrap reads these (ABI §4a).

export const FONT_VERSION: i32 = {data["version"]};
export const FONT_LINE_HEIGHT: i32 = {data["line_height"]};
export const FONT_BASELINE: i32 = {data["baseline"]};

// Advance of the pinned placeholder glyph — every byte outside
// 0x20..0x7E renders it and advances by this (ABI §4 Drawing).
export const PLACEHOLDER_ADVANCE: i32 = {data["placeholder"]["advance"]};

// Advance widths for 0x20..0x7E, indexed by (byte - 0x20).
export const ADVANCES: StaticArray<u8> = [
{table}
];
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify assembly/font.ts matches the canonical artifact",
    )
    args = parser.parse_args()

    text = render()
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(
                "DRIFT: sdk/assembly/font.ts does not match "
                "assets/fonts/m6x11-v1.json — run sdk/tools/gen_font.py",
                file=sys.stderr,
            )
            return 1
        print("font.ts matches the canonical artifact")
        return 0

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
