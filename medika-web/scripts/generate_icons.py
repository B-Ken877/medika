#!/usr/bin/env python3
"""Generate Medika PWA icons (regular + maskable) with Pillow.

Brand: Medika green #16A34A background, white medical cross,
rounded square for 'any' purpose, full-bleed for 'maskable'.
"""
from PIL import Image, ImageDraw

GREEN = (22, 163, 74, 255)        # #16A34A Medika primary
GREEN_DARK = (13, 122, 53, 255)   # #0D7A35 shade
WHITE = (255, 255, 255, 255)

OUT = "/home/z/my-project/medika/medika-web/public/icons"


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_cross(draw, cx, cy, arm_w, arm_h, fill):
    """Draw a plus-sign centered at (cx, cy)."""
    draw.rounded_rectangle(
        [cx - arm_w / 2, cy - arm_h / 2, cx + arm_w / 2, cy + arm_h / 2],
        radius=arm_w * 0.18,
        fill=fill,
    )
    draw.rounded_rectangle(
        [cx - arm_h / 2, cy - arm_w / 2, cx + arm_h / 2, cy + arm_w / 2],
        radius=arm_w * 0.18,
        fill=fill,
    )


def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        # Full-bleed background (safe zone = inner 80%)
        draw.rectangle([0, 0, size, size], fill=GREEN)
        # subtle darker corner accent for depth
        draw.pieslice([size * 0.55, size * 0.55, size * 1.35, size * 1.35], 0, 90, fill=GREEN_DARK)
        safe = size * 0.8
        cx = cy = size / 2
        cross_size = safe * 0.62
        arm_w = cross_size * 0.38
        draw_cross(draw, cx, cy, arm_w, cross_size, WHITE)
    else:
        # Rounded-square app icon
        margin = size * 0.04
        radius = size * 0.22
        rounded_rect(draw, [margin, margin, size - margin, size - margin], radius, GREEN)
        # darker accent circle, clipped visually inside the rounded rect
        accent_r = size * 0.42
        cx, cy = size * 0.72, size * 0.28
        draw.ellipse(
            [cx - accent_r, cy - accent_r, cx + accent_r, cy + accent_r],
            fill=GREEN_DARK,
        )
        # re-clip to rounded square by drawing the rounded rect outline again
        # (draw accent first, then mask: simpler—redraw rounded rect with alpha)
        mask = Image.new("L", (size, size), 0)
        mdraw = ImageDraw.Draw(mask)
        mdraw.rounded_rectangle(
            [margin, margin, size - margin, size - margin], radius=radius, fill=255
        )
        base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(base)
        rounded_rect(bdraw, [margin, margin, size - margin, size - margin], radius, GREEN)
        bdraw.ellipse(
            [cx - accent_r, cy - accent_r, cx + accent_r, cy + accent_r], fill=GREEN_DARK
        )
        cross_size = size * 0.46
        arm_w = cross_size * 0.36
        draw_cross(bdraw, size / 2, size / 2, arm_w, cross_size, WHITE)
        img = Image.composite(base, img, mask)

    return img


def main():
    for size in (192, 512):
        regular = make_icon(size, maskable=False)
        regular.save(f"{OUT}/icon-{size}.png", optimize=True)
        maskable = make_icon(size, maskable=True)
        maskable.save(f"{OUT}/icon-maskable-{size}.png", optimize=True)
        # favicon-friendly 32px too
        if size == 192:
            regular.resize((32, 32), Image.LANCZOS).save(f"{OUT}/favicon-32.png", optimize=True)
            regular.resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", optimize=True)
    print("Icons generated:", sorted(__import__("os").listdir(OUT)))


if __name__ == "__main__":
    main()
