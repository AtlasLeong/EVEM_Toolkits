import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { clientIconDevServerPlugin } from './scripts/client-icon-dev-server.mjs'

export default defineConfig(({ command, mode, isPreview }) => ({
  // Only the application is an entry. Generated Playwright HTML/trace files
  // are not pages to scan or hot-reload while a local preview is open.
  optimizeDeps: { entries: ['index.html'] },
  ...(process.env.PW_TEST_PORT ? { cacheDir: `node_modules/.vite-pw-${process.env.PW_TEST_PORT}` } : {}),
  plugins: [
    react(),
    ...(command === 'serve' && !isPreview && mode !== 'production' ? [clientIconDevServerPlugin()] : []),
  ],
  // Explicit opt-in loopback preview. Builds and ordinary development retain
  // their configured API; demo credentials must never fall back to production.
  ...(command === 'serve' && mode === 'tactical-local' ? {
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:8001/api') },
  } : {}),
  ...(command === 'serve' && mode === 'starsea-local' ? {
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:8002/api') },
  } : {}),
  server: {
    port: 5180,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/output/client-icon-candidates/**'],
    },
    watch: { ignored: ['**/test-results-tactical/**', '**/test-results*/**', '**/playwright-report/**', '**/output/playwright/**', '**/output/client-icon-candidates/**'] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion-vendor': ['framer-motion'],
          'query-vendor': ['@tanstack/react-query'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
}))
