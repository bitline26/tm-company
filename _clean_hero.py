"""
Remove text from hero_new.jpg by replacing text regions with sampled background gradient.
The image has lavender background with text at top and small disclaimer at bottom.
"""
from PIL import Image, ImageDraw, ImageFilter

src = "hero_new.jpg"
dst = "hero_new.jpg"  # overwrite

im = Image.open(src).convert("RGB")
W, H = im.size
print("size:", W, H)

# Sample background color along the LEFT edge (clean lavender) per row
# We'll patch text regions using a per-row left-edge color (gradient-aware)
def row_color(y, x_sample=20):
    # average a few pixels from a clean area on the LEFT side
    px = im.load()
    rs, gs, bs = 0, 0, 0
    n = 0
    for x in range(10, 35):
        r, g, b = px[x, y]
        rs += r; gs += g; bs += b; n += 1
    return (rs // n, gs // n, bs // n)

draw = ImageDraw.Draw(im)

# TOP text block: y range ~ 40..180, x range ~ 280..720
# Use slightly bigger box to be safe
top_y0, top_y1 = 30, 195
top_x0, top_x1 = 240, 760
for y in range(top_y0, top_y1):
    c = row_color(y)
    draw.line([(top_x0, y), (top_x1, y)], fill=c)

# BOTTOM small disclaimer: y ~ 535..560, x ~ 360..640
bot_y0, bot_y1 = 530, H - 4
bot_x0, bot_x1 = 320, 700
for y in range(bot_y0, bot_y1):
    c = row_color(y)
    draw.line([(bot_x0, y), (bot_x1, y)], fill=c)

# Optional: subtle blur on patched regions to blend
mask = Image.new("L", im.size, 0)
md = ImageDraw.Draw(mask)
md.rectangle([top_x0 - 10, top_y0 - 6, top_x1 + 10, top_y1 + 6], fill=255)
md.rectangle([bot_x0 - 10, bot_y0 - 4, bot_x1 + 10, bot_y1 + 4], fill=255)
blurred = im.filter(ImageFilter.GaussianBlur(radius=8))
im = Image.composite(blurred, im, mask)

im.save(dst, "JPEG", quality=92)
print("saved:", dst)
