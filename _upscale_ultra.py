"""
S26 Ultra 이미지 고해상도화:
- 소스: C:/Users/user/Desktop/WWW.png (562x528)
- Lanczos 3x 업스케일 + 언샤프 마스크로 최상급 선명도
- 흰 배경 → 투명 처리 (flag-img 배경이 #fff라 시각적으론 동일)
- 교체 대상: s26ultra_phone.png
"""
from PIL import Image, ImageFilter
import numpy as np

SRC = r"C:/Users/user/Desktop/WWW.png"
DST = r"C:/Users/user/Desktop/TM COMPANY/s26ultra_phone.png"

im = Image.open(SRC).convert("RGBA")

# 3x Lanczos 업스케일
w, h = im.size
im_big = im.resize((w*3, h*3), Image.LANCZOS)

# 언샤프 마스크로 엣지 선명도 강화
im_sharp = im_big.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=2))

# 흰 배경 투명 처리 (min(RGB) 기반 알파 키잉)
arr = np.array(im_sharp).astype(np.float32)
r, g, b = arr[...,0], arr[...,1], arr[...,2]
mn = np.minimum(np.minimum(r, g), b)
alpha = 255.0 - mn
# 중간 알파 범위 선명하게
a_norm = alpha / 255.0
a_sharp = np.clip((a_norm - 0.08) / (0.92 - 0.08), 0.0, 1.0)
a_sharp = np.power(a_sharp, 0.85)

# unmultiply로 색상 복원
a_safe = np.clip(a_sharp, 1e-6, 1.0)
fg_r = (r - 255.0 * (1.0 - a_safe)) / a_safe
fg_g = (g - 255.0 * (1.0 - a_safe)) / a_safe
fg_b = (b - 255.0 * (1.0 - a_safe)) / a_safe

out = np.zeros_like(arr, dtype=np.uint8)
out[...,0] = np.clip(fg_r, 0, 255)
out[...,1] = np.clip(fg_g, 0, 255)
out[...,2] = np.clip(fg_b, 0, 255)
out[...,3] = (a_sharp * 255).astype(np.uint8)

out_img = Image.fromarray(out, mode="RGBA")
out_img.save(DST, "PNG", optimize=True)
print("saved:", DST, out_img.size)
