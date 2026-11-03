#!/usr/bin/env python3
"""Render Aven's mark and app icon source images.

The mark is Rise: a 5 x 5 staircase of round off-white dots, one more on each
row down, climbing to the top-left. On the app icon it sits on a tile of
smoky glass: dark grey at 70% opacity so the wallpaper shows through, a sheen
that lightens the top, a thin bright rim along the top edge, a soft shadow
inside the bottom and a soft drop shadow, like macOS icons on glass. The dots
carry a faint white glow there; in the interface they are plain.

Every image is drawn at its own output size, supersampled, so the tile's
corners and the dots stay smooth at every size instead of being resampled
from a larger one. Outputs:

- public/aven-mark.png and public/aven.png (256 px tiles for the interface)
- public/aven-mark.svg (the browser's 14 px fallback tab icon)
- target/brand/app-icon-1024.png (source for `npx tauri icon`)
- src-tauri/macos/AppIcon.icon/Assets/icon.png (1024 px glyph layer)

Run from the repository root, then regenerate the bundle icons with
`npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons` and run
this script again with `--bundle`. That redraws each desktop bundle PNG at its
own size and rebuilds `icon.icns` (with `iconutil`, macOS only) and
`icon.ico`, replacing Tauri's resampled copies.
"""
import argparse
import io
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri/icons"
SCALE = 4  # supersampling factor
GLASS = (42, 43, 48)  # #2a2b30
GLASS_ALPHA = 0.70
WHITE = (242, 242, 240)  # #f2f2f0
# Rise, one character per cell: "#" a lit dot. Keep it in step with
# AVEN_MARK_ROWS in src/lib/avenMark.ts.
RISE = (
    "#....",
    "##...",
    "###..",
    "####.",
    "#####",
)
GRID = len(RISE)
# The mark's width as a share of the tile's, and a dot's diameter as a share
# of its cell. Both grow as the tile shrinks (see `glyph_metrics`) so the
# stairs still read at Dock and tab sizes.
APP_SHARE = 0.52
INTERFACE_SHARE = 0.56
DOT = 0.55
# The browser's fallback icon draws its dots a little bigger, 0.6 of a cell,
# like the in-app mark (AVEN_MARK_DOT_RADIUS in src/lib/avenMark.ts).
SVG_DOT_RADIUS = 0.3
# Sizes in each bundle container, in the order Tauri writes them.
ICO_SIZES = (32, 16, 24, 48, 64, 256)
ICONSET = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}


def ramp(n, box, values):
    """An n x n "L" image from `values(u, v)`, u and v across and down `box`.

    Sampled on a coarse grid and resized, so a smooth gradient costs little
    even on a 4096 px canvas.
    """
    samples = 96
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    data = []
    for j in range(samples):
        y = (j + 0.5) / samples * n
        v = min(1, max(0, (y - top) / height))
        for i in range(samples):
            x = (i + 0.5) / samples * n
            u = min(1, max(0, (x - left) / width))
            data.append(max(0, min(255, round(255 * values(u, v)))))
    strip = Image.new("L", (samples, samples))
    strip.putdata(data)
    return strip.resize((n, n), Image.BILINEAR)


def smoothstep(edge0, edge1, x):
    t = min(1, max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def tile(n, box, radius, shadow=True):
    """Smoky glass tile inside `box` on an n x n transparent canvas."""
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    side = box[2] - box[0]
    if shadow:
        drop = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        offset = side * 0.035
        ImageDraw.Draw(drop).rounded_rectangle(
            (box[0], box[1] + offset, box[2], box[3] + offset), radius=radius, fill=(0, 0, 0, 125)
        )
        out = Image.alpha_composite(out, drop.filter(ImageFilter.GaussianBlur(side * 0.045)))
    body = Image.new("L", (n, n), 0)
    ImageDraw.Draw(body).rounded_rectangle(box, radius=radius, fill=255)

    def masked(color, alpha):
        layer = Image.new("RGBA", (n, n), color + (0,))
        layer.putalpha(ImageChops.multiply(alpha, body))
        return layer

    # The glass itself: dark grey the wallpaper shows through.
    glass = masked(GLASS, Image.new("L", (n, n), round(255 * GLASS_ALPHA)))
    # Sheen: white at the top, gone by 45% of the way down, slanted a little
    # (CSS `linear-gradient(165deg, ...)`).
    sheen = masked(
        (255, 255, 255),
        ramp(n, box, lambda u, v: 0.28 * max(0, 1 - (0.2588 * u + 0.9659 * v) / 1.2247 / 0.45)),
    )
    # A soft shadow inside the bottom edge, so the glass has depth.
    inner = masked((0, 0, 0), ramp(n, box, lambda u, v: 0.18 * smoothstep(0.55, 1, v)))
    # Rim: a thin light edge, brightest along the top.
    rim = Image.new("L", (n, n), 0)
    ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=255, width=max(2, round(side * 0.009)))
    rim_layer = Image.new("RGBA", (n, n), (255, 255, 255, 0))
    rim_layer.putalpha(ImageChops.multiply(rim, ramp(n, box, lambda u, v: 0.6 - 0.34 * v)))
    for layer in (glass, sheen, inner, rim_layer):
        out = Image.alpha_composite(out, layer)
    return out


def glyph_metrics(tile_side, share):
    """The mark's share of the tile and a dot's share of its cell at this size.

    Both grow as the tile shrinks below 96 px, up to 0.12 more at 16 px, so
    the stairs stay legible where a 0.55 dot would be under a pixel.
    """
    small = max(0.0, min(1.0, (96 - tile_side) / 80))
    return share + 0.12 * small, DOT + 0.12 * small


def draw_dots(image, box, share, glow=False):
    """Rise centred in `box`, round dots; `glow` adds a soft white halo."""
    side = box[2] - box[0]
    share, dot = glyph_metrics(side / SCALE, share)
    width = side * share
    cell = width / GRID
    left = box[0] + (side - width) / 2
    top = box[1] + (side - width) / 2
    radius = cell * dot / 2
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for row, cells in enumerate(RISE):
        for col, mark in enumerate(cells):
            if mark != "#":
                continue
            cx, cy = left + (col + 0.5) * cell, top + (row + 0.5) * cell
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=WHITE + (255,))
    if glow:
        for blur, strength in ((radius * 0.8, 0.75), (radius * 2.6, 0.4)):
            halo = layer.copy()
            halo.putalpha(halo.getchannel("A").point(lambda a, s=strength: round(a * s)))
            image = Image.alpha_composite(image, halo.filter(ImageFilter.GaussianBlur(blur)))
    return Image.alpha_composite(image, layer)


def render(size, tile_side, radius_share, share, shadow, glow):
    """A tile with the mark on it, drawn at `size` x SCALE and downsampled."""
    n = size * SCALE
    side = tile_side * SCALE
    left = (n - side) / 2
    box = (left, left, left + side, left + side)
    image = tile(n, box, side * radius_share, shadow)
    image = draw_dots(image, box, share, glow)
    return image.resize((size, size), Image.LANCZOS)


def app_icon(size):
    """macOS icon grid: an 824 of 1024 px rounded square with a drop shadow."""
    return render(size, size * 824 / 1024, 185 / 824, APP_SHARE, shadow=True, glow=size >= 128)


def interface_mark(size):
    """Interface tile: nearly full bleed, no shadow, a slightly bigger mark."""
    return render(size, size * 0.94, 0.245, INTERFACE_SHARE, shadow=False, glow=size >= 128)


def glyph_layer(size):
    """Icon Composer layer: the dots alone; icon.json supplies the fill.

    Icon Composer's canvas is the whole tile, so the mark takes the same
    share of the canvas as it takes of the tile in the app icon.
    """
    n = size * SCALE
    image = draw_dots(Image.new("RGBA", (n, n), (0, 0, 0, 0)), (0, 0, n, n), APP_SHARE)
    return image.resize((size, size), Image.LANCZOS)


def dot_circles(radius):
    """The lit cells as SVG circles over the grid, one unit a cell."""
    return "".join(
        f'<circle cx="{x + 0.5}" cy="{y + 0.5}" r="{radius}"/>'
        for y, cells in enumerate(RISE)
        for x, mark in enumerate(cells)
        if mark == "#"
    )


def fallback_svg():
    """The browser's fallback tab icon, shown at 14 px.

    The glass tile fills the box; the mark spans 9 of the 14 px, so its five
    columns are 1.8 px apart with dots just over a pixel wide.
    """
    hex_color = "#{:02x}{:02x}{:02x}".format
    tile_attrs = 'x="0.5" y="0.5" width="13" height="13" rx="3.2"'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'
        '<defs><linearGradient id="s" x1="0" y1="0" x2="0.26" y2="0.97">'
        '<stop offset="0" stop-color="#fff" stop-opacity="0.28"/>'
        '<stop offset="0.45" stop-color="#fff" stop-opacity="0"/>'
        "</linearGradient></defs>"
        f'<rect {tile_attrs} fill="{hex_color(*GLASS)}" fill-opacity="{GLASS_ALPHA}"/>'
        f'<rect {tile_attrs} fill="url(#s)"/>'
        f'<rect {tile_attrs} fill="none" stroke="#fff" stroke-opacity="0.42"/>'
        f'<g fill="{hex_color(*WHITE)}" transform="translate(2.5 2.5) scale(1.8)">'
        f"{dot_circles(SVG_DOT_RADIUS)}"
        "</g></svg>\n"
    )


def write_ico(path):
    """PNG-compressed entries in Tauri's order, each drawn at its own size."""
    entries = []
    for size in ICO_SIZES:
        data = io.BytesIO()
        app_icon(size).save(data, "PNG")
        entries.append((size, data.getvalue()))
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = len(header) + 16 * len(entries)
    directory, blobs = b"", b""
    for size, data in entries:
        edge = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", edge, edge, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    path.write_bytes(header + directory + blobs)


def write_bundle():
    """Redraw the desktop bundle icons Tauri generated, each at its own size."""
    redrawn = 0
    for path in sorted(ICONS.glob("*.png")):
        with Image.open(path) as current:
            size = current.size
        if size[0] != size[1]:
            continue
        app_icon(size[0]).save(path)
        redrawn += 1
    write_ico(ICONS / "icon.ico")
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as temp:
            iconset = Path(temp) / "icon.iconset"
            iconset.mkdir()
            for name, size in ICONSET.items():
                app_icon(size).save(iconset / name)
            subprocess.run(
                ["iconutil", "-c", "icns", str(iconset), "-o", str(ICONS / "icon.icns")], check=True
            )
        print(f"Redrew {redrawn} bundle PNGs, icon.ico and icon.icns")
    else:
        print(f"Redrew {redrawn} bundle PNGs and icon.ico; icon.icns needs iconutil (macOS)", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--bundle",
        action="store_true",
        help="after `npx tauri icon`, redraw the desktop bundle icons at their own sizes",
    )
    if parser.parse_args().bundle:
        write_bundle()
        return
    brand = ROOT / "target/brand"
    brand.mkdir(parents=True, exist_ok=True)
    mark = interface_mark(256)
    mark.save(ROOT / "public/aven-mark.png")
    mark.save(ROOT / "public/aven.png")
    (ROOT / "public/aven-mark.svg").write_text(fallback_svg())
    app_icon(1024).save(brand / "app-icon-1024.png")
    glyph_layer(1024).save(ROOT / "src-tauri/macos/AppIcon.icon/Assets/icon.png")
    print(f"Wrote marks and {brand / 'app-icon-1024.png'}")


if __name__ == "__main__":
    main()
