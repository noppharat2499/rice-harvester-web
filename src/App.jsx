import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Home,
  Tractor,
  Wrench,
  Bell,
  BarChart3,
  Menu,
  X,
  ZoomIn,
  ZoomOut,
  Search,
  Languages,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Phone,
  Plus,
  TrendingUp,
  LogOut,
  User,
  Lock,
  ShieldCheck,
  Settings,
  Mail,
  Users,
  MessageCircle,
  Camera,
  ImagePlus,
  Copy,
  ChevronLeft,
  Trash2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  Cell,
} from "recharts";
import { api } from "./api.js";


/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#F6F4EC",
  surface: "#FFFFFF",
  border: "#E4DFCF",
  ink: "#22281F",
  muted: "#6B7568",
  primary: "#1F4D3A",
  primaryDark: "#16342A",
  gold: "#D9A441",
  rust: "#B5482A",
  leaf: "#4C7A54",
  sky: "#4A6FA1",
  soil: "#8B5E3C",
  slate: "#57697A",
};

/* ------------------------------------------------------------------ */
/* Roles                                                                */
/* ------------------------------------------------------------------ */
const ROLES = [
  { id: "owner", label: "เจ้าของกิจการ", nav: ["dashboard", "vehicles", "repairs", "followups", "customers", "alerts", "reports", "settings"] },
  { id: "mechanic", label: "ช่างซ่อม", nav: ["dashboard", "vehicles", "repairs", "followups", "customers", "alerts", "settings"] },
  { id: "driver", label: "พนักงานขับรถ", nav: ["dashboard", "vehicles", "settings"] },
];
const roleById = (id) => ROLES.find((r) => r.id === id);

/* ------------------------------------------------------------------ */
/* Static metadata (ข้อมูลรถ/ซ่อม/แจ้งเตือนอยู่ในฐานข้อมูล PostgreSQL)   */
/* ------------------------------------------------------------------ */
const TYPE_META = {
  harvester: { label: "รถเกี่ยวข้าว", color: C.primary },
  plow: { label: "รถไถ", color: C.sky },
  tiller: { label: "รถตีดิน", color: C.soil },
  truck: { label: "รถสิบล้อ", color: C.slate },
};

const KPIS = [
  { id: "KPI-1", label: "ความถูกต้องของการบันทึกข้อมูลการซ่อม", target: "100%", result: "100%" },
  { id: "KPI-2", label: "ความถูกต้องของตำแหน่ง GPS", target: "≥ 95%", result: "97.4%" },
  { id: "KPI-3", label: "ความพึงพอใจของผู้ใช้งาน", target: "≥ 3.50 / 5.00", result: "4.20 / 5.00" },
  { id: "KPI-4", label: "ความพร้อมใช้งานของระบบ (Uptime)", target: "≥ 95%", result: "98.9%" },
  { id: "KPI-5", label: "ระยะเวลาตอบสนองของระบบ", target: "≤ 3 วินาที", result: "1.8 วินาที" },
];

const STATUS_META = {
  operating: { label: "กำลังซ่อม", color: C.leaf },
  repair: { label: "ซ่อมบำรุง", color: C.rust },
  ready: { label: "เสร็จเรียบร้อย", color: C.sky },
  parked: { label: "จอดพัก", color: C.muted },
};

// จำนวนวันที่เหลือของแจ้งเตือน จากข้อความ "อีก N วัน" / "เกินกำหนดแล้ว N วัน" (เกินกำหนด = ติดลบ)
const alertDays = (a) => {
  const m = String(a.due || "").match(/\d+/);
  if (!m) return /วันนี้/.test(a.due || "") ? 0 : 999;
  return /เกิน/.test(a.due) ? -Number(m[0]) : Number(m[0]);
};

// ตั้งค่าแจ้งเตือน (เก็บในเบราว์เซอร์ของแต่ละเครื่อง) ใช้ร่วมกันระหว่างหน้าตั้งค่า กระดิ่ง และหน้าภาพรวม
const ALERT_PREFS_KEY = "rh_alert_prefs";
const readAlertPrefs = () => {
  try {
    return { on: true, days: 60, ...JSON.parse(localStorage.getItem(ALERT_PREFS_KEY) || "{}") };
  } catch {
    return { on: true, days: 60 };
  }
};
function useAlertPrefs() {
  const [prefs, setPrefs] = useState(readAlertPrefs);
  useEffect(() => {
    const sync = () => setPrefs(readAlertPrefs());
    window.addEventListener("rh-alert-prefs", sync);
    return () => window.removeEventListener("rh-alert-prefs", sync);
  }, []);
  const update = (patch) => {
    const next = { ...readAlertPrefs(), ...patch };
    try { localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new Event("rh-alert-prefs"));
  };
  return [prefs, update];
}

const URGENCY_META = {
  critical: { color: C.rust, label: "เร่งด่วน" },
  warning: { color: C.gold, label: "ใกล้ถึงกำหนด" },
  normal: { color: C.leaf, label: "ปกติ" },
};

const NAV = [
  { id: "dashboard", label: "ภาพรวม", icon: Home },
  { id: "vehicles", label: "รถที่เคยซ่อม", icon: Tractor },
  { id: "repairs", label: "งานซ่อมทั้งหมด", icon: Wrench },
  { id: "followups", label: "โทรติดตามลูกค้า", icon: Phone },
  { id: "customers", label: "ลูกค้า", icon: Users },
  { id: "alerts", label: "แจ้งเตือน", icon: Bell },
  { id: "reports", label: "รายงานสรุป", icon: BarChart3 },
  { id: "settings", label: "ตั้งค่า", icon: Settings },
];

// ประเภทรถที่อู่ใช้งานในระบบ (แสดงเฉพาะรถเกี่ยวข้าวและรถตีดิน)
const SHOWN_TYPES = ["harvester", "tiller"];

// ชื่อรถเกี่ยวข้าว/รถตีดินคิดจากเจ้าของปัจจุบันเสมอ จึงไม่มีทางค้างเป็นชื่อลูกค้าคนเก่า
// เช่น "รถเกี่ยวข้าวคุณธนกฤษ คันที่ 2" (ถ้ายังไม่มีเจ้าของ = "รถเกี่ยวข้าว Kubota DC-70")
function withOwnerNames(vehicles) {
  const first = (n) => String(n || "").replace(/^คุณ\s*/, "").trim().split(/\s+/)[0];
  const groups = {};
  for (const v of vehicles) {
    if (SHOWN_TYPES.includes(v.type) && v.customerId) (groups[`${v.customerId}|${v.type}`] ||= []).push(v);
  }
  const names = new Map();
  for (const list of Object.values(groups)) {
    [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((v, i) => {
      names.set(v.id, `${TYPE_META[v.type].label}คุณ${first(v.customerName)}${list.length > 1 ? ` คันที่ ${i + 1}` : ""}`);
    });
  }
  return vehicles.map((v) => {
    if (!SHOWN_TYPES.includes(v.type)) return v;
    const name = v.customerId ? names.get(v.id) : `${TYPE_META[v.type].label} ${String(v.model || "").replace(/\s*\+.*$/, "")}`;
    return name && name !== v.name ? { ...v, name } : v;
  });
}
const SHOWN_TYPE_ENTRIES = (meta) => Object.entries(meta).filter(([k]) => SHOWN_TYPES.includes(k));
const TYPE_SHORT = { harvester: "เกี่ยว", plow: "ไถ", tiller: "ตีดิน", truck: "สิบล้อ" };
const TYPE_PREFIX = { harvester: "H", plow: "T", tiller: "R", truck: "C" };

const fmtBaht = (n) => n.toLocaleString("th-TH") + " บาท";

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// "2026-07-28" -> "28 ก.ค. 2569"
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "ยังไม่มีประวัติ";
  return `${Number(m[3])} ${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
};

// "2026-07" -> "ก.ค."
const monthLabel = (ym) => THAI_MONTHS[Number(String(ym).slice(5, 7)) - 1] || ym;

// วันที่วันนี้ตามเวลาเครื่อง ในรูปแบบ YYYY-MM-DD (ไม่ใช้ toISOString เพราะจะเพี้ยนเป็น UTC)
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */
function StatusPill({ status }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: `${meta.color}1A`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: `${meta.color}14`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
      <p className="text-sm" style={{ color: C.muted }}>{label}</p>
      <p className="mt-2 text-4xl leading-none" style={{ fontFamily: "'Chonburi', sans-serif", color: accent || C.ink }}>
        {value}
      </p>
      {sub && <p className="mt-2 text-xs" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

function SectionHeading({ title, description, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {/* ชื่อหน้าอยู่ที่แถบด้านบนแล้ว จึงไม่แสดงซ้ำ แต่คงไว้เป็น aria สำหรับโปรแกรมอ่านหน้าจอ */}
        <h2 className="sr-only">{title}</h2>
        {description && <p className="mt-1 text-sm" style={{ color: C.muted }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

// รูปโปรไฟล์ (เจ้าของกิจการใช้ /profile.jpg ถ้าไม่มีไฟล์จะโชว์ตัวอักษรแทน)
function Avatar({ name, role, size = 48 }) {
  const [bad, setBad] = useState(false);
  if (role === "owner" && !bad) {
    return <img src="/profile.jpg" alt={name} onError={() => setBad(true)} className="rounded-full object-cover" style={{ width: size, height: size, border: `2px solid ${C.gold}` }} />;
  }
  return (
    <div className="flex items-center justify-center rounded-full font-medium text-white" style={{ width: size, height: size, background: C.primary, fontSize: size * 0.38 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function BrandLogo({ size = 32 }) {
  return <img src="/logo.svg" alt="ทรัพเจริญการช่าง" width={size} height={size} style={{ borderRadius: size * 0.23, flexShrink: 0 }} />;
}

/* ------------------------------------------------------------------ */
/* หน้าแรก (สาธารณะ): ข้อมูลติดต่อ บริการ และรูปผลงานซ่อม              */
/* ------------------------------------------------------------------ */
const GARAGE_PHONE = "087-115-6213";
// ลิงก์เพิ่มเพื่อน LINE ของอู่ เช่น "https://line.me/ti/p/xxxxxxxx" หรือ "https://line.me/R/ti/p/@abc123"  (เว้นว่างไว้ = ไม่แสดงปุ่ม)
// และให้วางรูป QR code ไว้ที่ public/line-qr.png (ถ้ามีไฟล์นี้ หน้าแรกจะแสดง QR ให้สแกนเอง)
const GARAGE_LINE_URL = "https://line.me/R/ti/p/@248auqee";
const GARAGE_FACEBOOK_URL = "https://www.facebook.com/chang.dech.xu.thraphy.ceriy.kar.chang";
// kw = คำที่ใช้จับคู่กับชื่องานในรูปผลงาน เพื่อเลือกรูปมาแสดงบนการ์ดบริการ
const GARAGE_SERVICES = [
  { name: "รับต่อรถเกี่ยวใหม่", kw: ["ทำโครงรถเกี่ยว", "ขึ้นโครงรถเกี่ยว"] },
  { name: "รับต่อรถตีดิน", kw: ["ใบดันดิน", "รถตีดิน", "พรวนดิน"] },
  { name: "ต่อช่วงล่างใหม่", kw: ["ล้อตีนตะขาบ", "โครงตีนตะขาบ", "ตีนตะขาบ"] },
  { name: "แปลงระบบภายในรถเกี่ยว", kw: ["ยกเครื่อง", "ตรวจเช็คเครื่อง"] },
  { name: "แต่งตู้เบา", kw: ["ตัวถัง", "ฝาครอบ"] },
  { name: "รับทำซี่รอบ", kw: ["ลูกนวด", "ชุดนวด"] },
  { name: "ขึ้นตู้ใหม่", kw: ["โครงและตัวถัง", "โครงตัวถัง"] },
  { name: "ขึ้นโครงรถเกี่ยว", kw: ["ขึ้นโครง", "ทำโครง"] },
  { name: "ผลิตอะไหล่ใหม่ทุกชนิดภายในรถเกี่ยว", kw: ["สกรูลำเลียง", "ท่อลำเลียง", "รางลำเลียง"] },
  { name: "ผลิตเครื่องมือการเกษตรทุกชนิด", kw: ["ใบพรวน", "ชุดพรวน"] },
  { name: "อะไหล่เก่า-ใหม่ทุกชนิด ราคาถูก", kw: ["ใบพัด", "เพลา", "เฟือง"] },
];
// ที่ตั้งอู่ (ใส่ที่อยู่หรือพิกัด เช่น "123 ม.4 ต.xxx อ.xxx จ.xxx" หรือ "14.0123,100.4567" เว้นว่างไว้ = ไม่แสดงส่วนแผนที่)
const GARAGE_ADDRESS = "";
const GARAGE_HOURS = "08:00 – 17:00 น.";
const GARAGE_MAP_QUERY = "14.1570428,100.277458";

// ค่อยๆ เลื่อนขึ้นมาเมื่อเลื่อนหน้าจอมาถึง (ปิดอัตโนมัติถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหว)
function Reveal({ children, delay = 0, className = "" }) {
  const ref = React.useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(26px)",
        transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function HeroCarousel({ items }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [startX, setStartX] = useState(null);
  const n = items.length;
  const go = (d) => setI((v) => (v + d + n) % n);

  useEffect(() => {
    if (paused || n < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % n), 4000);
    return () => clearInterval(id);
  }, [paused, n]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl shadow-2xl"
      style={{ border: "1px solid #ffffff30" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(e) => setStartX(e.clientX)}
      onPointerUp={(e) => {
        if (startX !== null && Math.abs(e.clientX - startX) > 40) go(e.clientX < startX ? 1 : -1);
        setStartX(null);
      }}
    >
      <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${i * 100}%)` }}>
        {items.map((g) => (
          <div key={g.filename} className="relative h-64 w-full shrink-0 md:h-80">
            <img src={g.url} alt={g.title} draggable={false} className="h-full w-full select-none object-cover" />
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 hover:bg-black/65" aria-label="รูปก่อนหน้า">
            <ChevronLeft size={22} color="#fff" />
          </button>
          <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 hover:bg-black/65" aria-label="รูปถัดไป">
            <ChevronRight size={22} color="#fff" />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2.5 py-1.5">
            {items.map((g, k) => (
              <button
                key={g.filename}
                onClick={() => setI(k)}
                aria-label={`รูปที่ ${k + 1}`}
                className="h-1.5 rounded-full transition-all"
                style={{ width: k === i ? 22 : 7, background: k === i ? "#F0C05A" : "#ffffffa0" }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LandingPage({ onLogin }) {
  const [gallery, setGallery] = useState([]);
  const [open, setOpen] = useState(null); // index ของรูปที่เปิดดูเต็มจอ
  const [galleryState, setGalleryState] = useState("loading"); // loading | ok | error
  const [hasQr, setHasQr] = useState(true);

  useEffect(() => {
    // ดึงรูปล่าสุดจากระบบ ถ้าเซิร์ฟเวอร์ไม่ตอบ/ยังไม่มีรูป ใช้รูปผลงานที่เก็บไว้ในเว็บ (public/gallery)
    const fromServer = (g) => g.map((x) => ({ ...x, url: `/api/public/photos/${x.filename}` }));
    const fromStatic = () =>
      fetch("/gallery/gallery.json")
        .then((r) => (r.ok ? r.json() : []))
        .then((g) => g.map((x) => ({ ...x, url: `/gallery/${x.filename}` })));
    api.publicGallery()
      .then((g) => (g.length ? fromServer(g) : fromStatic()))
      .catch(() => fromStatic())
      .then((g) => { setGallery(g); setGalleryState(g.length ? "ok" : "error"); })
      .catch(() => setGalleryState("error"));
  }, []);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i + 1) % gallery.length);
      if (e.key === "ArrowLeft") setOpen((i) => (i - 1 + gallery.length) % gallery.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, gallery.length]);

  const img = (g) => g.url;
  // จับคู่รูปผลงานกับแต่ละบริการ (ไม่ใช้รูปซ้ำ)
  const serviceCards = (() => {
    const used = new Set();
    return GARAGE_SERVICES.map((s) => {
      const photo = gallery.find((g) => !used.has(g.filename) && s.kw.some((k) => g.title.includes(k)));
      if (photo) used.add(photo.filename);
      return { name: s.name, photo };
    });
  })();
  // รูปเด่นที่ต้องขึ้นก่อนในหน้าแรก
  const FEATURED = [
    { filename: "featured-1", url: "/gallery/featured-1.jpg", title: "รถเกี่ยวข้าวที่ต่อใหม่ทั้งคัน" },
    { filename: "featured-2", url: "/gallery/featured-2.jpg", title: "รถเกี่ยวข้าวต่อใหม่ ช่วงล่างใหม่" },
  ];
  const hero = [...FEATURED, ...gallery.slice(0, 6)];
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'IBM Plex Sans Thai', sans-serif", color: C.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Chonburi&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');`}</style>

      {/* แถบบน */}
      <header className="sticky top-0 z-30" style={{ background: "#16342AF2", backdropFilter: "blur(6px)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} />
            <span className="text-lg text-white" style={{ fontFamily: "'Chonburi', sans-serif" }}>ทรัพเจริญการช่าง</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-white/85 md:flex">
            <button onClick={() => jump("services")}>บริการ</button>
            <button onClick={() => jump("gallery")}>ผลงานการซ่อม</button>
            <button onClick={() => jump("contact")}>ติดต่อ</button>
            {GARAGE_MAP_QUERY && <button onClick={() => jump("location")}>ที่ตั้งอู่</button>}
          </nav>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => jump("contact")} aria-label="โทร" title="โทร" className="flex h-9 w-9 items-center justify-center rounded-full transition hover:scale-110" style={{ background: C.gold, color: "#16342A" }}>
                <Phone size={16} />
              </button>
              <button onClick={() => jump("contact")} aria-label="LINE" title="LINE" className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:scale-110" style={{ background: "#06C755" }}>
                <MessageCircle size={17} />
              </button>
              <button onClick={() => jump("contact")} aria-label="Facebook" title="Facebook" className="flex h-9 w-9 items-center justify-center rounded-full transition hover:scale-110" style={{ background: "#1877F2" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.95.4-1.7 1.8-1.7h1.6V3.8c-.3 0-1.3-.2-2.5-.2-2.6 0-4.3 1.6-4.3 4.4v2.5H7.3v3.3h2.8V22h3.4z" /></svg>
              </button>
            </div>
            <span className="hidden h-5 w-px bg-white/25 sm:block" />
          <button
            onClick={onLogin}
            className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:bg-[#F0C05A] hover:text-[#16342A]"
            style={{ borderColor: "#F0C05A99", color: "#F0C05A" }}
          >
            <Lock size={15} /> เข้าสู่ระบบของอู่
          </button>
          </div>
        </div>
      </header>

      {/* ส่วนหัว */}
      <section style={{ background: "linear-gradient(160deg,#16342A 0%,#1F4D3B 100%)" }}>
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-5 py-8 md:grid-cols-2 md:py-10">
          <div>
            <p className="text-sm font-medium" style={{ color: "#F0C05A" }}>อู่ซ่อมและต่อรถเกี่ยวข้าว รถตีดิน</p>
            <h1 className="mt-2 text-4xl text-white md:text-5xl" style={{ fontFamily: "'Chonburi', sans-serif", lineHeight: 1.2 }}>
              อู่ทรัพย์เจริญการช่าง
            </h1>
            <p className="mt-1 text-xl text-white/90">ช่างเดช</p>
            <p className="mt-4 max-w-md text-white/80">
              รับต่อรถเกี่ยวใหม่ รถตีดิน ต่อช่วงล่าง แปลงระบบภายในรถเกี่ยว ซ่อมและผลิตอะไหล่ พร้อมอะไหล่เก่า-ใหม่ราคาถูก
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => jump("gallery")} className="rounded-lg border border-white/40 px-5 py-3 font-medium text-white">
                ดูผลงานการซ่อม
              </button>
            </div>
          </div>
          <div>
            {hero.length >= 2 ? (
              <HeroCarousel items={hero} />
            ) : (
              <img src="/garage-card.jpg" alt="นามบัตรอู่" className="w-full rounded-xl shadow-xl" />
            )}
          </div>
        </div>
      </section>

      {/* บริการ */}
      <section id="services" className="mx-auto max-w-6xl px-5 py-12">
        <Reveal>
          <h2 className="text-2xl font-semibold">บริการของอู่</h2>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>งานซ่อม ต่อ และผลิตสำหรับรถเกี่ยวข้าวและรถตีดิน</p>
        </Reveal>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {serviceCards.map((s, idx) => (
            <Reveal key={s.name} delay={(idx % 3) * 90}>
            <div className="h-full overflow-hidden rounded-xl bg-white transition duration-300 hover:-translate-y-1 hover:shadow-lg" style={{ border: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${C.gold}22` }}>
                  <Wrench size={18} color="#8A6416" />
                </span>
                <span className="text-sm font-semibold">{s.name}</span>
              </div>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ผลงาน */}
      <section id="gallery" style={{ background: "#fff", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div className="mx-auto max-w-6xl px-5 py-12">
          <Reveal>
            <h2 className="text-2xl font-semibold">ผลงานการซ่อม</h2>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>ตัวอย่างงานซ่อมและงานต่อที่อู่เคยทำ กดที่รูปเพื่อดูภาพใหญ่</p>
          </Reveal>
          {gallery.length === 0 ? (
            <p className="mt-6 text-sm" style={{ color: C.muted }}>
              {galleryState === "loading" ? "กำลังโหลดผลงาน..." : galleryState === "error" ? "ยังโหลดรูปผลงานไม่ได้ กรุณารีเฟรชหน้านี้อีกครั้ง" : "ยังไม่มีรูปผลงาน"}
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {gallery.map((g, i) => (
                <Reveal key={g.filename} delay={(i % 4) * 70}>
                <button onClick={() => setOpen(i)} className="group block w-full overflow-hidden rounded-xl text-left transition duration-300 hover:-translate-y-1 hover:shadow-lg" style={{ border: `1px solid ${C.border}` }}>
                  <div className="overflow-hidden">
                    <img src={img(g)} alt={g.title} loading="lazy" className="h-40 w-full object-cover transition-transform duration-300 group-hover:scale-105 md:h-44" />
                  </div>
                  <p className="truncate px-3 py-2 text-sm" style={{ color: C.ink }}>{g.title}</p>
                </button>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ติดต่อ */}
      <section id="contact" className="mx-auto max-w-6xl px-5 py-12">
        <Reveal><h2 className="text-2xl font-semibold">ติดต่ออู่</h2></Reveal>
        <div className="mt-6 grid items-center gap-6 md:grid-cols-2">
          <Reveal>
          <div className="rounded-xl bg-white p-6" style={{ border: `1px solid ${C.border}` }}>
            <p className="text-lg font-semibold">อู่ทรัพย์เจริญการช่าง (ช่างเดช)</p>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>สอบถามงานซ่อม งานต่อรถเกี่ยว และอะไหล่ได้ทางโทรศัพท์</p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" style={{ background: `${C.gold}22`, color: "#8A6416" }}>
              <Clock size={15} /> เปิดทำการ {GARAGE_HOURS}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <a href={`tel:${GARAGE_PHONE.replace(/-/g, "")}`} className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: C.primary }}>
                <Phone size={18} /> {GARAGE_PHONE}
              </a>
              {GARAGE_LINE_URL && (
                <a href={GARAGE_LINE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: "#06C755" }}>
                  <MessageCircle size={18} /> LINE
                </a>
              )}
              {GARAGE_FACEBOOK_URL && (
                <a href={GARAGE_FACEBOOK_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: "#1877F2" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.95.4-1.7 1.8-1.7h1.6V3.8c-.3 0-1.3-.2-2.5-.2-2.6 0-4.3 1.6-4.3 4.4v2.5H7.3v3.3h2.8V22h3.4z" /></svg> Facebook
                </a>
              )}
            </div>
            {hasQr && (
              <div className="mt-5 flex items-center gap-4 rounded-lg p-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                <img src="/line-qr.png" alt="QR code LINE ของอู่" className="h-28 w-28 rounded bg-white object-contain" onError={() => setHasQr(false)} />
                <div>
                  <p className="font-semibold" style={{ color: "#06A94D" }}>สแกนเพื่อแอดไลน์</p>
                  <p className="mt-1 text-sm" style={{ color: C.muted }}>เปิดแอป LINE แล้วสแกน QR นี้ เพื่อคุยกับอู่ได้ทันที</p>
                </div>
              </div>
            )}
          </div>
          </Reveal>
          <Reveal delay={120}>
            <img src="/garage-card.jpg" alt="นามบัตรอู่ทรัพย์เจริญการช่าง" className="w-full rounded-xl shadow-md" style={{ border: `1px solid ${C.border}` }} />
          </Reveal>
        </div>
      </section>

      {GARAGE_MAP_QUERY && (
        <section id="location" className="mx-auto max-w-6xl px-5 pb-12">
          <Reveal>
          <h2 className="text-2xl font-semibold">ที่ตั้งอู่</h2>
          {GARAGE_ADDRESS && <p className="mt-1 text-sm" style={{ color: C.muted }}>{GARAGE_ADDRESS}</p>}
          <div className="mt-5 overflow-hidden rounded-xl" style={{ border: `1px solid ${C.border}` }}>
            <iframe
              title="แผนที่ตั้งอู่ทรัพย์เจริญการช่าง"
              src={`https://www.google.com/maps?q=${encodeURIComponent(GARAGE_MAP_QUERY)}&hl=th&output=embed`}
              className="h-80 w-full md:h-96"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(GARAGE_MAP_QUERY)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold text-white shadow-sm"
            style={{ background: C.primary }}
          >
            <ChevronRight size={18} /> นำทางด้วย Google Maps
          </a>
          </Reveal>
        </section>
      )}

      <footer className="py-6 text-center text-xs" style={{ background: "#16342A", color: "#ffffffaa" }}>
        © อู่ทรัพย์เจริญการช่าง · <a href={GARAGE_FACEBOOK_URL} target="_blank" rel="noreferrer" className="underline">Facebook</a> · <button onClick={onLogin} className="underline">เข้าสู่ระบบสำหรับทางอู่</button>
      </footer>

      {/* ดูรูปเต็มจอ */}
      {open !== null && gallery[open] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setOpen(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/15 p-2" onClick={() => setOpen(null)} aria-label="ปิด"><X size={22} color="#fff" /></button>
          {gallery.length > 1 && (
            <>
              <button className="absolute left-3 rounded-full bg-white/15 p-2" onClick={(e) => { e.stopPropagation(); setOpen((i) => (i - 1 + gallery.length) % gallery.length); }} aria-label="รูปก่อนหน้า"><ChevronLeft size={26} color="#fff" /></button>
              <button className="absolute right-3 rounded-full bg-white/15 p-2" onClick={(e) => { e.stopPropagation(); setOpen((i) => (i + 1) % gallery.length); }} aria-label="รูปถัดไป"><ChevronRight size={26} color="#fff" /></button>
            </>
          )}
          <figure className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <img src={img(gallery[open])} alt={gallery[open].title} className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain" />
            <figcaption className="mt-2 text-center text-sm text-white">{gallery[open].title} · {open + 1}/{gallery.length}</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login page                                                           */
/* ------------------------------------------------------------------ */
function LoginPage({ onLogin, onBack }) {
  const [mode, setMode] = useState("login"); // login | register
  const [fullName, setFullName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (loading) return;
    if (!username.trim() || !password.trim()) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const u = await api.login(username.trim(), password);
      onLogin(u);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (loading) return;
    if (!fullName.trim() || !username.trim() || !password) {
      setError("กรุณากรอกชื่อ-นามสกุล ชื่อผู้ใช้ และรหัสผ่านให้ครบถ้วน");
      return;
    }
    if (password.length < 8) {
      setError("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (password !== confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const r = await api.register({ fullName: fullName.trim(), username: username.trim(), password });
      setNotice(r.message);
      setMode("login");
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chonburi&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>
      {onBack && (
        <button onClick={onBack} className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium shadow-sm" style={{ color: C.primary, border: `1px solid ${C.border}` }}>
          <ChevronLeft size={16} /> กลับหน้าแรก
        </button>
      )}
      <div className="flex min-h-screen">
        <div
          className="relative hidden w-[42%] flex-col justify-between overflow-hidden p-10 lg:flex"
          style={{
            backgroundColor: C.primaryDark,
            backgroundImage: "url('/login-bg.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* ไล่สีเขียวเข้มทับรูป ให้อ่านตัวหนังสือชัด */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(180deg, ${C.primaryDark}CC 0%, ${C.primaryDark}22 30%, ${C.primaryDark}55 55%, ${C.primaryDark}F2 100%)` }}
          />
          <div className="relative flex items-center gap-2">
            <BrandLogo size={40} />
            <span style={{ fontFamily: "'Chonburi', sans-serif", color: "#F6F4EC", fontSize: 20 }}>
              ทรัพเจริญการช่าง
            </span>
          </div>
          <div className="relative">
            <h1 style={{ fontFamily: "'Chonburi', sans-serif", color: "#F6F4EC", fontSize: 34, lineHeight: 1.35 }}>
              บันทึกงานซ่อมรถทางการเกษตร
              <br />
              และติดตามหลังการซ่อม
            </h1>
            <p className="mt-4 max-w-sm text-sm" style={{ color: "#D7E3D5" }}>
              บันทึกงานซ่อมรายคัน พร้อมรูปถ่ายและราคา และติดตามลูกค้าหลังซ่อม
            </p>
          </div>
          <p className="relative text-xs" style={{ color: "#9FB6A4" }}>
            
          </p>
        </div>

        <div
          className="flex flex-1 items-center justify-center p-6"
          style={{ background: C.bg }}
        >
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-2 lg:hidden">
              <BrandLogo size={34} />
              <span style={{ fontFamily: "'Chonburi', sans-serif", color: C.ink, fontSize: 18 }}>
                ทรัพเจริญการช่าง
              </span>
            </div>

            <h2 className="text-2xl font-semibold" style={{ color: C.ink }}>{isRegister ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</h2>
            <p className="mt-1 text-sm" style={{ color: '#2B4A3A' }}>
              {isRegister ? "บัญชีใหม่ต้องรอเจ้าของอู่อนุมัติก่อนจึงจะเข้าใช้งานได้" : "สำหรับเจ้าของอู่และทีมงานที่ได้รับอนุมัติ"}
            </p>

            {notice && !isRegister && (
              <p className="mt-4 rounded-lg p-3 text-xs font-medium" style={{ background: `${C.leaf}18`, color: C.leaf }}>{notice}</p>
            )}

            {isRegister && (
              <div className="mt-5">
                <label className="mb-1.5 block text-xs font-medium" style={{ color: '#2B4A3A' }}>ชื่อ-นามสกุล</label>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                  <User size={16} color={C.muted} />
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="เช่น สมชาย ใจดี"
                    className="w-full bg-transparent text-sm outline-none"
                    style={{ color: C.ink }}
                  />
                </div>
              </div>
            )}

            <div className="mt-5">
              <label className="mb-1.5 block text-xs font-medium" style={{ color: '#2B4A3A' }}>ชื่อผู้ใช้</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <User size={16} color={C.muted} />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="เช่น somchai.j"
                  className="w-full bg-transparent text-sm outline-none"
                  style={{ color: C.ink }}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium" style={{ color: '#2B4A3A' }}>รหัสผ่าน</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Lock size={16} color={C.muted} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !isRegister) handleLogin(); }}
                  placeholder={isRegister ? "อย่างน้อย 8 ตัวอักษร" : "••••••••"}
                  className="w-full bg-transparent text-sm outline-none"
                  style={{ color: C.ink }}
                />
              </div>
            </div>

            {isRegister && (
              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-medium" style={{ color: '#2B4A3A' }}>ยืนยันรหัสผ่าน</label>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                  <Lock size={16} color={C.muted} />
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
                    placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                    className="w-full bg-transparent text-sm outline-none"
                    style={{ color: C.ink }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="mt-3 text-xs font-medium" style={{ color: C.rust }}>{error}</p>
            )}

            <button
              type="button"
              onClick={isRegister ? handleRegister : handleLogin}
              disabled={loading}
              className="mt-6 w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: C.primary }}
            >
              {loading ? "กำลังดำเนินการ..." : isRegister ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}
            </button>

            <p className="mt-4 text-center text-sm" style={{ color: '#2B4A3A' }}>
              {isRegister ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?"}{" "}
              <button
                type="button"
                onClick={() => { setMode(isRegister ? "login" : "register"); setError(""); setNotice(""); }}
                className="font-semibold"
                style={{ color: C.primary }}
              >
                {isRegister ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
              </button>
            </p>

            <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs" style={{ background: `${C.primary}12`, color: C.primary }}>
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              ล็อกอินผิดหลายครั้งติดกัน ระบบจะล็อกชั่วคราว 15 นาที
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pages                                                                */
/* ------------------------------------------------------------------ */
function DashboardPage({ goTo, user, vehicles, repairs, alerts, followups = [] }) {
  const [alertPrefs] = useAlertPrefs();
  const dueFollowups = followups.filter((f) => f.status === "pending" && f.dueDate <= todayISO()).length;
  const vehicleById = (id) => vehicles.find((v) => v.id === id);
  const shownVehicles = vehicles.filter((v) => SHOWN_TYPES.includes(v.type));
  const shownIds = new Set(shownVehicles.map((v) => v.id));
  const shownRepairs = repairs.filter((r) => shownIds.has(r.vehicleId));
  // คันที่ซ่อมเสร็จแล้ว = คันที่มีประวัติซ่อมและตอนนี้ไม่ได้อยู่ระหว่างซ่อม
  const repairedIds = new Set(shownRepairs.map((r) => r.vehicleId));
  const doneRepair = shownVehicles.filter((v) => repairedIds.has(v.id) && v.status !== "repair").length;
  const repairing = shownVehicles.filter((v) => v.status === "repair").length;
  const monthCost = shownRepairs.reduce((s, r) => s + r.cost, 0);
  // แจ้งเตือนที่ต้องทำ: เฉพาะรถเกี่ยวข้าว/รถตีดิน ที่ยังไม่จัดคิว และเพิ่งเกินกำหนดหรือใกล้ถึง (ไม่เกิน 90 วันก่อน – 60 วันข้างหน้า)
  const todoAlerts = alerts
    .filter((a) => alertPrefs.on && shownIds.has(a.vehicleId) && !a.queued && alertDays(a) >= -90 && alertDays(a) <= alertPrefs.days)
    .sort((x, y) => alertDays(x) - alertDays(y));
  const critical = todoAlerts.filter((a) => alertDays(a) < 0).length;
  const counts = SHOWN_TYPES.map(
    (t) => `${TYPE_META[t].label} ${vehicles.filter((v) => v.type === t).length}`
  );

  return (
    <div>
      <SectionHeading
        title={`สวัสดี ${user.username}`}
        description="สถานะเครื่องจักรกลการเกษตรทั้งหมดและงานที่ต้องติดตามวันนี้"
      />
      {dueFollowups > 0 && (
        <button
          type="button"
          onClick={() => goTo("followups")}
          className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left"
          style={{ background: `${C.gold}22`, border: `1px solid ${C.gold}` }}
        >
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: C.ink }}>
            <MessageCircle size={18} color={C.gold} /> ถึงกำหนดติดตามหลังซ่อม {dueFollowups} ราย
          </span>
          <ChevronRight size={16} color={C.muted} />
        </button>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="รถทั้งหมด" value={shownVehicles.length} sub={counts.join(" · ")} />
        <StatCard label="ซ่อมเสร็จแล้ว" value={doneRepair} accent={C.leaf} sub="คันที่ซ่อมเสร็จเรียบร้อย" />
        <StatCard label="อยู่ระหว่างซ่อม" value={repairing} accent={C.rust} sub="รอดำเนินการ" />
        <StatCard label="ค่าซ่อมสะสมทั้งหมด" value={monthCost.toLocaleString("th-TH")} accent={C.gold} sub="บาท" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold" style={{ color: C.ink }}>สถานะรถแต่ละคัน</h3>
            <button onClick={() => goTo("vehicles")} className="flex items-center gap-1 text-sm font-medium" style={{ color: C.primary }}>
              ดูทั้งหมด <ChevronRight size={15} />
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {vehicles.filter((v) => SHOWN_TYPES.includes(v.type)).map((v) => (
              <div key={v.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${TYPE_META[v.type].color}12` }}>
                    <Tractor size={18} color={TYPE_META[v.type].color} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: C.ink }}>{v.name}</p>
                    <p className="text-xs" style={{ color: C.muted }}>{TYPE_META[v.type].label}{v.customerName ? ` · เจ้าของรถ ${v.customerName}` : ""}</p>
                  </div>
                </div>
                <StatusPill status={v.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold" style={{ color: C.ink }}>แจ้งเตือนที่ต้องดำเนินการ</h3>
            <button onClick={() => goTo("alerts")} className="flex items-center gap-1 text-sm font-medium" style={{ color: C.primary }}>
              ทั้งหมด <ChevronRight size={15} />
            </button>
          </div>
          <div className="space-y-3">
            {todoAlerts.length === 0 && <p className="text-sm" style={{ color: C.muted }}>{alertPrefs.on ? "ไม่มีรายการที่ต้องดำเนินการในตอนนี้" : "ปิดการแจ้งเตือนไว้ (เปิดได้ที่หน้าตั้งค่า)"}</p>}
            {todoAlerts.slice(0, 5).map((a) => {
              const d = alertDays(a);
              const color = d < 0 ? C.rust : d <= 45 ? C.gold : C.leaf;
              const v = vehicleById(a.vehicleId);
              return (
                <div key={a.id} className="flex gap-3 pl-3" style={{ borderLeft: `3px solid ${color}` }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: C.ink }}>{v.name}: {String(a.item).replace(/^ตรวจติดตามหลังซ่อม:\s*/, "")}</p>
                    <p className="text-xs" style={{ color }}>{a.due}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {critical > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs" style={{ background: `${C.rust}12`, color: C.rust }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              มี {critical} รายการเกินกำหนดบำรุงรักษาแล้ว ควรจัดคิวซ่อมก่อนออกงานครั้งถัดไป
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ช่องพิมพ์ชื่อเจ้าของรถ: ค้นจากลูกค้าที่มี หรือพิมพ์ชื่อใหม่แล้วกด "เพิ่มเป็นลูกค้าใหม่"
function OwnerInput({ customers, owner, onPick }) {
  const [text, setText] = useState(owner.name || "");
  const [open, setOpen] = useState(false);
  const q = text.trim();
  const matches = customers.filter((c) => !q || c.name.includes(q)).slice(0, 20);
  const exact = customers.some((c) => c.name === q);
  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); onPick({ id: "", name: "", newName: "" }); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="พิมพ์ชื่อลูกค้า เช่น คุณสมชาย ใจดี"
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ border: `1px solid ${C.border}`, color: C.ink }}
      />
      {open && (matches.length > 0 || (q && !exact)) && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-lg bg-white shadow-lg" style={{ border: `1px solid ${C.border}` }}>
          {q && !exact && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick({ id: "", name: q, newName: q }); setText(q); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm font-medium hover:bg-black/5"
              style={{ color: C.primary }}
            >
              + เพิ่ม "{q}" เป็นลูกค้าใหม่
            </button>
          )}
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick({ id: c.id, name: c.name, newName: "" }); setText(c.name); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              style={{ color: C.ink }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddVehicleModal({ customers = [], onClose, onAdd, onAddCustomer }) {
  const [owner, setOwner] = useState({ id: "", name: "", newName: "" });
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("harvester");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [status, setStatus] = useState("ready");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };
  const lab = "mb-1.5 block text-xs font-medium";

  async function handleSubmit() {
    if (saving) return;
    if (!model.trim() || !plate.trim()) {
      setError("กรุณากรอกรุ่นและทะเบียนรถ");
      return;
    }
    setError("");
    setSaving(true);
    try {
      let customerId = owner.id ? Number(owner.id) : null;
      let ownerName = owner.name;
      if (owner.newName) {
        const c = await onAddCustomer({ name: owner.newName, phone: phone.trim() });
        customerId = c.id;
        ownerName = c.name;
      }
      // รหัสคัน (เช่น H-06) และชื่อรถ (เช่น "รถเกี่ยวข้าวคุณสมชาย") ระบบหลังบ้านสร้างให้อัตโนมัติ
      await onAdd({
        type,
        shortName: model.trim(),
        model: model.trim(),
        plate: plate.trim(),
        driver: ownerName || "-",
        status,
        hours: 0,
        nextService: 500,
        customerId,
      });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6" style={{ border: `1px solid ${C.border}` }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: C.ink }}>เพิ่มรถ</h3>
          <button onClick={onClose} aria-label="ปิด"><X size={18} color={C.muted} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={lab} style={{ color: C.muted }}>ประเภทรถ</label>
            <div className="grid grid-cols-2 gap-2">
              {SHOWN_TYPE_ENTRIES(TYPE_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className="rounded-lg py-2 text-xs font-medium"
                  style={{
                    background: type === key ? meta.color : C.surface,
                    color: type === key ? "#fff" : C.muted,
                    border: `1px solid ${type === key ? meta.color : C.border}`,
                  }}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={lab} style={{ color: C.muted }}>เจ้าของรถ (พิมพ์ชื่อ)</label>
            <OwnerInput customers={customers} owner={owner} onPick={setOwner} />
          </div>

          {owner.newName && (
            <div>
              <label className={lab} style={{ color: C.muted }}>เบอร์โทรของ {owner.newName} (ถ้ามี)</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="เช่น 081-234-5678" className={input} style={inputStyle} />
            </div>
          )}

          <div>
            <label className={lab} style={{ color: C.muted }}>รุ่น</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="เช่น Kubota DC-70" className={input} style={inputStyle} />
          </div>

          <div>
            <label className={lab} style={{ color: C.muted }}>ทะเบียน</label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="กข-0000 จังหวัด" className={input} style={inputStyle} />
          </div>

          <div>
            <label className={lab} style={{ color: C.muted }}>สถานะเริ่มต้น</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={input} style={inputStyle}>
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
              ยกเลิก
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
              {saving ? "กำลังบันทึก..." : "บันทึกรถ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VehiclesPage({ openId, onOpened, vehicles, onAddVehicle, onAddCustomer, repairs, canEdit, canDelete, customers, followups, onAddRepair, onAddPhotos, onDeletePhoto, onChangeCustomer }) {
  const [detailId, setDetailId] = useState(openId?.id || null);
  const [detailCustomer, setDetailCustomer] = useState(openId?.customerId || null);
  useEffect(() => {
    if (openId) {
      setDetailId(openId.id);
      setDetailCustomer(openId.customerId || null);
      if (onOpened) onOpened();
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState(vehicles[0]?.id);
  const [showAdd, setShowAdd] = useState(false);

  const vehicleById = (id) => vehicles.find((v) => v.id === id);

  const filtered = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          SHOWN_TYPES.includes(v.type) &&
          (typeFilter === "all" || v.type === typeFilter) &&
          (v.name.includes(query) || v.model.toLowerCase().includes(query.toLowerCase()) || v.driver.includes(query))
      ),
    [vehicles, query, typeFilter]
  );

  const active = vehicleById(selected) || filtered[0];
  const activeRepairs = active ? repairs.filter((r) => r.vehicleId === active.id) : [];

  const detailVehicle = detailId ? vehicleById(detailId) : null;
  if (detailVehicle) {
    return (
      <VehicleDetail
        vehicle={detailVehicle}
        vehicles={vehicles}
        repairs={repairs}
        followups={followups}
        customers={customers}
        canEdit={canEdit}
        canDelete={canDelete}
        initialCustomerId={detailCustomer}
        onBack={() => { setDetailId(null); setDetailCustomer(null); }}
        onAddRepair={onAddRepair}
        onAddPhotos={onAddPhotos}
        onDeletePhoto={onDeletePhoto}
        onChangeCustomer={onChangeCustomer}
      />
    );
  }

  return (
    <div>
      <SectionHeading
        title="รถที่เคยซ่อม"
        description="ข้อมูลรถเกี่ยวข้าวและรถตีดิน"
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 min-w-[220px] items-center gap-2 rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${C.border}` }}>
          <Search size={16} color={C.muted} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาจากรุ่น หรือหมายเลขคัน"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: C.ink }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTypeFilter("all")}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{
              background: typeFilter === "all" ? C.ink : C.surface,
              color: typeFilter === "all" ? "#fff" : C.muted,
              border: `1px solid ${typeFilter === "all" ? C.ink : C.border}`,
            }}
          >
            ทั้งหมด
          </button>
          {SHOWN_TYPE_ENTRIES(TYPE_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{
                background: typeFilter === key ? meta.color : C.surface,
                color: typeFilter === key ? "#fff" : C.muted,
                border: `1px solid ${typeFilter === key ? meta.color : C.border}`,
              }}
            >
              {meta.label}
            </button>
          ))}
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: C.primary }}>
            <Plus size={16} /> เพิ่มรถ
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelected(v.id)}
              className="rounded-xl bg-white p-4 text-left transition-shadow hover:shadow-md"
              style={{ border: `1px solid ${active?.id === v.id ? TYPE_META[v.type].color : C.border}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium" style={{ color: C.ink }}>{v.name}</p>
                <StatusPill status={v.status} />
              </div>
              <div className="mt-2"><TypeBadge type={v.type} /></div>
              <p className="mt-2 text-sm" style={{ color: C.muted }}>{v.model}</p>
              <p className="mt-2 text-xs" style={{ color: C.muted }}>ทะเบียน {v.plate}</p>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm" style={{ color: C.muted }}>ไม่พบรถที่ตรงกับเงื่อนไข</p>}
        </div>

        {active && (
          <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
            <p className="text-xs" style={{ color: C.muted }}>รายละเอียดรถ</p>
            <h3 className="mt-1 text-lg font-semibold" style={{ color: C.ink }}>{active.name}</h3>
            <div className="mt-1"><TypeBadge type={active.type} /></div>
            <p className="mt-2 text-sm" style={{ color: C.muted }}>{active.model} · {active.plate}</p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span style={{ color: C.muted }}>เจ้าของรถ</span><span style={{ color: C.ink }}>{active.customerName || "ยังไม่ระบุ"}</span></div>
              <div className="flex justify-between"><span style={{ color: C.muted }}>ซ่อมบำรุงล่าสุด</span><span style={{ color: C.ink }}>{fmtDate(active.lastService)}</span></div>
            </div>


            <div className="mt-5 border-t pt-4" style={{ borderColor: C.border }}>
              <p className="mb-2 text-xs" style={{ color: C.muted }}>ประวัติการซ่อมของคันนี้</p>
              {activeRepairs.length === 0 && <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีประวัติการซ่อม</p>}
              <button
                type="button"
                onClick={() => { setDetailCustomer(null); setDetailId(active.id); }}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
                style={{ background: C.primary }}
              >
                <Camera size={15} /> ดูประวัติซ่อมรายคัน (ปี / เดือน / รูป / ราคา)
              </button>
              <ul className="space-y-2">
                {activeRepairs.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-sm">
                    <span style={{ color: C.ink }}>{r.issue}</span>
                    <span style={{ color: C.muted }}> — {fmtDate(r.date)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <AddVehicleModal
          customers={customers}
          onAddCustomer={onAddCustomer}
          onClose={() => setShowAdd(false)}
          onAdd={async (v) => {
            const created = await onAddVehicle(v);
            setSelected(created.id);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* อู่ซ่อม: รูปถ่าย ประวัติรายคัน ลูกค้า ติดตามหลังซ่อม                   */
/* ------------------------------------------------------------------ */
const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const CHANNEL_META = {
  phone: { label: "โทรศัพท์" },
  line: { label: "LINE" },
  visit: { label: "ไปดูที่หน้างาน" },
};
const LINE_GREEN = "#06A755";
// หน้าแชตทางการของ LINE Official Account (เปิดในแท็บใหม่ ล็อกอินด้วย LINE ที่เป็นผู้ดูแลบัญชีอู่)
const LINE_CHAT_URL = "https://chat.line.biz/";
const lineAddFriendUrl = (basicId) => `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;

// ย่อรูปจากกล้องมือถือ (ไฟล์หลาย MB) ให้เหลือด้านยาวไม่เกิน 1600px เป็น JPEG ก่อนอัปโหลด
async function shrinkImage(file, max = 1600, quality = 0.82) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error(`ไฟล์ "${file.name}" ต้องเป็นรูป JPG, PNG หรือ WebP`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`เปิดรูป "${file.name}" ไม่ได้`));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error(`ย่อรูป "${file.name}" ไม่สำเร็จ`);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// รูปที่เก็บบนเซิร์ฟเวอร์ (ต้องล็อกอินถึงจะดูได้ จึงดึงด้วย token แล้วแสดงเป็น blob)
function PhotoImg({ filename, source = "photo", alt = "รูปงานซ่อม", className = "", style, onClick }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    let url = null;
    setSrc(null);
    setFailed(false);
    (source === "line" ? api.line.mediaUrl(filename) : api.photoUrl(filename))
      .then((u) => {
        if (dead) URL.revokeObjectURL(u);
        else {
          url = u;
          setSrc(u);
        }
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [filename, source]);

  if (!src) {
    return (
      <div className={`flex items-center justify-center text-xs ${className}`} style={{ background: C.bg, color: C.muted, ...style }}>
        {failed ? "โหลดรูปไม่ได้" : "กำลังโหลด..."}
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} style={style} onClick={onClick} />;
}

function Lightbox({ filename, filenames, index = 0, source, onClose }) {
  const list = filenames && filenames.length ? filenames : [filename];
  const [i, setI] = useState(index);
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = React.useRef(null);
  const moved = React.useRef(false);

  const reset = useCallback(() => { setZ(1); setPos({ x: 0, y: 0 }); }, []);
  const go = useCallback((d) => { setI((v) => (v + d + list.length) % list.length); reset(); }, [list.length, reset]);
  const zoomBy = useCallback((f) => {
    setZ((v) => {
      const nz = Math.min(6, Math.max(1, +(v * f).toFixed(2)));
      if (nz === 1) setPos({ x: 0, y: 0 });
      return nz;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && list.length > 1) go(-1);
      else if (e.key === "ArrowRight" && list.length > 1) go(1);
      else if (e.key === "+" || e.key === "=") zoomBy(1.4);
      else if (e.key === "-") zoomBy(1 / 1.4);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, zoomBy, reset, list.length]);

  const btn = "flex h-9 w-9 items-center justify-center rounded-full bg-white/90 hover:bg-white";
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/85"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2)}
    >
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 p-3">
        <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {list.length > 1 ? `${i + 1} / ${list.length} · ` : ""}ซูม {Math.round(z * 100)}%
        </span>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => zoomBy(1 / 1.4)} aria-label="ซูมออก" title="ซูมออก (-)"><ZoomOut size={18} color={C.ink} /></button>
          <button className={btn} onClick={() => zoomBy(1.4)} aria-label="ซูมเข้า" title="ซูมเข้า (+)"><ZoomIn size={18} color={C.ink} /></button>
          <button className="h-9 rounded-full bg-white/90 px-3 text-xs font-medium hover:bg-white" style={{ color: C.ink }} onClick={reset}>พอดีจอ</button>
          <button className={btn} onClick={onClose} aria-label="ปิด"><X size={18} color={C.ink} /></button>
        </div>
      </div>

      {list.length > 1 && (
        <>
          <button className={`${btn} absolute left-3 top-1/2 z-10 -translate-y-1/2`} onClick={() => go(-1)} aria-label="รูปก่อนหน้า"><ChevronLeft size={20} color={C.ink} /></button>
          <button className={`${btn} absolute right-3 top-1/2 z-10 -translate-y-1/2`} onClick={() => go(1)} aria-label="รูปถัดไป"><ChevronRight size={20} color={C.ink} /></button>
        </>
      )}

      <div
        className="select-none"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})`,
          cursor: z > 1 ? "grab" : "zoom-in",
          transition: drag.current ? "none" : "transform 0.15s ease-out",
          touchAction: "none",
        }}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          moved.current = false;
          drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || z === 1) return;
          moved.current = true;
          setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
        }}
        onPointerUp={() => { drag.current = null; setPos((p) => ({ ...p })); }}
        onClick={() => { if (!moved.current) (z === 1 ? setZ(2.5) : reset()); }}
      >
        <PhotoImg
          key={list[i]}
          filename={list[i]}
          source={source}
          className="rounded-lg object-contain"
          style={{ maxHeight: "86vh", maxWidth: "92vw", pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

// ข้อความติดตามหลังซ่อม (คัดลอกไปส่งทาง LINE / อ่านตอนโทรได้)
function followUpMessage(f) {
  const name = f.customerName || "ลูกค้า";
  return (
    `สวัสดีครับ ${name} จากอู่ทรัพเจริญการช่าง\n` +
    `ขอติดตามผลหลังซ่อม ${f.vehicleName || f.vehicleId} เมื่อวันที่ ${fmtDate(f.repairDate)} (${f.issue})\n` +
    `ตอนนี้ใช้งานเป็นอย่างไรบ้างครับ มีอาการผิดปกติหรือไม่ ถ้ามีแจ้งได้เลยครับ`
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ContactButtons({ phone, lineId, size = "sm", onAdd }) {
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium";
  return (
    <div className="flex flex-wrap gap-2">
      {phone ? (
        <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className={base} style={{ background: C.primary, color: "#fff" }}>
          <Phone size={13} /> โทร {phone}
        </a>
      ) : (
        onAdd ? (
          <button type="button" onClick={onAdd} className={base} style={{ border: `1px dashed ${C.primary}`, color: C.primary }}>+ เพิ่มเบอร์โทร</button>
        ) : (
          <span className={base} style={{ border: `1px dashed ${C.border}`, color: C.muted }}>ยังไม่มีเบอร์โทร</span>
        )
      )}
      {lineId ? (
        <a
          href={`https://line.me/ti/p/~${encodeURIComponent(lineId)}`}
          target="_blank"
          rel="noreferrer"
          className={base}
          style={{ background: LINE_GREEN, color: "#fff" }}
        >
          <MessageCircle size={13} /> เปิด LINE ({lineId})
        </a>
      ) : (
        onAdd ? (
          <button type="button" onClick={onAdd} className={base} style={{ border: `1px dashed ${C.primary}`, color: C.primary }}>+ เพิ่ม LINE ID</button>
        ) : (
          <span className={base} style={{ border: `1px dashed ${C.border}`, color: C.muted }}>ยังไม่มี LINE ID</span>
        )
      )}
    </div>
  );
}

/* ---------- ฟอร์มบันทึกงานซ่อม (มีรูป + นัดติดตาม) ---------- */
// ช่องพิมพ์ค้นหารถ (พิมพ์ชื่อรถ ชื่อเจ้าของ รุ่น หรือทะเบียน แล้วเลือกจากรายการที่ขึ้นมา)
function VehiclePicker({ vehicles, value, onChange, className, style }) {
  const list = useMemo(() => {
    const shown = vehicles.filter((v) => SHOWN_TYPES.includes(v.type) || v.id === value);
    return shown.length ? shown : vehicles;
  }, [vehicles, value]);
  const labelOf = (v) => `${v.name}${v.customerName ? ` · ${v.customerName}` : ""}`;
  const current = vehicles.find((v) => v.id === value);
  const [text, setText] = useState(current ? labelOf(current) : "");
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const matches = list.filter((v) => !q || `${labelOf(v)} ${v.model} ${v.plate}`.toLowerCase().includes(q)).slice(0, 30);
  const pick = (v) => {
    onChange(v.id);
    setText(labelOf(v));
    setOpen(false);
  };
  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={(e) => { e.target.select(); setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); const c = vehicles.find((v) => v.id === value); if (c) setText(labelOf(c)); }, 150)}
        placeholder="พิมพ์ชื่อลูกค้า ชื่อรถ รุ่น หรือทะเบียน"
        className={className}
        style={style}
      />
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg bg-white shadow-lg" style={{ border: `1px solid ${C.border}` }}>
          {matches.length === 0 && <p className="px-3 py-2 text-sm" style={{ color: C.muted }}>ไม่พบรถที่ตรงกับที่พิมพ์</p>}
          {matches.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(v)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              style={{ color: C.ink, background: v.id === value ? C.bg : undefined }}
            >
              {labelOf(v)}
              <span className="block text-xs" style={{ color: C.muted }}>{v.model} · {v.plate}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRepairModal({ vehicles, defaultVehicleId, onClose, onAdd }) {
  const [vehicleId, setVehicleId] = useState(defaultVehicleId || vehicles[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [issue, setIssue] = useState("");
  const [part, setPart] = useState("");
  const [tech, setTech] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [followUpDays, setFollowUpDays] = useState("7");
  const [followUpChannel, setFollowUpChannel] = useState("line");
  const [photos, setPhotos] = useState([]); // { blob, kind, preview }
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const photosRef = React.useRef([]);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const vehicle = vehicles.find((v) => v.id === vehicleId);

  async function pickFiles(fileList, kind) {
    setError("");
    const room = 12 - photos.length;
    const files = Array.from(fileList).slice(0, Math.max(room, 0));
    const added = [];
    for (const f of files) {
      try {
        const blob = await shrinkImage(f);
        added.push({ blob, kind, preview: URL.createObjectURL(blob) });
      } catch (e) {
        setError(e.message);
      }
    }
    setPhotos((prev) => [...prev, ...added]);
  }

  function removePhoto(i) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function handleSubmit() {
    if (saving) return;
    if (!vehicleId || !date.trim() || !issue.trim() || !tech.trim()) {
      setError("กรุณากรอกรถ วันที่ อาการ/งานที่ทำ และช่างผู้รับผิดชอบให้ครบถ้วน");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onAdd({
        vehicleId,
        date: date.trim(),
        issue: issue.trim(),
        part: part.trim() || "-",
        cost: Number(cost) || 0,
        tech: tech.trim(),
        note: note.trim(),
        followUpDays: Number(followUpDays),
        followUpChannel,
        photos: photos.map(({ blob, kind }) => ({ blob, kind })),
      });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };
  const label = "mb-1.5 block text-xs font-medium";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6" style={{ border: `1px solid ${C.border}` }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: C.ink }}>บันทึกงานซ่อม</h3>
          <button onClick={onClose} aria-label="ปิด"><X size={18} color={C.muted} /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label} style={{ color: C.muted }}>รถ</label>
              <VehiclePicker vehicles={vehicles} value={vehicleId} onChange={setVehicleId} className={input} style={inputStyle} />
            </div>
            <div>
              <label className={label} style={{ color: C.muted }}>วันที่ซ่อม</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} style={inputStyle} />
            </div>
          </div>

          <div>
            <label className={label} style={{ color: C.muted }}>อาการ / งานที่ทำ</label>
            <input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="เช่น เปลี่ยนสายพานลำเลียง" className={input} style={inputStyle} />
          </div>

          <div>
            <label className={label} style={{ color: C.muted }}>อะไหล่ที่เปลี่ยน</label>
            <input value={part} onChange={(e) => setPart(e.target.value)} placeholder="เช่น สายพานลำเลียงเมล็ด" className={input} style={inputStyle} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} style={{ color: C.muted }}>ช่างผู้รับผิดชอบ</label>
              <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="ชื่อช่าง" className={input} style={inputStyle} />
            </div>
            <div>
              <label className={label} style={{ color: C.muted }}>ราคารวม (บาท)</label>
              <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className={input} style={inputStyle} />
            </div>
          </div>

          <div>
            <label className={label} style={{ color: C.muted }}>หมายเหตุ (ไม่บังคับ)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="เช่น รับประกันงาน 30 วัน, ลูกค้าให้ระวังเสียงผิดปกติ" className={input} style={inputStyle} />
          </div>

          <div>
            <label className={label} style={{ color: C.muted }}>รูปถ่ายประกอบ ({photos.length}/12)</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p, i) => (
                <div key={p.preview} className="relative overflow-hidden rounded-lg" style={{ border: `1px solid ${C.border}` }}>
                  <img src={p.preview} alt="" className="h-24 w-full object-cover" />
                  <button type="button" onClick={() => removePhoto(i)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1" aria-label="เอารูปออก">
                    <X size={12} color={C.ink} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[["after", "เพิ่มรูปการซ่อม"]].map(([kind, text]) => (
                <label key={kind} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
                  <ImagePlus size={14} /> {text}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      pickFiles(e.target.files, kind);
                      e.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: C.muted }}>ถ่ายจากมือถือได้เลย ระบบย่อรูปให้อัตโนมัติ</p>
          </div>

          <div className="rounded-lg p-3" style={{ background: `${LINE_GREEN}10`, border: `1px solid ${LINE_GREEN}30` }}>
            <p className="mb-2 text-xs font-medium" style={{ color: C.ink }}>
              นัดติดตามหลังซ่อม{vehicle?.customerName ? ` — ${vehicle.customerName}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <select value={followUpDays} onChange={(e) => setFollowUpDays(e.target.value)} className={input} style={inputStyle}>
                <option value="0">ไม่ต้องติดตาม</option>
                <option value="3">อีก 3 วัน</option>
                <option value="7">อีก 7 วัน</option>
                <option value="14">อีก 14 วัน</option>
                <option value="30">อีก 30 วัน</option>
              </select>
              <select value={followUpChannel} onChange={(e) => setFollowUpChannel(e.target.value)} disabled={followUpDays === "0"} className={input} style={inputStyle}>
                {Object.entries(CHANNEL_META).map(([k, m]) => (
                  <option key={k} value={k}>ทาง{m.label}</option>
                ))}
              </select>
            </div>
            {vehicle && !vehicle.customerId && followUpDays !== "0" && (
              <p className="mt-2 text-[11px]" style={{ color: C.rust }}>รถคันนี้ยังไม่ได้ผูกกับลูกค้า — ไปหน้า "รถที่เคยซ่อม" เพื่อเลือกลูกค้า จะได้มีเบอร์/LINE ไว้ติดตาม</p>
            )}
          </div>

          {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
              ยกเลิก
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
              {saving ? "กำลังบันทึก..." : "บันทึกงานซ่อม"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- ประวัติซ่อมรายคัน (แยกปี / เดือน) ---------- */
function RepairCard({ repair, followup, canEdit, canDelete, onAddPhotos, onDeletePhoto }) {
  const [big, setBig] = useState(null);
  const [busy, setBusy] = useState(false);

  async function upload(files, kind) {
    setBusy(true);
    try {
      await onAddPhotos(repair.id, files, kind);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs" style={{ color: C.muted }}>{fmtDate(repair.date)} · {repair.tech}</p>
          <p className="mt-0.5 font-medium" style={{ color: C.ink }}>{repair.issue}</p>
          {repair.part && repair.part !== "-" && (
            <p className="mt-0.5 text-sm" style={{ color: C.muted }}>อะไหล่: {repair.part}</p>
          )}
        </div>
        <p className="text-lg font-semibold" style={{ color: C.primary }}>{fmtBaht(repair.cost)}</p>
      </div>
      {repair.note && <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: C.bg, color: C.ink }}>{repair.note}</p>}

      {repair.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {repair.photos.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-lg" style={{ border: `1px solid ${C.border}` }}>
              <PhotoImg filename={p.filename} className="h-24 w-full cursor-zoom-in object-cover" onClick={() => setBig(p.filename)} />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDeletePhoto(p.id)}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-1"
                  aria-label="ลบรูปนี้"
                >
                  <Trash2 size={12} color={C.rust} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {[["after", "เพิ่มรูปการซ่อม"]].map(([kind, text]) => (
              <label key={kind} className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium" style={{ border: `1px solid ${C.border}`, color: busy ? C.muted : C.ink }}>
                <Camera size={13} /> {busy ? "กำลังอัปโหลด..." : text}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busy}
                  className="hidden"
                  onChange={(e) => {
                    upload(e.target.files, kind);
                    e.target.value = "";
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </div>
      {big && <Lightbox filename={big} onClose={() => setBig(null)} />}
    </div>
  );
}

function VehicleDetail({
  vehicle, vehicles = [], repairs, followups, customers, canEdit, canDelete,
  onBack, onAddRepair, onAddPhotos, onDeletePhoto, onChangeCustomer, initialCustomerId,
}) {
  const [showAdd, setShowAdd] = useState(false);
  // ชื่อลูกค้าที่กำลังดูอยู่ (เลือกจากช่อง หรือมาจากการ์ดนัดติดตาม) ดูอย่างเดียว ไม่ได้ย้ายเจ้าของรถ
  const [viewId, setViewId] = useState(initialCustomerId || vehicle.customerId || "");
  useEffect(() => {
    setViewId(initialCustomerId || vehicle.customerId || "");
  }, [vehicle.id, vehicle.customerId, initialCustomerId]);
  const viewCustomer = customers.find((c) => c.id === Number(viewId)) || null;
  // แสดงงานซ่อมของลูกค้าที่เลือกทุกคัน (ไม่ได้เลือก = เฉพาะคันนี้)
  const ownerVehicles = useMemo(
    () => (viewId ? vehicles.filter((v) => v.customerId === Number(viewId) && SHOWN_TYPES.includes(v.type)) : [vehicle]),
    [vehicles, vehicle, viewId]
  );
  const ownerIds = useMemo(() => new Set(ownerVehicles.map((v) => v.id)), [ownerVehicles]);
  const mine = useMemo(() => repairs.filter((r) => ownerIds.has(r.vehicleId)), [repairs, ownerIds]);
  const years = useMemo(
    () => [...new Set(mine.map((r) => r.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    [mine]
  );
  const [year, setYear] = useState("all");
  const shown = year === "all" ? mine : mine.filter((r) => r.date.startsWith(year));

  const totalCost = shown.reduce((s, r) => s + r.cost, 0);
  const photoCount = shown.reduce((s, r) => s + r.photos.length, 0);

  // จัดกลุ่มตามเดือน (ใหม่ → เก่า)
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of shown) {
      const key = r.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [shown]);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium" style={{ color: C.primary }}>
        <ChevronLeft size={16} /> กลับไปรายการรถ
      </button>

      <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: C.ink }}>{vehicle.name}</h2>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>{vehicle.model} · ทะเบียน {vehicle.plate}</p>
            <div className="mt-2 flex flex-wrap gap-2"><TypeBadge type={vehicle.type} /><StatusPill status={vehicle.status} /></div>
          </div>
          {canEdit && (
            <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: C.primary }}>
              <Plus size={16} /> บันทึกงานซ่อมคันนี้
            </button>
          )}
        </div>

        <div className="mt-4 rounded-lg p-3" style={{ background: C.bg }}>
          <p className="mb-2 text-xs font-medium" style={{ color: C.muted }}>เจ้าของรถ / ช่องทางติดต่อ</p>
          {canEdit && (
            <select
              value={viewId || ""}
              onChange={(e) => setViewId(e.target.value ? Number(e.target.value) : "")}
              className="mb-2 w-full max-w-xs rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: `1px solid ${C.border}`, color: C.ink, background: "#fff" }}
            >
              <option value="">— ยังไม่ผูกลูกค้า —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {viewCustomer ? (
            <>
              <p className="mb-2 text-sm font-medium" style={{ color: C.ink }}>{viewCustomer.name}</p>
              <ContactButtons phone={viewCustomer.phone} lineId={viewCustomer.lineId} />
              {canEdit && Number(viewId) !== (vehicle.customerId || 0) && (
                <button
                  type="button"
                  onClick={() => onChangeCustomer(vehicle.id, Number(viewId))}
                  className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium"
                  style={{ border: `1px solid ${C.primary}`, color: C.primary }}
                >
                  ตั้ง {viewCustomer.name} เป็นเจ้าของรถคันนี้
                </button>
              )}
            </>
          ) : (
            <p className="text-sm" style={{ color: C.muted }}>เลือกลูกค้าเพื่อเก็บเบอร์โทร/LINE ไว้ติดตามหลังซ่อม (เพิ่มลูกค้าใหม่ได้ที่เมนู "ลูกค้า")</p>
          )}
        </div>
      </div>

      {viewCustomer && (
        <p className="mt-5 text-sm font-semibold" style={{ color: C.ink }}>
          งานซ่อมของ{viewCustomer.name} <span className="font-normal" style={{ color: C.muted }}>({ownerVehicles.length} คัน)</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {["all", ...years].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{
              background: year === y ? C.ink : C.surface,
              color: year === y ? "#fff" : C.muted,
              border: `1px solid ${year === y ? C.ink : C.border}`,
            }}
          >
            {y === "all" ? "ทุกปี" : `ปี ${Number(y) + 543}`}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="จำนวนงานซ่อม" value={shown.length} sub="รายการ" />
        <StatCard label="ค่าซ่อมรวม" value={totalCost.toLocaleString("th-TH")} accent={C.gold} sub="บาท" />
        <StatCard label="รูปถ่าย" value={photoCount} accent={C.sky} sub="รูป" />
      </div>

      <div className="mt-6 space-y-6">
        {groups.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center" style={{ border: `1px dashed ${C.border}` }}>
            <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีประวัติซ่อม</p>
          </div>
        )}
        {groups.map(([ym, list]) => (
          <section key={ym}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-base font-semibold" style={{ color: C.ink }}>
                {THAI_MONTHS_FULL[Number(ym.slice(5, 7)) - 1]} {Number(ym.slice(0, 4)) + 543}
              </h3>
              <p className="text-xs" style={{ color: C.muted }}>
                {list.length} งาน · {fmtBaht(list.reduce((s, r) => s + r.cost, 0))}
              </p>
            </div>
            <div className="space-y-3">
              {list.map((r) => (
                <div key={r.id}>
                  <RepairCard
                    repair={r}
                    followup={followups.find((f) => f.repairId === r.id)}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onAddPhotos={onAddPhotos}
                    onDeletePhoto={onDeletePhoto}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {showAdd && (
        <AddRepairModal
          vehicles={[vehicle]}
          defaultVehicleId={vehicle.id}
          onClose={() => setShowAdd(false)}
          onAdd={async (r) => {
            await onAddRepair(r);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- ลูกค้า ---------- */
function CustomerModal({ customer, onClose, onSave }) {
  const [name, setName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [lineId, setLineId] = useState(customer?.lineId || "");
  const [address, setAddress] = useState(customer?.address || "");
  const [note, setNote] = useState(customer?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };

  async function submit() {
    if (saving) return;
    if (!name.trim()) return setError("กรุณากรอกชื่อลูกค้า");
    if (!phone.trim() && !lineId.trim()) return setError("กรอกเบอร์โทรหรือ LINE ID อย่างน้อย 1 อย่าง เพื่อใช้ติดตามหลังซ่อม");
    setError("");
    setSaving(true);
    try {
      await onSave({ name: name.trim(), phone: phone.trim(), lineId: lineId.trim().replace(/^@/, ""), address: address.trim(), note: note.trim() }, customer?.id);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <ModalShell title={customer ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้า"} onClose={onClose}>
      <div className="space-y-3">
        {[
          ["ชื่อลูกค้า", name, setName, "เช่น คุณสมชาย ใจดี", "text"],
          ["เบอร์โทรศัพท์", phone, setPhone, "เช่น 081-234-5678", "tel"],
          ["LINE ID", lineId, setLineId, "เช่น somchai.jd (ถามจากลูกค้า)", "text"],
          ["ที่อยู่ / พื้นที่", address, setAddress, "เช่น ต.บางเลน อ.บางเลน จ.นครปฐม", "text"],
        ].map(([lab, val, set, ph, type]) => (
          <div key={lab}>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>{lab}</label>
            <input type={type} value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className={input} style={inputStyle} />
          </div>
        ))}
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>หมายเหตุ</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} style={inputStyle} placeholder="เช่น โทรได้หลัง 6 โมงเย็น" />
        </div>
        {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>ยกเลิก</button>
          <button type="button" onClick={submit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CustomerDetailModal({ customer: c, vehicles, repairs, followups, canEdit, canDelete, onClose, onEdit, onDelete }) {
  const myVehicles = vehicles.filter((v) => v.customerId === c.id && SHOWN_TYPES.includes(v.type));
  const ids = new Set(myVehicles.map((v) => v.id));
  const myRepairs = repairs.filter((r) => ids.has(r.vehicleId)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const pending = followups.filter((f) => ids.has(f.vehicleId) && f.status === "pending");
  const nameOf = (id) => vehicles.find((v) => v.id === id)?.name || id;
  const total = myRepairs.reduce((s, r) => s + r.cost, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6" style={{ border: `1px solid ${C.border}` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: C.ink }}>{c.name}</h3>
            {c.address && <p className="mt-0.5 text-sm" style={{ color: C.muted }}>{c.address}</p>}
          </div>
          <button onClick={onClose}><X size={18} color={C.muted} /></button>
        </div>
        <div className="mt-3"><ContactButtons phone={c.phone} lineId={c.lineId} /></div>
        {c.note && <p className="mt-2 text-sm" style={{ color: C.muted }}>{c.note}</p>}

        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          {[["รถ", `${myVehicles.length} คัน`], ["งานซ่อม", `${myRepairs.length} รายการ`], ["ค่าซ่อมรวม", fmtBaht(total)]].map(([l, v]) => (
            <div key={l} className="rounded-lg p-3" style={{ background: C.bg }}>
              <p className="text-xs" style={{ color: C.muted }}>{l}</p>
              <p className="mt-0.5 text-sm font-semibold" style={{ color: C.ink }}>{v}</p>
            </div>
          ))}
        </div>

        <p className="mb-2 mt-5 text-sm font-semibold" style={{ color: C.ink }}>รถของลูกค้า</p>
        <div className="space-y-1.5">
          {myVehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${C.border}` }}>
              <span style={{ color: C.ink }}>{v.name} <span style={{ color: C.muted }}>· {v.model} · {v.plate}</span></span>
              <StatusPill status={v.status} />
            </div>
          ))}
          {myVehicles.length === 0 && <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีรถที่ผูกกับลูกค้ารายนี้</p>}
        </div>

        <p className="mb-2 mt-5 text-sm font-semibold" style={{ color: C.ink }}>ประวัติการซ่อม</p>
        <div className="space-y-1.5">
          {myRepairs.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
              <span style={{ color: C.ink }}>
                <span style={{ color: C.muted }}>{fmtDate(r.date)} · {nameOf(r.vehicleId)}</span><br />{r.issue}
              </span>
              <span className="shrink-0 font-medium" style={{ color: C.ink }}>{fmtBaht(r.cost)}</span>
            </div>
          ))}
          {myRepairs.length === 0 && <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีประวัติซ่อม</p>}
        </div>

        {pending.length > 0 && (
          <p className="mt-5 rounded-lg px-3 py-2 text-sm" style={{ background: `${C.gold}22`, color: C.ink }}>
            รอติดตามหลังซ่อม {pending.length} รายการ
          </p>
        )}

        {canEdit && (
          <div className="mt-5 flex gap-2 border-t pt-4" style={{ borderColor: C.border }}>
            <button type="button" onClick={onEdit} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>แก้ไขข้อมูลลูกค้า</button>
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`ลบลูกค้า "${c.name}" ? (รถและประวัติซ่อมยังอยู่ แค่ไม่ผูกกับลูกค้า)`)) onDelete(c.id);
                }}
                className="ml-auto rounded-lg px-4 py-2 text-sm font-medium"
                style={{ border: `1px solid ${C.border}`, color: C.rust }}
              >
                ลบลูกค้า
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomersPage({ customers, vehicles, repairs = [], followups = [], canEdit, canDelete, onSave, onDelete }) {
  const [modal, setModal] = useState(null); // null | "new" | customer (แก้ไข)
  const [detail, setDetail] = useState(null); // ลูกค้าที่เปิดดูรายละเอียด
  const [query, setQuery] = useState("");
  const list = customers.filter(
    (c) => c.name.includes(query) || c.phone.includes(query) || c.lineId.toLowerCase().includes(query.toLowerCase())
  );
  const statsOf = (c) => {
    const mine = vehicles.filter((v) => v.customerId === c.id && SHOWN_TYPES.includes(v.type));
    const ids = new Set(mine.map((v) => v.id));
    const rs = repairs.filter((r) => ids.has(r.vehicleId));
    const last = rs.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), "");
    return {
      mine,
      cars: mine.length,
      last: last ? fmtDate(last) : "-",
      total: rs.reduce((s, r) => s + r.cost, 0),
      pending: followups.filter((f) => ids.has(f.vehicleId) && f.status === "pending").length,
    };
  };
  return (
    <div>
      <SectionHeading
        title="ลูกค้า"
        description="เจ้าของรถที่นำมาซ่อม เก็บเบอร์โทรและ LINE ไว้ติดตามหลังซ่อม"
        action={
          canEdit ? (
            <button onClick={() => setModal("new")} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: C.primary }}>
              <Plus size={16} /> เพิ่มลูกค้า
            </button>
          ) : null
        }
      />
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${C.border}` }}>
        <Search size={16} color={C.muted} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ เบอร์โทร หรือ LINE ID" className="w-full bg-transparent text-sm outline-none" style={{ color: C.ink }} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const st = statsOf(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetail(c)}
              onKeyDown={(e) => e.key === "Enter" && setDetail(c)}
              className="cursor-pointer rounded-xl bg-white p-5 transition-shadow hover:shadow-md"
              style={{ border: `1px solid ${C.border}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold" style={{ color: C.ink }}>{c.name}</p>
                  {c.address && <p className="mt-0.5 text-sm" style={{ color: C.muted }}>{c.address}</p>}
                </div>
                {st.pending > 0 && (
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: `${C.gold}30`, color: C.ink }}>รอติดตาม {st.pending}</span>
                )}
              </div>
              <div className="mt-3" onClick={(e) => e.stopPropagation()}><ContactButtons phone={c.phone} lineId={c.lineId} /></div>
              {c.note && <p className="mt-2 text-sm" style={{ color: C.muted }}>{c.note}</p>}
              {st.mine.length > 0 && (
                <p className="mt-3 text-sm" style={{ color: C.ink }}>
                  รถ: {st.mine.slice(0, 2).map((v) => `${v.id} ${v.model}`).join(", ")}
                </p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs" style={{ borderColor: C.border }}>
                <div><p style={{ color: C.muted }}>จำนวนรถ</p><p className="mt-0.5 text-sm font-semibold" style={{ color: C.ink }}>{st.cars} คัน</p></div>
                <div><p style={{ color: C.muted }}>ซ่อมล่าสุด</p><p className="mt-0.5 text-sm font-semibold" style={{ color: C.ink }}>{st.last}</p></div>
                <div><p style={{ color: C.muted }}>ค่าซ่อมรวม</p><p className="mt-0.5 text-sm font-semibold" style={{ color: C.ink }}>{st.total.toLocaleString("th-TH")} บาท</p></div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีลูกค้า — กด "เพิ่มลูกค้า" เพื่อเริ่มต้น</p>}
      </div>
      {detail && (
        <CustomerDetailModal
          customer={customers.find((x) => x.id === detail.id) || detail}
          vehicles={vehicles}
          repairs={repairs}
          followups={followups}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setDetail(null)}
          onEdit={() => { setModal(customers.find((x) => x.id === detail.id) || detail); setDetail(null); }}
          onDelete={async (id) => { await onDelete(id); setDetail(null); }}
        />
      )}
      {modal && (
        <CustomerModal
          customer={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={async (data, id) => {
            await onSave(data, id);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- ติดตามหลังซ่อม ---------- */
// เพิ่ม/แก้เบอร์โทรและ LINE ID ของลูกค้าได้จากการ์ดนัดติดตามเลย (ถ้ารถยังไม่มีเจ้าของ ให้พิมพ์ชื่อเลือกหรือเพิ่มใหม่ได้ในนี้)
function ContactModal({ f, customers, onClose, onSave }) {
  const hasOwner = !!f.customerId;
  const [owner, setOwner] = useState({ id: "", name: "", newName: "" });
  const [phone, setPhone] = useState(f.customerPhone || "");
  const [lineId, setLineId] = useState(f.customerLine || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };
  const lab = "mb-1.5 block text-xs font-medium";

  async function submit() {
    if (saving) return;
    if (!hasOwner && !owner.id && !owner.newName) return setError("กรุณาพิมพ์ชื่อเจ้าของรถ แล้วเลือกจากรายการ หรือกด + เพิ่มเป็นลูกค้าใหม่");
    if (!phone.trim() && !lineId.trim()) return setError("กรอกเบอร์โทรหรือ LINE ID อย่างน้อย 1 อย่าง");
    setError("");
    setSaving(true);
    try {
      await onSave({
        vehicleId: f.vehicleId,
        customerId: hasOwner ? f.customerId : owner.id ? Number(owner.id) : null,
        newName: hasOwner ? "" : owner.newName,
        phone: phone.trim(),
        lineId: lineId.trim().replace(/^@/, ""),
      });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <ModalShell title="เพิ่มช่องทางติดต่อลูกค้า" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: C.muted }}>{f.vehicleName}</p>
        {hasOwner ? (
          <div>
            <label className={lab} style={{ color: C.muted }}>เจ้าของรถ</label>
            <p className="text-sm font-medium" style={{ color: C.ink }}>{f.customerName}</p>
          </div>
        ) : (
          <div>
            <label className={lab} style={{ color: C.muted }}>เจ้าของรถ (พิมพ์ชื่อ)</label>
            <OwnerInput customers={customers} owner={owner} onPick={(o) => { setOwner(o); if (o.id) { const c = customers.find((x) => x.id === Number(o.id)); if (c) { setPhone(c.phone || ""); setLineId(c.lineId || ""); } } }} />
          </div>
        )}
        <div>
          <label className={lab} style={{ color: C.muted }}>เบอร์โทรศัพท์</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="เช่น 081-234-5678" className={input} style={inputStyle} />
        </div>
        <div>
          <label className={lab} style={{ color: C.muted }}>LINE ID</label>
          <input value={lineId} onChange={(e) => setLineId(e.target.value)} placeholder="เช่น somchai.jd (ถามจากลูกค้า)" className={input} style={inputStyle} />
        </div>
        {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>ยกเลิก</button>
          <button type="button" onClick={submit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function FollowUpCard({ f, canEdit, onUpdate, flash, customers = [], onSaveContact, onOpenVehicle }) {
  const [showContact, setShowContact] = useState(false);
  const [result, setResult] = useState(f.result || "");
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const overdue = f.status === "pending" && f.dueDate < today;
  const isToday = f.status === "pending" && f.dueDate === today;
  const accent = f.status !== "pending" ? C.leaf : overdue ? C.rust : isToday ? C.gold : C.sky;

  async function setStatus(status) {
    setBusy(true);
    try {
      await onUpdate(f.id, { status, result: status === "done" ? result.trim() : status === "pending" ? "" : f.result });
    } catch (e) {
      flash(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    flash((await copyText(followUpMessage(f))) ? "คัดลอกข้อความแล้ว นำไปวางในแชต LINE ได้เลย" : "คัดลอกไม่ได้ ให้เลือกข้อความด้านล่างแล้วคัดลอกเอง");
  }

  return (
    <div className="rounded-xl bg-white p-4" style={{ border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}` }}>
      {showContact && (
        <ContactModal
          f={f}
          customers={customers}
          onClose={() => setShowContact(false)}
          onSave={async (d) => { await onSaveContact(d); setShowContact(false); }}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium" style={{ color: C.ink }}>{f.vehicleName}</p>
          <p className="mt-0.5 text-sm" style={{ color: C.muted }}>
            ซ่อม {fmtDate(f.repairDate)}: {f.issue} ({fmtBaht(f.cost)})
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium" style={{ color: accent }}>
            {f.status === "pending"
              ? overdue ? `เลยกำหนด (${fmtDate(f.dueDate)})` : isToday ? "ติดตามวันนี้" : `นัด ${fmtDate(f.dueDate)}`
              : f.status === "done" ? "ติดตามแล้ว" : "ข้าม"}
          </p>
          <p className="text-xs" style={{ color: C.muted }}>ทาง{CHANNEL_META[f.channel].label}</p>
        </div>
      </div>

      {f.status === "pending" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ContactButtons phone={f.customerPhone} lineId={f.customerLine} onAdd={canEdit && onSaveContact && f.status === "pending" ? () => setShowContact(true) : undefined} />
          </div>
          <textarea readOnly value={followUpMessage(f)} rows={3} className="mt-3 w-full rounded-lg px-3 py-2 text-xs outline-none" style={{ background: C.bg, color: C.ink, border: `1px solid ${C.border}` }} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
              <Copy size={13} /> คัดลอกข้อความ
            </button>
          </div>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: C.border }}>
              <input
                value={result}
                onChange={(e) => setResult(e.target.value)}
                placeholder="ผลการติดตาม เช่น ใช้งานปกติ / มีเสียงดัง นัดเข้าอู่"
                className="min-w-[200px] flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                style={{ border: `1px solid ${C.border}`, color: C.ink }}
              />
              <button type="button" disabled={busy} onClick={() => setStatus("done")} className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
                ติดตามแล้ว
              </button>
              <button type="button" disabled={busy} onClick={() => setStatus("skipped")} className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-60" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
                ข้าม
              </button>
              {onOpenVehicle && (
                <button type="button" onClick={() => onOpenVehicle(f.vehicleId, f.customerId)} className="rounded-lg px-3 py-2 text-xs font-medium" style={{ border: `1px solid ${C.primary}`, color: C.primary }}>
                  ดูประวัติรถ
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm" style={{ color: C.ink }}>{f.result || (f.status === "skipped" ? "ข้ามการติดตาม" : "—")}</p>
          {canEdit && (
            <button type="button" disabled={busy} onClick={() => setStatus("pending")} className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
              ย้อนกลับเป็นรอติดตาม
            </button>
          )}
          {onOpenVehicle && (
            <button type="button" onClick={() => onOpenVehicle(f.vehicleId, f.customerId)} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ border: `1px solid ${C.primary}`, color: C.primary }}>
              ดูประวัติรถ
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddFollowUpModal({ repairs, vehicles, onClose, onCreate }) {
  const plus7 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [repairId, setRepairId] = useState(repairs[0]?.id ? String(repairs[0].id) : "");
  const [dueDate, setDueDate] = useState(plus7());
  const [channel, setChannel] = useState("line");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const vById = (id) => vehicles.find((v) => v.id === id);
  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };

  async function submit() {
    if (saving) return;
    if (!repairId || !dueDate) return setError("กรุณาเลือกงานซ่อมและวันที่นัดติดตาม");
    setError("");
    setSaving(true);
    try {
      await onCreate({ repairId: Number(repairId), dueDate, channel });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <ModalShell title="เพิ่มนัดติดตามหลังซ่อม" onClose={onClose}>
      {repairs.length === 0 ? (
        <p className="text-sm" style={{ color: C.muted }}>ยังไม่มีงานซ่อมให้เลือก — บันทึกงานซ่อมก่อนที่เมนู "งานซ่อมทั้งหมด"</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>งานซ่อมที่จะติดตาม</label>
            <select value={repairId} onChange={(e) => setRepairId(e.target.value)} className={input} style={inputStyle}>
              {repairs.map((r) => {
                const v = vById(r.vehicleId);
                return (
                  <option key={r.id} value={r.id}>
                    {fmtDate(r.date)} · {v?.name || r.vehicleId}{v?.customerName ? ` · ${v.customerName}` : ""} · {r.issue}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>วันที่นัดติดตาม</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} style={inputStyle} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>ช่องทาง</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={input} style={inputStyle}>
                {Object.entries(CHANNEL_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>ยกเลิก</button>
            <button type="button" onClick={submit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
              {saving ? "กำลังบันทึก..." : "เพิ่มนัด"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function FollowUpsPage({ followups, repairs = [], vehicles = [], customers = [], canEdit, onUpdate, onCreate, onSaveContact, onOpenVehicle, flash }) {
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState("pending");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const today = todayISO();
  const pending = followups.filter((f) => f.status === "pending");
  const finished = followups.filter((f) => f.status !== "pending");
  const overdue = pending.filter((f) => f.dueDate < today).length;
  const list = tab === "pending" ? (onlyOverdue ? pending.filter((f) => f.dueDate < today) : pending) : finished;

  return (
    <div>
      <SectionHeading
        title="ติดตามหลังซ่อม"
        description="โทรหรือทัก LINE ลูกค้าตามนัด เพื่อถามว่ารถใช้งานเป็นอย่างไร และเก็บผลไว้ในประวัติรถ"
        action={
          canEdit ? (
            <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: C.primary }}>
              <Plus size={16} /> เพิ่มนัดติดตาม
            </button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[["pending", `รอติดตาม (${pending.length})`], ["done", `ติดตามแล้ว (${finished.length})`]].map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k); setOnlyOverdue(false); }}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ background: tab === k && !onlyOverdue ? C.ink : C.surface, color: tab === k && !onlyOverdue ? "#fff" : C.muted, border: `1px solid ${tab === k && !onlyOverdue ? C.ink : C.border}` }}
          >
            {t}
          </button>
        ))}
        {overdue > 0 && (
          <button
            type="button"
            onClick={() => { setTab("pending"); setOnlyOverdue(!onlyOverdue); }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
            style={onlyOverdue ? { background: C.rust, color: "#fff", border: `1px solid ${C.rust}` } : { background: "#fff", color: C.rust, border: `1px solid ${C.rust}` }}
            title={onlyOverdue ? "กดเพื่อกลับไปดูทั้งหมด" : "กดเพื่อดูเฉพาะที่เลยกำหนด"}
          >
            <AlertTriangle size={13} /> เลยกำหนด {overdue} ราย
          </button>
        )}
      </div>

      <div className="space-y-3">
        {list.map((f) => (
          <FollowUpCard key={f.id} f={f} canEdit={canEdit} onUpdate={onUpdate} flash={flash} customers={customers} onSaveContact={onSaveContact} onOpenVehicle={onOpenVehicle} />
        ))}
        {list.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center" style={{ border: `1px dashed ${C.border}` }}>
            <p className="text-sm" style={{ color: C.muted }}>
              {tab === "pending" ? (onlyOverdue ? "ไม่มีรายการที่เลยกำหนด" : "ไม่มีงานที่ต้องติดตามตอนนี้") : "ยังไม่มีประวัติการติดตาม"}
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs" style={{ color: C.muted }}>
        กดปุ่ม LINE สีเขียวที่มุมขวาล่างเพื่อเปิด LINE ของอู่และคุยกับลูกค้า
      </p>

      {showAdd && (
        <AddFollowUpModal
          repairs={repairs}
          vehicles={vehicles}
          onClose={() => setShowAdd(false)}
          onCreate={async (data) => {
            await onCreate(data);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function RepairsPage({ vehicles, repairs, onAddRepair }) {
  const [showAdd, setShowAdd] = useState(false);
  const [viewer, setViewer] = useState(null); // { files, index } รูปที่กำลังดูแบบเต็มจอ
  // เรียงตามวันที่ (ปี/เดือน/วัน) เริ่มที่เก่า → ใหม่ กดหัวคอลัมน์เพื่อสลับได้
  const [dateAsc, setDateAsc] = useState(true);
  const [yearFilter, setYearFilter] = useState("all");
  const [query, setQuery] = useState("");
  const vehicleById = (id) => vehicles.find((v) => v.id === id);

  // แสดงเฉพาะงานซ่อมของรถเกี่ยวข้าวและรถตีดิน ที่มีรูปถ่าย
  const shown = new Set(vehicles.filter((v) => v.type === "harvester" || v.type === "tiller").map((v) => v.id));
  const base = repairs.filter((r) => shown.has(r.vehicleId) && r.photos.length > 0);
  const years = [...new Set(base.map((r) => String(r.date).slice(0, 4)))].sort();

  const q = query.trim().toLowerCase();
  const list = base
    .filter((r) => yearFilter === "all" || String(r.date).startsWith(yearFilter))
    .filter((r) => !q || `${vehicleById(r.vehicleId)?.name} ${r.issue} ${r.part}`.toLowerCase().includes(q))
    .sort((x, y) => (dateAsc ? 1 : -1) * (String(x.date).localeCompare(String(y.date)) || x.id - y.id));

  // จัดกลุ่มตามปี เพื่อใส่แถบคั่นหัวปี
  const groups = [];
  list.forEach((r) => {
    const y = String(r.date).slice(0, 4);
    let g = groups[groups.length - 1];
    if (!g || g.year !== y) groups.push((g = { year: y, items: [] }));
    g.items.push(r);
  });

  const tabBtn = (key, label, n) => (
    <button
      key={key}
      onClick={() => setYearFilter(key)}
      className="rounded-full px-3.5 py-1.5 text-sm font-medium"
      style={yearFilter === key ? { background: C.primary, color: "#fff" } : { background: "#fff", color: C.ink, border: `1px solid ${C.border}` }}
    >
      {label} <span style={{ opacity: 0.7 }}>{n}</span>
    </button>
  );

  return (
    <div>
      <SectionHeading
        title="ประวัติการซ่อมและเปลี่ยนอะไหล่"
        description="บันทึกทุกรายการซ่อมบำรุงเพื่อตรวจสอบย้อนหลังได้"
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: C.primary }}
          >
            <Plus size={16} /> บันทึกงานซ่อม
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabBtn("all", "ทั้งหมด", base.length)}
          {years.map((y) => tabBtn(y, `พ.ศ. ${Number(y) + 543}`, base.filter((r) => String(r.date).startsWith(y)).length))}
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${C.border}` }}>
          <Search size={15} color={C.muted} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหารถ อาการ หรืออะไหล่" className="w-56 bg-transparent text-sm outline-none" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white" style={{ border: `1px solid ${C.border}` }}>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
              {["วันที่", "รถ", "อาการ / งานที่ทำ", "อะไหล่ที่เปลี่ยน", "ช่างผู้รับผิดชอบ", "รูป", "ค่าใช้จ่าย"].map((h) => (
                <th key={h} className={`px-4 py-3 font-medium ${h === "ค่าใช้จ่าย" ? "text-right" : ""}`} style={{ color: C.muted }}>
                  {h === "วันที่" ? (
                    <button type="button" onClick={() => setDateAsc((v) => !v)} className="flex items-center gap-1 font-medium" title="กดเพื่อสลับการเรียง">
                      วันที่ <span style={{ color: C.gold }}>{dateAsc ? "↑ เก่า→ใหม่" : "↓ ใหม่→เก่า"}</span>
                    </button>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: C.muted }}>ไม่พบรายการซ่อม</td></tr>
            )}
            {groups.map((g) => (
              <React.Fragment key={g.year}>
                <tr style={{ background: `${C.gold}14`, borderBottom: `1px solid ${C.border}` }}>
                  <td colSpan={7} className="px-4 py-2 text-sm font-semibold" style={{ color: C.ink }}>
                    พ.ศ. {Number(g.year) + 543}
                    <span className="ml-3 font-normal" style={{ color: C.muted }}>
                      {g.items.length} งาน · รวม {fmtBaht(g.items.reduce((s, r) => s + r.cost, 0))}
                    </span>
                  </td>
                </tr>
                {g.items.map((r) => {
                  const v = vehicleById(r.vehicleId);
                  return (
                    <tr key={r.id} className="hover:bg-black/[0.02]" style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="whitespace-nowrap px-4 py-3" style={{ color: C.muted }}>{fmtDate(r.date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium" style={{ color: C.ink }}>
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: TYPE_META[v?.type]?.color || C.muted }} title={TYPE_META[v?.type]?.label} />
                        {v?.name}
                      </td>
                      <td className="px-4 py-3" style={{ color: C.ink }}>{r.issue}</td>
                      <td className="px-4 py-3" style={{ color: C.muted }}>{r.part}</td>
                      <td className="px-4 py-3" style={{ color: C.muted }}>{r.tech}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewer({ files: r.photos.map((p) => p.filename), index: 0 })}
                          className="relative block overflow-hidden rounded-lg"
                          style={{ border: `1px solid ${C.border}` }}
                          title="กดเพื่อดูรูปและซูม"
                        >
                          <PhotoImg filename={r.photos[0].filename} className="h-16 w-24 object-cover transition-transform hover:scale-105" />
                          {r.photos.length > 1 && (
                            <span className="absolute bottom-1 right-1 rounded-full bg-black/65 px-1.5 text-[11px] font-medium text-white">{r.photos.length} รูป</span>
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="text-base font-semibold" style={{ color: C.ink }}>{fmtBaht(r.cost)}</span>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {viewer && <Lightbox filenames={viewer.files} index={viewer.index} onClose={() => setViewer(null)} />}
      {showAdd && (
        <AddRepairModal
          vehicles={vehicles}
          onClose={() => setShowAdd(false)}
          onAdd={async (r) => {
            await onAddRepair(r);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AlertsPage({ vehicles, alerts, onToggleQueue, onAddAlert, onDeleteAlert, canEdit, canDelete }) {
  const vehicleById = (id) => vehicles.find((v) => v.id === id);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  // จำนวนวันที่เหลือ อ่านจากข้อความ "อีก N วัน"
  const daysOf = alertDays;
  const bandOf = (a) => (a.queued ? "queued" : daysOf(a) <= 45 ? "urgent" : daysOf(a) <= 90 ? "soon" : "later");
  const BANDS = {
    urgent: { label: "เร่งด่วน", sub: "ภายใน 45 วัน", color: C.rust },
    soon: { label: "ใกล้ครบกำหนด", sub: "ภายใน 3 เดือน", color: C.gold },
    later: { label: "ภายหลัง", sub: "เกิน 3 เดือน", color: C.leaf },
    queued: { label: "อยู่ในคิวซ่อมแล้ว", sub: "จัดคิวเรียบร้อย", color: C.muted },
  };

  const items = alerts
    .filter((a) => ["harvester", "tiller"].includes(vehicleById(a.vehicleId)?.type))
    .map((a) => ({ a, v: vehicleById(a.vehicleId), band: bandOf(a), days: daysOf(a) }))
    .sort((x, y) => x.days - y.days);

  const count = (b) => items.filter((i) => i.band === b).length;
  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (i) => (filter === "all" || i.band === filter) && (!q || `${i.v?.name} ${i.a.item}`.toLowerCase().includes(q))
  );

  const tabs = [
    { key: "all", label: "ทั้งหมด", n: items.length, color: C.primary },
    ...["urgent", "soon", "later", "queued"].map((k) => ({ key: k, label: BANDS[k].label, n: count(k), color: BANDS[k].color })),
  ];

  const groups = ["urgent", "soon", "later", "queued"].filter((b) => visible.some((i) => i.band === b));

  const row = (i) => {
    const { a, v, band, days } = i;
    const color = BANDS[band].color;
    const pct = band === "queued" ? 100 : Math.max(6, Math.min(100, Math.round(((180 - Math.max(days, 0)) / 180) * 100)));
    return (
      <div key={a.id} className="rounded-xl bg-white p-4" style={{ border: `1px solid ${C.border}`, borderLeftWidth: 4, borderLeftColor: color, opacity: a.queued ? 0.75 : 1 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${color}16` }}>
              {a.queued ? <CheckCircle2 size={18} color={color} /> : band === "urgent" ? <AlertTriangle size={18} color={color} /> : band === "soon" ? <Clock size={18} color={color} /> : <CheckCircle2 size={18} color={color} />}
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: C.ink }}>{v?.name} · {a.item}</p>
              <p className="text-xs" style={{ color: C.muted }}>
                ซ่อมล่าสุด {fmtDate(v?.lastService)}{v?.customerName ? ` · เจ้าของรถ ${v.customerName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color }}>{a.queued ? "อยู่ในคิวซ่อมแล้ว" : a.due}</span>
            <button
              onClick={() => onToggleQueue(a.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={a.queued ? { background: C.surface, color: C.muted, border: `1px solid ${C.border}` } : { background: C.primary, color: "#fff" }}
            >
              {a.queued ? "ยกเลิกคิว" : "จัดคิวซ่อม"}
            </button>
            {canDelete && (
              <button
                onClick={() => { if (window.confirm("ลบรายการแจ้งเตือนนี้?")) onDeleteAlert(a.id); }}
                className="rounded-lg p-1.5"
                style={{ border: `1px solid ${C.border}` }}
                aria-label="ลบแจ้งเตือน"
                title="ลบแจ้งเตือน"
              >
                <Trash2 size={14} color={C.rust} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.surface }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    );
  };

  return (
    <div>
      <SectionHeading title="แจ้งเตือนการบำรุงรักษา" description="แจ้งเตือนติดตามตรวจเช็คต่อเนื่องจากประวัติการซ่อมของแต่ละคัน" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["urgent", "soon", "later", "queued"].map((k) => (
          <button key={k} onClick={() => setFilter(filter === k ? "all" : k)} className="rounded-xl bg-white p-4 text-left transition" style={{ border: `1px solid ${filter === k ? BANDS[k].color : C.border}`, boxShadow: filter === k ? `0 0 0 2px ${BANDS[k].color}30` : "none" }}>
            <p className="text-xs" style={{ color: C.muted }}>{BANDS[k].label} · {BANDS[k].sub}</p>
            <p className="mt-1 text-2xl font-semibold" style={{ color: BANDS[k].color }}>{count(k)} <span className="text-sm font-normal" style={{ color: C.muted }}>คัน</span></p>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key)} className="rounded-full px-3.5 py-1.5 text-sm font-medium" style={filter === t.key ? { background: t.color, color: "#fff" } : { background: "#fff", color: C.ink, border: `1px solid ${C.border}` }}>
              {t.label} {t.n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${C.border}` }}>
            <Search size={15} color={C.muted} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาเลขคันหรืออาการ" className="w-48 bg-transparent text-sm outline-none" />
          </div>
          {canEdit && (
            <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: C.primary }}>
              <Plus size={16} /> เพิ่มแจ้งเตือน
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl bg-white p-8 text-center text-sm" style={{ border: `1px solid ${C.border}`, color: C.muted }}>ไม่พบรายการแจ้งเตือน</p>
      ) : (
        <div className="space-y-6">
          {groups.map((b) => (
            <div key={b}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: BANDS[b].color }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: BANDS[b].color }} />
                {BANDS[b].label} <span className="font-normal" style={{ color: C.muted }}>· {BANDS[b].sub}</span>
              </h3>
              <div className="space-y-3">{visible.filter((i) => i.band === b).map(row)}</div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddAlertModal
          vehicles={vehicles.filter((v) => SHOWN_TYPES.includes(v.type))}
          onClose={() => setShowAdd(false)}
          onAdd={async (d) => { await onAddAlert(d); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

// เพิ่มแจ้งเตือนเอง: เลือกรถ พิมพ์รายการ และเลือกวันครบกำหนด (ตัวเลข "อีก N วัน" จะนับถอยหลังให้เอง)
function AddAlertModal({ vehicles, onClose, onAdd }) {
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || "");
  const [item, setItem] = useState("");
  const [dueDate, setDueDate] = useState(addDays(30));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = "w-full rounded-lg px-3 py-2 text-sm outline-none";
  const inputStyle = { border: `1px solid ${C.border}`, color: C.ink };
  const lab = "mb-1.5 block text-xs font-medium";

  async function submit() {
    if (saving) return;
    if (!vehicleId || !item.trim() || !dueDate) return setError("กรุณาเลือกรถ พิมพ์รายการ และเลือกวันที่ครบกำหนด");
    setError("");
    setSaving(true);
    try {
      await onAdd({ vehicleId, item: item.trim(), dueDate });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <ModalShell title="เพิ่มแจ้งเตือน" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={lab} style={{ color: C.muted }}>รถ</label>
          <VehiclePicker vehicles={vehicles} value={vehicleId} onChange={setVehicleId} className={input} style={inputStyle} />
        </div>
        <div>
          <label className={lab} style={{ color: C.muted }}>รายการที่ต้องตรวจ / ซ่อม</label>
          <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="เช่น ตรวจสายพานลำเลียง" className={input} style={inputStyle} />
        </div>
        <div>
          <label className={lab} style={{ color: C.muted }}>วันที่ครบกำหนด</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} style={inputStyle} />
        </div>
        {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>ยกเลิก</button>
          <button type="button" onClick={submit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ReportsPage({ vehicles, repairs, followups = [] }) {
  const [year, setYear] = useState("all");
  // แสดงเฉพาะรถเกี่ยวข้าวและรถตีดิน ให้ตรงกับหน้าอื่น
  const shownVehicles = vehicles.filter((v) => SHOWN_TYPES.includes(v.type));
  const ids = new Set(shownVehicles.map((v) => v.id));
  const allRs = repairs.filter((r) => ids.has(r.vehicleId));
  const rs = year === "all" ? allRs : allRs.filter((r) => String(r.date).startsWith(year));

  // ค่าซ่อมรายปี (พ.ศ.) ตามประวัติซ่อมจริง (แสดงทุกปีเสมอ ปีที่เลือกเป็นสีทอง)
  const years = [...new Set(allRs.map((r) => String(r.date).slice(0, 4)))].sort();
  const yearly = years.map((y) => ({
    y,
    year: String(Number(y) + 543),
    cost: allRs.filter((r) => String(r.date).startsWith(y)).reduce((s, r) => s + r.cost, 0),
    count: allRs.filter((r) => String(r.date).startsWith(y)).length,
  }));

  // รวมค่าซ่อมรายลูกค้า (รถที่ยังไม่ผูกลูกค้าแยกเป็นรายคัน) เรียงมาก → น้อย
  const vById = new Map(shownVehicles.map((v) => [v.id, v]));
  const byOwner = new Map();
  for (const r of rs) {
    const v = vById.get(r.vehicleId);
    if (!v) continue;
    const key = v.customerId ? `c${v.customerId}` : `v${v.id}`;
    const cur = byOwner.get(key) || { name: v.customerName || v.name, cost: 0, jobs: 0, cars: new Set() };
    cur.cost += r.cost;
    cur.jobs += 1;
    cur.cars.add(v.id);
    byOwner.set(key, cur);
  }
  const costByOwner = [...byOwner.values()]
    .map((o) => ({ name: o.name.replace(/^คุณ/, ""), cost: o.cost, jobs: o.jobs, cars: o.cars.size }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const total = rs.reduce((s, r) => s + r.cost, 0);
  const carsRepaired = new Set(rs.map((r) => r.vehicleId)).size;
  const yLabel = year === "all" ? "" : ` ปี ${Number(year) + 543}`;
  const stats = [
    { id: "3", label: `ค่าซ่อมสะสม${year === "all" ? "ทั้งหมด" : yLabel}`, result: fmtBaht(total), color: C.gold },
    { id: "2", label: `งานซ่อมที่บันทึก${year === "all" ? "ทั้งหมด" : yLabel}`, result: `${rs.length} รายการ`, color: C.primary },
    { id: "4", label: "ค่าซ่อมเฉลี่ยต่อรายการ", result: fmtBaht(rs.length ? Math.round(total / rs.length) : 0), color: C.primary },
    { id: "1", label: year === "all" ? "รถเกี่ยวข้าวและรถตีดินในระบบ" : "รถที่เข้าซ่อม", result: `${year === "all" ? shownVehicles.length : carsRepaired} คัน`, color: C.primary },
  ];
  const fmtK = (v) => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString("th-TH")}k` : String(v));

  return (
    <div>
      <SectionHeading title="รายงานสรุป" description="ค่าใช้จ่ายในการซ่อมของรถเกี่ยวข้าวและรถตีดิน ตามประวัติการซ่อมที่บันทึกไว้" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["all", ...[...years].reverse()].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className="rounded-full px-3.5 py-1.5 text-sm font-medium"
            style={year === y ? { background: C.ink, color: "#fff" } : { background: "#fff", color: C.ink, border: `1px solid ${C.border}` }}
          >
            {y === "all" ? "ทุกปี" : `ปี ${Number(y) + 543}`}
          </button>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {stats.map((k) => (
          <div key={k.id} className="rounded-xl bg-white p-4" style={{ border: `1px solid ${C.border}` }}>
            <p className="text-xs leading-snug" style={{ color: C.muted }}>{k.label}</p>
            <p className="mt-2 text-xl font-semibold" style={{ color: k.color }}>{k.result}</p>
            {k.sub && <p className="mt-1 text-xs" style={{ color: C.muted }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold" style={{ color: C.ink }}>ค่าซ่อมรายปี</h3>
            <span className="flex items-center gap-1 text-xs" style={{ color: C.leaf }}><TrendingUp size={14} /> ปี {yearly[0]?.year}–{yearly[yearly.length - 1]?.year}</span>
          </div>
          <div className="min-h-[260px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearly} margin={{ top: 22 }}>
              <CartesianGrid stroke={C.border} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: C.muted }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => v.toLocaleString("th-TH")} />
              <Tooltip cursor={{ fill: `${C.gold}14` }} formatter={(v, n, p) => [`${fmtBaht(v)} (${p.payload.count} รายการ)`, "ค่าซ่อม"]} contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}` }} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]} onClick={(d) => setYear(year === d.y ? "all" : d.y)} style={{ cursor: "pointer" }}>
                {yearly.map((x) => (
                  <Cell key={x.y} fill={year === "all" || year === x.y ? C.primary : `${C.primary}55`} />
                ))}
                <LabelList dataKey="cost" position="top" formatter={fmtK} style={{ fontSize: 11, fill: C.ink }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <h3 className="mb-4 font-semibold" style={{ color: C.ink }}>ค่าซ่อมแยกตามลูกค้า <span className="text-xs font-normal" style={{ color: C.muted }}>(มาก → น้อย{yLabel})</span></h3>
          {costByOwner.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: C.muted }}>ยังไม่มีงานซ่อมในช่วงนี้</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(260, costByOwner.length * 34 + 40)}>
              <BarChart data={costByOwner} layout="vertical" margin={{ left: 10, right: 70 }}>
                <CartesianGrid stroke={C.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toLocaleString("th-TH")} />
                <YAxis dataKey="name" type="category" interval={0} tick={{ fontSize: 12, fill: C.ink }} axisLine={false} tickLine={false} width={130} />
                <Tooltip cursor={{ fill: `${C.gold}14` }} formatter={(v, n, p) => [`${fmtBaht(v)} (${p.payload.jobs} งาน · ${p.payload.cars} คัน)`, "ค่าซ่อม"]} contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}` }} />
                <Bar dataKey="cost" fill={C.gold} radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="cost" position="right" formatter={(v) => v.toLocaleString("th-TH")} style={{ fontSize: 11, fill: C.ink }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? C.primary : C.border }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}

function SettingsRow({ icon: Icon, title, description, right }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${C.primary}12` }}>
          <Icon size={16} color={C.primary} />
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: C.ink }}>{title}</p>
          {description && <p className="mt-0.5 text-xs" style={{ color: C.muted }}>{description}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6" style={{ border: `1px solid ${C.border}` }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: C.ink }}>{title}</h3>
          <button onClick={onClose}><X size={18} color={C.muted} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddUserModal({ onClose, onCreated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("mechanic");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (saving) return;
    if (!username.trim() || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const created = await api.users.create({ username: username.trim(), password, role });
      onCreated(created);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <ModalShell title="เพิ่มผู้ใช้งาน" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>สิทธิ์การใช้งาน</label>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setRole(r.id)}
                className="rounded-lg py-2 text-xs font-medium"
                style={{
                  background: role === r.id ? C.primary : C.surface,
                  color: role === r.id ? "#F6F4EC" : C.muted,
                  border: `1px solid ${role === r.id ? C.primary : C.border}`,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>ชื่อผู้ใช้</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="เช่น somchai.j (ภาษาอังกฤษ/ตัวเลข)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ border: `1px solid ${C.border}`, color: C.ink }}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ border: `1px solid ${C.border}`, color: C.ink }}
          />
        </div>
        {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
            ยกเลิก
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
            {saving ? "กำลังบันทึก..." : "เพิ่มผู้ใช้"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ChangePasswordModal({ onClose, onDone }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (saving) return;
    if (!current || !next) {
      setError("กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่");
      return;
    }
    if (next.length < 8) {
      setError("รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (next !== confirm) {
      setError("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const fields = [
    ["รหัสผ่านเดิม", current, setCurrent],
    ["รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)", next, setNext],
    ["ยืนยันรหัสผ่านใหม่", confirm, setConfirm],
  ];

  return (
    <ModalShell title="เปลี่ยนรหัสผ่าน" onClose={onClose}>
      <div className="space-y-4">
        {fields.map(([label, value, setValue]) => (
          <div key={label}>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>{label}</label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: `1px solid ${C.border}`, color: C.ink }}
            />
          </div>
        ))}
        {error && <p className="text-xs font-medium" style={{ color: C.rust }}>{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${C.border}`, color: C.ink }}>
            ยกเลิก
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.primary }}>
            {saving ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function SettingsPage({ user, role, onLogout, flash }) {
  const [alertPrefs, setAlertPrefs] = useAlertPrefs();

  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showCard, setShowCard] = useState(false);

  // รายชื่อผู้ใช้จริงจากฐานข้อมูล (เฉพาะเจ้าของกิจการ)
  useEffect(() => {
    if (role.id !== "owner") return;
    api.users.list().then(setUsers).catch((e) => setUsersError(e.message));
  }, [role.id]);

  async function handleApprove(m, newRole) {
    try {
      const updated = await api.users.update(m.id, { status: "active", role: newRole });
      setUsers((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
      flash(`อนุมัติ ${m.username} แล้ว`);
    } catch (e) {
      flash(e.message);
    }
  }

  async function handleDeleteUser(m) {
    if (!window.confirm(`ลบผู้ใช้ "${m.username}" ใช่หรือไม่?`)) return;
    try {
      await api.users.remove(m.id);
      setUsers((prev) => prev.filter((x) => x.id !== m.id));
      flash(`ลบผู้ใช้ ${m.username} แล้ว`);
    } catch (e) {
      flash(e.message);
    }
  }

  return (
    <div>
      <SectionHeading title="ตั้งค่า" description="จัดการบัญชีผู้ใช้ การแจ้งเตือน และข้อมูลอู่" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
            <h3 className="mb-1 font-semibold" style={{ color: C.ink }}>การแจ้งเตือน</h3>
            <p className="mb-2 text-xs" style={{ color: C.muted }}>ตั้งค่าการแจ้งเตือนบนกระดิ่งและหน้าภาพรวม (บันทึกในเบราว์เซอร์เครื่องนี้)</p>
            <div className="divide-y" style={{ borderColor: C.border }}>
              <SettingsRow
                icon={Bell}
                title="แจ้งเตือนกำหนดบำรุงรักษา"
                description="แจ้งเมื่อรถเกี่ยวข้าวและรถตีดินใกล้ถึงกำหนดตรวจเช็คต่อเนื่องหลังซ่อม"
                right={<Switch checked={alertPrefs.on} onChange={(v) => setAlertPrefs({ on: v })} />}
              />
              <div className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${C.primary}12` }}>
                    <Clock size={16} color={C.primary} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: C.ink }}>ระยะเวลาแจ้งเตือนล่วงหน้า</p>
                    <p className="mt-0.5 text-xs" style={{ color: C.muted }}>แสดงรายการที่จะถึงกำหนดภายในกี่วัน</p>
                  </div>
                </div>
                <select
                  value={alertPrefs.days}
                  disabled={!alertPrefs.on}
                  onChange={(e) => setAlertPrefs({ days: Number(e.target.value) })}
                  className="rounded-lg px-3 py-1.5 text-sm outline-none"
                  style={{ border: `1px solid ${C.border}`, color: C.ink }}
                >
                  <option value={15}>15 วัน</option>
                  <option value={30}>30 วัน</option>
                  <option value={45}>45 วัน</option>
                  <option value={60}>60 วัน</option>
                  <option value={90}>90 วัน</option>
                </select>
              </div>
            </div>
          </div>

          {role.id === "owner" && (
            <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="mb-1 font-semibold" style={{ color: C.ink }}>ผู้ใช้งานในระบบ</h3>
                  <p className="text-xs" style={{ color: C.muted }}>บัญชีที่เข้าสู่ระบบได้และสิทธิ์การเข้าถึง</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddUser(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: C.primary }}
                >
                  <Plus size={14} /> เพิ่มผู้ใช้
                </button>
              </div>
              {usersError && <p className="mb-2 text-xs font-medium" style={{ color: C.rust }}>{usersError}</p>}
              <div className="divide-y" style={{ borderColor: C.border }}>
                {users.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.username} role={m.role} size={36} />
                      <div>
                        <p className="text-sm" style={{ color: C.ink }}>{m.username}{m.id === user.id ? " (คุณ)" : ""}</p>
                        {m.fullName && <p className="text-xs" style={{ color: C.muted }}>{m.fullName}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {m.status === "pending" ? (
                        <>
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${C.gold}30`, color: "#8A6416" }}>รออนุมัติ</span>
                          <select
                            defaultValue="mechanic"
                            id={`role-${m.id}`}
                            className="rounded-lg px-2 py-1 text-xs outline-none"
                            style={{ border: `1px solid ${C.border}`, color: C.ink }}
                          >
                            <option value="mechanic">ช่างซ่อม</option>
                            <option value="driver">พนักงานขับรถ</option>
                            <option value="owner">เจ้าของกิจการ</option>
                          </select>
                          <button type="button" onClick={() => handleApprove(m, document.getElementById(`role-${m.id}`).value)} className="text-xs font-semibold" style={{ color: C.primary }}>
                            อนุมัติ
                          </button>
                        </>
                      ) : (
                        <span className="text-xs" style={{ color: C.muted }}>{roleById(m.role)?.label || m.role}</span>
                      )}
                      {m.id !== user.id && (
                        <button type="button" onClick={() => handleDeleteUser(m)} className="text-xs font-medium" style={{ color: C.rust }}>
                          ลบ
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5">
        <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <p className="text-xs" style={{ color: C.muted }}>บัญชีของฉัน</p>
          <div className="mt-3 flex items-center gap-3">
            <Avatar name={user.username} role={user.role} size={56} />
            <div>
              <p className="text-sm font-medium" style={{ color: C.ink }}>{user.username}</p>
              <p className="text-xs" style={{ color: C.muted }}>{role.label}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            className="mt-5 w-full rounded-lg py-2 text-sm font-medium"
            style={{ border: `1px solid ${C.border}`, color: C.ink }}
          >
            เปลี่ยนรหัสผ่าน
          </button>
          <button
            onClick={onLogout}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium"
            style={{ background: `${C.rust}12`, color: C.rust }}
          >
            <LogOut size={15} /> ออกจากระบบ
          </button>
        </div>

        <div className="rounded-xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <p className="text-xs" style={{ color: C.muted }}>ข้อมูลอู่</p>
          <div className="mt-3 flex items-center gap-3">
            <BrandLogo size={48} />
            <div>
              <p className="text-base font-semibold leading-tight" style={{ color: C.ink }}>อู่ทรัพย์เจริญการช่าง</p>
              <p className="text-sm" style={{ color: C.muted }}>ช่างเดช</p>
            </div>
          </div>
          <a href="tel:0871156213" className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white" style={{ background: C.primary }}>
            <Phone size={15} /> โทร 087-115-6213
          </a>
          <p className="mb-2 mt-5 text-xs font-medium" style={{ color: C.muted }}>บริการของอู่</p>
          <ul className="space-y-1.5 text-sm" style={{ color: C.ink }}>
            {[
              "รับต่อรถเกี่ยวใหม่ และรถตีดิน",
              "ต่อช่วงล่างใหม่",
              "แปลงระบบภายในรถเกี่ยว แต่งตู้เบา",
              "รับทำซี่รอบ",
              "ขึ้นตู้ใหม่",
              "ขึ้นโครงรถเกี่ยว",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2">
                <CheckCircle2 size={15} color={C.leaf} className="mt-0.5 shrink-0" /> {s}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setShowCard(true)} className="mt-4 flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-black/[0.03]" style={{ border: `1px solid ${C.border}` }} title="กดเพื่อขยาย">
            <img src="/garage-card.jpg" alt="นามบัตรอู่" className="h-14 w-24 rounded object-cover" />
            <span className="text-sm font-medium" style={{ color: C.primary }}>ดูนามบัตรอู่</span>
          </button>
        </div>
        </div>
      </div>

      {showCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowCard(false)}>
          <img src="/garage-card.jpg" alt="นามบัตรอู่" className="max-h-full max-w-full rounded-lg" style={{ width: "min(900px, 100%)" }} />
        </div>
      )}

      {showAddUser && (
        <AddUserModal
          onClose={() => setShowAddUser(false)}
          onCreated={(u) => {
            setUsers((prev) => [...prev, u]);
            setShowAddUser(false);
            flash(`เพิ่มผู้ใช้ ${u.username} แล้ว`);
          }}
        />
      )}
      {showPassword && (
        <ChangePasswordModal
          onClose={() => setShowPassword(false)}
          onDone={() => {
            setShowPassword(false);
            flash("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
          }}
        />
      )}
    </div>
  );
}


// ปุ่ม LINE อยู่มุมขวาบน (ในแถบหัวเว็บ): กดแล้วเปิดแชต LINE ของอู่ในแท็บใหม่
// ถ้าอยากใช้ไอคอนทางการของ LINE ให้วางไฟล์ไว้ที่ public/line-icon.png (หรือ .svg แล้วแก้ชื่อไฟล์ด้านล่าง)
function LineFab() {
  const [custom, setCustom] = useState(true);
  const [hover, setHover] = useState(false);
  return (
    <a
      href={LINE_CHAT_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="เปิด LINE ของอู่ทรัพเจริญการช่าง"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="relative flex items-center"
      style={{ textDecoration: "none" }}
    >
      <span
        className="absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium shadow-lg"
        style={{
          background: "#fff",
          color: C.ink,
          border: `1px solid ${C.border}`,
          opacity: hover ? 1 : 0,
          marginRight: hover ? 12 : 4,
          transition: "opacity .18s, transform .18s",
          pointerEvents: "none",
        }}
      >
        คุยกับลูกค้าทาง LINE
      </span>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full"
        style={{
          background: custom ? "transparent" : `linear-gradient(145deg, #2FD06B, ${LINE_GREEN})`,
          boxShadow: "0 4px 12px rgba(6,167,85,.35), 0 1px 3px rgba(0,0,0,.18)",
          transform: hover ? "scale(1.08)" : "scale(1)",
          transition: "transform .18s",
        }}
      >
        {custom ? (
          <img
            src="/line-icon.png"
            alt=""
            className="h-11 w-11 rounded-full object-cover"
            onError={() => setCustom(false)}
          />
        ) : (
          <MessageCircle size={22} color="#fff" strokeWidth={2.2} />
        )}
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* App shell                                                            */
/* ------------------------------------------------------------------ */
export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(api.isLoggedIn());
  const [tab, setTab] = useState("dashboard");
  const [openVehicleId, setOpenVehicleId] = useState(null); // เปิดหน้ารายละเอียดรถจากหน้าอื่น
  const [showLogin, setShowLogin] = useState(false);
  useEffect(() => {
    document.title = user ? "ทรัพเจริญการช่าง — ระบบจัดการงานซ่อม" : "อู่ทรัพย์เจริญการช่าง — ต่อรถเกี่ยว ซ่อมรถเกี่ยว รถตีดิน";
  }, [user]);
  const [bellPrefs] = useAlertPrefs();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // พับแถบเมนูซ้ายบนจอคอม (จำค่าไว้ในเบราว์เซอร์)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("rh_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("rh_sidebar_collapsed", c ? "0" : "1");
      } catch {
        /* เบราว์เซอร์บล็อก localStorage */
      }
      return !c;
    });
  }, []);
  const [rawVehicles, setVehicles] = useState([]);
  const vehicles = useMemo(() => withOwnerNames(rawVehicles), [rawVehicles]);
  const [repairs, setRepairs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [rawFollowups, setFollowups] = useState([]);
  const followups = useMemo(() => {
    const byId = new Map(vehicles.map((v) => [v.id, v.name]));
    return rawFollowups.map((f) => (byId.has(f.vehicleId) && byId.get(f.vehicleId) !== f.vehicleName ? { ...f, vehicleName: byId.get(f.vehicleId) } : f));
  }, [rawFollowups, vehicles]);
  const [dataState, setDataState] = useState({ loading: true, error: "" });
  const [toast, setToast] = useState("");

  const flash = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setVehicles([]);
    setRepairs([]);
    setAlerts([]);
    setCustomers([]);
    setFollowups([]);
    setDataState({ loading: true, error: "" });
    setTab("dashboard");
  }, []);

  // รีเฟรชหน้า: ถ้ายังอยู่ในเซสชันเดิม (token ใน sessionStorage) ให้กลับเข้าระบบ  เปิดเว็บใหม่จะเริ่มที่หน้าล็อกอิน
  useEffect(() => {
    if (!api.isLoggedIn()) return;
    api
      .me()
      .then(setUser)
      .catch(() => api.logout())
      .finally(() => setBooting(false));
  }, []);

  // token หมดอายุระหว่างใช้งาน -> กลับไปหน้า Login
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const loadData = useCallback(async () => {
    setDataState({ loading: true, error: "" });
    try {
      const [v, r, a, c, f] = await Promise.all([
        api.vehicles.list(),
        api.repairs.list(),
        api.alerts.list(),
        api.customers.list(),
        api.followups.list(),
      ]);
      setVehicles(v);
      setRepairs(r);
      setAlerts(a);
      setCustomers(c);
      setFollowups(f);
      setDataState({ loading: false, error: "" });
    } catch (e) {
      setDataState({ loading: false, error: e.message });
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  // แจ้งเตือนนับถอยหลังตามวันจริง: โหลดใหม่ทุก 10 นาที และเมื่อกลับมาเปิดแท็บ
  useEffect(() => {
    if (!user) return;
    const refresh = () => api.alerts.list().then(setAlerts).catch(() => {});
    const id = setInterval(refresh, 10 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [user]);

  // ปุ่ม LINE ลอย: เจ้าของ/ช่างเท่านั้น
  const canLine = !!user && (user.role === "owner" || user.role === "mechanic");

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm" style={{ background: C.bg, color: C.muted }}>
        กำลังโหลด...
      </div>
    );
  }

  if (!user && !showLogin) {
    return <LandingPage onLogin={() => setShowLogin(true)} />;
  }
  if (!user) {
    return (
      <LoginPage
        onBack={() => setShowLogin(false)}
        onLogin={(u) => {
          setUser(u);
          setTab("dashboard");
        }}
      />
    );
  }

  const role = roleById(user.role) || ROLES[2];
  const visibleNav = NAV.filter((n) => role.nav.includes(n.id));

  async function addVehicle(v) {
    const created = await api.vehicles.create(v);
    // ชื่อรถของเจ้าของคนเดียวกันอาจเรียงเลขใหม่ จึงโหลดรายการรถและลูกค้าใหม่
    const [vs, cs] = await Promise.all([api.vehicles.list(), api.customers.list()]);
    setVehicles(vs);
    setCustomers(cs);
    return created;
  }

  // เพิ่ม/แก้เบอร์โทร+LINE ID จากการ์ดนัดติดตาม (และผูกเจ้าของให้รถถ้ายังไม่มี) แล้วโหลดข้อมูลที่เกี่ยวข้องใหม่
  async function saveContact({ vehicleId, customerId, newName, phone, lineId }) {
    let cid = customerId;
    if (newName) {
      const c = await api.customers.create({ name: newName, phone, lineId, address: "", note: "" });
      cid = c.id;
    } else if (cid) {
      await api.customers.update(cid, { phone, lineId });
    }
    if (vehicleId && cid) await api.vehicles.update(vehicleId, { customerId: cid });
    const [vs, cs, fs] = await Promise.all([api.vehicles.list(), api.customers.list(), api.followups.list()]);
    setVehicles(vs);
    setCustomers(cs);
    setFollowups(fs);
    flash("บันทึกช่องทางติดต่อแล้ว");
  }

  async function addCustomerQuick(data) {
    const saved = await api.customers.create({ name: data.name, phone: data.phone || "", lineId: "", address: "", note: "" });
    setCustomers((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name, "th")));
    return saved;
  }

  // โหลดข้อมูลที่เปลี่ยนหลังบันทึกงานซ่อม/รูป ใหม่จากฐานข้อมูล
  async function reloadRepairData() {
    const [rs, vs, fs] = await Promise.all([api.repairs.list(), api.vehicles.list(), api.followups.list()]);
    setRepairs(rs);
    setVehicles(vs);
    setFollowups(fs);
  }

  async function uploadPhotos(repairId, items) {
    let failed = 0;
    let lastError = "";
    for (const it of items) {
      try {
        await api.uploadPhoto(repairId, it.blob, it.kind);
      } catch (e) {
        failed += 1;
        lastError = e.message;
      }
    }
    if (failed) flash(`อัปโหลดรูปไม่สำเร็จ ${failed} รูป: ${lastError}`);
  }

  async function addRepair(r) {
    const { photos = [], ...payload } = r;
    const created = await api.repairs.create(payload);
    await uploadPhotos(created.id, photos);
    try {
      await reloadRepairData();
    } catch {
      setRepairs((prev) => [created, ...prev]);
    }
    flash("บันทึกงานซ่อมแล้ว");
    return created;
  }

  // เพิ่มรูปให้งานซ่อมที่มีอยู่แล้ว (files = FileList จากช่องเลือกไฟล์)
  async function addPhotos(repairId, files, kind) {
    const items = [];
    for (const f of Array.from(files)) {
      try {
        items.push({ blob: await shrinkImage(f), kind });
      } catch (e) {
        flash(e.message);
      }
    }
    await uploadPhotos(repairId, items);
    try {
      setRepairs(await api.repairs.list());
    } catch (e) {
      flash(e.message);
    }
  }

  async function deletePhoto(photoId) {
    if (!window.confirm("ลบรูปนี้ออกจากงานซ่อม?")) return;
    try {
      await api.deletePhoto(photoId);
      setRepairs(await api.repairs.list());
    } catch (e) {
      flash(e.message);
    }
  }

  async function changeCustomer(vehicleId, customerId) {
    try {
      await api.vehicles.update(vehicleId, { customerId });
      // ชื่อรถ จำนวนรถ และค่าซ่อมของลูกค้าเปลี่ยนตามเจ้าของ จึงโหลดใหม่ทั้งหมด
      const [v, c, f] = await Promise.all([api.vehicles.list(), api.customers.list(), api.followups.list()]);
      setVehicles(v);
      setCustomers(c);
      setFollowups(f);
    } catch (e) {
      flash(e.message);
    }
  }

  async function saveCustomer(data, id) {
    const saved = id ? await api.customers.update(id, data) : await api.customers.create(data);
    setCustomers((prev) => (id ? prev.map((c) => (c.id === id ? saved : c)) : [...prev, saved]).sort((a, b) => a.name.localeCompare(b.name, "th")));
    flash(id ? "แก้ไขข้อมูลลูกค้าแล้ว" : "เพิ่มลูกค้าแล้ว");
  }

  async function deleteCustomer(id) {
    try {
      await api.customers.remove(id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      setVehicles(await api.vehicles.list());
      setFollowups(await api.followups.list());
      flash("ลบลูกค้าแล้ว");
    } catch (e) {
      flash(e.message);
    }
  }

  async function createFollowup(data) {
    await api.followups.create(data);
    setFollowups(await api.followups.list()); // โหลดใหม่ให้เรียงตามวันนัด
    flash("เพิ่มนัดติดตามแล้ว");
  }

  async function updateFollowup(id, data) {
    const updated = await api.followups.update(id, data);
    setFollowups((prev) => prev.map((f) => (f.id === id ? updated : f)));
    flash("บันทึกผลการติดตามแล้ว");
  }

  async function addAlert(data) {
    const created = await api.alerts.create(data);
    setAlerts((prev) => [...prev, created]);
  }

  async function deleteAlert(alertId) {
    try {
      await api.alerts.remove(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (e) {
      flash(e.message);
    }
  }

  async function toggleQueue(alertId) {
    const current = alerts.find((a) => a.id === alertId);
    if (!current) return;
    try {
      const updated = await api.alerts.update(alertId, { queued: !current.queued });
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
    } catch (e) {
      flash(e.message);
    }
  }

  const pages = {
    dashboard: <DashboardPage goTo={setTab} user={user} vehicles={vehicles} repairs={repairs} alerts={alerts} followups={followups} />,
    vehicles: (
      <VehiclesPage
        openId={openVehicleId}
        onOpened={() => setOpenVehicleId(null)}
        vehicles={vehicles}
        onAddVehicle={addVehicle}
        onAddCustomer={addCustomerQuick}
        repairs={repairs}
        canEdit={role.id !== "driver"}
        canDelete={role.id === "owner"}
        customers={customers}
        followups={followups}
        onAddRepair={addRepair}
        onAddPhotos={addPhotos}
        onDeletePhoto={deletePhoto}
        onChangeCustomer={changeCustomer}
      />
    ),
    followups: (
      <FollowUpsPage
        followups={followups}
        repairs={repairs}
        vehicles={vehicles}
        customers={customers}
        onSaveContact={saveContact}
        onOpenVehicle={(id, customerId) => { setOpenVehicleId({ id, customerId }); setTab("vehicles"); }}
        canEdit={role.id !== "driver"}
        onUpdate={updateFollowup}
        onCreate={createFollowup}
        flash={flash}
      />
    ),
    customers: (
      <CustomersPage
        customers={customers}
        vehicles={vehicles}
        repairs={repairs}
        followups={followups}
        canEdit={role.id !== "driver"}
        canDelete={role.id === "owner"}
        onSave={saveCustomer}
        onDelete={deleteCustomer}
      />
    ),
    repairs: <RepairsPage vehicles={vehicles} repairs={repairs} onAddRepair={addRepair} />,
    alerts: <AlertsPage vehicles={vehicles} alerts={alerts} onToggleQueue={toggleQueue} onAddAlert={addAlert} onDeleteAlert={deleteAlert} canEdit={role.id !== "driver"} canDelete={role.id === "owner"} />,
    reports: <ReportsPage vehicles={vehicles} repairs={repairs} followups={followups} />,
    settings: <SettingsPage user={user} role={role} onLogout={logout} flash={flash} />,
  };

  const currentLabel = NAV.find((n) => n.id === tab)?.label;
  // ตัวเลขบนกระดิ่ง = รายการที่ต้องดำเนินการ (ยังไม่จัดคิว เพิ่งเกินกำหนดหรือใกล้ถึงกำหนด) ตรงกับหน้าภาพรวม
  const shownVehicleIds = new Set(vehicles.filter((v) => SHOWN_TYPES.includes(v.type)).map((v) => v.id));
  const bellCount = !bellPrefs.on ? 0 : alerts.filter((x) => shownVehicleIds.has(x.vehicleId) && !x.queued && alertDays(x) >= -90 && alertDays(x) <= bellPrefs.days).length;

  function renderNav(onClickExtra, compact = false) {
    return visibleNav.map((n) => {
      const Icon = n.icon;
      const isActive = tab === n.id;
      return (
        <button
          key={n.id}
          onClick={() => {
            setTab(n.id);
            if (onClickExtra) onClickExtra();
          }}
          title={compact ? n.label : undefined}
          aria-label={n.label}
          className={compact
            ? "mx-auto flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            : "flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm transition-colors"}
          style={{
            background: isActive ? C.gold : "transparent",
            color: isActive ? C.primaryDark : "#E8E4D6",
            fontWeight: isActive ? 600 : 400,
          }}
        >
          <Icon size={compact ? 20 : 17} />
          {!compact && n.label}
        </button>
      );
    });
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'IBM Plex Sans Thai', sans-serif", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chonburi&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
        ::selection { background: ${C.gold}55; }
      `}</style>

      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden flex-col justify-between transition-[width] duration-200 lg:flex ${collapsed ? "w-[76px] p-3" : "w-64 p-5"}`}
          style={{ background: `linear-gradient(180deg, ${C.primaryDark}, ${C.primary})` }}
        >
          <div>
            {collapsed ? (
              <div className="mb-6 flex flex-col items-center gap-3">
                <BrandLogo size={44} />
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title="ขยายแถบเมนู"
                  aria-label="ขยายแถบเมนู"
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.10)" }}
                >
                  <ChevronRight size={18} color="#F6F4EC" />
                </button>
              </div>
            ) : (
              <div className="mb-8 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <BrandLogo size={44} />
                  <div style={{ fontFamily: "'Chonburi', sans-serif", fontSize: 22, lineHeight: 1.15, textShadow: "0 1px 2px rgba(0,0,0,.35)" }}>
                    <p style={{ color: "#FFFFFF" }}>ทรัพเจริญ</p>
                    <p style={{ color: "#FFFFFF" }}>การช่าง</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title="ซ่อนแถบเมนู"
                  aria-label="ซ่อนแถบเมนู"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.10)" }}
                >
                  <ChevronLeft size={18} color="#F6F4EC" />
                </button>
              </div>
            )}
            <nav className="space-y-1">{renderNav(undefined, collapsed)}</nav>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setTab("settings")}
              title="ไปที่หน้าโปรไฟล์/ตั้งค่า"
              className={`group flex w-full items-center rounded-xl text-left transition hover:bg-white/15 ${collapsed ? "justify-center p-2" : "gap-3 p-2.5"}`}
              style={{
                background: tab === "settings" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <Avatar name={user.username} role={user.role} size={collapsed ? 40 : 42} />
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" style={{ color: "#F6F4EC" }}>{user.username}</p>
                    <p className="flex items-center gap-1.5 text-[11px]" style={{ color: "#B9CBB9" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#4ADE80" }} />
                      {role.label}
                    </p>
                  </div>
                  <ChevronRight size={16} color="#B9CBB9" className="transition group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col justify-between p-5" style={{ background: `linear-gradient(180deg, ${C.primaryDark}, ${C.primary})` }}>
              <div>
                <div className="mb-8 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrandLogo size={40} />
                    <div style={{ fontFamily: "'Chonburi', sans-serif", fontSize: 20, lineHeight: 1.15 }}>
                      <p style={{ color: "#FFFFFF" }}>ทรัพเจริญ</p>
                      <p style={{ color: "#FFFFFF" }}>การช่าง</p>
                    </div>
                  </div>
                  <button onClick={() => setSidebarOpen(false)}><X size={20} color="#F6F4EC" /></button>
                </div>
                <nav className="space-y-1">{renderNav(() => setSidebarOpen(false))}</nav>
              </div>
            </aside>
          </div>
        )}

        <div className={`min-w-0 flex-1 transition-[margin] duration-200 ${collapsed ? "lg:ml-[76px]" : "lg:ml-64"}`}>
          <header
            className="sticky top-0 z-20 flex items-center justify-between gap-3 px-5 py-4"
            style={{ background: `${C.bg}E6`, backdropFilter: "blur(6px)", borderBottom: `1px solid ${C.border}` }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="lg:hidden"
                title="เมนู"
                aria-label="เปิดแถบเมนู"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu size={22} color={C.ink} />
              </button>
              <div>
                <h1 className="text-xl font-semibold" style={{ color: C.ink }}>{currentLabel}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm sm:inline" style={{ color: C.muted }}>วันนี้ {fmtDate(todayISO())}</span>
              <button
                type="button"
                onClick={() => setTab("alerts")}
                className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white"
                style={{ border: `1px solid ${C.border}` }}
                title="แจ้งเตือนบำรุงรักษา"
                aria-label="แจ้งเตือนบำรุงรักษา"
              >
                <Bell size={20} color={C.ink} />
                {bellCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white" style={{ background: C.rust }}>
                    {bellCount}
                  </span>
                )}
              </button>
              {canLine && <LineFab />}
            </div>
          </header>

          <main className="p-5">
            {dataState.error ? (
              <div className="rounded-xl bg-white p-6 text-center" style={{ border: `1px solid ${C.border}` }}>
                <p className="text-sm font-medium" style={{ color: C.rust }}>{dataState.error}</p>
                <button
                  type="button"
                  onClick={loadData}
                  className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ background: C.primary }}
                >
                  ลองใหม่
                </button>
              </div>
            ) : dataState.loading ? (
              <p className="py-10 text-center text-sm" style={{ color: C.muted }}>กำลังโหลดข้อมูล...</p>
            ) : (
              pages[tab]
            )}
            {toast && (
              <div
                className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg"
                style={{ background: C.ink, color: "#fff" }}
              >
                {toast}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
