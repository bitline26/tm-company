"""hero_new.jpg에서 흰 글자 디스클레이머 2개 영역(상단 좌측 / 하단 좌측) 깔끔하게 제거.
주변 라벤더 그라데이션 패턴을 그대로 복제해서 자연스럽게 덮음."""
from PIL import Image, ImageFilter

src = Image.open('hero_new.jpg').convert('RGB')
W, H = src.size  # 600x900

# === 1) 상단 좌측 텍스트 영역 ===
# 텍스트 위치 (대략): y=140~200, x=10~230
# 위쪽(y=20~80)에서 깨끗한 라벤더 영역 가져와 복제
top_text_box = (0, 130, 260, 215)  # 살짝 여유
clean_top_src = src.crop((0, 30, 260, 115))  # 같은 x, 위쪽 클린 영역 (높이 85)
# top_text_box 높이는 215-130=85 → 같음
src.paste(clean_top_src, (top_text_box[0], top_text_box[1]))

# === 2) 하단 좌측 텍스트 영역 ===
# 텍스트 위치 (대략): y=830~890, x=10~220
# 위쪽(y=720~780)에서 클린 라벤더 가져와 복제 (단, 폰 그림자가 안 들어갈 영역)
# 하단 왼쪽 끝부분은 폰이 거의 끝나는 부분이라 라벤더가 보임
bot_text_box = (0, 825, 250, 895)  # 70픽셀 높이
clean_bot_src = src.crop((0, 745, 250, 815))  # 위쪽 70픽셀
src.paste(clean_bot_src, (bot_text_box[0], bot_text_box[1]))

# 살짝 블러 처리해서 경계 부드럽게 (선택)
# 페이스트 경계가 너무 또렷하면 블렌딩
# (라벤더 그라데이션이라 큰 차이 없음)

src.save('hero_new.jpg', 'JPEG', quality=92, optimize=True)
print('hero_new.jpg cleaned')
