// ตั้งชื่อรถให้เหมือนที่อู่เรียกจริง เช่น "รถเกี่ยวคุณจิระเดช" "รถตีดินคุณบุญชู คันที่ 2"
// รันด้วย: node realistic-vehicle-names.js   (รันซ้ำได้ ผลเหมือนเดิม)
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
const TYPE = { harvester: 'รถเกี่ยวข้าว', tiller: 'รถตีดิน' };
const { rows } = await c.query(`
  SELECT v.id, v.type, v.model, cu.name AS cname
  FROM vehicles v LEFT JOIN customers cu ON cu.id = v.customer_id
  WHERE v.type IN ('harvester','tiller')
  ORDER BY v.id`);

const first = (n) => (n || '').replace(/^คุณ\s*/, '').trim().split(/\s+/)[0];
const modelShort = (m) => m.replace(/\s*\+.*$/, '').replace(/^(Kubota|Yanmar|Iseki|CLAAS)\s+/, '');
const groups = {};
for (const r of rows) (groups[`${r.type}|${r.cname || r.model}`] ||= []).push(r);

let n = 0;
for (const list of Object.values(groups)) {
  for (const [i, r] of list.entries()) {
    const t = TYPE[r.type];
    const base = r.cname ? `${t}คุณ${first(r.cname)}` : `${t} ${r.model.replace(/\s*\+.*$/, '')}`;
    const no = list.length > 1 ? ` คันที่ ${i + 1}` : '';
    const name = base + no;
    const short = r.cname ? `${modelShort(r.model)} · ${first(r.cname)}${no}` : `${modelShort(r.model)}${no}`;
    n++;
    await c.query('UPDATE vehicles SET name=$2, short_name=$3 WHERE id=$1', [r.id, name, short]);
  }
}
console.log(`✅ ตั้งชื่อรถ ${n} คัน`);
console.table((await c.query("SELECT id, name, short_name, model FROM vehicles WHERE type IN ('harvester','tiller') ORDER BY id")).rows);
await c.end();
