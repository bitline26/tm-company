from PIL import Image, ImageDraw, ImageFont
import os

TEXT = "GALAXY SALE"
OUT_DIR = "/Users/young/Desktop"

FONT_CANDIDATES = [
    ("/System/Library/Fonts/HelveticaNeue.ttc", 3),
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/System/Library/Fonts/Supplemental/Impact.ttf", 0),
]

def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path, idx in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size, index=idx)
            except Exception:
                try:
                    return ImageFont.truetype(path, size=size)
                except Exception:
                    continue
    return ImageFont.load_default()


def render(color: tuple, out_name: str) -> None:
    size_px = 600
    font = load_font(size_px)

    dummy = Image.new("RGBA", (10, 10))
    draw_d = ImageDraw.Draw(dummy)
    bbox = draw_d.textbbox((0, 0), TEXT, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    pad_x = 80
    pad_y = 60
    W = text_w + pad_x * 2
    H = text_h + pad_y * 2

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.text((pad_x - bbox[0], pad_y - bbox[1]), TEXT, font=font, fill=color)

    out_path = os.path.join(OUT_DIR, out_name)
    img.save(out_path, "PNG")
    print(f"saved: {out_path}  ({W}x{H})")


if __name__ == "__main__":
    render((0, 0, 0, 255), "GalaxySale_black.png")
    render((255, 255, 255, 255), "GalaxySale_white.png")
