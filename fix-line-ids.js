// ตั้ง LINE ID ลูกค้าให้ตรงกับชื่อจริง (ยกเว้นคุณนพรัตน์)   รันด้วย: node fix-line-ids.js   (รันซ้ำได้)
import 'dotenv/config';
import pg from 'pg';

const map = [
  ['คุณจิระเดช ดิษฐทรัพย์', 'jiradech.d'],
  ['คุณธนกฤษ ดุริยะพันธ์',  'thanakrit.d'],
  ['คุณบุญชู งวนงาม',       'boonchoo.n'],
  ['คุณพรชัย ไร่ดี',        'pornchai.r'],
];
const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();
let n = 0;
for (const [name, lineId] of map) {
  n += (await c.query('UPDATE customers SET line_id=$2 WHERE name=$1', [name, lineId])).rowCount;
}
console.log(`✅ แก้ LINE ID ${n} ราย`);
console.table((await c.query('SELECT id, name, line_id FROM customers ORDER BY id')).rows);
await c.end();
