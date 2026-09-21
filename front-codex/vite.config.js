import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  // Explicit opt-in loopback preview. Builds and ordinary development retain
  // their configured API; demo credentials must never fall back to production.
  ...(command === 'serve' && mode === 'tactical-local' ? {
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:8001/api') },
  } : {}),
  server: {
    port: 5180,
  },
}))
