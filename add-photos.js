// แนบรูปงานซ่อม 19 รูป (ไฟล์อยู่ในโฟลเดอร์ uploads) เข้ากับประวัติซ่อมของรถเกี่ยวข้าวและรถตีดิน
// รันด้วย: node add-photos.js   รันซ้ำได้ ไม่แนบซ้ำ
// จับคู่รูปกับงานซ่อมตามคำสำคัญของงาน (เช่น ยกเครื่อง, ลูกนวด, ตีนตะขาบ) ถ้าไม่ตรงจะกระจายให้งานที่ยังไม่มีรูป
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
const photos = [["a38cca24-4dc7-4742-9770-a3c8d2e87546.jpg", ["ยกเครื่อง", "ขึ้นโครง"]], ["c42892b0-2355-42a9-aa8c-3ac563839176.jpg", ["ขึ้นโครง", "ชุดนวด"]], ["15516ba1-176b-403a-a029-9863f6bb91f3.jpg", ["สายพานลำเลียง"]], ["1c84b58e-c6b7-44a4-a306-b5d7589f5716.jpg", ["ลูกนวด"]], ["e9b2dadf-fd80-458e-a2aa-9ea9635ae75d.jpg", ["ขึ้นโครง", "ยกเครื่อง"]], ["32a79de7-4030-43fa-b1a7-1088f9c2d477.jpg", ["สายพานลำเลียง", "ลูกนวด"]], ["5ad79ff5-58cd-4d69-9dd2-4ee3c6b1a5c3.jpg", ["ขึ้นโครง"]], ["3dd8ae42-d1b4-46ca-a93b-4a2075faf0c9.jpg", ["เกียร์", "คลัตช์", "ใบพรวน"]], ["230a9b0f-9426-4139-bba2-fb392f3d6aea.jpg", ["เพลาส่งกำลัง", "ใบพรวน"]], ["10bbd8bd-f737-47fb-b22c-afeac50f95f8.jpg", ["ใบพรวน"]], ["235f1653-8751-4cd3-9d83-e7c827333f5c.jpg", ["ตีนตะขาบ", "ยกเครื่อง"]], ["fa5a1377-4264-4231-a3af-32e17de7468f.jpg", ["สายพานลำเลียง", "ตะแกรง"]], ["62c34acf-7898-4e6e-961b-ef245bdc9a6b.jpg", ["ตีนตะขาบ", "ล้อ"]], ["66d79aca-e8d2-4f33-a5c5-0a89761b3516.jpg", ["ตีนตะขาบ"]], ["d2964b61-ea4e-430b-a2c6-ec251cd87f13.jpg", ["ใบมีด"]], ["a24e5d10-988b-448e-a3ac-cd50e4d2f52e.jpg", ["ยกเครื่อง"]], ["11dca24d-a7cc-40c7-ba74-247a86b5e889.jpg", ["ตะแกรง", "ลูกนวด"]], ["d3cd676b-2d27-470f-b3af-21327b18fc2a.jpg", ["ยกเครื่อง"]], ["44d4dfaa-6c60-4be6-8f5b-b103fecc542c.jpg", ["เครื่องยนต์", "แบตเตอรี่", "หม้อน้ำ"]]];

const c = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
await c.connect();

const repairs = async () => (await c.query(`
  SELECT r.id, r.issue, r.cost, (SELECT COUNT(*)::int FROM repair_photos p WHERE p.repair_id = r.id) AS n
  FROM repairs r JOIN vehicles v ON v.id = r.vehicle_id
  WHERE v.type IN ('harvester','tiller')`)).rows;

let added = 0, skipped = 0;
for (const [file, keywords] of photos) {
  if (!fs.existsSync(path.join(dir, file))) { console.log('⚠️ ไม่พบไฟล์', file); skipped++; continue; }
  if ((await c.query('SELECT 1 FROM repair_photos WHERE filename=$1', [file])).rowCount) { skipped++; continue; }
  const list = (await repairs()).sort((a, b) => a.n - b.n || b.cost - a.cost);
  const match = list.find((r) => r.n < 3 && keywords.some((k) => r.issue.includes(k))) || list[0];
  if (!match) { skipped++; continue; }
  await c.query(`INSERT INTO repair_photos (repair_id, filename, kind) VALUES ($1,$2,'after')`, [match.id, file]);
  added++;
}
console.log(`✅ แนบรูปใหม่ ${added} รูป, ข้าม ${skipped} รูป`);
const t = await c.query(`SELECT COUNT(*) FILTER (WHERE n > 0) AS "งานที่มีรูป", COUNT(*) AS "งานทั้งหมด" FROM (
  SELECT r.id, (SELECT COUNT(*) FROM repair_photos p WHERE p.repair_id = r.id) AS n
  FROM repairs r JOIN vehicles v ON v.id = r.vehicle_id WHERE v.type IN ('harvester','tiller')) x`);
console.table(t.rows);
await c.end();
