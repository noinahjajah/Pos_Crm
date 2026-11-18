import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // ตอน dev ส่ง /api/* ต่อให้ API Gateway (ใน docker ตั้ง API_PROXY_TARGET=http://gateway:8080)
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:8080',
    },
  },
})
