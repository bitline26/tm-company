from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import os

SRC = r"C:/Users/user/.claude/image-cache/10a8b798-6249-4048-9923-1c51b30ea08f/1.png"
OUT_DIR = r"C:/Users/user/Desktop"

BOLD = r"C:/Windows/Fonts/malgunbd.ttf"
REG  = r"C:/Windows/Fonts/malgun.ttf"

BLUE = (20, 40, 160)
RED  = (229, 57, 53)
DARK = (17, 17, 17)
WHITE = (255, 255, 255)
GREY = (136, 136, 136)
CREAM = (245, 242, 236)


def f(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size)


def text_w(draw, txt, font):
    b = draw.textbbox((0, 0), txt, font=font)
    return b[2] - b[0], b[3] - b[1]


def fit_cover(img, tw, th):
    iw, ih = img.size
    rs = max(tw / iw, th / ih)
    nw, nh = int(iw * rs), int(ih * rs)
    img = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return img.crop((x, y, x + tw, y + th))


def fit_contain(img, tw, th, bg=CREAM):
    iw, ih = img.size
    rs = min(tw / iw, th / ih)
    nw, nh = int(iw * rs), int(ih * rs)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (tw, th), bg)
    canvas.paste(img, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def rounded_rect(draw, xy, r, fill):
    draw.rounded_rectangle(xy, radius=r, fill=fill)


def drop_gradient_bottom(base, height, color=(0, 0, 0), max_alpha=140):
    W, H = base.size
    grad = Image.new("L", (1, height), 0)
    for y in range(height):
        grad.putpixel((0, y), int(max_alpha * (y / height)))
    grad = grad.resize((W, height))
    overlay = Image.new("RGBA", (W, height), color + (0,))
    overlay.putalpha(grad)
    base = base.convert("RGBA")
    base.alpha_composite(overlay, (0, H - height))
    return base.convert("RGB")


# ============================================================
# 소재 A — 피드 광고 1080 x 1350 (4:5)
# 상단 카피 + 인물 이미지 + 하단 가격 밴드 + CTA
# ============================================================
def make_feed():
    W, H = 1080, 1350
    src = Image.open(SRC).convert("RGB")

    # 인물 이미지는 상단 2/3 영역에 배치 (905px), 하단 445px은 가격/CTA 밴드
    IMG_H = 905
    img_area = fit_cover(src, W, IMG_H)

    canvas = Image.new("RGB", (W, H), WHITE)
    canvas.paste(img_area, (0, 0))

    # 상단 카피 오버레이 (인물 이미지 위)
    canvas = canvas.convert("RGB")
    # 상단 그라디언트 (텍스트 가독성)
    top_band = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
    for y in range(240):
        a = int(110 * (1 - y / 240))
        for x in range(W):
            top_band.putpixel((x, y), (0, 0, 0, a))
    top_band = Image.new("L", (1, 240), 0)
    for y in range(240):
        top_band.putpixel((0, y), int(130 * (1 - y / 240)))
    top_band = top_band.resize((W, 240))
    ov = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
    ov.putalpha(top_band)
    c2 = canvas.convert("RGBA")
    c2.alpha_composite(ov, (0, 0))
    canvas = c2.convert("RGB")

    d = ImageDraw.Draw(canvas)

    # 상단 뱃지
    badge = "이통 3사 공식 판매점"
    bf = f(26)
    bw, bh = text_w(d, badge, bf)
    bx, by = 48, 44
    pad = 18
    rounded_rect(d, (bx, by, bx + bw + pad * 2, by + bh + 18), 22, WHITE)
    d.text((bx + pad, by + 6), badge, font=bf, fill=BLUE)

    # 상단 헤드라인
    d.text((48, 110), "대리점 안 가도", font=f(62), fill=WHITE)
    d.text((48, 180), "됩니다.", font=f(62), fill=WHITE)

    # ── 하단 영역 디자인 ──────────────────────────────────
    # 구분 강조 라인
    d.line((0, IMG_H, W, IMG_H), fill=(230, 230, 230), width=1)

    # 메인 가격 블록
    y = IMG_H + 40
    d.text((48, y), "GALAXY  S26  ULTRA", font=f(28), fill=BLUE)
    y += 48
    # 출고가 취소선
    oldp = "출고가 1,797,000원"
    of = f(30, bold=False)
    ow, oh = text_w(d, oldp, of)
    d.text((48, y), oldp, font=of, fill=GREY)
    d.line((48, y + oh // 2 + 4, 48 + ow, y + oh // 2 + 4), fill=GREY, width=2)
    y += 46

    # 특판가 (존나 큼)
    d.text((48, y), "도매특판가", font=f(26), fill=DARK)
    d.text((48, y + 40), "350,000", font=f(118), fill=RED)
    # 원 단위
    wf = f(42)
    d.text((48 + text_w(d, "350,000", f(118))[0] + 14, y + 106), "원", font=wf, fill=RED)
    # 할인 뱃지
    tag_w = 190
    tag_x = W - 48 - tag_w
    tag_y = y + 44
    rounded_rect(d, (tag_x, tag_y, tag_x + tag_w, tag_y + 70), 10, RED)
    d.text((tag_x + 16, tag_y + 14), "1,447,000", font=f(28), fill=WHITE)
    d.text((tag_x + 16, tag_y + 42), "원 할인", font=f(22), fill=WHITE)

    # 하단 미세 고지
    d.text((48, H - 52), "※ 선착순 한정 · 신규 개통 고객 · 조기 마감 가능",
           font=f(20, bold=False), fill=GREY)

    out = os.path.join(OUT_DIR, "TM_광고_01_피드_1080x1350.jpg")
    canvas.save(out, "JPEG", quality=94)
    return out


# ============================================================
# 소재 B — 스토리 / 릴스 1080 x 1920 (9:16)
# ============================================================
def make_story():
    W, H = 1080, 1920
    src = Image.open(SRC).convert("RGB")
    base = fit_cover(src, W, H)
    # 하단 어둡게
    base = drop_gradient_bottom(base, 820, color=(0, 0, 0), max_alpha=200)
    # 상단 살짝
    top = Image.new("L", (1, 300), 0)
    for y in range(300):
        top.putpixel((0, y), int(120 * (1 - y / 300)))
    top = top.resize((W, 300))
    ov = Image.new("RGBA", (W, 300), (0, 0, 0, 0))
    ov.putalpha(top)
    base = base.convert("RGBA")
    base.alpha_composite(ov, (0, 0))
    base = base.convert("RGB")

    d = ImageDraw.Draw(base)

    # 상단 뱃지
    badge = "SKT · KT · LGU+ 공식 특판"
    bf = f(30)
    bw, bh = text_w(d, badge, bf)
    bx, by = 60, 80
    pad = 22
    rounded_rect(d, (bx, by, bx + bw + pad * 2, by + bh + 22), 28, WHITE)
    d.text((bx + pad, by + 8), badge, font=bf, fill=BLUE)

    # 상단 헤드카피
    d.text((60, 170), "한 달 용돈으로", font=f(72), fill=WHITE)
    d.text((60, 250), "S26 울트라.", font=f(72), fill=WHITE)

    # 하단 카피 (가격 강조)
    bottom_y = 1260
    d.text((60, bottom_y), "출고가  1,797,000원", font=f(36, bold=False), fill=(200, 200, 200))
    # 취소선
    ow, _ = text_w(d, "출고가  1,797,000원", f(36, bold=False))
    d.line((60, bottom_y + 22, 60 + ow, bottom_y + 22), fill=(200, 200, 200), width=2)

    d.text((60, bottom_y + 70), "도매특판가", font=f(40), fill=WHITE)
    d.text((60, bottom_y + 130), "350,000원", font=f(160), fill=WHITE)
    d.text((60, bottom_y + 310), "최대 1,447,000원 할인", font=f(44), fill=RED)

    # CTA 버튼
    btn_y = 1740
    btn_x = 60
    btn_w = W - 120
    btn_h = 110
    rounded_rect(d, (btn_x, btn_y, btn_x + btn_w, btn_y + btn_h), 20, BLUE)
    cta = "2분 안에 콜백 받기  ▶"
    cf = f(44)
    cw, ch = text_w(d, cta, cf)
    d.text((btn_x + (btn_w - cw) // 2, btn_y + (btn_h - ch) // 2 - 4),
           cta, font=cf, fill=WHITE)

    out = os.path.join(OUT_DIR, "TM_광고_02_스토리_1080x1920.jpg")
    base.save(out, "JPEG", quality=94)
    return out


# ============================================================
# 소재 C — 썸네일 배너 1080 x 1080 (1:1, 카톡/네이버 카페/배너용)
# 좌측: 인물 / 우측: 가격 큰 블록
# ============================================================
def make_square():
    W, H = 1080, 1080
    src = Image.open(SRC).convert("RGB")

    # 좌측 절반에 인물
    LW = 560
    left = fit_cover(src, LW, H)

    canvas = Image.new("RGB", (W, H), WHITE)
    canvas.paste(left, (0, 0))

    d = ImageDraw.Draw(canvas)

    # 우측 텍스트 블록
    x0 = LW + 50
    d.text((x0, 90), "갤럭시 S26 울트라", font=f(36), fill=DARK)
    d.text((x0, 140), "도매 특판 공개", font=f(36), fill=BLUE)

    # 구분선
    d.line((x0, 210, W - 60, 210), fill=(230, 230, 230), width=2)

    # 출고가 취소
    old = "출고가 1,797,000원"
    of = f(28, bold=False)
    ow, oh = text_w(d, old, of)
    d.text((x0, 250), old, font=of, fill=GREY)
    d.line((x0, 250 + oh // 2 + 4, x0 + ow, 250 + oh // 2 + 4), fill=GREY, width=2)

    # 특판가
    d.text((x0, 310), "특판가", font=f(30), fill=DARK)
    d.text((x0, 360), "350,000원", font=f(88), fill=RED)

    # 할인액 하이라이트 박스
    box_y = 500
    box_h = 150
    rounded_rect(d, (x0, box_y, W - 60, box_y + box_h), 14, (255, 241, 240))
    d.text((x0 + 24, box_y + 22), "할인액", font=f(26), fill=DARK)
    d.text((x0 + 24, box_y + 60), "1,447,000원", font=f(54), fill=RED)

    # 중간 혜택
    y2 = 690
    d.text((x0, y2), "· 이통 3사 공식 판매점", font=f(24), fill=DARK)
    d.text((x0, y2 + 40), "· 당일 상담 → 당일 개통", font=f(24), fill=DARK)
    d.text((x0, y2 + 80), "· 버즈4·충전기·케이스 증정", font=f(24), fill=DARK)

    # CTA
    btn_y = 860
    btn_h = 110
    rounded_rect(d, (x0, btn_y, W - 60, btn_y + btn_h), 16, BLUE)
    cta = "단독특가 신청 ▶"
    cf = f(40)
    cw, ch = text_w(d, cta, cf)
    d.text((x0 + ((W - 60 - x0) - cw) // 2, btn_y + (btn_h - ch) // 2 - 4),
           cta, font=cf, fill=WHITE)

    # 하단 고지
    d.text((x0, H - 40), "※ 선착순 한정 · 조기 마감",
           font=f(18, bold=False), fill=GREY)

    out = os.path.join(OUT_DIR, "TM_광고_03_썸네일_1080x1080.jpg")
    canvas.save(out, "JPEG", quality=94)
    return out


if __name__ == "__main__":
    r1 = make_feed()
    r2 = make_story()
    r3 = make_square()
    print("DONE")
    print(r1)
    print(r2)
    print(r3)
