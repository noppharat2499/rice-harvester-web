-- โครงสร้างฐานข้อมูล PostgreSQL ของระบบจัดการซ่อมและติดตามเครื่องจักรกลการเกษตร
-- รันซ้ำได้ปลอดภัย (ใช้ IF NOT EXISTS) :  npm run db:init

-- ผู้ใช้งานระบบ (สิทธิ์: owner = เจ้าของกิจการ, mechanic = ช่างซ่อม, driver = พนักงานขับรถ)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('owner', 'mechanic', 'driver')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

-- ลูกค้า (เจ้าของรถที่นำมาซ่อม) เก็บช่องทางติดต่อไว้ใช้ติดตามหลังซ่อม
CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(30)  NOT NULL DEFAULT '',
  line_id    VARCHAR(100) NOT NULL DEFAULT '',   -- LINE ID ที่ลูกค้าบอก (ใช้ค้นหา/เปิดแชต)
  address    VARCHAR(300) NOT NULL DEFAULT '',
  note       VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- รถ / เครื่องจักรกลการเกษตร  (id เป็นรหัสคัน เช่น H-01, T-02, R-01, C-01)
CREATE TABLE IF NOT EXISTS vehicles (
  id           VARCHAR(20)  PRIMARY KEY,
  type         VARCHAR(20)  NOT NULL CHECK (type IN ('harvester', 'plow', 'tiller', 'truck')),
  name         VARCHAR(150) NOT NULL,
  short_name   VARCHAR(100) NOT NULL,
  model        VARCHAR(100) NOT NULL,
  plate        VARCHAR(50)  NOT NULL,
  driver       VARCHAR(100) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'ready'
               CHECK (status IN ('operating', 'repair', 'ready', 'parked')),
  hours        NUMERIC(10,1) NOT NULL DEFAULT 0   CHECK (hours >= 0),
  next_service NUMERIC(10,1) NOT NULL DEFAULT 500 CHECK (next_service > 0),
  last_service DATE,
  fuel         INTEGER      NOT NULL DEFAULT 100  CHECK (fuel BETWEEN 0 AND 100),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ประวัติการซ่อมและเปลี่ยนอะไหล่ (ลบรถที่มีประวัติซ่อมไม่ได้ เพื่อไม่ให้ประวัติหายโดยไม่ตั้งใจ)
CREATE TABLE IF NOT EXISTS repairs (
  id          SERIAL PRIMARY KEY,
  vehicle_id  VARCHAR(20)   NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  repair_date DATE          NOT NULL DEFAULT CURRENT_DATE,
  issue       VARCHAR(300)  NOT NULL,
  part        VARCHAR(300)  NOT NULL DEFAULT '-',
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  tech        VARCHAR(100)  NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- แจ้งเตือนการบำรุงรักษา (queued = จัดคิวซ่อมแล้ว)
CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  vehicle_id VARCHAR(20)  NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item       VARCHAR(300) NOT NULL,
  due        VARCHAR(100) NOT NULL DEFAULT '',
  urgency    VARCHAR(20)  NOT NULL DEFAULT 'normal' CHECK (urgency IN ('critical', 'warning', 'normal')),
  queued     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ฐานข้อมูลเดิมที่สร้างไว้แล้ว: เพิ่มคอลัมน์ใหม่ (รันซ้ำได้)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE repairs  ADD COLUMN IF NOT EXISTS note VARCHAR(1000) NOT NULL DEFAULT '';

-- รูปถ่ายประกอบงานซ่อม (เก็บไฟล์ในโฟลเดอร์ uploads เก็บเฉพาะชื่อไฟล์ในฐานข้อมูล)
CREATE TABLE IF NOT EXISTS repair_photos (
  id         SERIAL PRIMARY KEY,
  repair_id  INTEGER      NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  filename   VARCHAR(100) NOT NULL UNIQUE,
  kind       VARCHAR(10)  NOT NULL DEFAULT 'after' CHECK (kind IN ('before', 'after')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- นัดติดตามหลังซ่อม (ช่องทาง: โทร / LINE / เข้าไปดูหน้างาน)
CREATE TABLE IF NOT EXISTS followups (
  id         SERIAL PRIMARY KEY,
  repair_id  INTEGER      NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  due_date   DATE         NOT NULL,
  channel    VARCHAR(10)  NOT NULL DEFAULT 'line' CHECK (channel IN ('phone', 'line', 'visit')),
  status     VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  result     VARCHAR(500) NOT NULL DEFAULT '',
  done_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- สมัครสมาชิก: บัญชีใหม่เป็น 'pending' จนกว่าเจ้าของอู่จะอนุมัติ
ALTER TABLE users ADD COLUMN IF NOT EXISTS status    VARCHAR(10)  NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100) NOT NULL DEFAULT '';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'pending'));
  END IF;
END $$;

-- LINE Official Account: คนที่เพิ่มเพื่อน/ทักมา และข้อความแชตทั้งหมด
CREATE TABLE IF NOT EXISTS line_contacts (
  line_user_id    VARCHAR(64)  PRIMARY KEY,
  display_name    VARCHAR(200) NOT NULL DEFAULT '',
  picture_url     VARCHAR(500) NOT NULL DEFAULT '',
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  following       BOOLEAN      NOT NULL DEFAULT TRUE,
  unread          INTEGER      NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_messages (
  id              BIGSERIAL PRIMARY KEY,
  line_user_id    VARCHAR(64)  NOT NULL REFERENCES line_contacts(line_user_id) ON DELETE CASCADE,
  direction       VARCHAR(3)   NOT NULL CHECK (direction IN ('in', 'out')),
  kind            VARCHAR(10)  NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'other')),
  body            TEXT         NOT NULL DEFAULT '',
  media           VARCHAR(100) NOT NULL DEFAULT '',
  line_message_id VARCHAR(64),
  sent_by         VARCHAR(50)  NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS line_messages_lineid_idx ON line_messages(line_message_id) WHERE line_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_line_messages_user ON line_messages(line_user_id, id);
CREATE INDEX IF NOT EXISTS idx_line_contacts_customer ON line_contacts(customer_id);

CREATE INDEX IF NOT EXISTS idx_photos_repair   ON repair_photos(repair_id);
CREATE INDEX IF NOT EXISTS idx_followups_due   ON followups(status, due_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_cust   ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_repairs_vehicle ON repairs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_repairs_date    ON repairs(repair_date);
CREATE INDEX IF NOT EXISTS idx_alerts_vehicle  ON alerts(vehicle_id);
