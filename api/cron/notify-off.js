// 매일 저녁 18:00 KST → 내일 휴무자 조회 → 알리고 친구톡으로 대표 카톡 발송
// Vercel Cron: 0 9 * * * (UTC) = 18:00 KST
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

function kstTomorrow() {
  // 한국시간 기준 내일 (서버는 UTC, KST = UTC+9)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + 1);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendAligoFriendtalk({ message, receiver }) {
  const form = new URLSearchParams();
  form.append('apikey', process.env.ALIGO_API_KEY);
  form.append('userid', process.env.ALIGO_USER_ID);
  form.append('senderkey', process.env.ALIGO_SENDERKEY);
  form.append('sender', process.env.ALIGO_SENDER);
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
  const cronSecret = process.env.CRON_SECRET || '';
  const isCron = cronSecret && auth === `Bearer ${cronSecret}`;
  const isManual = req.query.force === '1';
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'unauthorized — Bearer CRON_SECRET 또는 ?force=1 필요' });
  }

  if (!process.env.ALIGO_API_KEY || !process.env.ALIGO_SENDERKEY || !process.env.ALIGO_SENDER) {
    return res.status(500).json({ error: 'aligo env vars 미설정 (ALIGO_API_KEY/USER_ID/SENDERKEY/SENDER)' });
  }
  const adminPhone = process.env.ADMIN_PHONE || '01057411114';

  const tomorrow = kstTomorrow();

  // 내일 휴무자 = APPROVED + WORK 아닌 모든 타입
  const rows = await sql`
    SELECT a.type, u.name, u.tier
    FROM attendance_records a
    JOIN users u ON u.id = a.user_id
    WHERE a.work_date = ${tomorrow}
      AND a.status = 'APPROVED'
      AND a.type <> 'WORK'
      AND u.name NOT IN ('2','3')
    ORDER BY u.tier ASC, u.name ASC
  `;

  if (!rows.length) {
    return res.status(200).json({ ok: true, tomorrow, count: 0, sent: false, note: '내일 휴무자 없음 — 발송 안 함' });
  }

  // 메시지 작성 — 직원별 [직원명/일자/휴무유형] 카드 형식
  const blocks = rows.map((r,i)=>
    `${i+1}. 직원명: ${r.name}\n   일자: ${tomorrow}\n   휴무유형: ${TYPE_LABEL[r.type] || r.type}`
  );
  const message =
`[티엠컴퍼니 휴무 알림]
총 ${rows.length}명 — ${tomorrow}

${blocks.join('\n\n')}

— 자동 발송 (매일 18:00)`;

  // 알리고 친구톡 발송
  const result = await sendAligoFriendtalk({
    message,
    receiver: adminPhone.replace(/[^0-9]/g, ''),
  });

  return res.status(200).json({
    ok: result.ok && result.body?.code === 0,
    tomorrow,
    count: rows.length,
    sent: true,
    aligo: result.body,
    preview: message,
  });
}
