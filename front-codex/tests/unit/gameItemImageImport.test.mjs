import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const importerUrl = new URL('../../scripts/import-game-item-images.mjs', import.meta.url)
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const revision = 'a'.repeat(64)
const ids = ['10100000101', '10100000102']

async function fixture(t, changeCatalog = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evem-shared-images-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const sourceRoot = path.join(root, 'source')
  const frontRoot = path.join(root, 'target')
  const dataRoot = path.join(sourceRoot, 'backend/GameData/data')
  const sourceImages = path.join(sourceRoot, 'front-codex/public/images/game-items')
  await Promise.all([fs.mkdir(path.join(dataRoot, 'versions'), { recursive: true }), fs.mkdir(sourceImages, { recursive: true }), fs.mkdir(frontRoot)])
  const png = await sharp({ create: { width: 156, height: 128, channels: 4, background: '#456789' } }).png().toBuffer()
  const digest = hash(png)
  const assetKey = `${revision}:icon`
  const catalog = {
    schema_version: 1, revision,
    items: Object.fromEntries(ids.map(id => [id, { image_status: 'verified', image_role: 'item-icon', asset_key: assetKey }])),
    assets: { [assetKey]: { path: `/images/game-items/${digest}.png`, png_sha256: digest, width: 156, height: 128 } },
  }
  changeCatalog(catalog)
  const bytes = Buffer.from(JSON.stringify(catalog))
  await fs.writeFile(path.join(dataRoot, 'versions', `${revision}.json`), bytes)
  await fs.writeFile(path.join(dataRoot, 'current.json'), JSON.stringify({ schema_version: 1, revision, catalog_sha256: hash(bytes) }))
  await fs.writeFile(path.join(sourceImages, `${digest}.png`), png)
  return { sourceRoot, frontRoot, png, digest, dataRoot, sourceImages, itemIds: ids }
}

async function runImport(options) {
  assert.ok(await fs.access(fileURLToPath(importerUrl)).then(() => true, () => false), 'shared GameData importer must exist')
  const { importGameItemImages } = await import(importerUrl)
  return importGameItemImages(options)
}

test('dry-run verifies the snapshot and deduplicates images without writing browser data', async t => {
  const options = await fixture(t)
  const result = await runImport(options)
  assert.equal(result.itemCount, 2)
  assert.equal(result.imageCount, 1)
  assert.equal(result.imageBytes, options.png.length)
  assert.deepEqual(result.manifest.items, Object.fromEntries(ids.map(id => [id, options.digest])))
  assert.equal(await fs.access(path.join(options.frontRoot, 'src/data/game-item-images.json')).then(() => true, () => false), false)
})

test('apply preserves original PNG content and proportions with a deterministic private-path-free index', async t => {
  const options = await fixture(t)
  await runImport({ ...options, apply: true })
  const manifestFile = path.join(options.frontRoot, 'src/data/game-item-images.json')
  const first = await fs.readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(first)
  assert.deepEqual(Object.keys(manifest).sort(), ['catalogSha256', 'items', 'schemaVersion', 'sourceRevision'])
  assert.equal(manifest.sourceRevision, revision)
  assert.equal(manifest.schemaVersion, 1)
  assert.ok(!first.includes(options.sourceRoot))
  const copied = await fs.readFile(path.join(options.frontRoot, 'public/images/game-items', `${options.digest}.png`))
  assert.deepEqual(copied, options.png)
  assert.equal((await sharp(copied).metadata()).width, 156)
  assert.equal((await fs.readdir(path.join(options.frontRoot, 'public/images/game-items'))).length, 1)
  await runImport({ ...options, apply: true })
  assert.equal(await fs.readFile(manifestFile, 'utf8'), first)
})

test('catalog hash mismatch aborts before writes', async t => {
  const options = await fixture(t)
  await fs.appendFile(path.join(options.dataRoot, 'versions', `${revision}.json`), '\n')
  await assert.rejects(runImport({ ...options, apply: true }), /catalog hash mismatch/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('corrupt source PNG aborts before writes', async t => {
  const options = await fixture(t)
  await fs.writeFile(path.join(options.sourceImages, `${options.digest}.png`), 'not the verified image')
  await assert.rejects(runImport({ ...options, apply: true }), /PNG hash mismatch/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('nonstandard or unverified image roles cannot enter the scoped index', async t => {
  const options = await fixture(t, catalog => { catalog.items[ids[1]].image_role = 'ship-render' })
  await assert.rejects(runImport({ ...options, apply: true }), /verified item-icon required/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('asset paths outside the content-addressed public namespace are rejected', async t => {
  const options = await fixture(t, catalog => { Object.values(catalog.assets)[0].path = '/images/game-items/../private.png' })
  await assert.rejects(runImport({ ...options, apply: true }), /invalid public image path/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('an existing content-addressed file with different content is not overwritten', async t => {
  const options = await fixture(t)
  const targetImages = path.join(options.frontRoot, 'public/images/game-items')
  await fs.mkdir(targetImages, { recursive: true })
  const targetFile = path.join(targetImages, `${options.digest}.png`)
  await fs.writeFile(targetFile, 'keep this conflicting file')
  await assert.rejects(runImport({ ...options, apply: true }), /destination hash mismatch/)
  assert.equal(await fs.readFile(targetFile, 'utf8'), 'keep this conflicting file')
  assert.equal(await fs.access(path.join(options.frontRoot, 'src')).then(() => true, () => false), false)
})

test('missing requested items fail the complete scope instead of silently yielding partial coverage', async t => {
  const options = await fixture(t)
  await assert.rejects(runImport({ ...options, itemIds: [...ids, '99999999'], apply: true }), /missing item 99999999/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('verified PNG dimensions must match catalog metadata', async t => {
  const options = await fixture(t, catalog => { Object.values(catalog.assets)[0].width = 128 })
  await assert.rejects(runImport({ ...options, apply: true }), /PNG dimensions mismatch/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('every alias for a shared image must agree with its verified PNG dimensions', async t => {
  const options = await fixture(t, catalog => {
    const asset = Object.values(catalog.assets)[0]
    catalog.assets.alias = { ...asset, width: 128 }
    catalog.items[ids[1]].asset_key = 'alias'
  })
  await assert.rejects(runImport({ ...options, apply: true }), /PNG dimensions mismatch/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('an invalid explicit scope is rejected rather than silently ignoring malformed IDs', async t => {
  const options = await fixture(t)
  await assert.rejects(runImport({ ...options, itemIds: [...ids, {}], apply: true }), /invalid requested item ID/)
  assert.deepEqual(await fs.readdir(options.frontRoot), [])
})

test('a late destination conflict is found before any new image is written', async t => {
  const options = await fixture(t)
  const png = await sharp({ create: { width: 156, height: 128, channels: 4, background: '#abcdef' } }).png().toBuffer()
  const digest = hash(png)
  const versionFile = path.join(options.dataRoot, 'versions', `${revision}.json`)
  const catalog = JSON.parse(await fs.readFile(versionFile, 'utf8'))
  catalog.assets.second = { path: `/images/game-items/${digest}.png`, png_sha256: digest, width: 156, height: 128 }
  catalog.items[ids[1]].asset_key = 'second'
  const bytes = Buffer.from(JSON.stringify(catalog))
  await fs.writeFile(versionFile, bytes)
  await fs.writeFile(path.join(options.dataRoot, 'current.json'), JSON.stringify({ schema_version: 1, revision, catalog_sha256: hash(bytes) }))
  await fs.writeFile(path.join(options.sourceImages, `${digest}.png`), png)
  const targetImages = path.join(options.frontRoot, 'public/images/game-items')
  await fs.mkdir(targetImages, { recursive: true })
  await fs.writeFile(path.join(targetImages, `${digest}.png`), 'conflict')
  await assert.rejects(runImport({ ...options, apply: true }), /destination hash mismatch/)
  assert.deepEqual(await fs.readdir(targetImages), [`${digest}.png`])
})

test('a destination directory link outside the frontend cannot receive imported files', async t => {
  const options = await fixture(t)
  const outside = path.join(path.dirname(options.frontRoot), 'outside')
  await fs.mkdir(outside)
  await fs.mkdir(path.join(options.frontRoot, 'public/images'), { recursive: true })
  await fs.symlink(outside, path.join(options.frontRoot, 'public/images/game-items'), 'junction')
  await assert.rejects(runImport({ ...options, apply: true }), /destination escapes frontend/)
  assert.deepEqual(await fs.readdir(outside), [])
})

test('a destination directory linked to the frontend parent is also outside the allowed root', async t => {
  const options = await fixture(t)
  const parent = path.dirname(options.frontRoot)
  await fs.mkdir(path.join(options.frontRoot, 'public/images'), { recursive: true })
  await fs.symlink(parent, path.join(options.frontRoot, 'public/images/game-items'), 'junction')
  await assert.rejects(runImport({ ...options, apply: true }), /destination escapes frontend/)
  assert.deepEqual((await fs.readdir(parent)).sort(), ['source', 'target'])
})
