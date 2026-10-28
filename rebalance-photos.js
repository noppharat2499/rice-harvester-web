// ย้ายรูปส่วนเกินจากงานซ่อมที่มีหลายรูป ไปใส่งานซ่อมที่ยังไม่มีรูป (ให้แต่ละงานมี 1 รูปก่อน)
// รันด้วย: node rebalance-photos.js   รันซ้ำได้
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

const rows = async () => (await c.query(`
  SELECT r.id, r.cost, (SELECT COUNT(*)::int FROM repair_photos p WHERE p.repair_id = r.id) AS n
  FROM repairs r JOIN vehicles v ON v.id = r.vehicle_id
  WHERE v.type IN ('harvester','tiller')`)).rows;

let moved = 0;
for (;;) {
  const all = await rows();
  const empty = all.filter((r) => r.n === 0).sort((a, b) => b.cost - a.cost);
  const donor = all.filter((r) => r.n > 1).sort((a, b) => b.n - a.n)[0];
  if (!empty.length || !donor) break;
  // ย้ายรูปล่าสุดของงานที่มีหลายรูป (เก็บรูปแรกไว้)
  const photo = (await c.query('SELECT id FROM repair_photos WHERE repair_id=$1 ORDER BY id DESC LIMIT 1', [donor.id])).rows[0];
  await c.query('UPDATE repair_photos SET repair_id=$1 WHERE id=$2', [empty[0].id, photo.id]);
  moved++;
}
const left = (await rows());
console.log(`✅ ย้ายรูป ${moved} รูป | งานที่มีรูป ${left.filter((r) => r.n > 0).length}/${left.length} | งานที่ยังมีหลายรูป ${left.filter((r) => r.n > 1).length}`);
await c.end();
