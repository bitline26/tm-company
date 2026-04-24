"""
캠페인 2개 랜딩 + 어드민 생성:
  /apply_google_kpi/     → key=tm_inq_google_kpi      / admin=/admin_google_kpi/
  /apply_google_demand/  → key=tm_inq_google_demand   / admin=/admin_google_demand/
assets 경로: ../xxx (루트 자산 참조). 기존 plus/index.html 그대로 유지 베이스.
"""
import os, re, shutil

ROOT = r"C:/Users/user/Desktop/TM COMPANY"
PLUS_SRC = os.path.join(ROOT, "plus", "index.html")
ADMIN_SRC = os.path.join(ROOT, "admin", "index.html")

CAMPAIGNS = [
    {
        "slug": "google_kpi",
        "title_suffix": "· Google KPI",
        "storage_key": "tm_inq_google_kpi",
        "session_key": "tm_admin_google_kpi",
        "admin_user": "admin",
        "admin_pass": "kpi2025!",
    },
    {
        "slug": "google_demand",
        "title_suffix": "· Google Demand",
        "storage_key": "tm_inq_google_demand",
        "session_key": "tm_admin_google_demand",
        "admin_user": "admin",
        "admin_pass": "demand2025!",
    },
]

with open(PLUS_SRC, "r", encoding="utf-8") as f:
    LANDING_BASE = f.read()

with open(ADMIN_SRC, "r", encoding="utf-8") as f:
    ADMIN_BASE = f.read()


def build_landing(camp):
    html = LANDING_BASE
    # 저장 키 교체: localStorage 'tm_inquiries' → 캠페인 키
    html = html.replace("'tm_inquiries'", f"'{camp['storage_key']}'")
    # 사이드 타이틀에 캠페인 표식
    html = html.replace(
        "<title>", f"<!-- campaign:{camp['slug']} -->\n<title>"
    )
    return html


def build_admin(camp):
    html = ADMIN_BASE
    # 저장 키 교체
    html = html.replace("'tm_inquiries'", f"'{camp['storage_key']}'")
    # 세션 키 교체 (어드민끼리 세션 공유 방지)
    html = html.replace(
        "var SESSION_KEY = 'tm_admin_session';",
        f"var SESSION_KEY = '{camp['session_key']}';",
    )
    # 계정/비번 교체
    html = re.sub(
        r"var ACCOUNTS = \{[^}]*\};",
        "var ACCOUNTS = {'" + camp["admin_user"] + "':'" + camp["admin_pass"] + "'};",
        html,
    )
    # 타이틀에 캠페인 표기
    html = html.replace(
        "TM COMPANY · 어드민",
        f"TM COMPANY {camp['title_suffix']}",
    )
    html = html.replace(
        "TM COMPANY 어드민",
        f"TM COMPANY 어드민 {camp['title_suffix']}",
    )
    # CSV 파일명도 캠페인별로
    html = html.replace(
        "tm_inquiries_",
        f"tm_{camp['slug']}_",
    )
    return html


for camp in CAMPAIGNS:
    # 랜딩
    land_dir = os.path.join(ROOT, f"apply_{camp['slug']}")
    os.makedirs(land_dir, exist_ok=True)
    with open(os.path.join(land_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_landing(camp))
    # 어드민
    adm_dir = os.path.join(ROOT, f"admin_{camp['slug']}")
    os.makedirs(adm_dir, exist_ok=True)
    with open(os.path.join(adm_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_admin(camp))
    print(f"[OK] /apply_{camp['slug']}/  +  /admin_{camp['slug']}/  (key={camp['storage_key']})")

# /plus 삭제
plus_dir = os.path.join(ROOT, "plus")
if os.path.isdir(plus_dir):
    shutil.rmtree(plus_dir)
    print("[DEL] /plus/ 삭제 완료")
else:
    print("[SKIP] /plus/ 없음")
