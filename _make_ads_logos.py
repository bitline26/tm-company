"""Tight Google Ads logos (square + landscape) + site header logo."""
from PIL import Image
import os

ROOT = "/Users/young/Desktop/TM COMPANY"
SRC_VERT = os.path.join(ROOT, "소재", "GS_black.png")
SRC_HORIZ = os.path.join(ROOT, "소재", "GS_horizontal_black.png")

OUT_SQUARE = os.path.join(ROOT, "gs_logo_square.png")           # 1200x1200
OUT_LAND = os.path.join(ROOT, "gs_logo_landscape.png")          # 1200x300
OUT_HEADER = os.path.join(ROOT, "gs_logo_header.png")           # site top use


def fit_tight(src_path: str, target_w: int, target_h: int, pad_ratio: float) -> Image.Image:
    src = Image.open(src_path).convert("RGBA")
    avail_w = int(target_w * (1 - 2 * pad_ratio))
    avail_h = int(target_h * (1 - 2 * pad_ratio))
    sw, sh = src.size
    scale = min(avail_w / sw, avail_h / sh)
    new_w, new_h = int(sw * scale), int(sh * scale)
    resized = src.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2), resized)
    return canvas


def main():
    # Square 1:1 — tight (pad 5%)
    sq = fit_tight(SRC_VERT, 1200, 1200, pad_ratio=0.05)
    sq.save(OUT_SQUARE, "PNG")
    print(f"saved: {OUT_SQUARE}  {sq.size}")

    # Landscape 4:1 — tight (pad 5%)
    land = fit_tight(SRC_HORIZ, 1200, 300, pad_ratio=0.05)
    land.save(OUT_LAND, "PNG")
    print(f"saved: {OUT_LAND}  {land.size}")

    # Header for site top — 600 x 150 (4:1) with breathable padding
    head = fit_tight(SRC_HORIZ, 600, 150, pad_ratio=0.10)
    head.save(OUT_HEADER, "PNG")
    print(f"saved: {OUT_HEADER}  {head.size}")


if __name__ == "__main__":
    main()
