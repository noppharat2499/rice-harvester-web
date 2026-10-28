// ปรับราคาซ่อมให้สมจริง + เพิ่มงานซ่อมใหญ่ (ขึ้นโครง/ยกเครื่องทั้งคัน) ราคาหลักแสน   รันด้วย: node realistic-prices.js
// รันซ้ำได้ ไม่เพิ่มซ้ำ (เช็คจาก รถ+วันที่)
import 'dotenv/config';
import pg from 'pg';

const prices = {
  'ใบมีดตัดข้าวสึกหรอ': 18500, 'เบรกลมรั่ว': 6800, 'ใบผานไถบิ่น': 7500, 'สายพานลำเลียงขาด': 9800,
  'น้ำมันเกียร์รั่วซึม': 12500, 'เปลี่ยนยางหลัง': 38000, 'น้ำมันเครื่องเสื่อมสภาพ': 4500,
  'ระบบไฮดรอลิกรั่ว': 28000, 'ไส้กรองอากาศอุดตัน': 2800, 'ยางล้อหน้าสึก': 21000, 'ไฟชาร์จไม่เข้า': 8500,
  'ล้อตีนตะขาบหลวม': 85000, 'พัดลมหม้อน้ำเสียงดัง': 14500, 'หม้อน้ำรั่ว': 18500, 'เกียร์มีเสียงดัง': 68000,
  'เปลี่ยนยางล้อหลัง': 32000, 'เครื่องยนต์สตาร์ทติดยาก': 46000, 'ตะแกรงร่อนข้าวชำรุด': 24000,
  'น้ำมันเครื่องรั่วซึม': 9500, 'ระบบไฮดรอลิกอ่อนแรง': 56000, 'เบรกไม่อยู่': 16500, 'เปลี่ยนแบตเตอรี่': 5800,
  'เครื่องยนต์มีควันขาว': 38000, 'ไฟส่องสว่างขัดข้อง': 4200, 'คลัตช์ลื่น': 35000, 'เปลี่ยนยางหน้า': 24000,
  'โซ่ขับเกียร์หย่อน': 22000, 'เปลี่ยนใบพรวนสึก': 14000, 'สายพานขับลูกนวดขาด': 8500,
};

const major = [
  ['H-02','2023-09-14','ยกเครื่องใหญ่ทั้งคัน (รื้อเครื่องยนต์ เกียร์ ชุดนวด)','ชุดลูกสูบ-ปลอกสูบ, แบริ่ง, ปะเก็นชุดใหญ่',185000],
  ['H-03','2024-08-09','ยกเครื่องใหญ่ เปลี่ยนชุดลูกสูบและเพลาข้อเหวี่ยง','ชุดลูกสูบ-แหวน, เพลาข้อเหวี่ยง, แบริ่ง',160000],
  ['H-04','2024-12-05','ขึ้นโครงซ่อมใหญ่ทั้งคัน เปลี่ยนชุดนวดและลูกนวด','ชุดลูกนวดข้าว, ตะแกรง, สายพานชุดใหญ่',320000],
  ['H-01','2025-04-16','ยกเครื่อง และเปลี่ยนชุดตีนตะขาบทั้งคัน','ชุดตีนตะขาบ, ลูกล้อ, ชุดลูกสูบ',245000],
  ['C-01','2025-11-04','ยกเครื่องและซ่อมเกียร์รถสิบล้อ','ชุดลูกสูบ, ชุดเกียร์, คลัตช์ชุดใหญ่',135000],
  ['H-05','2026-01-20','ขึ้นโครงซ่อมใหญ่ทั้งคัน ซ่อมตู้คนขับและทำสี','ตู้คนขับ, ชุดแอร์, สีพ่นทั้งคัน, ชุดนวด',410000],
];
const techs = ['ช่างเดช, ช่างดิว, ช่างเด่น, ช่างยุ่ง'];

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
let updated = 0;
for (const [issue, cost] of Object.entries(prices)) {
  updated += (await c.query('UPDATE repairs SET cost=$2 WHERE issue=$1', [issue, cost])).rowCount;
}
let added = 0;
for (const [i, [v, d, issue, part, cost]] of major.entries()) {
  const ok = (await c.query('SELECT 1 FROM vehicles WHERE id=$1', [v])).rowCount;
  const dup = (await c.query('SELECT 1 FROM repairs WHERE vehicle_id=$1 AND repair_date=$2', [v, d])).rowCount;
  if (!ok || dup) continue;
  const r = await c.query(
    'INSERT INTO repairs (vehicle_id, repair_date, issue, part, cost, tech) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [v, d, issue, part, cost, techs[0]]);
  await c.query(`INSERT INTO followups (repair_id, due_date, channel, status, result)
                 VALUES ($1, $2::date + 7, 'line', 'done', 'ลูกค้าแจ้งว่าใช้งานปกติ')`, [r.rows[0].id, d]);
  added++;
}
await c.query(`UPDATE vehicles v SET last_service = (SELECT MAX(repair_date) FROM repairs r WHERE r.vehicle_id = v.id)
               WHERE EXISTS (SELECT 1 FROM repairs r WHERE r.vehicle_id = v.id)`);
console.log(`✅ ปรับราคา ${updated} รายการ, เพิ่มงานซ่อมใหญ่ ${added} รายการ`);
const t = await c.query(`SELECT COUNT(*) AS รายการ, SUM(cost)::int AS ยอดรวม, MAX(cost)::int AS แพงสุด FROM repairs`);
console.table(t.rows);
await c.end();
