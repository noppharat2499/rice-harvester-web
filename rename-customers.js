// เปลี่ยนชื่อลูกค้าตัวอย่าง 4 ราย   รันด้วย: node rename-customers.js   (รันซ้ำได้)
import 'dotenv/config';
import pg from 'pg';

const map = [
  ['คุณสุรชัย ทองดี',     'คุณจิระเดช ดิษฐทรัพย์'],
  ['คุณบุญเลิศ รวงทอง',   'คุณธนกฤษ ดุริยะพันธ์'],
  ['คุณสมหมาย เพชรนา',    'คุณอำพล สวนแตง'],
  ['คุณอำนวย สุขสวัสดิ์', 'คุณบุญชู งวนงาม'],
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
for (const [oldName, newName] of map) {
  n += (await c.query('UPDATE customers SET name=$2 WHERE name=$1', [oldName, newName])).rowCount;
}
console.log(`✅ เปลี่ยนชื่อลูกค้า ${n} ราย`);
console.table((await c.query('SELECT id, name FROM customers ORDER BY id')).rows);
await c.end();
