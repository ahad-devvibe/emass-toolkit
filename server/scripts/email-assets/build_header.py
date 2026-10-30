"""Builds the email header image from the auth panel's chip photo.

Email clients can't apply the CSS masks the web panel uses (AuthLayout.tsx
`chipMask`), so the same look is baked into one JPEG: the panel's navy
gradient with the chip photo fading in from the left and from the top.

    python scripts/email-assets/build_header.py
Writes client/public/email/header.jpg (1200x400, shown at 600x200).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "client/public/auth/chip-background.jpg"
OUT = ROOT / "client/public/email/header.jpg"
WIDTH, HEIGHT = 1200, 400
TOP, BOTTOM = (0x0F, 0x36, 0x78), (0x00, 0x1A, 0x46)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def main() -> None:
    # Panel gradient, top to bottom
    base = Image.new("RGB", (WIDTH, HEIGHT))
    pixels = base.load()
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        color = tuple(round(lerp(TOP[i], BOTTOM[i], t)) for i in range(3))
        for x in range(WIDTH):
            pixels[x, y] = color

    # The chip photo, cover-cropped around 25% / 40% like object-position
    chip = Image.open(SOURCE).convert("RGB")
    scale = max(WIDTH / chip.width, HEIGHT / chip.height)
    chip = chip.resize((round(chip.width * scale), round(chip.height * scale)), Image.LANCZOS)
    left = round((chip.width - WIDTH) * 0.25)
    top = round((chip.height - HEIGHT) * 0.40)
    chip = chip.crop((left, top, left + WIDTH, top + HEIGHT))

    # Mask: 13% -> 100% from top to bottom, times transparent -> opaque from 30% to 90%
    # of the width (later than the panel's 10-69%, so the title on the left stays on navy)
    mask = Image.new("L", (WIDTH, HEIGHT))
    values = mask.load()
    for x in range(WIDTH):
        u = x / (WIDTH - 1)
        across = min(1.0, max(0.0, (u - 0.30) / 0.60))
        for y in range(HEIGHT):
            down = lerp(0.13, 1.0, y / (HEIGHT - 1))
            values[x, y] = round(255 * across * down)

    base.paste(chip, (0, 0), mask)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    base.save(OUT, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
