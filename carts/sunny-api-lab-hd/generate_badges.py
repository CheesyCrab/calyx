"""Reproduce the original alpha test sheet, then run png2src.py --format rgba."""
import pathlib
import struct
import zlib


def chunk(kind, data):
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data)))


rows = []
for y in range(16):
    row = []
    for x in range(32):
        local_x = x % 16
        distance = (local_x * 2 - 15) ** 2 + (y * 2 - 15) ** 2
        alpha = 255 if distance < 140 else 144 if distance < 200 else 40 if distance < 240 else 0
        value = 240 if (5 < local_x < 10) or (5 < y < 10) else 160
        rgb = ((value, 200 + local_x * 3, 140 + y * 6) if x < 16
               else (230, 120 + local_x * 5, 150 + y * 6))
        if x >= 16 and local_x < 7 and y < 7:
            rgb = (255, 245, 210)
        row.extend((*rgb, alpha))
    rows.append(bytes(row))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 16, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row for row in rows)))
       + chunk(b"IEND", b""))
pathlib.Path(__file__).with_name("badges.png").write_bytes(png)
