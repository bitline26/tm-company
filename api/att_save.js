import { sql, ensureSchema, statusToRatio } from './_db.js';

// 단일 셀 저장
// POST { employee_id, work_date: "2026-05-08", status: "WORK"|"MONTHLY_OFF"|"HALF_AM"|"HALF_PM"|"ANNUAL"|"SICK"|"OFF"|"HOLIDAY"|"CLEAR", note? }
// status 'CLEAR' → 행 삭제 (정상으로 되돌리기)
const VALID = ['WORK','MONTHLY_OFF','HALF_AM','HALF_PM','ANNUAL','SICK','OFF','HOLIDAY','CLEAR'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { employee_id, work_date, status, note } = body;
    const empId = Number(employee_id);
    if (!empId || !work_date || !VALID.includes(status)) {
      return res.status(400).json({ error: 'employee_id, work_date, status required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
      return res.status(400).json({ error: 'work_date format YYYY-MM-DD' });
    }

    if (status === 'CLEAR') {
      await sql`DELETE FROM attendance WHERE employee_id = ${empId} AND work_date = ${work_date}`;
      return res.status(200).json({ ok: true, cleared: true });
    }

    const ratio = statusToRatio(status);
    await sql`
      INSERT INTO attendance (employee_id, work_date, status, ratio, note, updated_at)
      VALUES (${empId}, ${work_date}, ${status}, ${ratio}, ${note || null}, NOW())
      ON CONFLICT (employee_id, work_date)
      DO UPDATE SET status = EXCLUDED.status, ratio = EXCLUDED.ratio, note = EXCLUDED.note, updated_at = NOW()
    `;
    return res.status(200).json({ ok: true, status, ratio });
  } catch (e) {
    console.error('att_save error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}
