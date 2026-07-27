#!/usr/bin/env python3
"""
Generates build/icon.png, the source image electron-builder turns into the
platform icon sets.

Written by hand rather than pulled from a design tool so the icon is
reproducible from the repo with no dependencies -- pure stdlib, zlib for the
PNG encoding. Anti-aliasing is analytic (coverage from a signed distance)
rather than supersampled, because a 4x supersample of a 1024px image in pure
Python is slow enough to be annoying.

The mark: a dark rounded square, an accent ring, and a radius line from the
centre to the ring. Literal, but it reads at 32px, which is the only size that
really matters.
"""

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024
OUTPUT = Path(__file__).resolve().parent.parent / "build" / "icon.png"

# Matches the default theme: --rx-color-bg and --rx-color-accent.
BACKGROUND = (0x1B, 0x1B, 0x26)
SURFACE = (0x2A, 0x2A, 0x3A)
ACCENT = (0xA6, 0x8C, 0xFF)
ACCENT_DIM = (0x6F, 0x5A, 0xC9)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def rounded_square_distance(x: float, y: float, half: float, radius: float) -> float:
    """Signed distance to a rounded square centred on the origin."""
    dx = abs(x) - (half - radius)
    dy = abs(y) - (half - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def blend(base, layer, alpha: float):
    return tuple(round(b + (l - b) * alpha) for b, l in zip(base, layer))


def build_pixels() -> bytearray:
    centre = SIZE / 2
    half = SIZE * 0.46
    corner = SIZE * 0.22

    ring_radius = SIZE * 0.27
    ring_width = SIZE * 0.055
    dot_radius = SIZE * 0.045
    line_width = SIZE * 0.045

    # The radius line runs up and to the right at 45 degrees.
    angle = math.radians(-45)
    dir_x, dir_y = math.cos(angle), math.sin(angle)

    rows = bytearray()
    for py in range(SIZE):
        rows.append(0)  # PNG filter type: none
        y = py + 0.5 - centre
        for px in range(SIZE):
            x = px + 0.5 - centre

            # Card
            card = 1.0 - smoothstep(-1.0, 1.0, rounded_square_distance(x, y, half, corner))
            if card <= 0.0:
                rows.extend((0, 0, 0, 0))
                continue

            # A soft vertical lift so the card is not flat.
            lift = smoothstep(-half, half, -y) * 0.55
            colour = blend(BACKGROUND, SURFACE, lift)

            # Accent ring
            distance_to_ring = abs(math.hypot(x, y) - ring_radius)
            ring = 1.0 - smoothstep(ring_width * 0.5 - 1.5, ring_width * 0.5 + 1.5, distance_to_ring)
            if ring > 0.0:
                # Fade the ring towards the bottom-left so it reads as lit.
                shade = smoothstep(-ring_radius, ring_radius, x * 0.6 - y * 0.8)
                colour = blend(colour, blend(ACCENT_DIM, ACCENT, shade), ring)

            # Radius line: centre outwards to the ring, along `dir`.
            along = x * dir_x + y * dir_y
            across = abs(-x * dir_y + y * dir_x)
            if 0.0 <= along <= ring_radius:
                line = 1.0 - smoothstep(line_width * 0.5 - 1.5, line_width * 0.5 + 1.5, across)
                if line > 0.0:
                    colour = blend(colour, ACCENT, line)

            # Centre dot
            dot = 1.0 - smoothstep(dot_radius - 1.5, dot_radius + 1.5, math.hypot(x, y))
            if dot > 0.0:
                colour = blend(colour, ACCENT, dot)

            rows.extend((colour[0], colour[1], colour[2], round(card * 255)))

    return rows


def write_png(path: Path, pixels: bytearray) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(pixels), 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    write_png(OUTPUT, build_pixels())
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")
