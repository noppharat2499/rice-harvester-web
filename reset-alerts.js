// สร้างรายการแจ้งเตือนบำรุงรักษาจากประวัติซ่อมจริงของรถเกี่ยวข้าวและรถตีดินทุกคัน   รันด้วย: node reset-alerts.js
// กติกา: นัดตรวจเช็คต่อเนื่อง = 180 วันหลังงานซ่อมล่าสุดของแต่ละคัน
import 'dotenv/config';
import pg from 'pg';

const CHECK_DAYS = 180;
const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
const { rows } = await c.query(`
  SELECT DISTINCT ON (v.id) v.id, r.issue,
         (CURRENT_DATE - r.repair_date) AS since
  FROM vehicles v JOIN repairs r ON r.vehicle_id = v.id
  WHERE v.type IN ('harvester','tiller')
  ORDER BY v.id, r.repair_date DESC, r.id DESC`);
await c.query('DELETE FROM alerts');
let n = 0;
for (const r of rows) {
  const left = CHECK_DAYS - Number(r.since);
  const due = left < 0 ? `เกินกำหนดแล้ว ${-left} วัน` : left === 0 ? 'ครบกำหนดวันนี้' : `อีก ${left} วัน`;
  const urgency = left < 0 ? 'critical' : left <= 30 ? 'warning' : 'normal';
  await c.query('INSERT INTO alerts (vehicle_id, item, due, urgency) VALUES ($1,$2,$3,$4)',
    [r.id, `ตรวจติดตามหลังซ่อม: ${r.issue}`, due, urgency]);
  n++;
}
console.log(`✅ สร้างรายการแจ้งเตือนใหม่ ${n} รายการ (ตามงานซ่อมล่าสุดของแต่ละคัน)`);
await c.end();
