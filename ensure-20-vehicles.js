// เติมรถเกี่ยวข้าวและรถตีดินให้ครบ 20 คัน (พร้อมประวัติซ่อมคันละ 1 รายการ)   รันด้วย: node ensure-20-vehicles.js
// รันซ้ำได้ ไม่เพิ่มซ้ำ และไม่เพิ่มเกิน 20 คัน
import 'dotenv/config';
import pg from 'pg';

const TARGET = 20;
const TEAM = 'ช่างเดช, ช่างดิว, ช่างเด่น, ช่างยุ่ง';
const H = (n) => ['harvester', `H-${String(n).padStart(2, '0')}`, `รถเกี่ยวข้าว คันที่ ${n}`, `คันที่ ${n}`];
const R = (n) => ['tiller', `R-${String(n).padStart(2, '0')}`, `รถตีดิน คันที่ ${n}`, `คันที่ ${n}`];

// [ตัวช่วยสร้างชื่อ, รุ่น, ทะเบียน, สถานะ, ชั่วโมงใช้งาน, ซ่อมครั้งล่าสุด[วันที่, อาการ, อะไหล่, ราคา]]
const wanted = [
  [H(6),  'Kubota DC-93G',            'กข-7421 นครปฐม',    'operating', 610, ['2025-02-18','สายพานลำเลียงขาด','สายพานลำเลียงเมล็ด',9800]],
  [H(8),  'Yanmar YH700',             'บฉ-3308 สุพรรณบุรี', 'ready',     275, ['2024-09-05','ใบมีดตัดข้าวทื่อ','ใบมีดตัดชุดหน้า',19500]],
  [H(9),  'Kubota DC-105X',           'กข-8890 นครปฐม',    'operating', 1320, ['2023-11-14','ระบบไฮดรอลิกรั่ว','ซีลไฮดรอลิก, ท่อน้ำมันไฮดรอลิก',26500]],
  [H(10), 'Kubota DC-70G',            'ชพ-1560 ชัยนาท',    'parked',    905, ['2026-03-12','เครื่องยนต์สตาร์ทติดยาก','หัวฉีด, แบตเตอรี่',44000]],
  [H(11), 'Yanmar AW82G',            'ชพ-2271 ชัยนาท',    'operating', 480, ['2025-07-29','ตะแกรงร่อนข้าวชำรุด','ตะแกรงร่อน',24000]],
  [H(12), 'Kubota DC-135X',         'พจ-6642 พิจิตร',    'repair',    740, ['2026-08-21','ลูกนวดข้าวสึกหรอ','ชุดลูกนวด',63000]],
  [H(13), 'Kubota DC-95',             'พจ-9035 พิจิตร',    'ready',     1180, ['2024-05-16','หม้อน้ำรั่ว','หม้อน้ำ, ท่อยางน้ำ',18500]],
  [R(2),  'Kubota M7040', 'บฉ-5578 สุพรรณบุรี', 'operating', 410, ['2025-04-03','เปลี่ยนใบพรวนสึก','ใบพรวน 8 ใบ',14000]],
  [R(3),  'Kubota M9960', 'กข-4412 นครปฐม',    'ready',     365, ['2023-06-27','คลัตช์ลื่น','ชุดคลัตช์, แผ่นคลัตช์',35000]],
  [R(4),  'Kubota L5018', 'ชพ-3190 ชัยนาท',    'operating', 520, ['2024-12-09','เพลาส่งกำลังแตก','เพลาส่งกำลัง, ปลอกเพลา',31000]],
  [R(5),  'Yanmar EF393',  'พจ-7714 พิจิตร',    'parked',    690, ['2025-10-24','เฟืองเกียร์มีเสียงดัง','เฟืองเกียร์, ลูกปืน',58000]],
  [R(6),  'Kubota M9540', 'บฉ-6203 สุพรรณบุรี', 'ready',     245, ['2026-01-15','น้ำมันเกียร์รั่วซึม','ซีลเกียร์, น้ำมันเกียร์',12500]],
  [R(7),  'Kubota M7040', 'กข-1987 นครปฐม',    'operating', 580, ['2023-09-02','ไฟชาร์จไม่เข้า','ไดชาร์จ, สายพานไดชาร์จ',8500]],
];

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
const count = async () => Number((await c.query(`SELECT COUNT(*) FROM vehicles WHERE type IN ('harvester','tiller')`)).rows[0].count);
const before = await count();
const customers = (await c.query('SELECT id FROM customers ORDER BY id')).rows.map((r) => r.id);
let have = before, added = 0;
for (const [[type, id, name, shortName], model, plate, status, hours, [d, issue, part, cost]] of wanted) {
  if (have >= TARGET) break;
  if ((await c.query('SELECT 1 FROM vehicles WHERE id=$1', [id])).rowCount) continue;
  const cust = customers.length ? customers[added % customers.length] : null;
  await c.query(
    `INSERT INTO vehicles (id, type, name, short_name, model, plate, driver, status, hours, next_service, last_service, fuel, customer_id)
     VALUES ($1,$2,$3,$4,$5,$6,'-',$7,$8,$9,$10,100,$11)`,
    [id, type, name, shortName, model, plate, status, hours, Math.ceil((hours + 100) / 100) * 100, d, cust]);
  const r = await c.query(
    'INSERT INTO repairs (vehicle_id, repair_date, issue, part, cost, tech) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [id, d, issue, part, cost, TEAM]);
  await c.query(`INSERT INTO followups (repair_id, due_date, channel, status, result)
                 VALUES ($1, $2::date + 7, 'line', 'done', 'ลูกค้าแจ้งว่าใช้งานปกติ')`, [r.rows[0].id, d]);
  have++; added++;
}
console.log(`✅ รถเกี่ยวข้าวและรถตีดินมี ${before} คัน → เพิ่ม ${added} → รวม ${have} คัน`);
const t = await c.query(`SELECT type AS ประเภท, COUNT(*) AS คัน FROM vehicles WHERE type IN ('harvester','tiller') GROUP BY 1`);
console.table(t.rows);
await c.end();
