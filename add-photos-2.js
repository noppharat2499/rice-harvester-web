// แนบรูปงานซ่อมชุดที่ 2 (13 รูป) (ไฟล์อยู่ในโฟลเดอร์ uploads) เข้ากับประวัติซ่อมของรถเกี่ยวข้าวและรถตีดิน
// รันด้วย: node add-photos-2.js   รันซ้ำได้ ไม่แนบซ้ำ
// ใส่รูปในงานซ่อมที่ยังไม่มีรูปเท่านั้น (จับคู่ตามคำสำคัญของงาน ถ้าไม่ตรงก็ใส่งานว่างงานแรก)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
const photos = [["8f04e0bb-79d8-46b9-89c5-abc5d31935c2.jpg", ["ยกเครื่อง", "ขึ้นโครง"]], ["a75df40e-1025-4009-9b5c-54506ab019cb.jpg", ["ขึ้นโครง"]], ["5edc6277-5f7c-4d11-a784-2b290332c8f4.jpg", ["ลูกนวด"]], ["61b758f0-1ed5-48b1-bff9-ab6701d3cbfd.jpg", ["ยกเครื่อง"]], ["dc36ba82-090f-4ec2-93ca-ea3ea4bb8686.jpg", ["ใบพรวน", "เพลา"]], ["092176a0-2118-48a3-a0a8-323d27c8403f.jpg", ["เกียร์", "ตีนตะขาบ"]], ["5656afc6-5239-4a57-a504-1dc161f3d907.jpg", ["ใบมีด", "ตะแกรง"]], ["ab07856d-f042-43e3-899d-d3150f4ebe86.jpg", ["ตีนตะขาบ"]], ["13be6bdc-c21e-4eaf-bcb6-0c5063c3f3ba.jpg", ["ตีนตะขาบ"]], ["db66776c-d7ec-4239-875f-8be87f5ffb3b.jpg", ["สายพานลำเลียง"]], ["1feadf11-5422-4cb0-9398-1da938aa97ef.jpg", ["ใบมีด", "สายพานลำเลียง"]], ["98957903-9fc3-4d52-93aa-e5ceaedc9c92.jpg", ["ลูกนวด", "ตะแกรง"]], ["f46f95ee-14d6-441d-818b-dd68612df023.jpg", ["เครื่องยนต์", "หม้อน้ำ", "ซ่อมบำรุง"]]];

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
  // ใส่เฉพาะงานที่ยังไม่มีรูปก่อน (เลือกที่ตรงคำสำคัญ) ถ้าไม่มีที่ว่างแล้วค่อยใส่งานที่มีรูปน้อยที่สุด
  const list = (await repairs()).sort((a, b) => a.n - b.n || b.cost - a.cost);
  const empties = list.filter((r) => r.n === 0);
  const match = empties.length
    ? empties.find((r) => keywords.some((k) => r.issue.includes(k))) || empties[0]
    : list[0];
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
