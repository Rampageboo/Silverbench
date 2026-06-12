"""Generate raster app icons from the vector design for Qt / OS shortcuts."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets"


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _gradient_color(t: float) -> tuple[int, int, int]:
    return (
        int(_lerp(0x1D, 0x0F, t)),
        int(_lerp(0x4E, 0x76, t)),
        int(_lerp(0xD8, 0x6E, t)),
    )


def _i(value: float) -> int:
    return int(round(value))


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = size * 0.0625
    radius = size * 0.1875

    for y in range(size):
        for x in range(size):
            if x < pad or y < pad or x > size - pad or y > size - pad:
                continue
            t = (x + y) / (2 * (size - 1))
            r, g, b = _gradient_color(t)
            img.putpixel((x, y), (r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((_i(pad), _i(pad), _i(size - pad), _i(size - pad)), radius=_i(radius), fill=255)
    img.putalpha(mask)

    stroke = max(2, round(size * 0.039))
    box = (
        size * 0.234,
        size * 0.266,
        size * 0.766,
        size * 0.672,
    )
    draw.rounded_rectangle(
        tuple(_i(v) for v in box),
        radius=_i(size * 0.047),
        outline=(255, 255, 255, 255),
        width=stroke,
    )

    cx = size * 0.5
    cy = size * 0.469
    r = size * 0.039
    draw.ellipse((_i(cx - r), _i(cy - r), _i(cx + r), _i(cy + r)), fill=(255, 255, 255, 255))
    cross = max(1, _i(size * 0.027))
    draw.line((_i(cx), _i(cy - size * 0.094), _i(cx), _i(cy + size * 0.094)), fill=(255, 255, 255, 255), width=cross)
    draw.line((_i(cx - size * 0.094), _i(cy), _i(cx + size * 0.094), _i(cy)), fill=(255, 255, 255, 255), width=cross)

    handle = size * 0.039
    for hx, hy, color in (
        (box[0], box[1], (147, 197, 253, 255)),
        (box[2], box[1], (147, 197, 253, 255)),
        (box[0], box[3], (94, 234, 212, 255)),
        (box[2], box[3], (94, 234, 212, 255)),
    ):
        draw.ellipse((_i(hx - handle), _i(hy - handle), _i(hx + handle), _i(hy + handle)), fill=color)

    bar_y = size * 0.766
    draw.rounded_rectangle(
        (_i(size * 0.266), _i(bar_y), _i(size * 0.734), _i(bar_y + size * 0.031)),
        radius=_i(size * 0.016),
        fill=(219, 234, 254, 230),
    )
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [draw_icon(size) for size in sizes]
    png_path = OUT_DIR / "app-icon.png"
    ico_path = OUT_DIR / "app-icon.ico"
    images[-1].save(png_path, format="PNG")
    images[-1].save(
        ico_path,
        format="ICO",
        sizes=[(size, size) for size in sizes],
    )
    print(f"Wrote {png_path}")
    print(f"Wrote {ico_path}")


if __name__ == "__main__":
    main()
