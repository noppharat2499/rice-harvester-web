// เปลี่ยนช่างทุกรายการซ่อมให้สลับกัน: ช่างเดช → ช่างดิว → ช่างเด่น → ช่างยุ่ง   รันด้วย: node rotate-techs.js
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
await c.query(`
  UPDATE repairs r SET tech = (ARRAY['ช่างเดช','ช่างดิว','ช่างเด่น','ช่างยุ่ง'])[1 + (s.n - 1) % 4]
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY repair_date, id) AS n FROM repairs) s
  WHERE r.id = s.id`);
const r = await c.query(`SELECT tech AS ช่าง, COUNT(*) AS รายการ FROM repairs GROUP BY 1 ORDER BY 1`);
console.log('✅ เสร็จแล้ว'); console.table(r.rows);
await c.end();
