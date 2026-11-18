// เครื่องมือ build ของเว็บ · /api ส่งต่อไป gateway ตอนพัฒนา
// ใน docker ตั้ง API_PROXY_TARGET=http://gateway:8080 · รันบนเครื่องใช้ localhost:8080

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target = process.env.API_PROXY_TARGET || env.VITE_GATEWAY_URL || 'http://localhost:8080'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
  }
})
