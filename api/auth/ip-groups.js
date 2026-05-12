// IP 그룹 마스터 CRUD — 대표(admin) 전용
// GET  /api/auth/ip-groups                       → { groups, currentIp, max:200 }
// POST /api/auth/ip-groups  { id?, label, ips:[], active, sort_order, note }
// DELETE /api/auth/ip-groups?id=NN
import { sql, requireAuth, readJson } from '../_db.js';

const MAX_GROUPS = 200;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_LOOSE = /^[0-9a-fA-F:]+$/;
function normalizeIp(s){
  const t = String(s||'').trim();
  if(!t) return null;
  if(IPV4.test(t) || IPV6_LOOSE.test(t)) return t;
  return null;
}
function clientIp(req){
  const xf = String(req.headers['x-forwarded-for']||'');
  return xf.split(',')[0].trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

export default requireAuth(async function handler(req, res){
  const me = req.user;
  if (me.role !== 'admin') return res.status(403).json({ error: '대표만 사용 가능합니다' });

  if (req.method === 'GET') {
    const groups = await sql`
      SELECT id, label, ips, active, sort_order, note, created_at, updated_at
      FROM ip_groups ORDER BY sort_order ASC, id ASC`;
    return res.status(200).json({ groups, currentIp: clientIp(req), max: MAX_GROUPS });
  }

  if (req.method === 'POST') {
    const b = await readJson(req);
    const label = String(b.label||'').trim();
    if(!label) return res.status(400).json({ error: '제목을 입력하세요' });
    if(label.length > 32) return res.status(400).json({ error: '제목 32자 이내' });
    const rawIps = Array.isArray(b.ips) ? b.ips : String(b.ips||'').split(/[\s,\/;]+/);
    const ips = rawIps.map(normalizeIp).filter(Boolean).slice(0, 200);
    const active = b.active !== false;
    const sortOrder = Number(b.sort_order || 0);
    const note = b.note ? String(b.note).slice(0,200) : null;

    if (b.id) {
      const rows = await sql`
        UPDATE ip_groups SET label=${label}, ips=${ips}, active=${active},
          sort_order=${sortOrder}, note=${note}, updated_at=NOW()
        WHERE id=${Number(b.id)} RETURNING *`;
      if(!rows[0]) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ ok:true, group: rows[0] });
    }

    const cnt = (await sql`SELECT COUNT(*)::int AS n FROM ip_groups`)[0]?.n || 0;
    if (cnt >= MAX_GROUPS) return res.status(400).json({ error: `최대 등록 가능 갯수 초과 (${MAX_GROUPS}건)` });

    try {
      const rows = await sql`
        INSERT INTO ip_groups (label, ips, active, sort_order, note)
        VALUES (${label}, ${ips}, ${active}, ${sortOrder}, ${note}) RETURNING *`;
      return res.status(200).json({ ok:true, group: rows[0] });
    } catch (e) {
      if (String(e.message||'').includes('duplicate')) return res.status(409).json({ error: '이미 같은 제목이 있습니다' });
      throw e;
    }
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if(!id) return res.status(400).json({ error: 'id required' });
    await sql`DELETE FROM ip_groups WHERE id=${id}`;
    // 사용 중이던 user들의 ip_group_ids 에서도 제거
    await sql`UPDATE users SET ip_group_ids = array_remove(ip_group_ids, ${id})`;
    return res.status(200).json({ ok:true });
  }

  res.setHeader('Allow', 'GET,POST,DELETE');
  return res.status(405).json({ error: 'method not allowed' });
});
