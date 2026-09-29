import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { promoteClientIcons } from '../../scripts/promote-client-icons.mjs'

const sha = data => crypto.createHash('sha256').update(data).digest('hex')
test('dry-run validates source and PNG and produces content-addressed metadata without writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-promote-'))
  try {
    const images = path.join(root, 'images'); const sources = path.join(root, 'sources')
    await fs.mkdir(path.join(images, 'nested'), { recursive: true }); await fs.mkdir(path.join(sources, 'nested'), { recursive: true })
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: 'red' } }).png().toBuffer()
    const source = Buffer.from('texture-data'); await fs.writeFile(path.join(images, 'nested/icon.png'), png); await fs.writeFile(path.join(sources, 'nested/icon.ktx'), source)
    const sourceHash = sha(source); const mapping = path.join(root, 'mapping.json'); const manifest = path.join(root, 'manifest.json')
    await fs.writeFile(mapping, JSON.stringify({ schemaVersion: 1, mappings: [{ itemId: '28007000000', sourceHash, status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z', iconPath: '/images/client-items/old.webp' }] }))
    await fs.writeFile(manifest, JSON.stringify({ items: [{ source: 'nested/icon.ktx', sourceSha256: sourceHash, png: 'nested/icon.png' }] }))
    const result = await promoteClientIcons({ mappingPath: mapping, manifestPath: manifest, imagesDir: images, sourcesDir: sources, replace: true, frontRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../') })
    assert.equal(result.mapping.mappings[0].width, 128); assert.match(result.mapping.mappings[0].iconPath, /^\/images\/client-items\/28007000000-[a-f0-9]{64}\.webp$/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('accepts icons:prepare sourceHash manifests and only promotes confirmed records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-promote-prepared-'))
  try {
    const images = path.join(root, 'images'); const sources = path.join(root, 'sources')
    await fs.mkdir(images, { recursive: true }); await fs.mkdir(sources, { recursive: true })
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: 'blue' } }).png().toBuffer()
    const source = Buffer.from('prepared-source'); await fs.writeFile(path.join(images, 'icon.png'), png); await fs.writeFile(path.join(sources, 'icon.ktx'), source)
    const sourceHash = sha(source); const mapping = path.join(root, 'mapping.json'); const manifest = path.join(root, 'manifest.json')
    await fs.writeFile(mapping, JSON.stringify({ schemaVersion: 1, mappings: [
      { itemId: '28007000000', sourceHash, status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z', iconPath: '/images/client-items/28007000000.png' },
      { itemId: '42002000012', sourceHash, status: 'conflict', confirmedAt: '2026-09-29T00:00:00.000Z', iconPath: '/images/client-items/42002000012.png' },
    ] }))
    await fs.writeFile(manifest, JSON.stringify({ schemaVersion: 1, candidates: [{ source: 'icon.ktx', sourceHash, png: 'icon.png', width: 32, height: 32, format: 'png' }] }))
    const result = await promoteClientIcons({ mappingPath: mapping, manifestPath: manifest, imagesDir: images, sourcesDir: sources, frontRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../') })
    assert.equal(result.writes.length, 1)
    assert.equal(result.mapping.mappings.find(item => item.itemId === '42002000012').status, 'conflict')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('rejects malformed mappings before promotion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-promote-invalid-'))
  try {
    const mapping = path.join(root, 'mapping.json'); const manifest = path.join(root, 'manifest.json')
    await fs.writeFile(mapping, JSON.stringify({ schemaVersion: 1, mappings: [
      { itemId: '28007000000', sourceHash: 'a'.repeat(64), status: 'revoked', confirmedAt: '2026-09-29T00:00:00.000Z', iconPath: '/images/client-items/shared.webp' },
      { itemId: '42002000012', sourceHash: 'b'.repeat(64), status: 'revoked', confirmedAt: '2026-09-29T00:00:00.000Z', iconPath: '/images/client-items/shared.webp' },
    ] }))
    await fs.writeFile(manifest, JSON.stringify({ items: [] }))
    await assert.rejects(() => promoteClientIcons({ mappingPath: mapping, manifestPath: manifest, imagesDir: root, sourcesDir: root, frontRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../') }), /duplicate iconPath/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('does not replace a corrupt installed mapping with an empty fixture', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-promote-installed-'))
  try {
    const frontRoot = path.join(root, 'front'); const images = path.join(root, 'images'); const sources = path.join(root, 'sources')
    await fs.mkdir(path.join(frontRoot, 'src/utils'), { recursive: true }); await fs.mkdir(path.join(frontRoot, 'src/data'), { recursive: true })
    await fs.mkdir(images, { recursive: true }); await fs.mkdir(sources, { recursive: true })
    await fs.writeFile(path.join(frontRoot, 'src/utils/marketItemIcons.js'), "export const MARKET_ITEM_ICON_IDS = ['28007000000']\n")
    const target = path.join(frontRoot, 'src/data/confirmed-client-icon-mapping.json')
    const original = '{"schemaVersion":1,"mappings":[}'
    await fs.writeFile(target, original)
    const mapping = path.join(root, 'mapping.json'); const manifest = path.join(root, 'manifest.json')
    await fs.writeFile(mapping, JSON.stringify({ schemaVersion: 1, mappings: [] }))
    await fs.writeFile(manifest, JSON.stringify({ items: [] }))
    await assert.rejects(() => promoteClientIcons({ mappingPath: mapping, manifestPath: manifest, imagesDir: images, sourcesDir: sources, apply: true, frontRoot }), /invalid installed mapping/)
    assert.equal(await fs.readFile(target, 'utf8'), original)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
