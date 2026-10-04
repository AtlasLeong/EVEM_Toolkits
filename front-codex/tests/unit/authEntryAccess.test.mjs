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

test('production login describes guest reads, normal registration and separate private permissions', async () => {
  const html = await renderEntry({ PROD: true })
  assert.match(html, /普通工具可作为访客浏览/)
  assert.match(html, /新邮箱可通过验证码注册/)
  assert.match(html, /提交、保存和私人模块需要登录/)
  assert.match(html, /管理与协作资源还需相应授权/)
  assert.match(html, /href="\/fraudlist"[^>]*>访客模式<\/a>/)
  assert.doesNotMatch(html, /白名单|当前站点暂未开放访客浏览|注册账号不会自动获得查看权限/)
})

test('legacy viewer flags cannot turn normal registration into a whitelist or hide the public guest entry', async () => {
  for (const env of [{ PROD: false }, { PROD: true, VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'false', VITE_VIEWER_ALLOWLIST_ENABLED: 'true' }]) {
    const html = await renderEntry(env)
    assert.match(html, /href="\/fraudlist"[^>]*>访客模式<\/a>/)
    assert.doesNotMatch(html, /当前站点暂未开放访客浏览/)
  }
})

test('a disabled dedicated read switch truthfully hides the guest link but keeps normal account registration', async () => {
  const html = await renderEntry({ PROD: true, VITE_PUBLIC_READ_ACCESS_ENABLED: 'false', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' })
  assert.match(html, /当前部署的普通工具需要登录/)
  assert.match(html, /新邮箱可通过验证码注册/)
  assert.match(html, /私人模块仍需相应授权/)
  assert.doesNotMatch(html, /href="\/fraudlist"/)
  assert.doesNotMatch(html, /访客模式|白名单/)
})
