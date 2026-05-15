// 그 날 휴무자 알림 — 매일 2회 자동 발송 (대표 지시)
//   1) 00:01 KST (15:01 UTC) — 자정 직후 알림
//   2) 07:30 KST (22:30 UTC) — 출근 전 리마인드
// 둘 다 같은 날(KST 기준 오늘) 휴무자 조회 → 알리고 친구톡 → 대표 카톡
// 친구톡 실패 시 알리고가 SMS 폴백 (자동)

import { sql } from '../_db.js';

const TYPE_LABEL = {
  OFF: '휴무',
  HALF_AM: '오전반차',
  HALF_PM: '오후반차',
  MONTHLY: '월차',
  ANNUAL: '연차',
  SICK: '병가',
  HOLIDAY: '공휴일',
  UNAUTHORIZED: '무단결근',
};

function kstToday() {
  // 한국시간 기준 오늘 (서버는 UTC, KST = UTC+9)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 알리고 자격증명 — env 우선, 없으면 하드코딩 폴백 (대표 지시: 환경변수 등록 대기 X, 당장 가동)
const ALIGO = {
  apikey:    process.env.ALIGO_API_KEY   || 'pw8x8s9kajo31bcd96nv2os4bkqcl1wf',
  userid:    process.env.ALIGO_USER_ID   || 'tami98',
  senderkey: process.env.ALIGO_SENDERKEY || '422ebc0f44745b54bc7caf91696161873f4690b4',
  sender:    process.env.ALIGO_SENDER    || '18009678',
  admin:     process.env.ADMIN_PHONE     || '01057411114',
  cron:      process.env.CRON_SECRET     || 'c93513d3de07036d44106e7148bceaedd417074b544cbd259d409b52d892ebed',
};

async function sendAligoFriendtalk({ message, receiver }) {
  const form = new URLSearchParams();
  form.append('apikey', ALIGO.apikey);
  form.append('userid', ALIGO.userid);
  form.append('senderkey', ALIGO.senderkey);
  form.append('sender', ALIGO.sender);
  form.append('receiver_1', receiver);
  form.append('subject_1', '내일 휴무자 알림');
  form.append('message_1', message);
  form.append('failover', 'Y'); // 친구톡 실패 시 SMS 자동 폴백
  form.append('fsubject_1', '내일 휴무자');
  form.append('fmessage_1', message);
  form.append('testmode_yn', 'N');

  const res = await fetch('https://kakaoapi.aligo.in/akv10/friendtalk/send/', {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json };
}

export default async function handler(req, res) {
  // Vercel Cron 만 호출 가능 (Authorization: Bearer CRON_SECRET)
  // 수동 테스트도 같은 헤더로 가능 (?force=1 도 허용)
  const auth = req.headers.authorization || '';
  const isCron = auth === `Bearer ${ALIGO.cron}`;
  const isManual = req.query.force === '1';
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'unauthorized — Bearer CRON_SECRET 또는 ?force=1 필요' });
  }
  const adminPhone = ALIGO.admin;

  const today = kstToday();

  // 오늘 휴무자 = APPROVED + WORK 아닌 모든 타입
  const rows = await sql`
    SELECT a.type, u.name, u.tier
    FROM attendance_records a
    JOIN users u ON u.id = a.user_id
    WHERE a.work_date = ${today}
      AND a.status = 'APPROVED'
      AND a.type <> 'WORK'
      AND u.name NOT IN ('2','3')
    ORDER BY u.tier ASC, u.name ASC
  `;

  if (!rows.length) {
    return res.status(200).json({ ok: true, date: today, count: 0, sent: false, note: '오늘 휴무자 없음 — 발송 안 함' });
  }

  // 메시지 작성 — 직원별 [직원명/일자/휴무유형] 카드 형식
  const blocks = rows.map((r,i)=>
    `${i+1}. 직원명: ${r.name}\n   일자: ${today}\n   휴무유형: ${TYPE_LABEL[r.type] || r.type}`
  );
  const message =
`[티엠컴퍼니 휴무 알림]
총 ${rows.length}명 — ${today}

${blocks.join('\n\n')}

— 자동 발송 (매일 00:01 / 07:30)`;

  // 알리고 친구톡 발송
  const result = await sendAligoFriendtalk({
    message,
    receiver: adminPhone.replace(/[^0-9]/g, ''),
  });

  return res.status(200).json({
    ok: result.ok && result.body?.code === 0,
    date: today,
    count: rows.length,
    sent: true,
    aligo: result.body,
    preview: message,
  });
}
