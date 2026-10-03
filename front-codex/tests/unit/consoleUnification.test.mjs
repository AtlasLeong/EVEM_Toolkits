import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cssPath = fileURLToPath(new URL('../../src/styles/console-unification.css', import.meta.url))
const entryPath = fileURLToPath(new URL('../../src/main.jsx', import.meta.url))

test('console unification stylesheet defines the shared dark-console contract', () => {
  assert.ok(existsSync(cssPath), 'console unification stylesheet must exist')
  const css = readFileSync(cssPath, 'utf8')

  for (const token of [
    '--console-bg',
    '--console-accent',
    '--content-gutter',
    '--page-max',
  ]) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing shared token ${token}`)
  }

  for (const selector of ['.shell-main', '.page-stage', '.page-head', '.eyebrow', '.panel-head']) {
    assert.match(css, new RegExp(`\\${selector}\\b`), `missing console selector ${selector}`)
  }

  assert.match(css, /:focus-visible/, 'interactive focus treatment must be explicit')
  assert.match(css, /prefers-reduced-motion/, 'motion preferences must be respected')
  assert.match(css, /--console-bg[^;]*#(?:0b|0d|10|11|12|14|16|18|1a|1b|1c|1e|202|212|222|232|242|252|262|272|282|292|2a|2b|2c|2d|2e|2f)/i, 'console background should be dark')
})

test('console unification stylesheet is the final global style entry', () => {
  const entry = readFileSync(entryPath, 'utf8')
  const styleImports = [...entry.matchAll(/import ['"]([^'"]+\.css)['"];?/g)].map(match => match[1])
  assert.ok(styleImports.includes('./styles.css'), 'legacy global styles must remain imported')
  assert.equal(styleImports.at(-1), './styles/console-unification.css', 'unification layer must load last')
})

test('console surfaces map to the shared dark tokens without touching page data', () => {
  const css = readFileSync(cssPath, 'utf8')
  for (const selector of ['.manufacturing-page', '.market-page', '.tac-page', '.tactical-map-panel']) {
    assert.match(css, new RegExp(`\\${selector}[^}]*var\\(--console-(?:bg|surface|raised|line|text|accent)`), `missing token mapping for ${selector}`)
  }
})

test('local preview ignores generated browser reports instead of reloading the UI', () => {
  const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8')
  assert.match(config, /optimizeDeps:\s*\{\s*entries:\s*\['index\.html'\]/)
  assert.ok(config.includes('**/test-results*/**'))
  assert.ok(config.includes('**/playwright-report/**'))
})
