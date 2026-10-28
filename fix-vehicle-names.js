// แก้ชื่อรถที่พิมพ์ติดกัน เช่น "คันที่7" → "คันที่ 7"   รันด้วย: node fix-vehicle-names.js   (รันซ้ำได้)
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
const r = await c.query(`UPDATE vehicles SET name = regexp_replace(name, 'คันที่\\s*([0-9]+)', 'คันที่ \\1'), short_name = regexp_replace(short_name, 'คันที่\\s*([0-9]+)', 'คันที่ \\1') WHERE name ~ 'คันที่[0-9]' OR short_name ~ 'คันที่[0-9]'`);
console.log(`✅ แก้ชื่อรถ ${r.rowCount} คัน`);
await c.end();
