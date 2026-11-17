// เครื่องมือ build ของเว็บ · /api ส่งต่อไป gateway ตอนพัฒนา

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: env.VITE_GATEWAY_URL || 'http://localhost:8080', changeOrigin: true },
      },
    },
  }
})
