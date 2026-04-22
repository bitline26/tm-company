"""
Hero text removal v3:
- Copy clean lavender STRIPS from regions adjacent to the text and stretch across.
- Preserves natural gradient texture (no flat color patches).
- Soft-feather composite blend so patch edges fade out.
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = "iihjhjhjhj_src.jpg"
DST = "hero_new.jpg"

im = Image.open(SRC).convert("RGB")
W, H = im.size
print("size:", W, H)

def patch_strip(y0, y1, x0, x1, sx0, sx1):
    """Crop vertical strip (sx0..sx1, y0..y1) and stretch over (x0..x1, y0..y1)."""
    strip = im.crop((sx0, y0, sx1, y1))
    stretched = strip.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    im.paste(stretched, (x0, y0))

# 1) TOP wording region: y=18..210, x=220..780
#    sample from LEFT clean lavender strip (x=40..200)
patch_strip(18, 212, 220, 780, 40, 200)

# 2) BOTTOM small disclaimer: y=520..H, x=295..715
#    sample from LEFT clean strip below the phones (x=20..200)
patch_strip(520, H, 295, 715, 20, 200)

# 3) Soft feathered blend: blur a copy and composite using a feathered mask
#    so the patch edges disappear into the surrounding gradient.
mask = Image.new("L", im.size, 0)
md = ImageDraw.Draw(mask)
md.rectangle([218, 16, 782, 214], fill=255)
md.rectangle([293, 518, 717, H], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(radius=20))

blurred = im.filter(ImageFilter.GaussianBlur(radius=14))
im = Image.composite(blurred, im, mask)

im.save(DST, "JPEG", quality=95)
print("saved:", DST)
