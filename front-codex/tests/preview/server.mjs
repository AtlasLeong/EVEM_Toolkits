import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePreviewRequest } from './fixtures.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const assetRoot = fileURLToPath(new URL('../../../backend/static/planet-nobg/', import.meta.url))
const token = () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userName: 'Local Preview', email: 'preview@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })}.preview-only`
}
const preview = await createServer({
  root,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 4182, strictPort: true },
  plugins: [{
    name: 'local-only-visual-fixtures',
    transformIndexHtml(html) {
      const fakeToken = token()
      return html.replace('<head>', `<head><script>const role=new URLSearchParams(location.search).get('previewRole');if(role){localStorage.clear();if(role!=='guest'){localStorage.setItem('access_token',${JSON.stringify(fakeToken)});localStorage.setItem('refresh_token',${JSON.stringify(fakeToken)});}}</script>`)
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1:4182')
        if (url.pathname.startsWith('/preview-assets/')) {
          const filename = path.basename(url.pathname)
          if (!/^[A-Za-z-]+\.png$/.test(filename)) { res.statusCode = 404; res.end(); return }
          try { res.setHeader('Content-Type', 'image/png'); res.end(await readFile(path.join(assetRoot, filename))) }
          catch { res.statusCode = 404; res.end() }
          return
        }
        if (!url.pathname.startsWith('/api/')) return next()
        try {
          let raw = ''
          for await (const chunk of req) { raw += chunk; if (raw.length > 1000000) throw new Error('Too large') }
          const result = resolvePreviewRequest(url, req.method, raw ? JSON.parse(raw) : {})
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(result.data))
        } catch { res.statusCode = 400; res.end('{"error":"Invalid preview request"}') }
      })
    },
  }],
})
await preview.listen()
preview.printUrls()
