// 그 날 휴무자 알림 — 매일 2회 자동 발송 (대표 지시)
//   1) 00:01 KST (15:01 UTC) — 자정 직후 알림
//   2) 07:30 KST (22:30 UTC) — 출근 전 리마인드
// 발송 로직은 api/_notify.js 공유 모듈로 분리 (즉시 발송에서도 같은 함수 사용)

import { sql } from '../_db.js';
import { ALIGO, kstToday, buildOffMessage, sendAdminFriendtalk } from '../_notify.js';

export default async function handler(req, res) {
  // Vercel Cron 만 호출 가능 (Authorization: Bearer CRON_SECRET)
  // 수동 테스트도 같은 헤더로 가능 (?force=1 도 허용)
  const auth = req.headers.authorization || '';
  const isCron = auth === `Bearer ${ALIGO.cron}`;
  const isManual = req.query.force === '1';
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'unauthorized — Bearer CRON_SECRET 또는 ?force=1 필요' });
  }

  // 우리 함수의 외부 IP 확인 — 알리고 화이트리스트 등록용 (대표 지시)
  // ?whoami=1 → ipify 호출해서 우리 서버 외부 IP 반환
  if (req.query.whoami === '1') {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch('https://api.ipify.org?format=json');
        const j = await r.json();
        samples.push(j.ip);
      } catch (e) { samples.push('err:' + e.message); }
    }
    return res.status(200).json({ samples, unique: [...new Set(samples)] });
  }

  // 테스트 발송 — ?test=1 이면 휴무자 무관 ADMIN_PHONE 전체로 "테스트 메시지" 발송
  // 친구추가 했는지 확인하는 용도 (대표 지시)
  if (req.query.test === '1') {
    const stamp = new Date().toISOString();
    const message =
`[티엠컴퍼니 카톡 테스트]
이 메시지가 카톡으로 보이면 친구추가 정상.
SMS 로 왔으면 친구추가 필요 (@타미통신).

발송시각(UTC): ${stamp}`;
    const r = await sendAdminFriendtalk({ message, subject: '카톡 도착 테스트' });
    return res.status(200).json({ ok: r.ok, mode: 'test', aligo: r.sent, preview: message });
  }

  // ?date=YYYY-MM-DD 로 임의 날짜 미리 발송 (대표 지시 — 테스트용)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : kstToday();
  // ?to=01043008739,01012345678 — 특정 번호로만 발송 (테스트 1회용, 대표 지시)
  const overrideReceivers = req.query.to
    ? String(req.query.to).split(/[,\s]+/).filter(Boolean)
    : null;

  // 오늘 휴무자 — REJECTED 만 제외하고 REQUESTED/APPROVED 둘 다 메시지 포함 (대표 지시)
  const rows = await sql`
    SELECT a.type, u.name, u.tier
    FROM attendance_records a
    JOIN users u ON u.id = a.user_id
    WHERE a.work_date = ${today}
      AND a.status <> 'REJECTED'
      AND a.type <> 'WORK'
      AND u.name NOT IN ('2','3')
    ORDER BY u.tier ASC, u.name ASC
  `;

  if (!rows.length) {
    return res.status(200).json({ ok: true, date: today, count: 0, sent: false, note: '오늘 휴무자 없음 — 발송 안 함' });
  }

  const message = buildOffMessage({ rows, date: today });
  const result = await sendAdminFriendtalk({
    message,
    subject: '오늘 휴무자 알림',
    overrideReceivers,
  });

  return res.status(200).json({
    ok: result.ok,
    date: today,
    count: rows.length,
    sent: true,
    aligo: result.sent,
    preview: message,
  });
}
