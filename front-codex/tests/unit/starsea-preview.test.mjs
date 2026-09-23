import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import viteConfig from '../../vite.config.js'
const config = (command, mode) => viteConfig({ command, mode })
test('Starsea preview API is loopback and does not alter production builds or tactical preview', () => {
  assert.equal(config('serve', 'starsea-local').define?.['import.meta.env.VITE_API_URL'], JSON.stringify('http://127.0.0.1:8002/api'))
  assert.equal(config('serve', 'tactical-local').define?.['import.meta.env.VITE_API_URL'], JSON.stringify('http://127.0.0.1:8001/api'))
  for (const [command, mode] of [['build', 'starsea-local'], ['build', 'production'], ['serve', 'development']]) {
    assert.equal(config(command, mode).define?.['import.meta.env.VITE_API_URL'], undefined)
  }
})
test('Starsea preview binds only loopback on its own strict port', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['dev:starsea'] || '', /--host 127\.0\.0\.1.*--port 4195.*--strictPort.*--mode starsea-local/)
})
