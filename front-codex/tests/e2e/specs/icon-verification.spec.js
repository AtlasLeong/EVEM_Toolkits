import { test, expect } from '@playwright/test'

const sourceHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const catalogFixture = {
  items: [{ itemId: '42', name: '试验舰船', category: 'ship' }],
  recipes: [],
}

const manifestFixture = {
  candidates: [{
    source: 'fixture/ships',
    sourceHash,
    png: `fixture/${sourceHash}.png`,
    thumbnailUrl: `thumbnails/${sourceHash}.webp`,
    format: 'png',
    width: 128,
    height: 128,
    iconId: '9001',
  }],
}

test.describe('developer icon verification workflow', () => {
  test('searches, binds, exports, and restores a mapping', async ({ page }) => {
    await page.route('**/industry/manufacturing-scope.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogFixture),
    }))
    await page.route('**/dev/icon-candidates/manifest.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(manifestFixture),
    }))

    await page.goto('/dev/icon-verification')
    await expect(page.getByRole('heading', { name: '客户端图标校验' })).toBeVisible()
    await page.getByLabel('搜索物品').fill('试验舰船')
    await expect(page.getByRole('button', { name: /试验舰船/ })).toBeVisible()
    await page.getByRole('button', { name: /aaaaaaaaaa/ }).click()
    await page.getByRole('button', { name: '绑定候选图标' }).click()
    await expect(page.getByText('已创建待审查绑定')).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出映射 JSON' }).click()
    const downloaded = await download
    const exported = JSON.parse(await downloaded.createReadStream().then(async stream => {
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      return Buffer.concat(chunks).toString('utf8')
    }))
    expect(exported.mappings).toHaveLength(1)
    expect(exported.mappings[0]).toMatchObject({ itemId: '42', sourceHash, iconPath: '/images/client-items/42.png' })

    await page.reload()
    await expect(page.getByText('confirmed', { exact: true })).toBeVisible()
    await expect(page.getByText('/images/client-items/42.png', { exact: true })).toBeVisible()
  })
})
