import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')
const authContext = React.createContext({ isAuthenticated: false, userInfo: null, logout() {} })
const compiled = new Map()

// Exercise the real Routes tree and guards with the real React router. Page
// bodies are replaced so this policy test cannot make API calls or mistake a
// lazy loading fallback for an authorization result.
async function appFor(env) {
  const key = JSON.stringify(env)
  if (!compiled.has(key)) {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../../src/App.jsx', import.meta.url))],
      bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
      define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, ...env }) },
      plugins: [{
        name: 'route-policy-bodies',
        setup(build) {
          build.onResolve({ filter: /^(react|react-router-dom)$/ }, args => args.namespace === 'policy-fixture'
            ? { path: args.path, external: true }
            : { path: args.path, namespace: 'policy-fixture' })
          build.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'policy-fixture' }))
          build.onResolve({ filter: /\/components\/layout\/AppShell$/ }, () => ({ path: 'shell', namespace: 'policy-fixture' }))
          build.onResolve({ filter: /\/components\/layout\/SiteFooter$/ }, () => ({ path: 'footer', namespace: 'policy-fixture' }))
          build.onResolve({ filter: /\/hooks\/useKillboardAccess$/ }, () => ({ path: 'killboard', namespace: 'policy-fixture' }))
          build.onResolve({ filter: /\.\/pages\// }, () => ({ path: 'page', namespace: 'policy-fixture' }))
          build.onLoad({ filter: /.*/, namespace: 'policy-fixture' }, ({ path }) => {
            const sources = {
              react: `import React from 'react'; export const { useContext, useEffect, Suspense } = React; export const lazy = () => () => React.createElement('span', { 'data-page': 'rendered' });`,
              'react-router-dom': `import React from 'react'; export { Route, Routes, Outlet, useLocation, useNavigate } from 'react-router-dom'; export function Navigate({ to, state }) { return React.createElement('output', { 'data-navigation': to, 'data-from': state?.from, 'data-reason': state?.reason }); }`,
              auth: `export const AuthContext = globalThis.__policyAuthContext;`,
              shell: `import React from 'react'; import { Outlet } from 'react-router-dom'; export default function Shell() { return React.createElement('section', { 'data-shell': true }, React.createElement(Outlet)); }`,
              footer: `export default function Footer() { return null; }`,
              killboard: `export default function useKillboardAccess() { return globalThis.__policyKillboardAccess; }`,
              page: `export default function Page() { return null; } export function CorporationDetailPage() { return null; }`,
            }
            return { contents: sources[path], loader: 'js' }
          })
        },
      }],
    })
    globalThis.__policyAuthContext = authContext
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    compiled.set(key, module.exports.default)
  }
  return compiled.get(key)
}

async function route(path, env = {}, authenticated = false, killboardAllowed = false) {
  const App = await appFor(env)
  globalThis.__policyKillboardAccess = { loading: false, allowed: killboardAllowed }
  return renderToStaticMarkup(React.createElement(StaticRouter, { location: path },
    React.createElement(authContext.Provider, { value: {
      isAuthenticated: authenticated, userInfo: authenticated ? { userId: 42, email: 'new-pilot@example.com' } : null, logout() {},
    } }, React.createElement(App))))
}

const publicPages = ['/market', '/manufacturing', '/planetary', '/infocenter', '/fraudlist', '/corporations', '/corporations/12', '/starsea', '/starsea/12', '/starmap', '/tactical']
const privatePages = ['/feedback', '/usersetting', '/market/admin', '/fraudadmin', '/licenseadmin', '/corporations/manage', '/corporations/review', '/starsea/mine', '/starsea/new', '/starsea/review', '/starsea/review/12', '/starsea/12/edit', '/tactical/usage', '/killboard', '/killboard/admin', '/killboard/12']
const publicEnvironments = [{}, { VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'false', VITE_VIEWER_ALLOWLIST_ENABLED: 'true' }, { VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' }, { VITE_PUBLIC_READ_ACCESS_ENABLED: 'true' }]

test('production public pages render anonymously regardless of old viewer flags', async () => {
  for (const env of publicEnvironments) {
    for (const path of publicPages) {
      const html = await route(path, env)
      assert.match(html, /data-page="rendered"/, `${path} ${JSON.stringify(env)}`)
      assert.doesNotMatch(html, /data-navigation=/, path)
    }
    assert.match(await route('/', env), /data-navigation="\/market"/)
  }
})

test('production private pages always require login and preserve their exact safe return path', async () => {
  for (const env of publicEnvironments) {
    for (const path of privatePages) {
      const html = await route(path, env)
      assert.match(html, /data-navigation="\/login"/, `${path} ${JSON.stringify(env)}`)
      assert.ok(html.includes(`data-from="${path}"`), path)
      assert.match(html, /data-reason="authentication"/)
      assert.doesNotMatch(html, /data-page="rendered"/, path)
    }
  }
})

test('disabling public reads requires login but accepts an ordinary registered email', async () => {
  const env = { VITE_PUBLIC_READ_ACCESS_ENABLED: 'false', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true', VITE_VIEWER_ALLOWLIST_EMAILS: 'someone-else@example.com' }
  for (const path of publicPages) {
    assert.match(await route(path, env), /data-navigation="\/login"/, path)
    const signedIn = await route(path, env, true)
    assert.match(signedIn, /data-page="rendered"/, path)
    assert.doesNotMatch(signedIn, /data-navigation=/, path)
  }
})

test('public and legacy switches never grant a registered nonowner KM access', async () => {
  for (const env of [...publicEnvironments, { VITE_PUBLIC_READ_ACCESS_ENABLED: 'false' }]) {
    for (const path of ['/killboard', '/killboard/12', '/killboard/admin']) {
      const denied = await route(path, env, true, false)
      assert.match(denied, /data-navigation="\/market"/, path)
      assert.doesNotMatch(denied, /data-page="rendered"/, path)
      const allowed = await route(path, env, true, true)
      assert.match(allowed, /data-page="rendered"/, path)
      assert.doesNotMatch(allowed, /data-navigation=/, path)
    }
  }
})
