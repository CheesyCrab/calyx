#!/usr/bin/env python3
"""Deterministic fixture tests for png2src — no binary fixtures.

Each test encodes a tiny PNG in memory (stdlib-only writer below),
runs the converter, and asserts on the emitted module or the error.

    python tools/test_png2src.py
"""

import struct
import sys
import unittest
import zlib

import png2src


def _chunk(ctype, body):
    return (
        struct.pack(">I", len(body))
        + ctype
        + body
        + struct.pack(">I", zlib.crc32(ctype + body))
    )


def encode_png(rows, color_type):
    """Minimal non-interlaced 8-bit PNG writer for the test fixtures."""
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    h = len(rows)
    w = len(rows[0]) // channels
    ihdr = struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


# SWEETIE_16: 0 BLACK, 1 WHITE, 4 RED (#b13e53)
BLACK = (0x00, 0x00, 0x00)
WHITE = (0xFF, 0xFF, 0xFF)
RED = (0xB1, 0x3E, 0x53)
SWEETIE = png2src.PALETTES["SWEETIE_16"]


class Png2SrcTest(unittest.TestCase):
    def test_full_color_preserves_rgba(self):
        png = encode_png([[17, 29, 83, 0, 3, 5, 7, 127]], 6)
        out = png2src.convert(png, "S", "s.png", SWEETIE, "SWEETIE_16", format="rgba")
        self.assertIn("17, 29, 83, 0, 3, 5, 7, 127,", out)
        self.assertIn("S_W: i32 = 2", out)
        self.assertIn("straight-alpha RGBA", out)

    def test_rgb_and_gray_trns_preserved(self):
        for color, values, transparent, expected in [
            (2, [17, 29, 83, 3, 5, 7], struct.pack(">HHH", 17, 29, 83), [(17,29,83,0), (3,5,7,255)]),
            (0, [42, 43], struct.pack(">H", 42), [(42,42,42,0), (43,43,43,255)]),
        ]:
            png = encode_png([values], color)
            png = png[:33] + _chunk(b"tRNS", transparent) + png[33:]
            self.assertEqual(png2src.parse_png(png)[2][0], expected)

    def test_rgba_sprite_maps_exactly(self):
        # 2x2: white, transparent / red, black
        rows = [
            list(WHITE) + [255] + [12, 34, 56, 0],
            list(RED) + [255] + list(BLACK) + [255],
        ]
        png = encode_png(rows, 6)
        out = png2src.convert(png, "SPR", "spr.png", SWEETIE, "SWEETIE_16")
        self.assertIn("export const SPR_W: i32 = 2;", out)
        self.assertIn("export const SPR_H: i32 = 2;", out)
        self.assertIn("  1, 0,\n  4, 0,", out)

    def test_rgb_sprite(self):
        rows = [list(WHITE) + list(RED), list(BLACK) + list(WHITE)]
        png = encode_png(rows, 2)
        out = png2src.convert(png, "S", "s.png", SWEETIE, "SWEETIE_16")
        self.assertIn("  1, 4,\n  0, 1,", out)

    def test_unmatched_color_is_an_error(self):
        rows = [[10, 20, 30, 255]]
        png = encode_png(rows, 6)
        with self.assertRaises(ValueError) as ctx:
            png2src.convert(png, "S", "s.png", SWEETIE, "SWEETIE_16")
        self.assertIn("(0,0)", str(ctx.exception))
        self.assertIn("#0a141e", str(ctx.exception))

    def test_paeth_filter_roundtrip(self):
        # Encode the second row with filter 4 (Paeth) by applying the
        # predictor forward; parse_png must undo it exactly.
        def paeth(a, b, c):
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            if pa <= pb and pa <= pc:
                return a
            return b if pb <= pc else c

        row0 = bytes(list(WHITE) + list(RED))
        row1 = bytes(list(BLACK) + list(WHITE))
        filtered1 = bytes(
            (row1[i] - paeth(row1[i - 3] if i >= 3 else 0, row0[i],
                             row0[i - 3] if i >= 3 else 0)) & 0xFF
            for i in range(len(row1))
        )
        raw = b"\x00" + row0 + b"\x04" + filtered1
        ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
        png = (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", zlib.compress(raw))
            + _chunk(b"IEND", b"")
        )
        w, h, rows = png2src.parse_png(png)
        self.assertEqual(rows[1][0], (0, 0, 0, 255))
        self.assertEqual(rows[1][1], (255, 255, 255, 255))

    def test_unknown_filter_type_is_an_error(self):
        raw = b"\x09" + bytes(list(WHITE) + list(RED))
        ihdr = struct.pack(">IIBBBBB", 2, 1, 8, 2, 0, 0, 0)
        png = (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", zlib.compress(raw))
            + _chunk(b"IEND", b"")
        )
        with self.assertRaises(ValueError):
            png2src.parse_png(png)

    def test_indexed_with_trns(self):
        plte = bytes(WHITE) + bytes(RED)
        trns = bytes([255, 0])  # entry 1 fully transparent
        ihdr = struct.pack(">IIBBBBB", 2, 1, 8, 3, 0, 0, 0)
        raw = b"\x00" + bytes([0, 1])
        png = (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", ihdr)
            + _chunk(b"PLTE", plte)
            + _chunk(b"tRNS", trns)
            + _chunk(b"IDAT", zlib.compress(raw))
            + _chunk(b"IEND", b"")
        )
        out = png2src.convert(png, "S", "s.png", SWEETIE, "SWEETIE_16")
        self.assertIn("  1, 0,", out)  # white, then the tRNS hole

    def test_module_shape_is_stable(self):
        rows = [[0xFF, 0xFF, 0xFF, 255]]
        png = encode_png(rows, 6)
        out = png2src.convert(png, "DOT", "dot.png", SWEETIE, "SWEETIE_16")
        expected = (
            "// GENERATED from dot.png by tools/png2src.py — do not edit.\n"
            "// 8bpp palette indices, row-major, for blit_sprite "
            "(ABI §4 Drawing);\n"
            "// transparent source pixels are index 0 "
            "(the color-key hole).\n"
            "\n"
            "export const DOT_W: i32 = 1;\n"
            "export const DOT_H: i32 = 1;\n"
            "export const DOT: StaticArray<u8> = [\n"
            "  1,\n"
            "];\n"
        )
        self.assertEqual(out, expected)


if __name__ == "__main__":
    sys.exit(unittest.main())
