// ตัวช่วยตรวจข้อมูลที่ส่งมาจากหน้าเว็บ (ไม่พึ่งไลบรารีภายนอก)

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ข้อความที่จำเป็นต้องมี (ตัดช่องว่างหัวท้ายให้)
export function reqStr(body, key, label, max = 200) {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `กรุณากรอก${label}`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${label}ยาวเกินไป (สูงสุด ${max} ตัวอักษร)`);
  return t;
}

// ข้อความที่ไม่บังคับ (ไม่ส่ง/ว่าง = ใช้ fallback)
export function optStr(body, key, label, max = 200, fallback = null) {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return fallback;
  if (typeof v !== 'string') throw new HttpError(400, `${label}ต้องเป็นข้อความ`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${label}ยาวเกินไป (สูงสุด ${max} ตัวอักษร)`);
  return t;
}

// ตัวเลขที่ไม่บังคับ (ไม่ส่ง/ว่าง = ใช้ fallback)
export function optNum(body, key, label, { min = 0, max = 1e9, fallback = null } = {}) {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return fallback;
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${label}ต้องเป็นตัวเลขระหว่าง ${min} ถึง ${max}`);
  }
  return n;
}

// ต้องเป็นหนึ่งในค่าที่กำหนด
export function oneOf(value, list, label) {
  if (typeof value !== 'string' || !list.includes(value)) {
    throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  }
  return value;
}

// วันที่รูปแบบ YYYY-MM-DD (ค.ศ.) ที่มีอยู่จริง
export function optDate(body, key, label, fallback = null) {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return fallback;
  const bad = () => new HttpError(400, `${label}ไม่ถูกต้อง (ต้องเป็นรูปแบบ ปี-เดือน-วัน เช่น 2026-07-28)`);
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad();
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad();
  const year = Number(v.slice(0, 4));
  if (year < 2000 || year > 2100) throw bad();
  return v;
}
