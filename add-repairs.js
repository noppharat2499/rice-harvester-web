// เพิ่มประวัติซ่อมตัวอย่าง 20 รายการ (ปี 2566-2569 คละกัน)   รันด้วย: node add-repairs.js
// รันซ้ำได้ ไม่เพิ่มซ้ำ (เช็คจาก รถ+วันที่+อาการ)  ข้ามรายการของรถที่ไม่มีในระบบ
import 'dotenv/config';
import pg from 'pg';

const rows = [
  ['H-01','2023-03-12','เครื่องยนต์มีควันขาว','หัวฉีด, ไส้กรองน้ำมัน',1600,'ช่างดิว'],
  ['H-02','2023-05-09','ใบมีดตัดข้าวทื่อ','ใบมีดตัดชุดหน้า',4200,'ช่างเดช'],
  ['T-01','2023-06-21','คลัตช์ลื่น','ชุดคลัตช์, แผ่นคลัตช์',7800,'ช่างเดช'],
  ['C-01','2023-08-17','เปลี่ยนยางหน้า','ยางหน้า 2 เส้น',9800,'ช่างดิว'],
  ['H-03','2023-10-04','โซ่ขับเกียร์หย่อน','โซ่ขับ, เฟืองโซ่',3500,'ช่างเดช'],
  ['R-01','2023-11-26','เปลี่ยนใบพรวนสึก','ใบพรวน 6 ใบ',2900,'ช่างดิว'],
  ['H-04','2024-01-15','สายพานขับลูกนวดขาด','สายพานขับ B-75',1900,'ช่างเดช'],
  ['T-02','2024-02-28','ไฟส่องสว่างขัดข้อง','ชุดไฟหน้า, สายไฟ',1800,'ช่างดิว'],
  ['C-02','2024-04-10','เบรกไม่อยู่','ผ้าเบรกหลัง, ซ่อมกระบอกเบรก',6700,'ช่างเดช'],
  ['H-05','2024-05-22','ระบบไฮดรอลิกอ่อนแรง','ปั๊มไฮดรอลิก',12500,'ช่างดิว'],
  ['H-01','2024-07-08','ตะแกรงร่อนข้าวชำรุด','ตะแกรงร่อน',3800,'ช่างเดช'],
  ['C-01','2024-09-19','น้ำมันเครื่องรั่วซึม','ปะเก็นฝาครอบวาล์ว',2600,'ช่างดิว'],
  ['H-02','2024-11-30','เครื่องยนต์สตาร์ทติดยาก','หัวฉีด, แบตเตอรี่',8400,'ช่างเดช'],
  ['T-01','2025-01-24','เปลี่ยนแบตเตอรี่','แบตเตอรี่ 12V',2400,'ช่างดิว'],
  ['H-03','2025-03-13','เปลี่ยนยางล้อหลัง','ยางล้อหลัง 2 เส้น',7200,'ช่างเดช'],
  ['R-01','2025-05-06','เกียร์มีเสียงดัง','เฟืองเกียร์, น้ำมันเกียร์',9300,'ช่างดิว'],
  ['C-02','2025-07-18','หม้อน้ำรั่ว','หม้อน้ำ, ท่อยางน้ำ',5800,'ช่างเดช'],
  ['H-04','2025-09-02','พัดลมหม้อน้ำเสียงดัง','ใบพัดลม, สายพานพัดลม',3100,'ช่างดิว'],
  ['H-05','2025-12-11','ล้อตีนตะขาบหลวม','โซ่ตีนตะขาบ, ลูกล้อ',14200,'ช่างเดช'],
  ['T-02','2026-03-07','ไฟชาร์จไม่เข้า','ไดชาร์จ',4600,'ช่างดิว'],
];

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
// แก้รายการเดิมที่เคยเพิ่มไปแล้ว (ถ้ามี) ให้เป็นข้อความใหม่
await c.query(`UPDATE repairs SET issue='ไฟส่องสว่างขัดข้อง', part='ชุดไฟหน้า, สายไฟ', cost=1800
               WHERE vehicle_id='T-02' AND repair_date='2024-02-28' AND issue='ตรวจเช็คตามระยะ 200 ชม.'`);
// เปลี่ยนรายการเดิมในฐานข้อมูลที่มีคำว่า "ชม." ในอาการ ให้เป็นงานซ่อมอื่น
const swaps = [
  ['H-01','2023-03-12','เครื่องยนต์มีควันขาว','หัวฉีด, ไส้กรองน้ำมัน'],
  ['T-01','2025-01-24','เปลี่ยนแบตเตอรี่','แบตเตอรี่ 12V'],
  ['H-04','2025-09-02','พัดลมหม้อน้ำเสียงดัง','ใบพัดลม, สายพานพัดลม'],
  ['R-01','2026-07-08','น้ำมันเกียร์รั่วซึม','ซีลเกียร์, น้ำมันเกียร์'],
  ['H-05','2026-06-10','ไส้กรองอากาศอุดตัน','ไส้กรองอากาศ'],
  ['H-01','2026-07-02','น้ำมันเครื่องเสื่อมสภาพ','น้ำมันเครื่อง, ไส้กรองน้ำมัน'],
];
for (const [v, d, issue, part] of swaps) {
  await c.query(`UPDATE repairs SET issue=$3, part=$4 WHERE vehicle_id=$1 AND repair_date=$2 AND issue LIKE '%ชม.%'`, [v, d, issue, part]);
}
// รายการอื่นที่ยังมี "ชม." หลงเหลือ
await c.query(`UPDATE repairs SET issue='ซ่อมบำรุงทั่วไป' WHERE issue LIKE '%ชม.%'`);
let added = 0, skipped = 0;
for (const [v, d, issue, part, cost, tech] of rows) {
  const ok = (await c.query('SELECT 1 FROM vehicles WHERE id=$1', [v])).rowCount;
  const dup = (await c.query('SELECT 1 FROM repairs WHERE vehicle_id=$1 AND repair_date=$2', [v, d])).rowCount;
  if (!ok || dup) { skipped++; continue; }
  const r = await c.query(
    'INSERT INTO repairs (vehicle_id, repair_date, issue, part, cost, tech) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [v, d, issue, part, cost, tech]);
  await c.query(
    `INSERT INTO followups (repair_id, due_date, channel, status, result)
     VALUES ($1, $2::date + 7, 'line', 'done', 'ลูกค้าแจ้งว่าใช้งานปกติ')`, [r.rows[0].id, d]);
  added++;
}
await c.query(`UPDATE vehicles v SET last_service = (SELECT MAX(repair_date) FROM repairs r WHERE r.vehicle_id = v.id)
               WHERE EXISTS (SELECT 1 FROM repairs r WHERE r.vehicle_id = v.id)`);
console.log(`✅ เพิ่มประวัติซ่อม ${added} รายการ, ข้าม ${skipped} รายการ`);
const y = await c.query(`SELECT EXTRACT(YEAR FROM repair_date)::int + 543 AS ปี, COUNT(*) AS รายการ FROM repairs GROUP BY 1 ORDER BY 1`);
console.table(y.rows);
await c.end();
