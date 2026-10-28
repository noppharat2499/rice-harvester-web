import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { HttpError, reqStr, optStr, optNum, oneOf, optDate } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- ตั้งค่า ----------
const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('❌ ต้องตั้ง JWT_SECRET ในไฟล์ .env (อย่างน้อย 16 ตัวอักษร)');
  process.exit(1);
}

// LINE Official Account (ไม่บังคับ: ถ้าไม่ตั้ง ระบบอื่นยังใช้ได้ปกติ)
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const lineConfigured = () => !!(LINE_SECRET && LINE_TOKEN);
// Basic ID ของ LINE Official Account (ใช้ทำลิงก์ให้ลูกค้าเพิ่มเพื่อน) เปลี่ยนได้ด้วย LINE_OA_ID ใน .env
const LINE_OA_ID = process.env.LINE_OA_ID || '@248auqee';

// NUMERIC -> ตัวเลข, DATE -> สตริง 'YYYY-MM-DD' (กันวันที่เพี้ยนเพราะ timezone)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rice_harvester_db',
});
pool.on('error', (err) => console.error('❌ PostgreSQL error:', err.message));

try {
  await pool.query('SELECT 1');
  console.log('✅ Connect to PostgreSQL database successfully!');
} catch (err) {
  console.error('❌ Connection Error:', err.message);
  console.error('   ลองรัน  npm run db:init  เพื่อสร้างฐานข้อมูลและตารางก่อน');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
// เก็บ body ดิบของ webhook ไว้ตรวจลายเซ็น LINE (ต้องใช้ไบต์ต้นฉบับ)
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith('/api/line/webhook')) req.rawBody = buf;
    },
  })
);

// ---------- โฟลเดอร์เก็บรูปถ่ายงานซ่อม ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS_PER_REPAIR = 12;
// ตรวจชนิดไฟล์จากไบต์แรก ๆ ของไฟล์จริง (ไม่เชื่อชื่อไฟล์/Content-Type)
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// ---------- ค่าคงที่ให้ตรงกับหน้าเว็บ ----------
const ROLES = ['owner', 'mechanic', 'driver'];
const FOLLOWUP_CHANNELS = ['phone', 'line', 'visit'];
const FOLLOWUP_STATUSES = ['pending', 'done', 'skipped'];
const VEHICLE_TYPES = {
  harvester: { label: 'รถเกี่ยวข้าว', prefix: 'H' },
  plow: { label: 'รถไถ', prefix: 'T' },
  tiller: { label: 'รถตีดิน', prefix: 'R' },
  truck: { label: 'รถสิบล้อ', prefix: 'C' },
};
const VEHICLE_STATUSES = ['operating', 'repair', 'ready', 'parked'];
const URGENCIES = ['critical', 'warning', 'normal'];

// ---------- SQL สำหรับอ่านข้อมูล (ตั้งชื่อฟิลด์ให้ตรงกับที่หน้าเว็บใช้) ----------
const VEHICLE_SELECT = `
  SELECT v.id, v.type, v.name, v.short_name AS "shortName", v.model, v.plate, v.driver, v.status,
         v.hours, v.next_service AS "nextService", v.last_service AS "lastService", v.fuel,
         v.customer_id AS "customerId", c.name AS "customerName",
         c.phone AS "customerPhone", c.line_id AS "customerLine"
  FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id`;
const REPAIR_SELECT = `
  SELECT r.id, r.vehicle_id AS "vehicleId", r.repair_date AS date, r.issue, r.part, r.cost, r.tech, r.note,
         COALESCE((SELECT json_agg(json_build_object('id', p.id, 'filename', p.filename, 'kind', p.kind) ORDER BY p.id)
                     FROM repair_photos p WHERE p.repair_id = r.id), '[]'::json) AS photos
  FROM repairs r`;
const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.phone, c.line_id AS "lineId", c.address, c.note,
         (SELECT COUNT(*)::int FROM vehicles v WHERE v.customer_id = c.id) AS "vehicleCount"
  FROM customers c`;
const FOLLOWUP_SELECT = `
  SELECT f.id, f.repair_id AS "repairId", f.due_date AS "dueDate", f.channel, f.status, f.result,
         f.done_at AS "doneAt",
         r.vehicle_id AS "vehicleId", r.repair_date AS "repairDate", r.issue, r.cost,
         v.name AS "vehicleName", v.plate,
         c.id AS "customerId", c.name AS "customerName", c.phone AS "customerPhone", c.line_id AS "customerLine"
  FROM followups f
  JOIN repairs r ON r.id = f.repair_id
  JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN customers c ON c.id = v.customer_id`;
// กำหนดที่มีวันที่จริง (due_date) จะคำนวณจำนวนวันที่เหลือสดๆ ทุกครั้งที่ดึงข้อมูล
const ALERT_SELECT = `
  SELECT id, vehicle_id AS "vehicleId", item,
         CASE WHEN due_date IS NULL THEN due
              WHEN due_date < CURRENT_DATE THEN 'เกินกำหนดแล้ว ' || (CURRENT_DATE - due_date) || ' วัน'
              WHEN due_date = CURRENT_DATE THEN 'ครบกำหนดวันนี้'
              ELSE 'อีก ' || (due_date - CURRENT_DATE) || ' วัน' END AS due,
         CASE WHEN due_date IS NULL THEN urgency
              WHEN due_date < CURRENT_DATE THEN 'critical'
              WHEN due_date - CURRENT_DATE <= 30 THEN 'warning'
              ELSE 'normal' END AS urgency,
         queued, to_char(due_date, 'YYYY-MM-DD') AS "dueDate"
  FROM alerts`;

// ---------- ตัวช่วย ----------
const toId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'id ไม่ถูกต้อง');
  return n;
};

const toVehicleId = (v) => {
  if (typeof v !== 'string' || !/^[A-Za-z]-\d{1,6}$/.test(v)) throw new HttpError(400, 'รหัสรถไม่ถูกต้อง');
  return v.toUpperCase();
};

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// UPDATE ตามคู่ [คอลัมน์, ค่า] (ชื่อตาราง/คอลัมน์มาจากโค้ดนี้เท่านั้น ไม่ได้มาจากผู้ใช้)
async function updateById(table, id, sets) {
  if (!sets.length) throw new HttpError(400, 'ไม่มีข้อมูลที่จะแก้ไข');
  const cols = sets.map(([c], i) => `${c} = $${i + 1}`).join(', ');
  const params = [...sets.map(([, v]) => v), id];
  const r = await pool.query(`UPDATE ${table} SET ${cols} WHERE id = $${params.length}`, params);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบข้อมูล');
}

const selectVehicle = async (id) => (await pool.query(`${VEHICLE_SELECT} WHERE v.id = $1`, [id])).rows[0];
const selectRepair = async (id) => (await pool.query(`${REPAIR_SELECT} WHERE r.id = $1`, [id])).rows[0];
const selectCustomer = async (id) => (await pool.query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id])).rows[0];
const selectFollowup = async (id) => (await pool.query(`${FOLLOWUP_SELECT} WHERE f.id = $1`, [id])).rows[0];

// ลูกค้าของรถ: ไม่ส่ง/ว่าง = ไม่ผูกลูกค้า, ส่งมาต้องมีอยู่จริง
async function toCustomerId(v) {
  if (v === undefined || v === null || v === '') return null;
  const id = toId(v);
  const { rowCount } = await pool.query('SELECT 1 FROM customers WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(400, 'ไม่พบลูกค้าที่เลือก');
  return id;
}

// ลบไฟล์รูปออกจากดิสก์ (ไม่ error ถ้าไฟล์หายไปแล้ว)
const removeFiles = (names) =>
  Promise.all(names.map((n) => fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(n))).catch(() => {})));
const selectAlert = async (id) => (await pool.query(`${ALERT_SELECT} WHERE id = $1`, [id])).rows[0];

// ---------- ระบบเข้าสู่ระบบ (JWT) ----------
const signToken = (u) =>
  jwt.sign({ sub: u.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '8h' });

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

// จำกัดสิทธิ์ตามบทบาท เช่น requireRole('owner', 'mechanic')
const requireRole = (...allowed) => (req, res, next) =>
  allowed.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });

// hash ปลอมไว้เทียบเวลา กันการเดาว่าชื่อผู้ใช้นี้มีอยู่จริงหรือไม่
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

// กันเดารหัสผ่าน: ผิดเกิน 10 ครั้งต่อ (IP + ชื่อผู้ใช้) ภายใน 15 นาที จะถูกล็อกชั่วคราว
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map();
const isLocked = (key) => {
  const rec = fails.get(key);
  return !!rec && rec.resetAt > Date.now() && rec.count >= MAX_FAILS;
};
const recordFail = (key) => {
  const now = Date.now();
  const rec = fails.get(key);
  if (!rec || rec.resetAt <= now) fails.set(key, { count: 1, resetAt: now + LOCK_MS });
  else rec.count += 1;
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- เส้นทางที่ไม่ต้องล็อกอิน ----------
app.get('/', (req, res) => res.send('Server is running!'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/login', async (req, res) => {
  const b = req.body || {};
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const role = typeof b.role === 'string' ? b.role : '';
  if (!username || !password) throw new HttpError(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  if (username.length > 50 || password.length > 200) throw new HttpError(400, 'ชื่อผู้ใช้หรือรหัสผ่านยาวเกินไป');

  const key = `${req.ip}|${username.toLowerCase()}`;
  if (isLocked(key)) throw new HttpError(429, 'ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');

  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role, status FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    recordFail(key);
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  if (user.status === 'pending') {
    throw new HttpError(403, 'บัญชีนี้ยังรอเจ้าของอู่อนุมัติ กรุณารอการอนุมัติก่อนเข้าสู่ระบบ');
  }
  // (ถ้าหน้าเว็บส่ง role มา ต้องตรงกับบัญชีจริง; หน้าใหม่สำหรับเจ้าของอู่ไม่ส่งค่านี้)
  if (role && role !== user.role) {
    throw new HttpError(403, 'บัญชีนี้ไม่ใช่สิทธิ์ที่เลือก กรุณาเลือกสิทธิ์ให้ตรงกับบัญชีของคุณ');
  }
  fails.delete(key);
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

// สมัครสมาชิก: จำกัด 5 ครั้งต่อ IP ต่อชั่วโมง บัญชีที่สมัครจะเป็น "รออนุมัติ" และสิทธิ์ต่ำสุด (driver)
// เจ้าของอู่อนุมัติและกำหนดสิทธิ์จริงในหน้าตั้งค่า
const regHits = new Map();
app.post('/api/auth/register', async (req, res) => {
  const now = Date.now();
  const rec = regHits.get(req.ip);
  if (rec && rec.resetAt > now && rec.count >= 5) {
    throw new HttpError(429, 'สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  }
  if (!rec || rec.resetAt <= now) regHits.set(req.ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  else rec.count += 1;

  const b = req.body || {};
  const username = reqStr(b, 'username', 'ชื่อผู้ใช้', 50);
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ A-Z, 0-9, จุด, ขีดกลาง, ขีดล่าง (3-50 ตัว)');
  }
  const fullName = reqStr(b, 'fullName', 'ชื่อ-นามสกุล', 100);
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (password.length > 200) throw new HttpError(400, 'รหัสผ่านยาวเกินไป');
  await pool.query(
    `INSERT INTO users (username, password_hash, role, status, full_name) VALUES ($1, $2, 'driver', 'pending', $3)`,
    [username, await bcrypt.hash(password, 10), fullName]
  );
  res.status(201).json({ ok: true, message: 'สมัครสมาชิกแล้ว กรุณารอเจ้าของอู่อนุมัติก่อนเข้าสู่ระบบ' });
});

// ---------- LINE ----------
async function lineApi(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${LINE_TOKEN}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
}

async function ensureLineContact(userId) {
  const found = await pool.query('SELECT 1 FROM line_contacts WHERE line_user_id = $1', [userId]);
  if (found.rowCount) return;
  let name = '';
  let pic = '';
  try {
    const r = await lineApi(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`);
    if (r.ok) {
      const p = await r.json();
      name = String(p.displayName || '').slice(0, 200);
      pic = String(p.pictureUrl || '').slice(0, 500);
    }
  } catch {
    /* ดึงโปรไฟล์ไม่ได้ก็ยังเก็บผู้ติดต่อไว้ได้ */
  }
  await pool.query(
    `INSERT INTO line_contacts (line_user_id, display_name, picture_url) VALUES ($1, $2, $3)
     ON CONFLICT (line_user_id) DO NOTHING`,
    [userId, name, pic]
  );
}

async function handleLineEvent(ev) {
  const userId = ev?.source?.type === 'user' ? ev.source.userId : null;
  if (!userId) return; // ข้ามกลุ่ม/ห้องแชต
  if (ev.type === 'follow') {
    await ensureLineContact(userId);
    await pool.query('UPDATE line_contacts SET following = TRUE WHERE line_user_id = $1', [userId]);
  } else if (ev.type === 'unfollow') {
    await pool.query('UPDATE line_contacts SET following = FALSE WHERE line_user_id = $1', [userId]);
  } else if (ev.type === 'message' && ev.message) {
    await ensureLineContact(userId);
    const m = ev.message;
    let kind = 'other';
    let body = `[${m.type || 'ข้อความ'}]`;
    let media = '';
    if (m.type === 'text') {
      kind = 'text';
      body = String(m.text || '');
    } else if (m.type === 'image') {
      kind = 'image';
      body = '';
      try {
        const r = await lineApi(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(m.id)}/content`);
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const ext = buf.length <= MAX_PHOTO_BYTES ? sniffImage(buf) : null;
          if (ext) {
            media = `line-${crypto.randomUUID()}.${ext}`;
            await fs.promises.writeFile(path.join(UPLOAD_DIR, media), buf, { flag: 'wx' });
          }
        }
      } catch (err) {
        console.error('LINE: ดาวน์โหลดรูปไม่สำเร็จ:', err.message);
      }
      if (!media) body = '[รูปภาพ — โหลดไม่สำเร็จ]';
    } else if (m.type === 'sticker') {
      body = '[สติกเกอร์]';
    }
    const ins = await pool.query(
      `INSERT INTO line_messages (line_user_id, direction, kind, body, media, line_message_id)
       VALUES ($1, 'in', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, kind, body, media, m.id ? String(m.id) : null]
    );
    if (ins.rowCount) {
      await pool.query(
        `UPDATE line_contacts SET unread = unread + 1, last_message_at = NOW(), following = TRUE
         WHERE line_user_id = $1`,
        [userId]
      );
    } else if (media) {
      await removeFiles([media]); // ข้อความซ้ำ (LINE ส่งซ้ำ) ไม่ต้องเก็บไฟล์ซ้ำ
    }
  }
}

// LINE เรียกเข้ามาที่นี่ (ต้องเป็น HTTPS สาธารณะ) ตรวจลายเซ็นด้วย Channel secret ก่อนเชื่อข้อมูลใด ๆ
app.post('/api/line/webhook', async (req, res) => {
  if (!LINE_SECRET) return res.status(503).json({ error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET' });
  const expected = crypto.createHmac('sha256', LINE_SECRET).update(req.rawBody || Buffer.alloc(0)).digest();
  const given = Buffer.from(String(req.get('x-line-signature') || ''), 'base64');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'ลายเซ็นไม่ถูกต้อง' });
  }
  res.status(200).json({ ok: true }); // ตอบ LINE ทันที แล้วค่อยประมวลผล
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  for (const ev of events) {
    try {
      await handleLineEvent(ev);
    } catch (err) {
      console.error('LINE webhook error:', err.message);
    }
  }
});

// ---------- หน้าแรกสาธารณะ: แกลเลอรีรูปงานซ่อม (ไม่ต้องล็อกอิน) ----------
// เปิดเผยเฉพาะรูป + ชื่องานซ่อมของรถเกี่ยวข้าว/รถตีดิน ไม่มีชื่อลูกค้า ทะเบียน หรือราคา
app.get('/api/public/gallery', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (r.id) p.filename, r.issue, r.repair_date AS "date"
       FROM repair_photos p
       JOIN repairs r ON r.id = p.repair_id
       JOIN vehicles v ON v.id = r.vehicle_id
      WHERE v.type IN ('harvester', 'tiller')
      ORDER BY r.id, p.id`
  );
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.set('Cache-Control', 'public, max-age=300');
  res.json(rows.slice(0, 36).map((r) => ({ filename: r.filename, title: r.issue })));
});

app.get('/api/public/photos/:filename', async (req, res) => {
  const name = path.basename(req.params.filename);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw new HttpError(404, 'ไม่พบรูป');
  const { rowCount } = await pool.query(
    `SELECT 1 FROM repair_photos p
       JOIN repairs r ON r.id = p.repair_id
       JOIN vehicles v ON v.id = r.vehicle_id
      WHERE p.filename = $1 AND v.type IN ('harvester', 'tiller')`,
    [name]
  );
  if (!rowCount) throw new HttpError(404, 'ไม่พบรูป');
  res.set({
    'Content-Type': MIME[name.split('.').pop()],
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(path.join(UPLOAD_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'ไม่พบไฟล์รูป' });
  });
});

// ---------- ต่อจากนี้ต้องล็อกอินทุกเส้น ----------
app.use('/api', requireAuth);

app.get('/api/auth/me', async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, role, full_name AS "fullName" FROM users WHERE id = $1', [req.user.sub]);
  if (!rows[0]) throw new HttpError(401, 'ไม่พบบัญชีผู้ใช้');
  res.json(rows[0]);
});

app.put('/api/auth/password', async (req, res) => {
  const b = req.body || {};
  const current = typeof b.current_password === 'string' ? b.current_password : '';
  const next = typeof b.new_password === 'string' ? b.new_password : '';
  if (!current || !next) throw new HttpError(400, 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่');
  if (next.length < 8) throw new HttpError(400, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (next.length > 200) throw new HttpError(400, 'รหัสผ่านใหม่ยาวเกินไป');
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
    throw new HttpError(400, 'รหัสผ่านเดิมไม่ถูกต้อง');
  }
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 10), req.user.sub]);
  res.json({ ok: true });
});

// ---------- จัดการผู้ใช้ (เฉพาะเจ้าของกิจการ) ----------
app.get('/api/users', requireRole('owner'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, role, status, full_name AS "fullName", created_at AS "createdAt"
       FROM users ORDER BY (status = 'pending') DESC, id`
  );
  res.json(rows);
});

app.post('/api/users', requireRole('owner'), async (req, res) => {
  const b = req.body || {};
  const username = reqStr(b, 'username', 'ชื่อผู้ใช้', 50);
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ A-Z, 0-9, จุด, ขีดกลาง, ขีดล่าง (3-50 ตัว)');
  }
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (password.length > 200) throw new HttpError(400, 'รหัสผ่านยาวเกินไป');
  const role = oneOf(b.role, ROLES, 'สิทธิ์');
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, username, role, status, full_name AS "fullName", created_at AS "createdAt"`,
    [username, await bcrypt.hash(password, 10), role]
  );
  res.status(201).json(rows[0]);
});

// อนุมัติบัญชีที่สมัครเข้ามา / เปลี่ยนสิทธิ์ (เจ้าของอู่เท่านั้น)
app.put('/api/users/:id', requireRole('owner'), async (req, res) => {
  const id = toId(req.params.id);
  const b = req.body || {};
  if (id === req.user.sub) throw new HttpError(400, 'ไม่สามารถแก้ไขสิทธิ์ของบัญชีตัวเองได้');
  const sets = [];
  if (b.role !== undefined) sets.push(['role', oneOf(b.role, ROLES, 'สิทธิ์')]);
  if (b.status !== undefined) sets.push(['status', oneOf(b.status, ['active', 'pending'], 'สถานะ')]);
  await updateById('users', id, sets);
  const { rows } = await pool.query(
    'SELECT id, username, role, status, full_name AS "fullName", created_at AS "createdAt" FROM users WHERE id = $1',
    [id]
  );
  res.json(rows[0]);
});

app.delete('/api/users/:id', requireRole('owner'), async (req, res) => {
  const id = toId(req.params.id);
  if (id === req.user.sub) throw new HttpError(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
  const r = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบข้อมูล');
  res.json({ ok: true });
});

// ---------- รถ ----------
// อ่านได้ทุกบทบาท / เพิ่ม-แก้ไข: เจ้าของ, ช่าง / ลบ: เจ้าของ
app.get('/api/vehicles', async (req, res) => {
  const { rows } = await pool.query(`${VEHICLE_SELECT}
    ORDER BY CASE v.type WHEN 'harvester' THEN 1 WHEN 'plow' THEN 2 WHEN 'tiller' THEN 3 ELSE 4 END,
             length(v.id), v.id`);
  res.json(rows);
});

app.get('/api/vehicles/:id', async (req, res) => {
  const row = await selectVehicle(toVehicleId(req.params.id));
  if (!row) throw new HttpError(404, 'ไม่พบรถคันนี้');
  res.json(row);
});

app.post('/api/vehicles', requireRole('owner', 'mechanic'), async (req, res) => {
  const b = req.body || {};
  const type = oneOf(b.type, Object.keys(VEHICLE_TYPES), 'ประเภทรถ');
  const shortName = reqStr(b, 'shortName', 'หมายเลข/ชื่อคัน', 100);
  const model = reqStr(b, 'model', 'รุ่น', 100);
  const plate = reqStr(b, 'plate', 'ทะเบียน', 50);
  const driver = reqStr(b, 'driver', 'คนขับประจำ', 100);
  const status = b.status === undefined || b.status === '' ? 'ready' : oneOf(b.status, VEHICLE_STATUSES, 'สถานะ');
  const hours = optNum(b, 'hours', 'ชั่วโมงใช้งาน', { min: 0, max: 1e7, fallback: 0 });
  const nextService = optNum(b, 'nextService', 'กำหนดบำรุงถัดไป', { min: 1, max: 1e7, fallback: 500 });
  const customerId = await toCustomerId(b.customerId);
  const { label, prefix } = VEHICLE_TYPES[type];

  // รหัสคันรันต่อจากเลขสูงสุดของประเภทนั้น (เช่น H-05 -> H-06) ล็อกกันสร้างพร้อมกันได้เลขซ้ำ
  const id = await withTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(7101)');
    const { rows } = await c.query(
      `SELECT COALESCE(MAX((regexp_match(id, '([0-9]+)$'))[1]::int), 0) + 1 AS n
         FROM vehicles WHERE id LIKE $1`,
      [`${prefix}-%`]
    );
    const newId = `${prefix}-${String(rows[0].n).padStart(2, '0')}`;
    await c.query(
      `INSERT INTO vehicles (id, type, name, short_name, model, plate, driver, status, hours, next_service, customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [newId, type, `${label} ${shortName}`, shortName, model, plate, driver, status, hours, nextService, customerId]
    );
    return newId;
  });
  // ตั้งชื่อรถตามเจ้าของ เช่น "รถเกี่ยวข้าวคุณสมชาย" (ถ้ามีหลายคันเรียง "คันที่ N")
  if (customerId && ['harvester', 'tiller'].includes(type)) await renameVehiclesByOwner([customerId]);
  res.status(201).json(await selectVehicle(id));
});

// รถที่ไม่มีเจ้าของ: ใช้ชื่อ "ประเภท + รุ่น" เช่น "รถเกี่ยวข้าว Kubota DC-70"
async function renameUnownedVehicles() {
  await pool.query(
    `UPDATE vehicles
        SET name = CASE type WHEN 'harvester' THEN 'รถเกี่ยวข้าว ' ELSE 'รถตีดิน ' END || regexp_replace(model, '\\s*\\+.*$', ''),
            short_name = regexp_replace(model, '\\s*\\+.*$', '')
      WHERE customer_id IS NULL AND type IN ('harvester', 'tiller')`
  );
}

// ทำให้ชื่อรถทุกคันตรงกับเจ้าของปัจจุบันเสมอ (เรียกตอนเปิดเซิร์ฟเวอร์ กันชื่อค้างจากการแก้เจ้าของวิธีเก่า)
async function syncAllVehicleNames() {
  const { rows } = await pool.query('SELECT id FROM customers');
  await renameVehiclesByOwner(rows.map((r) => r.id));
  await renameUnownedVehicles();
}

// ตั้งชื่อรถเกี่ยว/รถตีดินตามเจ้าของ เช่น "รถเกี่ยวข้าวคุณจิระเดช" (ถ้ามีหลายคันเรียง "คันที่ N")
async function renameVehiclesByOwner(customerIds) {
  const ids = [...new Set(customerIds.filter((x) => x))];
  if (!ids.length) return;
  const { rows } = await pool.query(
    `SELECT v.id, v.type, v.model, v.customer_id, cu.name AS cname
       FROM vehicles v LEFT JOIN customers cu ON cu.id = v.customer_id
      WHERE v.type IN ('harvester','tiller') AND v.customer_id = ANY($1::int[])
      ORDER BY v.id`, [ids]);
  const first = (n) => (n || '').replace(/^คุณ\s*/, '').trim().split(/\s+/)[0];
  const modelShort = (m) => m.replace(/\s*\+.*$/, '').replace(/^(Kubota|Yanmar|Iseki|CLAAS)\s+/, '');
  const groups = {};
  for (const r of rows) (groups[`${r.customer_id}|${r.type}`] ||= []).push(r);
  for (const list of Object.values(groups)) {
    for (const [i, r] of list.entries()) {
      const no = list.length > 1 ? ` คันที่ ${i + 1}` : '';
      await pool.query('UPDATE vehicles SET name=$2, short_name=$3 WHERE id=$1', [
        r.id,
        `${VEHICLE_TYPES[r.type].label}คุณ${first(r.cname)}${no}`,
        `${modelShort(r.model)} · ${first(r.cname)}${no}`,
      ]);
    }
  }
}

app.put('/api/vehicles/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const id = toVehicleId(req.params.id);
  const b = req.body || {};
  const sets = [];
  if (b.model !== undefined) sets.push(['model', reqStr(b, 'model', 'รุ่น', 100)]);
  if (b.plate !== undefined) sets.push(['plate', reqStr(b, 'plate', 'ทะเบียน', 50)]);
  if (b.driver !== undefined) sets.push(['driver', reqStr(b, 'driver', 'คนขับประจำ', 100)]);
  if (b.status !== undefined) sets.push(['status', oneOf(b.status, VEHICLE_STATUSES, 'สถานะ')]);
  if (b.hours !== undefined) sets.push(['hours', optNum(b, 'hours', 'ชั่วโมงใช้งาน', { min: 0, max: 1e7, fallback: 0 })]);
  if (b.nextService !== undefined) {
    sets.push(['next_service', optNum(b, 'nextService', 'กำหนดบำรุงถัดไป', { min: 1, max: 1e7, fallback: 500 })]);
  }
  if (b.customerId !== undefined) sets.push(['customer_id', await toCustomerId(b.customerId)]);
  if (b.fuel !== undefined) sets.push(['fuel', Math.round(optNum(b, 'fuel', 'ระดับน้ำมัน', { min: 0, max: 100, fallback: 100 }))]);
  if (b.shortName !== undefined) {
    const shortName = reqStr(b, 'shortName', 'หมายเลข/ชื่อคัน', 100);
    const cur = await selectVehicle(id);
    if (!cur) throw new HttpError(404, 'ไม่พบรถคันนี้');
    sets.push(['short_name', shortName], ['name', `${VEHICLE_TYPES[cur.type].label} ${shortName}`]);
  }
  const before = b.customerId !== undefined ? await selectVehicle(id) : null;
  await updateById('vehicles', id, sets);
  if (before) {
    const after = await selectVehicle(id);
    if (after && before.customerId !== after.customerId) {
      if (!after.customerId && ['harvester', 'tiller'].includes(after.type)) {
        // ไม่มีเจ้าของแล้ว: ใช้ชื่อรุ่นแทน
        await renameUnownedVehicles();
      }
      await renameVehiclesByOwner([before.customerId, after.customerId]);
    }
  }
  res.json(await selectVehicle(id));
});

app.delete('/api/vehicles/:id', requireRole('owner'), async (req, res) => {
  const r = await pool.query('DELETE FROM vehicles WHERE id = $1', [toVehicleId(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบรถคันนี้');
  res.json({ ok: true });
});

// ---------- ประวัติการซ่อม ----------
app.get('/api/repairs', async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.vehicleId) {
    params.push(toVehicleId(req.query.vehicleId));
    where.push(`r.vehicle_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `${REPAIR_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY r.repair_date DESC, r.id DESC`,
    params
  );
  res.json(rows);
});

app.post('/api/repairs', requireRole('owner', 'mechanic'), async (req, res) => {
  const b = req.body || {};
  const vehicleId = toVehicleId(b.vehicleId);
  const date = optDate(b, 'date', 'วันที่', null); // ไม่ส่ง = วันนี้ (ตามฐานข้อมูล)
  const issue = reqStr(b, 'issue', 'อาการ / งานที่ทำ', 300);
  const part = optStr(b, 'part', 'อะไหล่ที่เปลี่ยน', 300, '-');
  const cost = optNum(b, 'cost', 'ค่าใช้จ่าย', { min: 0, max: 1e9, fallback: 0 });
  const tech = reqStr(b, 'tech', 'ช่างผู้รับผิดชอบ', 100);
  const note = optStr(b, 'note', 'หมายเหตุ', 1000, '');
  // นัดติดตามหลังซ่อมอัตโนมัติ: กี่วันหลังซ่อม (0 = ไม่นัด) และช่องทาง
  const followUpDays = Math.round(optNum(b, 'followUpDays', 'จำนวนวันที่ติดตาม', { min: 0, max: 365, fallback: 7 }));
  const followUpChannel = b.followUpChannel === undefined || b.followUpChannel === ''
    ? 'line' : oneOf(b.followUpChannel, FOLLOWUP_CHANNELS, 'ช่องทางติดตาม');

  const id = await withTx(async (c) => {
    const ins = await c.query(
      `INSERT INTO repairs (vehicle_id, repair_date, issue, part, cost, tech, note)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7)
       RETURNING id, repair_date`,
      [vehicleId, date, issue, part, cost, tech, note]
    );
    if (followUpDays > 0) {
      await c.query(
        `INSERT INTO followups (repair_id, due_date, channel) VALUES ($1, $2::date + $3::int, $4)`,
        [ins.rows[0].id, ins.rows[0].repair_date, followUpDays, followUpChannel]
      );
    }
    // งานซ่อมล่าสุดของรถเกี่ยวข้าว/รถตีดิน: สร้างแจ้งเตือนตรวจเช็คต่อเนื่อง 180 วันหลังซ่อม (แทนอันเดิมของคันนี้)
    const vt = (await c.query('SELECT type FROM vehicles WHERE id = $1', [vehicleId])).rows[0]?.type;
    if (vt === 'harvester' || vt === 'tiller') {
      const latest = await c.query('SELECT id FROM repairs WHERE vehicle_id = $1 ORDER BY repair_date DESC, id DESC LIMIT 1', [vehicleId]);
      if (latest.rows[0]?.id === ins.rows[0].id) {
        await c.query("DELETE FROM alerts WHERE vehicle_id = $1 AND item LIKE 'ตรวจติดตามหลังซ่อม:%'", [vehicleId]);
        await c.query(
          `INSERT INTO alerts (vehicle_id, item, due, urgency, due_date) VALUES ($1, $2, '', 'normal', $3::date + 180)`,
          [vehicleId, `ตรวจติดตามหลังซ่อม: ${issue}`, ins.rows[0].repair_date]
        );
      }
    }
    // อัปเดต "ซ่อมบำรุงล่าสุด" ของรถ ให้เป็นวันที่ใหม่กว่าเสมอ
    await c.query(
      `UPDATE vehicles SET last_service = GREATEST(COALESCE(last_service, $2::date), $2::date) WHERE id = $1`,
      [vehicleId, ins.rows[0].repair_date]
    );
    return ins.rows[0].id;
  });
  res.status(201).json(await selectRepair(id));
});

app.put('/api/repairs/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const id = toId(req.params.id);
  const b = req.body || {};
  const sets = [];
  if (b.date !== undefined) sets.push(['repair_date', optDate(b, 'date', 'วันที่')]);
  if (b.issue !== undefined) sets.push(['issue', reqStr(b, 'issue', 'อาการ / งานที่ทำ', 300)]);
  if (b.part !== undefined) sets.push(['part', optStr(b, 'part', 'อะไหล่ที่เปลี่ยน', 300, '-')]);
  if (b.cost !== undefined) sets.push(['cost', optNum(b, 'cost', 'ค่าใช้จ่าย', { min: 0, max: 1e9, fallback: 0 })]);
  if (b.tech !== undefined) sets.push(['tech', reqStr(b, 'tech', 'ช่างผู้รับผิดชอบ', 100)]);
  if (b.note !== undefined) sets.push(['note', optStr(b, 'note', 'หมายเหตุ', 1000, '')]);
  if (sets.some(([c, v]) => c === 'repair_date' && v === null)) throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
  await updateById('repairs', id, sets);
  res.json(await selectRepair(id));
});

app.delete('/api/repairs/:id', requireRole('owner'), async (req, res) => {
  const id = toId(req.params.id);
  const photos = await pool.query('SELECT filename FROM repair_photos WHERE repair_id = $1', [id]);
  const r = await pool.query('DELETE FROM repairs WHERE id = $1', [id]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบข้อมูล');
  await removeFiles(photos.rows.map((p) => p.filename));
  res.json({ ok: true });
});

// ---------- รูปถ่ายงานซ่อม ----------
// ส่งไฟล์รูปดิบเป็น body (Content-Type: image/*) เช่น fetch(url, { method:'POST', body: file })
// ?kind=before|after   (หน้าเว็บย่อรูปให้เล็กลงก่อนอัปโหลดอยู่แล้ว)
app.post(
  '/api/repairs/:id/photos',
  requireRole('owner', 'mechanic'),
  express.raw({ type: 'image/*', limit: MAX_PHOTO_BYTES }),
  async (req, res) => {
    const repairId = toId(req.params.id);
    const kind = req.query.kind === undefined ? 'after' : oneOf(req.query.kind, ['before', 'after'], 'ชนิดรูป');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'ไม่พบไฟล์รูป (ต้องเป็น JPG, PNG หรือ WebP)');
    const ext = sniffImage(req.body);
    if (!ext) throw new HttpError(400, 'ไฟล์ที่ส่งมาไม่ใช่รูป JPG, PNG หรือ WebP');

    const exists = await pool.query('SELECT 1 FROM repairs WHERE id = $1', [repairId]);
    if (!exists.rowCount) throw new HttpError(404, 'ไม่พบงานซ่อมนี้');
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM repair_photos WHERE repair_id = $1', [repairId]);
    if (count.rows[0].n >= MAX_PHOTOS_PER_REPAIR) {
      throw new HttpError(400, `แนบรูปได้ไม่เกิน ${MAX_PHOTOS_PER_REPAIR} รูปต่องานซ่อม`);
    }

    const filename = `${crypto.randomUUID()}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), req.body, { flag: 'wx' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO repair_photos (repair_id, filename, kind) VALUES ($1, $2, $3)
         RETURNING id, filename, kind`,
        [repairId, filename, kind]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      await removeFiles([filename]);
      throw err;
    }
  }
);

// ดูรูป (ต้องล็อกอิน: หน้าเว็บดึงด้วย Authorization header แล้วแสดงเป็น blob)
app.get('/api/photos/:filename', async (req, res) => {
  const name = path.basename(req.params.filename);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw new HttpError(404, 'ไม่พบรูป');
  const { rowCount } = await pool.query('SELECT 1 FROM repair_photos WHERE filename = $1', [name]);
  if (!rowCount) throw new HttpError(404, 'ไม่พบรูป');
  res.set({
    'Content-Type': MIME[name.split('.').pop()],
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(path.join(UPLOAD_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'ไม่พบไฟล์รูป' });
  });
});

app.delete('/api/photos/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM repair_photos WHERE id = $1 RETURNING filename', [toId(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, 'ไม่พบรูป');
  await removeFiles([rows[0].filename]);
  res.json({ ok: true });
});

// ---------- ลูกค้า ----------
app.get('/api/customers', async (req, res) => {
  const { rows } = await pool.query(`${CUSTOMER_SELECT} ORDER BY c.name, c.id`);
  res.json(rows);
});

function customerFields(b, partial) {
  const sets = [];
  const add = (key, col, fn) => {
    if (!partial || b[key] !== undefined) sets.push([col, fn()]);
  };
  add('name', 'name', () => reqStr(b, 'name', 'ชื่อลูกค้า', 150));
  add('phone', 'phone', () => optStr(b, 'phone', 'เบอร์โทร', 30, ''));
  add('lineId', 'line_id', () => optStr(b, 'lineId', 'LINE ID', 100, ''));
  add('address', 'address', () => optStr(b, 'address', 'ที่อยู่', 300, ''));
  add('note', 'note', () => optStr(b, 'note', 'หมายเหตุ', 500, ''));
  return sets;
}

app.post('/api/customers', requireRole('owner', 'mechanic'), async (req, res) => {
  const sets = customerFields(req.body || {}, false);
  const { rows } = await pool.query(
    `INSERT INTO customers (${sets.map(([c]) => c).join(', ')})
     VALUES (${sets.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    sets.map(([, v]) => v)
  );
  res.status(201).json(await selectCustomer(rows[0].id));
});

app.put('/api/customers/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const id = toId(req.params.id);
  await updateById('customers', id, customerFields(req.body || {}, true));
  await renameVehiclesByOwner([id]); // เปลี่ยนชื่อลูกค้า ชื่อรถของเขาเปลี่ยนตาม
  res.json(await selectCustomer(id));
});

app.delete('/api/customers/:id', requireRole('owner'), async (req, res) => {
  // รถของลูกค้าคนนี้จะยังอยู่ แค่ไม่ผูกกับลูกค้า (ON DELETE SET NULL)
  const r = await pool.query('DELETE FROM customers WHERE id = $1', [toId(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบลูกค้า');
  await renameUnownedVehicles();
  res.json({ ok: true });
});

// ---------- แชต LINE (เจ้าของ/ช่างเท่านั้น) ----------
const LINE_CONTACT_SELECT = `
  SELECT c.line_user_id AS id, c.display_name AS "displayName", c.picture_url AS "pictureUrl",
         c.customer_id AS "customerId", cu.name AS "customerName", c.following, c.unread,
         c.last_message_at AS "lastMessageAt",
         (SELECT CASE WHEN m.kind = 'image' THEN '[รูปภาพ]' ELSE LEFT(m.body, 80) END
            FROM line_messages m WHERE m.line_user_id = c.line_user_id ORDER BY m.id DESC LIMIT 1) AS "lastText"
  FROM line_contacts c LEFT JOIN customers cu ON cu.id = c.customer_id`;
const toLineUserId = (v) => {
  if (typeof v !== 'string' || !/^U[0-9a-f]{32}$/.test(v)) throw new HttpError(400, 'รหัสผู้ติดต่อ LINE ไม่ถูกต้อง');
  return v;
};
const lineRoles = requireRole('owner', 'mechanic');

app.get('/api/line/status', lineRoles, (req, res) => {
  res.json({
    configured: lineConfigured(),
    webhookPath: '/api/line/webhook',
    secretSet: !!LINE_SECRET,
    tokenSet: !!LINE_TOKEN,
    basicId: LINE_OA_ID,
  });
});

app.get('/api/line/contacts', lineRoles, async (req, res) => {
  const { rows } = await pool.query(`${LINE_CONTACT_SELECT} ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`);
  res.json(rows);
});

app.put('/api/line/contacts/:id', lineRoles, async (req, res) => {
  const id = toLineUserId(req.params.id);
  const customerId = await toCustomerId(req.body?.customerId);
  const r = await pool.query('UPDATE line_contacts SET customer_id = $1 WHERE line_user_id = $2', [customerId, id]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบผู้ติดต่อ');
  res.json((await pool.query(`${LINE_CONTACT_SELECT} WHERE c.line_user_id = $1`, [id])).rows[0]);
});

// อ่านข้อความ (after = id ข้อความล่าสุดที่หน้าเว็บมีแล้ว) และถือว่าอ่านแล้ว
app.get('/api/line/contacts/:id/messages', lineRoles, async (req, res) => {
  const id = toLineUserId(req.params.id);
  const after = Number.isInteger(Number(req.query.after)) ? Number(req.query.after) : 0;
  const { rows } = await pool.query(
    `SELECT id, direction, kind, body, media, sent_by AS "sentBy", created_at AS "createdAt"
       FROM line_messages WHERE line_user_id = $1 AND id > $2 ORDER BY id LIMIT 500`,
    [id, after]
  );
  await pool.query('UPDATE line_contacts SET unread = 0 WHERE line_user_id = $1 AND unread <> 0', [id]);
  res.json(rows.map((m) => ({ ...m, id: Number(m.id) })));
});

app.post('/api/line/contacts/:id/messages', lineRoles, async (req, res) => {
  if (!lineConfigured()) throw new HttpError(503, 'ยังไม่ได้ตั้งค่า LINE ในไฟล์ .env (LINE_CHANNEL_SECRET และ LINE_CHANNEL_ACCESS_TOKEN)');
  const id = toLineUserId(req.params.id);
  const text = reqStr(req.body || {}, 'text', 'ข้อความ', 2000);
  const c = await pool.query('SELECT following FROM line_contacts WHERE line_user_id = $1', [id]);
  if (!c.rowCount) throw new HttpError(404, 'ไม่พบผู้ติดต่อ');
  if (!c.rows[0].following) throw new HttpError(409, 'ลูกค้าคนนี้บล็อก/เลิกติดตามบัญชี LINE ของอู่แล้ว ส่งข้อความไม่ได้');

  let r;
  try {
    r = await lineApi('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: id, messages: [{ type: 'text', text }] }),
    });
  } catch {
    throw new HttpError(502, 'เชื่อมต่อ LINE ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    if (r.status === 429) throw new HttpError(429, 'ส่งไม่ได้: โควตาข้อความของ LINE Official Account เดือนนี้หมด หรือส่งถี่เกินไป');
    if (r.status === 401) throw new HttpError(502, 'LINE ปฏิเสธ Channel access token กรุณาตรวจสอบค่าใน .env');
    throw new HttpError(502, `LINE ปฏิเสธการส่ง: ${e.message || r.status}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO line_messages (line_user_id, direction, kind, body, sent_by)
     VALUES ($1, 'out', 'text', $2, $3)
     RETURNING id, direction, kind, body, media, sent_by AS "sentBy", created_at AS "createdAt"`,
    [id, text, req.user.username]
  );
  await pool.query('UPDATE line_contacts SET last_message_at = NOW() WHERE line_user_id = $1', [id]);
  res.status(201).json({ ...rows[0], id: Number(rows[0].id) });
});

app.get('/api/line/media/:filename', lineRoles, async (req, res) => {
  const name = path.basename(req.params.filename);
  if (!/^line-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw new HttpError(404, 'ไม่พบรูป');
  const { rowCount } = await pool.query('SELECT 1 FROM line_messages WHERE media = $1', [name]);
  if (!rowCount) throw new HttpError(404, 'ไม่พบรูป');
  res.set({
    'Content-Type': MIME[name.split('.').pop()],
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(path.join(UPLOAD_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'ไม่พบไฟล์รูป' });
  });
});

// ---------- ติดตามหลังซ่อม ----------
// ?status=pending|done|skipped (ไม่ส่ง = ทั้งหมด)  ที่ค้างอยู่เรียงตามวันนัดก่อน
app.get('/api/followups', async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) {
    params.push(oneOf(req.query.status, FOLLOWUP_STATUSES, 'สถานะ'));
    where = 'WHERE f.status = $1';
  }
  const { rows } = await pool.query(
    `${FOLLOWUP_SELECT} ${where}
     ORDER BY (f.status = 'pending') DESC, CASE WHEN f.status = 'pending' THEN f.due_date END ASC,
              f.done_at DESC NULLS LAST, f.id DESC`,
    params
  );
  res.json(rows);
});

app.post('/api/followups', requireRole('owner', 'mechanic'), async (req, res) => {
  const b = req.body || {};
  const { rows } = await pool.query(
    `INSERT INTO followups (repair_id, due_date, channel) VALUES ($1, $2::date, $3) RETURNING id`,
    [
      toId(b.repairId),
      optDate(b, 'dueDate', 'วันที่นัดติดตาม') || new Date().toISOString().slice(0, 10),
      b.channel === undefined || b.channel === '' ? 'line' : oneOf(b.channel, FOLLOWUP_CHANNELS, 'ช่องทาง'),
    ]
  );
  res.status(201).json(await selectFollowup(rows[0].id));
});

app.put('/api/followups/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const id = toId(req.params.id);
  const b = req.body || {};
  const sets = [];
  if (b.status !== undefined) {
    const status = oneOf(b.status, FOLLOWUP_STATUSES, 'สถานะ');
    sets.push(['status', status], ['done_at', status === 'pending' ? null : new Date()]);
  }
  if (b.result !== undefined) sets.push(['result', optStr(b, 'result', 'ผลการติดตาม', 500, '')]);
  if (b.channel !== undefined) sets.push(['channel', oneOf(b.channel, FOLLOWUP_CHANNELS, 'ช่องทาง')]);
  if (b.dueDate !== undefined) {
    const d = optDate(b, 'dueDate', 'วันที่นัดติดตาม');
    if (!d) throw new HttpError(400, 'วันที่นัดติดตามไม่ถูกต้อง');
    sets.push(['due_date', d]);
  }
  await updateById('followups', id, sets);
  res.json(await selectFollowup(id));
});

app.delete('/api/followups/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const r = await pool.query('DELETE FROM followups WHERE id = $1', [toId(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบข้อมูล');
  res.json({ ok: true });
});

// ---------- แจ้งเตือนบำรุงรักษา ----------
app.get('/api/alerts', async (req, res) => {
  // ที่ยังไม่จัดคิวขึ้นก่อน แล้วเรียงตามความเร่งด่วน
  const { rows } = await pool.query(`${ALERT_SELECT}
    ORDER BY queued, due_date NULLS LAST, id`);
  res.json(rows);
});

app.post('/api/alerts', requireRole('owner', 'mechanic'), async (req, res) => {
  const b = req.body || {};
  const urgency = b.urgency === undefined || b.urgency === '' ? 'normal' : oneOf(b.urgency, URGENCIES, 'ความเร่งด่วน');
  const dueDate = optDate(b, 'dueDate', 'วันที่ครบกำหนด', null);
  const { rows } = await pool.query(
    `INSERT INTO alerts (vehicle_id, item, due, urgency, due_date) VALUES ($1, $2, $3, $4, $5::date) RETURNING id`,
    [toVehicleId(b.vehicleId), reqStr(b, 'item', 'รายการ', 300), optStr(b, 'due', 'กำหนด', 100, ''), urgency, dueDate]
  );
  res.status(201).json(await selectAlert(rows[0].id));
});

app.put('/api/alerts/:id', requireRole('owner', 'mechanic'), async (req, res) => {
  const id = toId(req.params.id);
  const b = req.body || {};
  const sets = [];
  if (b.queued !== undefined) {
    if (typeof b.queued !== 'boolean') throw new HttpError(400, 'queued ต้องเป็น true หรือ false');
    sets.push(['queued', b.queued]);
  }
  if (b.item !== undefined) sets.push(['item', reqStr(b, 'item', 'รายการ', 300)]);
  if (b.due !== undefined) sets.push(['due', optStr(b, 'due', 'กำหนด', 100, '')]);
  if (b.dueDate !== undefined) sets.push(['due_date', optDate(b, 'dueDate', 'วันที่ครบกำหนด', null)]);
  if (b.urgency !== undefined) sets.push(['urgency', oneOf(b.urgency, URGENCIES, 'ความเร่งด่วน')]);
  await updateById('alerts', id, sets);
  res.json(await selectAlert(id));
});

app.delete('/api/alerts/:id', requireRole('owner'), async (req, res) => {
  const r = await pool.query('DELETE FROM alerts WHERE id = $1', [toId(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'ไม่พบข้อมูล');
  res.json({ ok: true });
});

// ---------- รายงาน (เฉพาะเจ้าของกิจการ) ----------
// ค่าซ่อมรายเดือนย้อนหลัง N เดือน (เดือนที่ไม่มีงานซ่อมจะได้ 0)
app.get('/api/reports/monthly-cost', requireRole('owner'), async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 36);
  const { rows } = await pool.query(
    `SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(SUM(r.cost), 0)::float AS cost
       FROM generate_series(
              date_trunc('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month'),
              date_trunc('month', CURRENT_DATE),
              INTERVAL '1 month') AS m
       LEFT JOIN repairs r ON date_trunc('month', r.repair_date) = m
      GROUP BY m
      ORDER BY m`,
    [months]
  );
  res.json(rows);
});

// ---------- ไม่พบ API ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบเส้นทางนี้' }));

// ---------- เสิร์ฟหน้าเว็บที่ build แล้ว (npm run build) ----------
const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- จัดการข้อผิดพลาดทั้งหมด ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'ไฟล์ใหญ่เกินไป (รูปต้องไม่เกิน 8 MB)' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'รูปแบบ JSON ไม่ถูกต้อง' });

  // ข้อผิดพลาดจาก PostgreSQL ที่เกิดจากข้อมูลที่ส่งมา
  const pgMap = {
    '23502': [400, 'กรอกข้อมูลที่จำเป็นไม่ครบ'],
    '23503': [409, 'ไม่พบข้อมูลที่อ้างถึง หรือข้อมูลนี้ถูกใช้งานอยู่ (เช่น รถที่มีประวัติซ่อมลบไม่ได้)'],
    '23505': [409, 'ข้อมูลนี้มีอยู่แล้ว (ซ้ำ)'],
    '23514': [400, 'ค่าที่ส่งมาอยู่นอกช่วงที่กำหนด'],
    '22P02': [400, 'รูปแบบข้อมูลไม่ถูกต้อง'],
    '22007': [400, 'รูปแบบวันที่ไม่ถูกต้อง'],
    '22003': [400, 'ตัวเลขเกินช่วงที่กำหนด'],
    '22001': [400, 'ข้อความยาวเกินกำหนด'],
  };
  if (pgMap[err.code]) return res.status(pgMap[err.code][0]).json({ error: pgMap[err.code][1] });

  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

syncAllVehicleNames().catch((e) => console.error('ตั้งชื่อรถตามเจ้าของไม่สำเร็จ:', e.message));

app.listen(PORT, (err) => {
  // Express 5 ส่งข้อผิดพลาด (เช่น พอร์ตถูกใช้อยู่) มาทาง callback นี้
  if (err) {
    console.error(`❌ เปิดเซิร์ฟเวอร์ที่พอร์ต ${PORT} ไม่ได้: ${err.message}`);
    console.error('   อาจมีหลังบ้านอีกตัวเปิดค้างอยู่ ให้ปิดเทอร์มินัลเก่าก่อน');
    process.exit(1);
  }
  console.log(` Server is running on http://localhost:${PORT}`);
});
