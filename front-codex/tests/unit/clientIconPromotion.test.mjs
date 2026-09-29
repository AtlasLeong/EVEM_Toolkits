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
