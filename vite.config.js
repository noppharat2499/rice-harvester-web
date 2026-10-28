import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // ส่งทุกคำขอที่ขึ้นต้นด้วย /api ไปให้ server.js (พอร์ต 5000)
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
