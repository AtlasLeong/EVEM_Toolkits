import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query')

async function renderEntry(env, location = '/login') {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/pages/Login.jsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'import.meta.env': JSON.stringify(env) },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  const client = new QueryClient()
  try {
    return renderToStaticMarkup(createElement(StaticRouter, { location },
      createElement(QueryClientProvider, { client }, createElement(module.exports.default))))
  } finally {
    client.clear()
  }
}

test('private production login describes its access policy and offers no misleading guest route', async () => {
  const html = await renderEntry({ PROD: true })
  assert.match(html, /请使用已获查看权限的账号登录/)
  assert.match(html, /当前站点暂未开放访客浏览/)
  assert.match(html, /注册账号不会自动获得查看权限/)
  assert.doesNotMatch(html, /href="\/fraudlist"/)
  assert.doesNotMatch(html, /访客模式/)
})

test('public and local login preserve the existing guest entry', async () => {
  for (const env of [{ PROD: false }, { PROD: true, VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' }]) {
    const html = await renderEntry(env)
    assert.match(html, /href="\/fraudlist"[^>]*>访客模式<\/a>/)
    assert.doesNotMatch(html, /当前站点暂未开放访客浏览/)
  }
})
