// สร้างฐานข้อมูล + ตาราง + บัญชีเจ้าของกิจการเริ่มต้น
//   npm run db:init     สร้าง/อัปเดตโครงสร้าง (รันซ้ำได้ ไม่ลบข้อมูล)
//   npm run db:seed     เหมือน db:init และเพิ่มข้อมูลตัวอย่างถ้าตารางรถยังว่าง
//   npm run db:reset    ลบตารางทั้งหมดแล้วสร้างใหม่ (ข้อมูลหาย! ต้องพิมพ์ RESET ยืนยัน)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const base = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
};
const dbName = process.env.DB_NAME || 'rice_harvester_db';
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error('❌ DB_NAME ต้องเป็น A-Z, a-z, 0-9 หรือ _ เท่านั้น');
  process.exit(1);
}

// 1) สร้างฐานข้อมูลถ้ายังไม่มี (ถ้าใช้ DATABASE_URL ถือว่าฐานข้อมูลถูกสร้างไว้แล้วโดยผู้ให้บริการ)
const ssl = process.env.DB_SSL === '1' ? { ssl: { rejectUnauthorized: false } } : {};
if (!process.env.DATABASE_URL) {
  const admin = new Client({ ...base, ...ssl, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${dbName}`);
    console.log(`✅ สร้างฐานข้อมูล ${dbName} แล้ว`);
  } else {
    console.log(`ℹ️  ฐานข้อมูล ${dbName} มีอยู่แล้ว`);
  }
  await admin.end();
}

const db = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL, ...ssl })
  : new Client({ ...base, ...ssl, database: dbName });
await db.connect();

try {
  // 2) (ทางเลือก) ล้างตารางเดิม
  if (args.includes('--reset')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question('⚠️  จะลบตารางทั้งหมดและข้อมูลในนั้น พิมพ์ RESET เพื่อยืนยัน: ');
    rl.close();
    if (ans.trim() !== 'RESET') {
      console.log('ยกเลิกแล้ว ไม่มีอะไรถูกลบ');
      process.exit(0);
    }
    await db.query('DROP TABLE IF EXISTS line_messages, line_contacts, followups, repair_photos, alerts, repairs, vehicles, customers, users CASCADE');
    console.log('🗑️  ลบตารางเดิมแล้ว');
  }

  // 3) กันกรณีมีตารางรุ่นเก่า (โครงสร้างต่างกัน) ค้างอยู่
  const old = await db.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicles'
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'short_name'
    )`);
  if (old.rowCount > 0) {
    console.error('❌ พบตารางรุ่นเก่าที่โครงสร้างไม่ตรงกับเวอร์ชันนี้ ให้รัน  npm run db:reset  เพื่อสร้างใหม่');
    process.exit(1);
  }

  // 4) สร้างตาราง
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('✅ สร้างตารางเรียบร้อย');

  // 5) บัญชีเจ้าของกิจการเริ่มต้น (ถ้ายังไม่มี)
  const ownerUser = process.env.OWNER_USERNAME || 'owner';
  const ownerPass = process.env.OWNER_PASSWORD;
  if (!ownerPass) {
    console.log('⚠️  ไม่ได้ตั้ง OWNER_PASSWORD ใน .env จึงยังไม่สร้างบัญชีเจ้าของกิจการ');
  } else if (ownerPass.length < 8) {
    console.error('❌ OWNER_PASSWORD ต้องยาวอย่างน้อย 8 ตัวอักษร');
    process.exit(1);
  } else {
    const hash = await bcrypt.hash(ownerPass, 10);
    const r = await db.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [ownerUser, hash]
    );
    console.log(
      r.rowCount
        ? `✅ สร้างบัญชีเจ้าของกิจการ "${ownerUser}" แล้ว`
        : `ℹ️  บัญชี "${ownerUser}" มีอยู่แล้ว (ไม่เปลี่ยนรหัสผ่าน)`
    );
  }

  // 6) (ทางเลือก) ข้อมูลตัวอย่าง
  if (args.includes('--seed')) {
    db.on('notice', (n) => console.log('ℹ️ ', n.message));
    await db.query(fs.readFileSync(path.join(__dirname, 'seed-demo.sql'), 'utf8'));
  }
} finally {
  await db.end();
}
