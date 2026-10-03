import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
const siteName = 'EVEM 工具箱'
const siteDescription = 'EVE Echoes 玩家工具箱，提供市场行情、制造估价、星系导航与战术协作。'

function metaContent(name) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/g)].find(([value]) => (
    value.includes(`name="${name}"`) || value.includes(`property="${name}"`)
  ))?.[0]
  return tag?.match(/\bcontent="([^"]*)"/)?.[1]
}

async function loadMetadata() {
  const metadata = await import('../../src/utils/siteMetadata.js').catch(() => null)
  assert.ok(metadata, 'central public site metadata module must exist')
  return metadata
}

test('static HTML uses the approved public title without development branding', () => {
  assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], siteName)
  assert.doesNotMatch(html, /Front\s+Codex/i)
})

test('share crawlers receive a public description and Open Graph site identity', () => {
  assert.equal(metaContent('description'), siteDescription)
  assert.equal(metaContent('og:site_name'), siteName)
  assert.equal(metaContent('og:title'), siteName)
  assert.equal(metaContent('og:description'), siteDescription)
  assert.equal(metaContent('og:type'), 'website')
  assert.equal(metaContent('og:locale'), 'zh_CN')
})

test('Twitter share metadata uses the public identity without an invented share image', () => {
  assert.equal(metaContent('twitter:card'), 'summary')
  assert.equal(metaContent('twitter:title'), siteName)
  assert.equal(metaContent('twitter:description'), siteDescription)
  assert.equal(metaContent('og:image'), undefined)
  assert.equal(metaContent('twitter:image'), undefined)
})

test('the existing compass favicon and Apple icon remain unchanged', () => {
  assert.match(html, /<link rel="icon" type="image\/png" href="\/evem-compass-solid\.png" \/>/)
  assert.match(html, /<link rel="apple-touch-icon" href="\/evem-compass-solid\.png" \/>/)
})

test('public metadata constants match the initial document metadata', async () => {
  const { SITE_NAME, SITE_DESCRIPTION } = await loadMetadata()
  assert.equal(SITE_NAME, siteName)
  assert.equal(SITE_DESCRIPTION, siteDescription)
})

const routeCases = [
  ['/manufacturing', '制造估价'],
  ['/market', '市场价格'],
  ['/market/admin', '市场管理'],
  ['/killboard/12345', '击毁情报'],
  ['/killboard/admin', '击毁采集后台'],
  ['/planetary', '行星资源'],
  ['/starmap', '星系导航'],
  ['/tactical', '战术板'],
  ['/tactical/usage', '战术板使用概况'],
  ['/fraudlist', '防诈名单'],
  ['/corporations/7', '军团大厅'],
  ['/corporations/manage', '军团管理'],
  ['/corporations/review', '军团审核'],
  ['/starsea/123', '星海见闻'],
  ['/starsea/mine', '我的见闻'],
  ['/starsea/new', '撰写见闻'],
  ['/starsea/123/edit', '撰写见闻'],
  ['/starsea/review/123', '见闻审核'],
  ['/infocenter', '信息中心'],
  ['/feedback', '需求与反馈'],
  ['/usersetting', '账号设置'],
  ['/fraudadmin', '防诈管理'],
  ['/licenseadmin', '许可管理'],
  ['/dev/icon-verification', '客户端图标校验'],
  ['/login', '登录'],
  ['/fraudlogin', '管理员登录'],
  ['/access-denied', '查看权限'],
]

for (const [pathname, label] of routeCases) {
  test(`route ${pathname} has a module-specific public tab title`, async () => {
    const { resolveSiteTitle } = await loadMetadata()
    assert.equal(resolveSiteTitle(pathname), `${label} · ${siteName}`)
  })
}

test('root, unknown and invalid paths use a safe public fallback', async () => {
  const { resolveSiteTitle } = await loadMetadata()
  for (const pathname of ['/', '/unknown/account@example.com', '/manufacturing-extra', '/marketplace', '', null, undefined]) {
    assert.equal(resolveSiteTitle(pathname), siteName)
  }
})

test('account data and query parameters never become the public tab title', async () => {
  const { resolveSiteTitle } = await loadMetadata()
  assert.equal(resolveSiteTitle('/login?email=account@example.com&next=/manufacturing'), `登录 · ${siteName}`)
  assert.equal(resolveSiteTitle('/tactical?organization=private-team#pilot-name'), `战术板 · ${siteName}`)
  assert.equal(resolveSiteTitle('/killboard/private-report-id'), `击毁情报 · ${siteName}`)
})

test('global router metadata updates document titles when the pathname changes', () => {
  assert.match(appSource, /import\s+\{\s*resolveSiteTitle\s*\}\s+from\s+['"]\.\/utils\/siteMetadata['"]/)
  assert.match(appSource, /function SiteMetadata\(\)\s*\{[\s\S]*?const \{ pathname \} = useLocation\(\)[\s\S]*?useEffect\(\(\) => \{\s*document\.title = resolveSiteTitle\(pathname\)\s*\}, \[pathname\]\)/)
  assert.match(appSource, /<SiteMetadata \/>/)
  assert.match(appSource, /<p className="eyebrow">EVEM 工具箱<\/p>/)
})
