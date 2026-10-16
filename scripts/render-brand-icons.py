#!/usr/bin/env python3
"""Render Aven's mark and app icon source images.

The mark is the Pixel A: a 7 x 8 pixel-art capital A in off-white with one
accent-blue pixel at the apex, the summit. It sits on a charcoal glass tile: a
soft top-to-bottom gradient, a sheen on the upper half and a rim that catches
light along the top edge, matching macOS dark icons.

Every image is drawn at its own output size. The tile is supersampled, but the
glyph's cells are exact rectangles snapped to whole pixels, so the A stays
crisp at every size instead of being blurred by a downscale. Outputs:

- public/aven-mark.png and public/aven.png (256 px tiles for the interface)
- public/aven-mark.svg (the browser's crisp 14 px fallback tab icon)
- target/brand/app-icon-1024.png (source for `npx tauri icon`)
- src-tauri/macos/AppIcon.icon/Assets/icon.png (1024 px glyph layer)

Run from the repository root, then regenerate the bundle icons with
`npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons` and run
this script again with `--bundle`. That redraws each desktop bundle PNG at its
own size and rebuilds `icon.icns` (with `iconutil`, macOS only) and
`icon.ico`, replacing Tauri's resampled copies, which soften the pixels.
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
SCALE = 4  # supersampling factor for the tile
TOP = (46, 46, 50)
BOTTOM = (12, 12, 14)
WHITE = (242, 242, 240, 255)  # #f2f2f0
BLUE = (87, 181, 255, 255)  # #57b5ff, Aven's accent
# The Pixel A, one character per cell: "#" white, "B" the blue summit. Keep it
# in step with AVEN_MARK_ROWS in src/lib/avenMark.ts.
PIXEL_A = (
    "...B...",
    "..###..",
    ".##.##.",
    ".#...#.",
    "#######",
    "##...##",
    "#.....#",
    "#.....#",
)
COLUMNS, ROWS = len(PIXEL_A[0]), len(PIXEL_A)
# Glyph width as a share of the tile width: 63 px in a 120 px tile in the
# approved concept. The interface tile uses a slightly heavier A because it is
# usually shown small.
APP_SHARE = 0.525
INTERFACE_SHARE = 0.56
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


def layout(size, tile_side, share):
    """Snap the tile and glyph to whole pixels on a `size` canvas.

    Returns the tile box, the cell size and the glyph's top-left corner. The
    tile side is rounded to the glyph width's parity so the A centres exactly
    across. Down the tile the A sits a quarter cell high, because its lone
    summit pixel makes it look low when centred by its bounds; an odd
    remainder at small sizes leaves it half a pixel high instead.
    """
    cell = max(1, round(tile_side * share / COLUMNS))
    width, height = COLUMNS * cell, ROWS * cell
    side = round(tile_side)
    if (side - width) % 2:
        side += 1 if tile_side > side else -1
    left = top = (size - side) // 2
    lift = cell // 4
    origin = (left + (side - width) // 2, top + (side - height) // 2 - lift)
    return (left, top, left + side, top + side), cell, origin


def draw_glyph(image, cell, origin, glow=False):
    """The Pixel A with its cells as exact rectangles; `glow` adds a soft halo."""
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for row, cells in enumerate(PIXEL_A):
        for col, mark in enumerate(cells):
            if mark == ".":
                continue
            x, y = origin[0] + col * cell, origin[1] + row * cell
            draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=BLUE if mark == "B" else WHITE)
    if glow:
        halo = layer.copy()
        halo.putalpha(halo.getchannel("A").point(lambda a: a * 50 // 255))
        image = Image.alpha_composite(image, halo.filter(ImageFilter.GaussianBlur(image.width * 0.02)))
    return Image.alpha_composite(image, layer)


def tile_image(size, box, radius, shadow):
    """The tile rendered at `size`, supersampled so its corners stay smooth."""
    n = size * SCALE
    scaled = tuple(v * SCALE for v in box)
    # Pillow boxes include their far edge; stop one subpixel short so the
    # tile's straight sides land exactly on pixel boundaries.
    body = tile(n, (scaled[0], scaled[1], scaled[2] - 1, scaled[3] - 1), radius * SCALE, shadow)
    return body.resize((size, size), Image.LANCZOS)


def app_icon(size):
    """macOS icon grid: an 824 of 1024 px rounded square with a drop shadow."""
    box, cell, origin = layout(size, size * 824 / 1024, APP_SHARE)
    side = box[2] - box[0]
    image = tile_image(size, box, side * 185 / 824, shadow=True)
    return draw_glyph(image, cell, origin, glow=size >= 128)


def interface_mark(size):
    """Interface tile: nearly full bleed, no shadow, a heavier glyph."""
    box, cell, origin = layout(size, size * 0.94, INTERFACE_SHARE)
    side = box[2] - box[0]
    image = tile_image(size, box, side * 0.245, shadow=False)
    return draw_glyph(image, cell, origin, glow=size >= 128)


def glyph_layer(size):
    """Icon Composer layer: the glyph alone; icon.json supplies the fill.

    Icon Composer's canvas is the whole tile, so the A takes the same share
    of the canvas as it takes of the tile in the app icon.
    """
    _, cell, origin = layout(size, size, APP_SHARE)
    return draw_glyph(Image.new("RGBA", (size, size), (0, 0, 0, 0)), cell, origin)


def glyph_path(mark, dx=0, dy=0):
    """Cells of one colour as an SVG path of unit squares, one run per row."""
    path = ""
    for y, cells in enumerate(PIXEL_A):
        x = 0
        while x < len(cells):
            if cells[x] != mark:
                x += 1
                continue
            run = 1
            while x + run < len(cells) and cells[x + run] == mark:
                run += 1
            path += f"M{x + dx} {y + dy}h{run}v1h-{run}z"
            x += run
    return path


def fallback_svg():
    """The browser's fallback tab icon, shown at 14 px with one-pixel cells.

    A 7-cell A cannot centre on whole pixels in an even tile, so the tile is
    13 px in the corner of the 14 px box: every edge and cell then lands on a
    whole pixel at 1x as well as 2x, and the A sits half a pixel high.
    """
    hex_color = "#{:02x}{:02x}{:02x}".format
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'
        '<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{hex_color(*TOP)}"/>'
        f'<stop offset="1" stop-color="{hex_color(*BOTTOM)}"/>'
        "</linearGradient></defs>"
        '<rect width="13" height="13" rx="3.2" fill="url(#t)"/>'
        '<g shape-rendering="crispEdges" transform="translate(3 2)">'
        f'<path fill="{hex_color(*WHITE[:3])}" d="{glyph_path("#")}"/>'
        f'<path fill="{hex_color(*BLUE[:3])}" d="{glyph_path("B")}"/>'
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
