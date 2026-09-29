import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { clientIconDevServerPlugin } from '../../scripts/client-icon-dev-server.mjs'
import viteConfig from '../../vite.config.js'

const hash = 'a'.repeat(64)

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-dev-server-'))
  const thumbnails = path.join(root, 'thumbnails')
  await fs.mkdir(thumbnails, { recursive: true })
  await fs.writeFile(path.join(root, 'manifest.json'), '{"schemaVersion":1,"candidates":[]}')
  await fs.writeFile(path.join(thumbnails, `${hash}.webp`), Buffer.from('webp-fixture'))
  return root
}

async function withServer(outputDir, callback) {
  const plugin = clientIconDevServerPlugin({ outputDir })
  const middlewares = { use(handler) { this.handler = handler } }
  plugin.configureServer({ middlewares })
  const server = http.createServer((request, response) => {
    middlewares.handler(request, response, () => {
      response.statusCode = 200
      response.setHeader('content-type', 'text/html')
      response.end('<html>spa fallback</html>')
    })
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
  try {
    const { port } = server.address()
    return await callback({ port })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers: { host: options.host || `127.0.0.1:${port}` } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    request.on('error', reject)
    request.end()
  })
}

test('serves only the generated manifest and hash-addressed thumbnails', async () => {
  const outputDir = await makeFixture()
  try {
    await withServer(outputDir, async ({ port }) => {
      const manifest = await request(port, '/dev/icon-candidates/manifest.json')
      assert.equal(manifest.status, 200)
      assert.match(manifest.headers['content-type'], /^application\/json/u)
      assert.deepEqual(JSON.parse(manifest.body), { schemaVersion: 1, candidates: [] })

      const thumbnail = await request(port, `/dev/icon-candidates/thumbnails/${hash}.webp`)
      assert.equal(thumbnail.status, 200)
      assert.equal(thumbnail.headers['content-type'], 'image/webp')
      assert.deepEqual(thumbnail.body, Buffer.from('webp-fixture'))

      const head = await request(port, '/dev/icon-candidates/manifest.json', { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.body.length, 0)
    })
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})

test('returns JSON errors for missing, traversal, unsupported method, and non-loopback host requests', async () => {
  const outputDir = await makeFixture()
  try {
    await withServer(outputDir, async ({ port }) => {
      await fs.rm(path.join(outputDir, 'manifest.json'))
      const missingManifest = await request(port, '/dev/icon-candidates/manifest.json')
      assert.equal(missingManifest.status, 404)
      assert.match(missingManifest.headers['content-type'], /^application\/json/u)
      assert.equal(JSON.parse(missingManifest.body).error, 'Not found')

      for (const pathname of [
        '/dev/icon-candidates/thumbnails/b.webp',
        '/dev/icon-candidates/thumbnails/../manifest.json',
        `/dev/icon-candidates/thumbnails/${hash}%2e%2e%2fmanifest.json`,
      ]) {
        const response = await request(port, pathname)
        assert.equal(response.status, 404, pathname)
        assert.match(response.headers['content-type'], /^application\/json/u)
        assert.equal(JSON.parse(response.body).error, 'Not found')
      }

      const method = await request(port, '/dev/icon-candidates/manifest.json', { method: 'POST' })
      assert.equal(method.status, 405)
      assert.match(method.headers.allow, /GET/u)
      assert.equal(JSON.parse(method.body).error, 'Method not allowed')

      const host = await request(port, '/dev/icon-candidates/manifest.json', { host: '192.0.2.1' })
      assert.equal(host.status, 403)
      assert.equal(JSON.parse(host.body).error, 'Loopback only')

      const spa = await request(port, '/some/other/path')
      assert.equal(spa.status, 200)
      assert.match(spa.body.toString(), /spa fallback/u)
    })
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})

test('rejects symlinked candidate files outside the generated output root', async () => {
  const outputDir = await makeFixture()
  const outside = path.join(path.dirname(outputDir), 'outside.webp')
  try {
    await fs.writeFile(outside, Buffer.from('secret'))
    try {
      await fs.symlink(outside, path.join(outputDir, 'thumbnails', `${'b'.repeat(64)}.webp`))
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EOPNOTSUPP') return
      throw error
    }
    await withServer(outputDir, async ({ port }) => {
      const response = await request(port, `/dev/icon-candidates/thumbnails/${'b'.repeat(64)}.webp`)
      assert.equal(response.status, 404)
      assert.equal(JSON.parse(response.body).error, 'Not found')
    })
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
    await fs.rm(outside, { force: true })
  }
})

test('adds the local candidate route only to non-production Vite serve config', () => {
  const hasPlugin = config => config.plugins.some(plugin => plugin?.name === 'client-icon-dev-server')
  assert.equal(hasPlugin(viteConfig({ command: 'serve', mode: 'development' })), true)
  assert.equal(hasPlugin(viteConfig({ command: 'serve', mode: 'tactical-local' })), true)
  assert.equal(hasPlugin(viteConfig({ command: 'build', mode: 'development' })), false)
  assert.equal(hasPlugin(viteConfig({ command: 'serve', mode: 'production' })), false)
  assert.equal(hasPlugin(viteConfig({ command: 'serve', mode: 'development', isPreview: true })), false)
  assert.ok(viteConfig({ command: 'serve', mode: 'development' }).server.fs.deny.includes('**/output/client-icon-candidates/**'))
  assert.ok(viteConfig({ command: 'serve', mode: 'development' }).server.watch.ignored.includes('**/output/client-icon-candidates/**'))
})
