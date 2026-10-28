// ตัดคำว่า " + ผานพรวน N จาน" ออกจากชื่อรุ่นรถ   รันด้วย: node remove-plow-suffix.js   (รันซ้ำได้)
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
const r = await c.query(`UPDATE vehicles SET model = regexp_replace(model, '\\s*\\+\\s*ผานพรวน.*$', '') WHERE model LIKE '%ผานพรวน%'`);
console.log(`✅ แก้รุ่นรถ ${r.rowCount} คัน`);
console.table((await c.query("SELECT id, name, model FROM vehicles WHERE type IN ('harvester','tiller') ORDER BY id")).rows);
await c.end();
