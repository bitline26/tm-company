// 알리고 SMS/LMS 발송 공유 모듈
// 알리고가 친구톡 자유메시지 API(/akv10/friendtalk/send/) 폐기 → 404
// 대체: SMS/LMS (/send/) 로 우선 발송. 같은 apikey/userid/sender 재사용.
// 카톡으로 보내려면 알리고 콘솔에서 브랜드메시지 템플릿 등록 후 별도 작업.
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

// 대표 지시 (2026-05-17): 알림 SMS 는 010-4300-8739 한 번호로만 발송.
// 다른 어떤 번호(01057411114 / 01057551630 등)도 발송 금지.
// ADMIN_PHONE 환경변수나 ?to= 쿼리스트링이 다른 번호를 가리켜도 무시하고 이 한 번호로 고정.
const FORCED_RECEIVER = '01043008739';

export const ALIGO = {
  apikey:    process.env.ALIGO_API_KEY   || 'pw8x8s9kajo31bcd96nv2os4bkqcl1wf',
  userid:    process.env.ALIGO_USER_ID   || 'tami98',
  senderkey: process.env.ALIGO_SENDERKEY || '422ebc0f44745b54bc7caf91696161873f4690b4',
  sender:    process.env.ALIGO_SENDER    || '18009678',
  admin:     FORCED_RECEIVER,
  cron:      process.env.CRON_SECRET     || 'c93513d3de07036d44106e7148bceaedd417074b544cbd259d409b52d892ebed',
};

export function adminReceivers() {
  // 대표 지시 — 고정 한 번호만 반환. 환경변수/쿼리/콤마 어떤 입력도 무시.
  return [FORCED_RECEIVER];
}

export function kstToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 알리고 SMS/LMS 단건 발송 — 90바이트 초과 시 자동 LMS 전환
// API: https://apis.aligo.in/send/
// 친구톡/알림톡과 달리 템플릿 등록·친구추가 불필요 — 즉시 발송
async function sendOne({ message, receiver, subject }) {
  const form = new URLSearchParams();
  form.append('key', ALIGO.apikey);
  form.append('user_id', ALIGO.userid);
  form.append('sender', ALIGO.sender);
  form.append('receiver', receiver);
  form.append('msg', message);
  form.append('title', subject);
  form.append('msg_type', message.length > 90 ? 'LMS' : 'SMS');
  form.append('testmode_yn', 'N');

  const res = await fetch('https://apis.aligo.in/send/', {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  // 알리고 성공: result_code === '1' (string). 실패 음수.
  const okBody = String(json?.result_code) === '1';
  return { receiver, status: res.status, ok: res.ok && okBody, body: json };
}

// 대표 지시 — FORCED_RECEIVER (010-4300-8739) 한 번호로만 발송.
// overrideReceivers 가 와도 무시. 다른 번호로의 발송을 코드 레벨에서 차단.
export async function sendAdminFriendtalk({ message, subject, overrideReceivers }) {
  const receivers = adminReceivers(); // 항상 [FORCED_RECEIVER]
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
