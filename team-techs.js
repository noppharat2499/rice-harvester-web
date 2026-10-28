// ตั้งช่างทุกรายการซ่อมเป็น "ช่วยกันทั้งทีม"   รันด้วย: node team-techs.js
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
const r = await c.query(`UPDATE repairs SET tech = 'ช่างเดช, ช่างดิว, ช่างเด่น, ช่างยุ่ง'`);
console.log(`✅ เปลี่ยนช่างเป็นช่วยกันทั้งทีม ${r.rowCount} รายการ`);
await c.end();
