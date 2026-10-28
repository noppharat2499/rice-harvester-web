// ตัวกลางเรียก API ของหลังบ้าน (เก็บ token ไว้ในเบราว์เซอร์)

const TOKEN_KEY = "rh_token";

// ---------- token ----------
// เก็บใน sessionStorage: ปิดหน้าเว็บ/ปิดเบราว์เซอร์แล้วเปิดใหม่ จะเด้งมาหน้าล็อกอินก่อนทุกครั้ง
// (รีเฟรชหน้า F5 ระหว่างใช้งานอยู่ยังไม่ต้องล็อกอินใหม่)
try {
  localStorage.removeItem(TOKEN_KEY); // ลบ token เก่าที่เคยจำไว้แบบถาวร
} catch {
  /* ไม่เป็นไร */
}

export const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const setToken = (t) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* เบราว์เซอร์บล็อก sessionStorage */
  }
};

// ---------- ตัวเรียก fetch กลาง ----------
async function request(path, { method = "GET", body, params } = {}) {
  const qs = params
    ? "?" +
      new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
      )
    : "";
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path + qs, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่าเปิด npm run server อยู่");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ไม่มีเนื้อหา */
  }

  if (!res.ok) {
    // token หมดอายุ/ไม่ถูกต้อง (ยกเว้นตอนกำลังล็อกอิน) -> ล้าง token แล้วให้ App กลับไปหน้า Login
    if (res.status === 401 && path !== "/api/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event("auth:expired"));
    }
    throw new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`);
  }
  return data;
}

const resource = (base) => ({
  list: (params) => request(base, { params }),
  get: (id) => request(`${base}/${id}`),
  create: (data) => request(base, { method: "POST", body: data }),
  update: (id, data) => request(`${base}/${id}`, { method: "PUT", body: data }),
  remove: (id) => request(`${base}/${id}`, { method: "DELETE" }),
});

// ---------- API ทั้งหมด ----------
export const api = {
  // เข้าสู่ระบบ (หน้าสำหรับเจ้าของอู่ ไม่ต้องเลือกบทบาท)
  async login(username, password) {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setToken(data.token);
    return data.user;
  },
  // สมัครสมาชิก: บัญชีจะรอเจ้าของอู่อนุมัติก่อนใช้งานได้
  register: (data) => request("/api/auth/register", { method: "POST", body: data }),
  logout() {
    setToken(null);
  },
  isLoggedIn: () => !!getToken(),
  me: () => request("/api/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/api/auth/password", { method: "PUT", body: { current_password, new_password } }),

  vehicles: resource("/api/vehicles"),
  repairs: resource("/api/repairs"),
  alerts: resource("/api/alerts"),
  users: resource("/api/users"), // เฉพาะเจ้าของกิจการ
  customers: resource("/api/customers"),

  // แชต LINE (ต้องตั้ง LINE Official Account ใน .env ฝั่งหลังบ้าน)
  line: {
    status: () => request("/api/line/status"),
    contacts: () => request("/api/line/contacts"),
    linkCustomer: (id, customerId) => request(`/api/line/contacts/${id}`, { method: "PUT", body: { customerId } }),
    messages: (id, after = 0) => request(`/api/line/contacts/${id}/messages`, { params: { after } }),
    send: (id, text) => request(`/api/line/contacts/${id}/messages`, { method: "POST", body: { text } }),
    async mediaUrl(filename) {
      const res = await fetch(`/api/line/media/${filename}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error("โหลดรูปไม่สำเร็จ");
      return URL.createObjectURL(await res.blob());
    },
  },
  followups: resource("/api/followups"),

  // รูปถ่ายงานซ่อม: ส่งไฟล์รูปดิบ (Blob) ขึ้นไปเก็บ
  async uploadPhoto(repairId, blob, kind = "after") {
    let res;
    try {
      res = await fetch(`/api/repairs/${repairId}/photos?kind=${kind}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/jpeg", Authorization: `Bearer ${getToken()}` },
        body: blob,
      });
    } catch {
      throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่าเปิด npm run server อยู่");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        setToken(null);
        window.dispatchEvent(new Event("auth:expired"));
      }
      throw new Error((data && data.error) || `อัปโหลดรูปไม่สำเร็จ (${res.status})`);
    }
    return data;
  },
  // หน้าแรกสาธารณะ (ไม่ต้องล็อกอิน)
  async publicGallery() {
    const res = await fetch("/api/public/gallery");
    if (!res.ok) throw new Error("โหลดผลงานไม่สำเร็จ");
    return res.json();
  },
  deletePhoto: (id) => request(`/api/photos/${id}`, { method: "DELETE" }),
  // ดึงรูปด้วย token แล้วคืน object URL ไว้ใส่ใน <img>
  async photoUrl(filename) {
    const res = await fetch(`/api/photos/${filename}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error("โหลดรูปไม่สำเร็จ");
    return URL.createObjectURL(await res.blob());
  },

  monthlyCost: (months = 6) => request("/api/reports/monthly-cost", { params: { months } }),
};
