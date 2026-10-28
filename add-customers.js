// เพิ่มลูกค้าตัวอย่างและกระจายรถเกี่ยวข้าว/รถตีดินให้เจ้าของหลายราย   รันด้วย: node add-customers.js
// รันซ้ำได้ ไม่เพิ่มลูกค้าซ้ำ (เช็คจากชื่อ)   ⚠️ จะจัดเจ้าของรถใหม่ทั้งหมด (วนไปตามลูกค้า)
import 'dotenv/config';
import pg from 'pg';

const people = [
  ['คุณจิระเดช ดิษฐทรัพย์',    '081-456-7821', 'surachai.t',  'ต.ท่าพระยา อ.เมือง จ.สุพรรณบุรี', 'รับจ้างเกี่ยวข้าวช่วงฤดูเก็บเกี่ยว'],
  ['คุณธนกฤษ ดุริยะพันธ์',  '089-345-1290', 'boonlert_r',  'ต.ดอนตูม อ.ดอนตูม จ.นครปฐม', ''],
  ['คุณอำพล สวนแตง',   '086-712-3456', '',            'ต.หนองหญ้าไซ อ.หนองหญ้าไซ จ.สุพรรณบุรี', 'โทรได้หลัง 18:00 น.'],
  ['คุณบุญชู งวนงาม', '087-224-9981', 'amnuay.s',    'ต.บางหลวง อ.บางเลน จ.นครปฐม', ''],
  ['คุณพรชัย ไร่ดี',     '082-908-6674', 'pornchai_rd', 'ต.วัดสิงห์ อ.เมือง จ.ชัยนาท', 'ลูกค้าประจำ มีรถหลายคัน'],
];

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
let added = 0;
for (const [name, phone, lineId, address, note] of people) {
  if ((await c.query('SELECT 1 FROM customers WHERE name=$1', [name])).rowCount) continue;
  await c.query('INSERT INTO customers (name, phone, line_id, address, note) VALUES ($1,$2,$3,$4,$5)', [name, phone, lineId, address, note]);
  added++;
}
const cust = (await c.query('SELECT id FROM customers ORDER BY id')).rows.map((r) => r.id);
const vs = (await c.query(`SELECT id FROM vehicles WHERE type IN ('harvester','tiller') ORDER BY type, length(id), id`)).rows;
for (const [i, v] of vs.entries()) {
  await c.query('UPDATE vehicles SET customer_id=$1 WHERE id=$2', [cust[i % cust.length], v.id]);
}
console.log(`✅ เพิ่มลูกค้า ${added} ราย, จัดเจ้าของให้รถ ${vs.length} คัน (ลูกค้าทั้งหมด ${cust.length} ราย)`);
const t = await c.query(`SELECT c.name AS ลูกค้า, COUNT(v.id) AS คัน FROM customers c LEFT JOIN vehicles v ON v.customer_id=c.id GROUP BY c.id, c.name ORDER BY c.id`);
console.table(t.rows);
await c.end();
