import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const assets = [
  { name: 'favicon-32.png', size: 32, limit: 5 * 1024 },
  { name: 'mark-96.png', size: 96, limit: 20 * 1024 },
  { name: 'touch-180.png', size: 180, limit: 45 * 1024 },
]

test('HTML and navigation use small dedicated brand assets and retain the source image', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  const shell = await readFile(new URL('src/components/layout/AppShell.jsx', root), 'utf8')
  assert.match(html, /href="\/brand\/favicon-32\.png"/)
  assert.match(html, /href="\/brand\/touch-180\.png"/)
  assert.equal((shell.match(/src="\/brand\/mark-96\.png"/g) || []).length, 2)
  assert.doesNotMatch(html + shell, /(?:href|src)="\/evem-compass-solid\.png"/)
  assert.ok((await readFile(new URL('public/evem-compass-solid.png', root))).length > 0)
})

for (const asset of assets) {
  test(`the ${asset.size}px brand derivative is small, transparent and matches the original artwork`, async () => {
    const actual = await readFile(new URL(`public/brand/${asset.name}`, root))
    const metadata = await sharp(actual).metadata()
    assert.equal(metadata.width, asset.size)
    assert.equal(metadata.height, asset.size)
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.hasAlpha, true)
    assert.ok(actual.length <= asset.limit, `${asset.name}: ${actual.length} > ${asset.limit}`)
    const expected = await sharp(fileURLToPath(new URL('public/evem-compass-solid.png', root)))
      .resize(asset.size, asset.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().raw().toBuffer()
    const pixels = await sharp(actual).ensureAlpha().raw().toBuffer()
    assert.deepEqual(pixels, expected)
  })
}
