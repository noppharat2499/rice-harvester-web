// เปลี่ยนรุ่นรถที่ไม่มีจริงให้เป็นรุ่นที่มีขายจริงในไทย   รันด้วย: node fix-vehicle-models.js   (รันซ้ำได้)
//   Yanmar CA-355    -> Yanmar AW82G     (ไม่มีรุ่น CA-355)
//   CLAAS Tucano 320 -> Kubota DC-135X   (Tucano เป็นรถเกี่ยวคันใหญ่จากยุโรป ไม่ค่อยพบในงานของอู่)
import 'dotenv/config';
import pg from 'pg';

const map = [
  ['Yanmar CA-355', 'Yanmar AW82G'],
  ['CLAAS Tucano 320', 'Kubota DC-135X'],
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
for (const [oldM, newM] of map) {
  n += (await c.query('UPDATE vehicles SET model=$2 WHERE model=$1', [oldM, newM])).rowCount;
}
console.log(`✅ เปลี่ยนรุ่นรถ ${n} คัน`);
console.table((await c.query("SELECT id, model FROM vehicles WHERE type IN ('harvester','tiller') ORDER BY id")).rows);
await c.end();
