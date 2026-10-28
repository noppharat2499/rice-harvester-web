# คู่มือ Deploy (เช่า VPS Ubuntu 22.04/24.04) — ทรัพเจริญการช่าง

เหตุผลที่แนะนำ VPS: แอปเก็บรูปซ่อมในโฟลเดอร์ `uploads/` ต้องใช้ดิสก์ที่ไม่หาย
(Render/Railway แบบฟรีลบไฟล์ทุกครั้งที่รีสตาร์ท) ราคาประมาณ 150–300 บาท/เดือน (RAM 1–2 GB พอ)

> ต้องมี: VPS + ชื่อโดเมน (เช่น `sapcharoen.com`) ที่ชี้ A record มาที่ IP ของ VPS

## ก. เตรียมในเครื่องตัวเอง (Windows / PowerShell ที่โฟลเดอร์โปรเจกต์)

1. ลบข้อมูลตัวอย่างออกก่อนขึ้นจริง: ลูกค้า/เบอร์/LINE ID ในระบบตอนนี้เป็นข้อมูลสมมติ
   (บนเซิร์ฟเวอร์ใหม่จะไม่มีข้อมูลเหล่านี้เลย ถ้าไม่รัน `db:seed`)
2. แก้ `og:image` / ชื่อโดเมนใน `index.html` ถ้ามี (ต้องเป็น URL เต็ม https://โดเมนของคุณ/...)
3. ตรวจรูปใน `public/gallery/` ว่าไม่มีป้ายทะเบียน/ใบหน้าที่ไม่ควรเปิดสาธารณะ
4. ทดสอบ build:
```powershell
npm run build
```
5. ส่งโค้ดขึ้น GitHub แบบ **Private** (ไฟล์ `.env`, `uploads`, `node_modules` ถูก ignore อยู่แล้ว)
```powershell
git init
git add .
git commit -m "first deploy"
git branch -M main
git remote add origin https://github.com/<ชื่อคุณ>/rice-harvester-app.git
git push -u origin main
```

## ข. ตั้งค่าเซิร์ฟเวอร์ (SSH เข้า VPS: `ssh root@IP`)

```bash
# 1) อัปเดต + ลง Node 20, PostgreSQL, nginx, git
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs postgresql nginx git certbot python3-certbot-nginx ufw
npm install -g pm2

# 2) ไฟร์วอลล์
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# 3) สร้างผู้ใช้/ฐานข้อมูล (เปลี่ยนรหัสผ่านเป็นของคุณ)
sudo -u postgres psql -c "CREATE USER rice WITH PASSWORD 'ตั้งรหัสผ่านยาวๆ';"
sudo -u postgres psql -c "CREATE DATABASE rice_harvester_db OWNER rice;"

# 4) ดึงโค้ด
cd /opt
git clone https://github.com/<ชื่อคุณ>/rice-harvester-app.git
cd rice-harvester-app
npm install
```

## ค. ตั้งค่า .env บนเซิร์ฟเวอร์

สร้างรหัสลับ:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
แล้วสร้างไฟล์ `nano .env`:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=rice
DB_PASSWORD=รหัสผ่านที่ตั้งไว้ข้อ 3
DB_NAME=rice_harvester_db
PORT=5000
CORS_ORIGIN=https://โดเมนของคุณ
TRUST_PROXY=1
JWT_SECRET=<ผลลัพธ์จากคำสั่งด้านบน>
OWNER_USERNAME=ชื่อผู้ใช้เจ้าของอู่
OWNER_PASSWORD=รหัสผ่านใหม่ที่คาดเดายาก
```
(คีย์ LINE ถ้ามีใช้ ให้ copy ชื่อตัวแปรจาก `.env.example`)

## ง. สร้างตาราง + build + รัน

```bash
npm run db:init        # สร้างตาราง + บัญชีเจ้าของ (ไม่ใส่ข้อมูลตัวอย่าง)
npm run build          # ได้โฟลเดอร์ dist ที่ server.js เสิร์ฟให้เอง
pm2 start server.js --name rice
pm2 save && pm2 startup   # รันคำสั่งที่มันพิมพ์ออกมา เพื่อให้เปิดเองหลังรีบูต
```

## จ. nginx + HTTPS

```bash
cat > /etc/nginx/sites-available/rice <<'CONF'
server {
  server_name โดเมนของคุณ www.โดเมนของคุณ;
  client_max_body_size 20M;
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
CONF
ln -s /etc/nginx/sites-available/rice /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d โดเมนของคุณ -d www.โดเมนของคุณ
```
เปิด `https://โดเมนของคุณ` → ควรเห็นหน้าแรกของอู่ แล้วกด "เข้าสู่ระบบของอู่"

## ฉ. สำรองข้อมูลอัตโนมัติ (ทุกวัน 02:00)

```bash
mkdir -p /opt/backups
cat > /opt/backup.sh <<'SH'
#!/bin/bash
D=$(date +%F)
sudo -u postgres pg_dump rice_harvester_db > /opt/backups/db-$D.sql
tar czf /opt/backups/uploads-$D.tgz -C /opt/rice-harvester-app uploads 2>/dev/null
find /opt/backups -type f -mtime +14 -delete
SH
chmod +x /opt/backup.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/backup.sh") | crontab -
```
ควรดึงไฟล์ใน `/opt/backups` มาเก็บในเครื่อง/ไดรฟ์อีกที่เป็นครั้งคราว (VPS พังก็ไม่เสียข้อมูล)

## ช. อัปเดตระบบครั้งต่อไป

ในเครื่อง: แก้โค้ด → `git add . ; git commit -m "update" ; git push`
บนเซิร์ฟเวอร์:
```bash
cd /opt/rice-harvester-app && git pull && npm install && npm run build && pm2 restart rice
```

## ตรวจเมื่อมีปัญหา
- `pm2 logs rice` ดู error ของแอป
- เข้าไม่ได้/หน้าขาว → `nginx -t`, ตรวจ DNS ชี้ถูก IP
- ล็อกอินแล้วเด้งออก/ CORS error → `CORS_ORIGIN` ต้องตรงโดเมน https ที่ใช้เปิดเว็บ
- ถ้าจะใช้บริการฐานข้อมูลออนไลน์แทน: ตั้ง `DATABASE_URL=...` (และ `DB_SSL=1` ถ้าบังคับ SSL) แทนค่า `DB_*`
