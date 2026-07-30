import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 3000 no host é de outro projeto — o agente publica na 3100.
        target: process.env.VITE_API_URL || 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})
