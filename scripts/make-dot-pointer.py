#!/usr/bin/env python3
"""Draws Aven's dot pointer images into src/assets/pointer/.

One soft dot, the same size everywhere: a flat, see-through fill with a
softened edge and no outline, floating on a soft shadow. The shadow is what
keeps it visible over a surface of its own colour (a white page in dark
mode). Over something you can press it is only a little brighter, never
larger, so the pointer keeps one weight as it moves across Aven (like the
iPad's pointer, a single fingertip-sized circle). Each tone for dark and
light appearance, at 1x and 2x. Standard library only:

    python3 scripts/make-dot-pointer.py

src/pointer.css names them, with the hotspot at the centre of the 1x size.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "pointer"
SUPERSAMPLE = 4

# Canvas side and dot radius in CSS pixels, for every image. Hotspot: SIDE / 2.
SIDE = 32
RADIUS = 7.0
# How far the dot's edge melts, in CSS pixels.
EDGE = 1.0
# The shadow: offset down, softness (Gaussian sigma), all in CSS pixels.
SHADOW_DROP = 1.0
SHADOW_SIGMA = 2.0

# (rgb, centre alpha, edge alpha, shadow alpha) per image. The fill is
# nearly flat; the shadow is black in both appearances.
TONES = {
    "dark": {
        "dot": ((1, 1, 1), 0.7, 0.62, 0.4),
        "dot-press": ((1, 1, 1), 0.82, 0.74, 0.42),
    },
    # Mid grey, so it shows over white and over a dark code block alike.
    "light": {
        "dot": ((0.42, 0.42, 0.45), 0.68, 0.6, 0.24),
        "dot-press": ((0.36, 0.36, 0.39), 0.78, 0.7, 0.26),
    },
}


def dot_alpha(distance, scale, centre, edge):
    radius = RADIUS * scale
    cover = min(max((radius - distance) / (EDGE * scale) + 0.5, 0.0), 1.0)
    if cover <= 0:
        return 0.0
    t = min(distance / radius, 1.0)
    return cover * (centre - (centre - edge) * t * t)


def shadow_alpha(distance, scale, strength):
    # A disc blurred by a Gaussian: half the complementary error function of
    # the distance past its edge.
    sigma = SHADOW_SIGMA * scale
    past = distance - (RADIUS - 0.5) * scale
    return strength * 0.5 * math.erfc(past / (sigma * math.sqrt(2)))


def draw(scale, tone):
    rgb, centre, edge, shadow = tone
    size = SIDE * scale
    middle = size / 2
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG filter: none
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    px = x + (sx + 0.5) / SUPERSAMPLE - middle
                    py = y + (sy + 0.5) / SUPERSAMPLE - middle
                    under = shadow_alpha(
                        math.hypot(px, py - SHADOW_DROP * scale), scale, shadow
                    )
                    over = dot_alpha(math.hypot(px, py), scale, centre, edge)
                    # The dot over its shadow, premultiplied.
                    alpha = over + under * (1 - over)
                    r += rgb[0] * over
                    g += rgb[1] * over
                    b += rgb[2] * over
                    a += alpha
            samples = SUPERSAMPLE * SUPERSAMPLE
            r, g, b, a = r / samples, g / samples, b / samples, a / samples
            if a <= 0.002:
                pixels.extend((0, 0, 0, 0))
                continue
            pixels.extend(
                (
                    round(min(r / a, 1) * 255),
                    round(min(g / a, 1) * 255),
                    round(min(b / a, 1) * 255),
                    round(a * 255),
                )
            )
    return size, bytes(pixels)


def png(size, raw):
    def chunk(kind, data):
        body = kind + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for appearance, tones in TONES.items():
        for name, tone in tones.items():
            for scale in (1, 2):
                size, raw = draw(scale, tone)
                suffix = "" if scale == 1 else "@2x"
                path = OUT / f"{name}-{appearance}{suffix}.png"
                path.write_bytes(png(size, raw))
                print(f"{path.relative_to(OUT.parent.parent.parent)} {size}x{size}")


if __name__ == "__main__":
    main()
