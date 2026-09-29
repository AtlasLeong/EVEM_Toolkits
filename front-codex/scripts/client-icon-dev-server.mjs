import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST_PATH = '/dev/icon-candidates/manifest.json'
const THUMBNAIL_PREFIX = '/dev/icon-candidates/thumbnails/'
const HASHED_THUMBNAIL = /^\/dev\/icon-candidates\/thumbnails\/([a-f0-9]{64})\.webp$/iu
const ROUTE_PREFIX = '/dev/icon-candidates'
const DEFAULT_OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../output/client-icon-candidates')

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function loopbackAddress(address) {
  if (!address) return false
  const normalizedAddress = String(address).toLowerCase()
  const normalized = normalizedAddress.startsWith('::ffff:') ? normalizedAddress.slice('::ffff:'.length) : normalizedAddress
  return normalized === '::1' || (net.isIP(normalized) === 4 && normalized.startsWith('127.'))
}

function loopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false
  let host = hostHeader.trim().toLowerCase()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end < 0) return false
    host = host.slice(1, end)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon > -1 && /^\d+$/u.test(host.slice(colon + 1))) host = host.slice(0, colon)
  }
  return host === 'localhost' || loopbackAddress(host)
}

function routePath(rawUrl) {
  const rawPath = String(rawUrl || '/').split(/[?#]/u, 1)[0]
  if (!rawPath.startsWith(ROUTE_PREFIX)) return null
  try {
    const pathname = decodeURIComponent(rawPath)
    // Do not let URL parsing normalize dot segments before this check.
    if (pathname.includes('\\') || pathname.split('/').some(segment => segment === '.' || segment === '..')) return { kind: 'invalid' }
    if (pathname === MANIFEST_PATH) return { kind: 'manifest' }
    const match = pathname.match(HASHED_THUMBNAIL)
    if (match) return { kind: 'thumbnail', hash: match[1].toLowerCase() }
    return { kind: 'invalid' }
  } catch {
    return { kind: 'invalid' }
  }
}

function send(response, status, contentType, body, method) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
  response.statusCode = status
  response.setHeader('content-type', contentType)
  response.setHeader('content-length', payload.length)
  if (method !== 'HEAD') response.end(payload)
  else response.end()
}

function sendError(response, status, error, method) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify({ error }), method)
}

async function readConfinedFile(outputDir, relativePath) {
  let root
  try {
    root = await fs.realpath(outputDir)
  } catch {
    return null
  }
  const candidate = path.resolve(root, relativePath)
  if (!isWithin(root, candidate)) return null
  let resolved
  try {
    resolved = await fs.realpath(candidate)
    const stat = await fs.stat(resolved)
    if (!stat.isFile() || !isWithin(root, resolved)) return null
    return { path: resolved, stat }
  } catch {
    return null
  }
}

/**
 * Mount the generated icon candidate output in Vite development only.
 * The route is deliberately allowlisted and cannot become a general file server.
 */
export function clientIconDevServerPlugin({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const outputRoot = path.resolve(outputDir)
  return {
    name: 'client-icon-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const route = routePath(request.url)
        if (!route) return next()
        const method = request.method || 'GET'
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD')
          return sendError(response, 405, 'Method not allowed', method)
        }
        const peer = request.socket?.remoteAddress
        if (!loopbackAddress(peer) || !loopbackHost(request.headers?.host)) return sendError(response, 403, 'Loopback only', method)
        if (route.kind === 'invalid') return sendError(response, 404, 'Not found', method)
        const relativePath = route.kind === 'manifest' ? 'manifest.json' : path.join('thumbnails', `${route.hash}.webp`)
        void readConfinedFile(outputRoot, relativePath).then(async file => {
          if (!file) return sendError(response, 404, 'Not found', method)
          const contentType = route.kind === 'manifest' ? 'application/json; charset=utf-8' : 'image/webp'
          if (method === 'HEAD') return send(response, 200, contentType, Buffer.alloc(file.stat.size), method)
          try {
            return send(response, 200, contentType, await fs.readFile(file.path), method)
          } catch {
            return sendError(response, 404, 'Not found', method)
          }
        }).catch(() => sendError(response, 404, 'Not found', method))
      })
    },
  }
}

export { DEFAULT_OUTPUT_DIR }
