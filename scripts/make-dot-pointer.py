#!/usr/bin/env python3
"""Draws Aven's dot pointer images into src/assets/pointer/.

Each image is a soft round dot, centred, with a faint outer ring so it still
shows over a surface of its own colour. There are two sizes (the resting dot
and a larger, brighter one over something you can press), each for dark and
light appearance, at 1x and 2x. Standard library only, so the images can be
rebuilt anywhere:

    python3 scripts/make-dot-pointer.py

src/pointer.css names them, with the hotspot at the centre of the 1x size.
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "pointer"
SUPERSAMPLE = 8

# (name, canvas side, dot radius) in CSS pixels. Hotspots are side / 2.
SIZES = [("dot", 28, 10.0), ("dot-press", 36, 13.0)]

# (fill, rim, halo) as RGBA in 0..1. The rim is the dot's last pixel; the halo
# is one pixel outside it, in the opposite tone.
TONES = {
    "dark": {
        "dot": ((1, 1, 1, 0.3), (1, 1, 1, 0.6), (0, 0, 0, 0.22)),
        "dot-press": ((1, 1, 1, 0.4), (1, 1, 1, 0.75), (0, 0, 0, 0.24)),
    },
    "light": {
        "dot": ((0.24, 0.24, 0.26, 0.26), (0.24, 0.24, 0.26, 0.55), (1, 1, 1, 0.6)),
        "dot-press": (
            (0.24, 0.24, 0.26, 0.34),
            (0.24, 0.24, 0.26, 0.7),
            (1, 1, 1, 0.65),
        ),
    },
}


def layer(distance, radius, scale, tones):
    """The colour of one sample, or None outside the dot."""
    fill, rim, halo = tones
    edge = 1.0 * scale
    if distance <= radius - edge:
        return fill
    if distance <= radius:
        return rim
    if distance <= radius + edge:
        return halo
    return None


def draw(side, radius, scale, tones):
    size = side * scale
    centre = size / 2
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG filter: none
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    px = x + (sx + 0.5) / SUPERSAMPLE - centre
                    py = y + (sy + 0.5) / SUPERSAMPLE - centre
                    colour = layer(
                        (px * px + py * py) ** 0.5, radius * scale, scale, tones
                    )
                    if colour is None:
                        continue
                    r += colour[0] * colour[3]
                    g += colour[1] * colour[3]
                    b += colour[2] * colour[3]
                    a += colour[3]
            samples = SUPERSAMPLE * SUPERSAMPLE
            alpha = a / samples
            if alpha <= 0:
                pixels.extend((0, 0, 0, 0))
                continue
            pixels.extend(
                (
                    round(r / a * 255),
                    round(g / a * 255),
                    round(b / a * 255),
                    round(alpha * 255),
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
    for tone, shapes in TONES.items():
        for name, side, radius in SIZES:
            for scale in (1, 2):
                size, raw = draw(side, radius, scale, shapes[name])
                suffix = "" if scale == 1 else "@2x"
                path = OUT / f"{name}-{tone}{suffix}.png"
                path.write_bytes(png(size, raw))
                print(f"{path.relative_to(OUT.parent.parent.parent)} {size}x{size}")


if __name__ == "__main__":
    main()
