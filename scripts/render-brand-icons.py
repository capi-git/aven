#!/usr/bin/env python3
"""Render Aven's monochrome mark and app icon source images.

The mark is a white line chevron on a dark rounded tile, drawn like the
interface's stroke icons. Outputs:

- public/aven-mark.png and public/aven.png (256 px tiles for the interface)
- target/brand/app-icon-1024.png (source for `npx tauri icon`)
- src-tauri/macos/AppIcon.icon/Assets/icon.png (1024 px glyph layer)

Run from the repository root, then regenerate the bundle icons with
`npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons`.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4  # supersampling factor
TILE = (23, 23, 23, 255)
EDGE = (52, 52, 52, 255)
BLACK = (10, 10, 10, 255)
WHITE = (250, 250, 250, 255)
# Chevron in a 24-unit icon box. The longer upper arm echoes the former
# folded-ribbon mark.
CHEVRON = [(17.2, 5.0), (7.6, 12.0), (15.8, 18.6)]
STROKE = 2.0


def stroke(draw, points, width, color):
    """Polyline with round caps and joins."""
    for start, end in zip(points, points[1:]):
        draw.line([start, end], fill=color, width=round(width))
    radius = width / 2
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def glyph(draw, box, size, color, weight=STROKE):
    """Draw the chevron into `box` = (left, top, side) in canvas pixels."""
    left, top, side = box
    unit = side / 24
    points = [(left + x * unit, top + y * unit) for x, y in CHEVRON]
    stroke(draw, points, weight * unit, color)


def render(size, paint):
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    paint(ImageDraw.Draw(canvas), size * SCALE)
    return canvas.resize((size, size), Image.LANCZOS)


def tile(draw, px):
    """Interface mark: full-bleed rounded tile, like a selected toolbar icon."""
    draw.rounded_rectangle((0, 0, px - 1, px - 1), radius=px * 0.23, fill=TILE)
    draw.rounded_rectangle(
        (0, 0, px - 1, px - 1), radius=px * 0.23, outline=EDGE, width=round(px * 0.012)
    )
    glyph(draw, (px * 0.14, px * 0.14, px * 0.72), px, WHITE, weight=2.1)


def app_icon(draw, px):
    """macOS icon grid: 824 of 1024 px rounded square, black with a fine edge."""
    inset = px * 100 / 1024
    body = (inset, inset, px - inset, px - inset)
    radius = px * 185 / 1024
    draw.rounded_rectangle(body, radius=radius, fill=BLACK)
    draw.rounded_rectangle(body, radius=radius, outline=EDGE, width=round(px * 0.004))
    side = px * 0.52
    glyph(draw, ((px - side) / 2, (px - side) / 2, side), px, WHITE, weight=1.9)


def glyph_layer(draw, px):
    """Icon Composer layer: the glyph alone; icon.json supplies the black fill."""
    side = px * 0.52
    glyph(draw, ((px - side) / 2, (px - side) / 2, side), px, WHITE, weight=1.9)


def main():
    brand = ROOT / "target/brand"
    brand.mkdir(parents=True, exist_ok=True)
    mark = render(256, tile)
    mark.save(ROOT / "public/aven-mark.png")
    mark.save(ROOT / "public/aven.png")
    render(1024, app_icon).save(brand / "app-icon-1024.png")
    render(1024, glyph_layer).save(ROOT / "src-tauri/macos/AppIcon.icon/Assets/icon.png")
    print(f"Wrote marks and {brand / 'app-icon-1024.png'}")


if __name__ == "__main__":
    main()
