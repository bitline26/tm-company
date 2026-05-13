// 데모: 입금 중복 시각화용 가짜 PB 2건 생성 (admin 전용)
// 같은 전화번호로 status='PAID' 2건 → PB 내역에 💰 빨강 배너 + 행 배지 노출
import { sql, ensureSchema, requireAuth } from '../_db.js';

export default requireAuth(async function handler(req, res){
  if(req.user.role !== 'admin') return res.status(403).json({ error: '대표 전용' });
  if(req.method !== 'POST'){ res.setHeader('Allow','POST'); return res.status(405).json({ error:'method not allowed' }); }
  try {
    await ensureSchema();
    // 1차 직원 1명 잡기 (없으면 admin 본인)
    const t1 = await sql`SELECT id FROM users WHERE tier = 1 AND name NOT IN ('2','3') ORDER BY sort_order ASC LIMIT 1`;
    const tmId = t1[0]?.id || req.user.id;
    const today = new Date().toISOString().slice(0,10);
    const demoPhone = '010-9999-' + String(Math.floor(1000 + Math.random()*9000));
    // 같은 phone + PAID 2건 — 입금 중복 트리거
    const rows = await sql`
      INSERT INTO sales_orders
        (tm_user_id, customer_name, customer_phone, carrier, consult_date, payment_bank, payment_account,
         amount, payment_date, status, note)
      VALUES
        (${tmId}, '데모홍길동(중복)', ${demoPhone}, 'SK', ${today}, 'KB국민', '110-DEMO-001',
         300000, ${today}, 'PAID', '⚠ 데모용 — 입금중복 시각화'),
        (${tmId}, '데모홍길동(중복)', ${demoPhone}, 'SK', ${today}, 'KB국민', '110-DEMO-002',
         350000, ${today}, 'PAID', '⚠ 데모용 — 입금중복 시각화')
      RETURNING id`;
    return res.status(200).json({ ok:true, ids: rows.map(r=>r.id), phone: demoPhone, message: `데모 PAID 2건 생성 (${demoPhone}) — PB내역 새로고침` });
  } catch (e) {
    return res.status(500).json({ error:'server error', detail: String(e.message||e) });
  }
});
