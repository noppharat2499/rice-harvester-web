// เพิ่มวันครบกำหนดจริงให้แจ้งเตือน เพื่อให้ "อีก N วัน" นับถอยหลังเองทุกวัน   รันด้วย: node migrate-alert-dates.js   (รันซ้ำได้)
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
await c.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS due_date DATE');
// แปลงข้อความเดิม "อีก N วัน" / "เกินกำหนดแล้ว N วัน" เป็นวันที่จริง (นับจากวันนี้)
const r = await c.query(`
  UPDATE alerts SET due_date = CASE
      WHEN due ~ 'เกิน' AND due ~ '[0-9]+' THEN CURRENT_DATE - (regexp_match(due, '[0-9]+'))[1]::int
      WHEN due ~ '[0-9]+' THEN CURRENT_DATE + (regexp_match(due, '[0-9]+'))[1]::int
      WHEN due ~ 'วันนี้' THEN CURRENT_DATE
    END
  WHERE due_date IS NULL`);
console.log(`✅ ใส่วันครบกำหนดให้แจ้งเตือน ${r.rowCount} รายการ`);
console.table((await c.query('SELECT id, vehicle_id, item, due, due_date FROM alerts ORDER BY due_date NULLS LAST')).rows);
await c.end();
