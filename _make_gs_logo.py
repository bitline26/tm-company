from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = "/Users/young/Desktop"
MARK = "GS"
WORD = "galaxysale"
PINK = (229, 66, 144, 255)  # #E54290

FONT_CANDIDATES = [
    ("/System/Library/Fonts/HelveticaNeue.ttc", 8),
    ("/System/Library/Fonts/HelveticaNeue.ttc", 3),
    ("/System/Library/Fonts/Helvetica.ttc", 1),
]


def load_font(size: int):
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


def render_vertical(color, out_name: str):
    mark_fs = 1800
    word_fs = 360
    gap = 80
    pad = 120

    mark_font = load_font(mark_fs)
    word_font = load_font(word_fs)

    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    m = d.textbbox((0, 0), MARK, font=mark_font)
    w = d.textbbox((0, 0), WORD, font=word_font)
    m_w, m_h = m[2] - m[0], m[3] - m[1]
    w_w, w_h = w[2] - w[0], w[3] - w[1]

    W = max(m_w, w_w) + pad * 2
    H = pad + m_h + gap + w_h + pad
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.text(((W - m_w) // 2 - m[0], pad - m[1]), MARK, font=mark_font, fill=color)
    dr.text(((W - w_w) // 2 - w[0], pad + m_h + gap - w[1]), WORD, font=word_font, fill=color)

    out = os.path.join(OUT_DIR, out_name)
    img.save(out, "PNG")
    print(f"saved: {out}  ({W}x{H})")


def render_horizontal(color, out_name: str):
    mark_fs = 1600
    word_fs = 900
    gap = 120
    pad = 120

    mark_font = load_font(mark_fs)
    word_font = load_font(word_fs)

    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    m = d.textbbox((0, 0), MARK, font=mark_font)
    w = d.textbbox((0, 0), WORD, font=word_font)
    m_w, m_h = m[2] - m[0], m[3] - m[1]
    w_w, w_h = w[2] - w[0], w[3] - w[1]

    content_h = max(m_h, w_h)
    W = pad + m_w + gap + w_w + pad
    H = pad + content_h + pad
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)

    dr.text((pad - m[0], pad + (content_h - m_h) // 2 - m[1]), MARK, font=mark_font, fill=color)
    dr.text((pad + m_w + gap - w[0], pad + content_h - w_h - w[1]), WORD, font=word_font, fill=color)

    out = os.path.join(OUT_DIR, out_name)
    img.save(out, "PNG")
    print(f"saved: {out}  ({W}x{H})")


if __name__ == "__main__":
    render_vertical(PINK, "GS_pink_vertical.png")
    render_horizontal(PINK, "GS_pink_horizontal.png")
