"""Strict char-count for Google Ads sitelinks (text<=25, desc1/2<=35)."""

LANDING = "https://galaxysale.co.kr/apply_google_kpi/"
LANDING_FORM = "https://galaxysale.co.kr/apply_google_kpi/#apply"

SITELINKS = [
    # (사이트링크 텍스트<=25, 내용1<=35, 내용2<=35, 최종URL)
    ("갤럭시 S26 단독특가",
     "출고가 1,254,000원→22,000원",
     "이통3사 공식 · 익일 상담 마감임박",
     LANDING),

    ("갤S26 Ultra 350,000원",
     "1,447,000원 빠짐 80% 단독최저가",
     "이통3사 공식 정식 대리점 정식 개통",
     LANDING),

    ("S26+ 단독 180,000원",
     "출고가 1,452,000원→180,000원",
     "1,272,000원 절약 88% 단독특판가",
     LANDING),

    ("이통3사 공식 정식 개통",
     "SKT·KT·LGU+ 공식 정식 판매점",
     "정식 대리점 정식 개통 보장",
     LANDING),

    ("사전예약 신청하기",
     "이름·연락처만 남기면 신청 완료",
     "익일 전담 상담사 연락 드림",
     LANDING_FORM),

    ("마감임박 단독특판가",
     "선착순 한정 · 조기종료 가능",
     "오늘 접수분만 단독혜택 적용",
     LANDING),
]


def report():
    print(f"\nLanding URL: {LANDING}")
    print(f"Form URL   : {LANDING_FORM}\n")
    over = 0
    for i, (t, d1, d2, u) in enumerate(SITELINKS, 1):
        nt, n1, n2 = len(t), len(d1), len(d2)
        ok = (nt <= 25) and (n1 <= 35) and (n2 <= 35)
        print(f"[Sitelink {i}]")
        flag = "OK" if nt <= 25 else f"OVER+{nt-25}"
        print(f"  텍스트 [{nt:>2}/25] {flag}  {t}")
        flag = "OK" if n1 <= 35 else f"OVER+{n1-35}"
        print(f"  내용1  [{n1:>2}/35] {flag}  {d1}")
        flag = "OK" if n2 <= 35 else f"OVER+{n2-35}"
        print(f"  내용2  [{n2:>2}/35] {flag}  {d2}")
        print(f"  URL    {u}")
        print()
        if not ok:
            over += 1
    print(f"-- {over} over-limit --")


report()
