"""
Hero text removal v4 (new S26 lineup 600x900):
- Remove top wording: "Galaxy S26 Series / Galaxy AI / 사전판매 / 2026년 2월 27일 ~ 3월 5일"
- Remove bottom-left small disclaimer
- Preserve lavender vertical gradient by sampling clean left-edge vertical strip
  and stretching horizontally across the text regions, then feather-blending.
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = "hero_new_original.jpg"
DST = "hero_new.jpg"

im = Image.open(SRC).convert("RGB")
W, H = im.size
print("size:", W, H)

def patch_strip(y0, y1, x0, x1, sx0, sx1):
    """Crop vertical strip (sx0..sx1, y0..y1) and stretch over (x0..x1, y0..y1)."""
    strip = im.crop((sx0, y0, sx1, y1))
    stretched = strip.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    im.paste(stretched, (x0, y0))

def patch_from(y0, y1, x0, x1, src_box):
    """Crop arbitrary source box and stretch over target (x0..x1, y0..y1)."""
    sx0, sy0, sx1, sy1 = src_box
    strip = im.crop((sx0, sy0, sx1, sy1))
    stretched = strip.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    im.paste(stretched, (x0, y0))

# 1) TOP wording region. Image is 600x900.
#    Text spans approximately y=90..300, x=120..490.
#    Sample clean lavender vertical strip from the far LEFT (x=15..95)
#    -> preserves the vertical gradient exactly at each y row.
patch_strip(80, 310, 115, 495, 15, 95)

# (bottom disclaimer removal skipped — user only asked for top wording)

# 3) Soft feathered blend so patch edges disappear into the gradient
mask = Image.new("L", im.size, 0)
md = ImageDraw.Draw(mask)
md.rectangle([113, 78, 497, 312], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(radius=18))

blurred = im.filter(ImageFilter.GaussianBlur(radius=12))
im = Image.composite(blurred, im, mask)

im.save(DST, "JPEG", quality=95)
print("saved:", DST)
