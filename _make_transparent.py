from PIL import Image
import numpy as np

src = r"C:/Users/user/Desktop/소재/OrangeX_로고_검정.png"
dst = r"C:/Users/user/Desktop/OrangeX_로고_흰색_투명.png"

im = Image.open(src).convert("RGBA")
arr = np.array(im).astype(np.float32)

r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]

# 흰 배경 키잉: 어두울수록 불투명
mn = np.minimum(np.minimum(r, g), b)
alpha = 255.0 - mn

# 선명도 강화: 중간 알파 영역을 가파르게 (경계 날카롭게)
a_norm = alpha / 255.0
a_sharp = np.clip((a_norm - 0.15) / (0.85 - 0.15), 0.0, 1.0)
# 감마로 엣지 선명도 + 풀 불투명 영역 확대
a_sharp = np.power(a_sharp, 0.7)
alpha_out = (a_sharp * 255.0).astype(np.uint8)

# 색상은 전부 흰색으로 교체
out = np.zeros_like(arr, dtype=np.uint8)
out[..., 0] = 255
out[..., 1] = 255
out[..., 2] = 255
out[..., 3] = alpha_out

out_img = Image.fromarray(out, mode="RGBA")
out_img.save(dst, "PNG", optimize=True)
print("saved:", dst, out_img.size)
