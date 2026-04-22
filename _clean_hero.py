"""
Cleanly remove text from hero_new.jpg.
Approach: per-row gradient interpolation from LEFT+RIGHT clean edges, then
heavy feathered blur composite to make patch undetectable.
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = "iihjhjhjhj_src.jpg"
DST = "hero_new.jpg"

im = Image.open(SRC).convert("RGB")
W, H = im.size
print("size:", W, H)
px = im.load()

def sample_row(y, x0, x1):
    rs = gs = bs = n = 0
    for x in range(x0, x1):
        r, g, b = px[x, y]
        rs += r; gs += g; bs += b; n += 1
    return (rs / n, gs / n, bs / n)

# Build per-row LEFT and RIGHT background colors
# Clean strips: x=10..70 on left, x=920..980 on right (away from any text/phones)
left_col = [sample_row(y, 10, 70) for y in range(H)]
right_col = [sample_row(y, 920, 980) for y in range(H)]

draw = ImageDraw.Draw(im)

def fill_text_region(y0, y1, x0, x1):
    """Fill rectangle with per-row, per-x interpolated background color."""
    for y in range(y0, y1):
        if y < 0 or y >= H: continue
        lr, lg, lb = left_col[y]
        rr, rg, rb = right_col[y]
        for x in range(x0, x1):
            t = (x - x0) / max(1, (x1 - x0))
            r = int(lr + (rr - lr) * t)
            g = int(lg + (rg - lg) * t)
            b = int(lb + (rb - lb) * t)
            draw.point((x, y), fill=(r, g, b))

# TOP wording block (Galaxy S26 Series + Galaxy AI + 사전판매 + dates)
# generous margins to fully cover text + dot decorations
fill_text_region(28, 200, 230, 770)

# BOTTOM small disclaimer (2 tiny lines)
fill_text_region(525, H, 305, 705)

# Heavy feathered blend so the patches disappear into the gradient
mask = Image.new("L", im.size, 0)
md = ImageDraw.Draw(mask)
# Top mask, slightly larger than fill region, then blur for soft feather
md.rectangle([220, 18, 780, 210], fill=255)
md.rectangle([295, 520, 715, H], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(radius=18))

blurred = im.filter(ImageFilter.GaussianBlur(radius=12))
im = Image.composite(blurred, im, mask)

im.save(DST, "JPEG", quality=94)
print("saved:", DST)
