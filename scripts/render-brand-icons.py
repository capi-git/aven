#!/usr/bin/env python3
"""Render Aven's mark and app icon source images.

The mark is a white line chevron on a charcoal glass tile: a soft top-to-bottom
gradient, a sheen on the upper half, a rim that catches light along the top
edge, and a faint glow behind the glyph, matching macOS dark icons. Outputs:

- public/aven-mark.png and public/aven.png (256 px tiles for the interface)
- target/brand/app-icon-1024.png (source for `npx tauri icon`)
- src-tauri/macos/AppIcon.icon/Assets/icon.png (1024 px glyph layer)

Run from the repository root, then regenerate the bundle icons with
`npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons`.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4  # supersampling factor
TOP = (46, 46, 50)
BOTTOM = (12, 12, 14)
WHITE = (250, 250, 250, 255)
# Chevron in a 24-unit icon box. The longer upper arm echoes the former
# folded-ribbon mark.
CHEVRON = [(16.6, 4.6), (7.4, 12.0), (15.6, 19.0)]


def stroke(draw, points, width, color):
    """Polyline with round caps and joins."""
    for start, end in zip(points, points[1:]):
        draw.line([start, end], fill=color, width=round(width))
    radius = width / 2
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def column(size, values):
    """A full-canvas image whose rows follow `values(t)` for t in [0, 1]."""
    strip = Image.new("L", (1, size))
    for y in range(size):
        strip.putpixel((0, y), max(0, min(255, round(values(y / (size - 1))))))
    return strip.resize((size, size))


def tile(n, box, radius, shadow=True):
    """Charcoal glass tile inside `box` on an n x n transparent canvas."""
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    if shadow:
        drop = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        offset = n * 0.012
        ImageDraw.Draw(drop).rounded_rectangle(
            (box[0], box[1] + offset, box[2], box[3] + offset), radius=radius, fill=(0, 0, 0, 150)
        )
        out = Image.alpha_composite(out, drop.filter(ImageFilter.GaussianBlur(n * 0.014)))
    body = Image.new("L", (n, n), 0)
    ImageDraw.Draw(body).rounded_rectangle(box, radius=radius, fill=255)
    top, bottom = box[1], box[3]
    span = bottom - top

    def within(y):
        return min(1, max(0, (y * (n - 1) - top) / span))

    fill = Image.merge(
        "RGB",
        [column(n, lambda t, i=i: TOP[i] + (BOTTOM[i] - TOP[i]) * within(t)) for i in range(3)],
    )
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    layer.paste(fill, (0, 0), body)
    # Sheen: a faint white wash over the upper half.
    sheen = Image.new("RGBA", (n, n), (255, 255, 255, 0))
    sheen.putalpha(
        ImageChops.multiply(column(n, lambda t: 26 * max(0, 1 - within(t) / 0.55)), body)
    )
    layer = Image.alpha_composite(layer, sheen)
    # Rim: bright along the top edge, fading towards the bottom.
    rim = Image.new("L", (n, n), 0)
    ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=255, width=max(2, round(n * 0.0045)))
    rim_layer = Image.new("RGBA", (n, n), (255, 255, 255, 0))
    rim_layer.putalpha(ImageChops.multiply(rim, column(n, lambda t: 95 - 70 * within(t))))
    return Image.alpha_composite(out, Image.alpha_composite(layer, rim_layer))


def glyph(n, center_x, center_y, side, weight, glow=True):
    """The chevron in a 24-unit box of `side` pixels, centred on the point."""
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    unit = side / 24
    left, top = center_x - side / 2 + n * 0.01, center_y - side / 2
    points = [(left + x * unit, top + y * unit) for x, y in CHEVRON]
    if glow:
        halo = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        stroke(ImageDraw.Draw(halo), points, (weight + 0.2) * unit, (255, 255, 255, 90))
        out = Image.alpha_composite(out, halo.filter(ImageFilter.GaussianBlur(n * 0.018)))
    crisp = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    stroke(ImageDraw.Draw(crisp), points, weight * unit, WHITE)
    return Image.alpha_composite(out, crisp)


def render(size, paint):
    n = size * SCALE
    return paint(n).resize((size, size), Image.LANCZOS)


def app_icon(n):
    """macOS icon grid: an 824 of 1024 px rounded square."""
    inset = n * 100 / 1024
    body = tile(n, (inset, inset, n - inset, n - inset), n * 185 / 1024)
    return Image.alpha_composite(body, glyph(n, n / 2, n / 2, n * 0.44, 2.1))


def interface_mark(n):
    """Interface tile: nearly full bleed, a heavier glyph for small sizes."""
    inset = n * 0.03
    body = tile(n, (inset, inset, n - inset, n - inset), n * 0.23, shadow=False)
    return Image.alpha_composite(body, glyph(n, n / 2, n / 2, n * 0.62, 2.3))


def glyph_layer(n):
    """Icon Composer layer: the glyph alone; icon.json supplies the fill."""
    return glyph(n, n / 2, n / 2, n * 0.44, 2.1, glow=False)


def main():
    brand = ROOT / "target/brand"
    brand.mkdir(parents=True, exist_ok=True)
    mark = render(256, interface_mark)
    mark.save(ROOT / "public/aven-mark.png")
    mark.save(ROOT / "public/aven.png")
    render(1024, app_icon).save(brand / "app-icon-1024.png")
    render(1024, glyph_layer).save(ROOT / "src-tauri/macos/AppIcon.icon/Assets/icon.png")
    print(f"Wrote marks and {brand / 'app-icon-1024.png'}")


if __name__ == "__main__":
    main()
