// 알리고 친구톡 발송 공유 모듈
// 사용처:
//   1) api/cron/notify-off.js — 매일 00:01 / 07:30 KST 정기 발송
//   2) api/att/request.js     — 휴무 등록 즉시 발송
//   3) api/att/approve.js     — 휴무 승인 즉시 발송
// ADMIN_PHONE 은 콤마 구분 다중 번호 지원 ("01057411114,01043008739")

export const TYPE_LABEL = {
  OFF: '휴무',
  HALF_AM: '오전반차',
  HALF_PM: '오후반차',
  MONTHLY: '월차',
  ANNUAL: '연차',
  SICK: '병가',
  HOLIDAY: '공휴일',
  UNAUTHORIZED: '무단결근',
  WORK: '근무',
};

export const ALIGO = {
  apikey:    process.env.ALIGO_API_KEY   || 'pw8x8s9kajo31bcd96nv2os4bkqcl1wf',
  userid:    process.env.ALIGO_USER_ID   || 'tami98',
  senderkey: process.env.ALIGO_SENDERKEY || '422ebc0f44745b54bc7caf91696161873f4690b4',
  sender:    process.env.ALIGO_SENDER    || '18009678',
  // 대표 폰 + 테스트 폰(010-4300-8739) 동시 발송 — 대표 지시
  admin:     process.env.ADMIN_PHONE     || '01057411114,01043008739',
  cron:      process.env.CRON_SECRET     || 'c93513d3de07036d44106e7148bceaedd417074b544cbd259d409b52d892ebed',
};

export function adminReceivers() {
  return String(ALIGO.admin || '')
    .split(/[,\s]+/)
    .map(s => s.replace(/[^0-9]/g, ''))
    .filter(s => s.length >= 10);
}

export function kstToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendOne({ message, receiver, subject }) {
  const form = new URLSearchParams();
  form.append('apikey', ALIGO.apikey);
  form.append('userid', ALIGO.userid);
  form.append('senderkey', ALIGO.senderkey);
  form.append('sender', ALIGO.sender);
  form.append('receiver_1', receiver);
  form.append('subject_1', subject);
  form.append('message_1', message);
  form.append('failover', 'Y'); // 친구톡 실패 시 SMS 자동 폴백
  form.append('fsubject_1', subject);
  form.append('fmessage_1', message);
  form.append('testmode_yn', 'N');

  const res = await fetch('https://kakaoapi.aligo.in/akv10/friendtalk/send/', {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { receiver, status: res.status, ok: res.ok, body: json };
}

// 다중 수신자 발송 — ADMIN_PHONE 콤마 구분 모두에 1건씩 전송
export async function sendAdminFriendtalk({ message, subject }) {
  const receivers = adminReceivers();
  if (!receivers.length) return { ok: false, error: 'no-admin-phone', sent: [] };
  const results = await Promise.all(
    receivers.map(r => sendOne({ message, receiver: r, subject }))
  );
  const okAll = results.every(r => r.ok && r.body?.code === 0);
  return { ok: okAll, sent: results };
}

// 휴무자 1건 메시지 ([티엠컴퍼니 휴무 알림] — 직원명/일자/휴무유형 카드)
export function buildOffMessage({ rows, date, header }) {
  const blocks = rows.map((r, i) =>
    `${i+1}. 직원명: ${r.name}\n   일자: ${date}\n   휴무유형: ${TYPE_LABEL[r.type] || r.type}`
  );
  const title = header || '[티엠컴퍼니 휴무 알림]';
  return `${title}
총 ${rows.length}명 — ${date}

${blocks.join('\n\n')}

— 자동 발송`;
}

// 단일 휴무 즉시 알림 (등록/승인 시점)
// kind: 'REGISTERED' | 'APPROVED' | 'REJECTED'
export function buildSingleOffMessage({ name, date, type, kind }) {
  const label = TYPE_LABEL[type] || type;
  const head =
    kind === 'APPROVED'  ? '[티엠컴퍼니 휴무 승인]' :
    kind === 'REJECTED'  ? '[티엠컴퍼니 휴무 반려]' :
                           '[티엠컴퍼니 휴무 등록]';
  return `${head}
직원명: ${name}
일자: ${date}
휴무유형: ${label}

— 자동 발송 (등록·승인 즉시)`;
}
