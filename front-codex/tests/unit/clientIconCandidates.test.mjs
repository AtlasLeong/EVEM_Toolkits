import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import {
  normalizeCandidateManifest,
  prepareClientIconCandidates,
} from '../../scripts/prepare-client-icon-candidates.mjs'

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'client-icon-candidates-'))
  const images = path.join(root, 'decoded-images')
  const out = path.join(root, 'candidates')
  await fs.mkdir(path.join(images, 'nested'), { recursive: true })
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
  }).png().toFile(path.join(images, 'nested/accepted.png'))
  await sharp({
    create: { width: 64, height: 32, channels: 4, background: { r: 80, g: 60, b: 40, alpha: 1 } },
  }).png().toFile(path.join(images, 'unsupported.png'))
  return { root, images, out }
}

test('normalizes decoded PNG candidates, preserves source metadata, and filters unsafe entries', async () => {
  const { root, images } = await makeFixture()
  try {
    const result = await normalizeCandidateManifest({
      count: 5,
      items: [
        {
          source: 'nested/accepted.ktx',
          sourceSha256: hashA,
          png: 'nested/accepted.png',
          width: 128,
          height: 128,
        },
        {
          source: 'unsupported.ktx',
          sourceSha256: hashB,
          png: 'unsupported.png',
          width: 64,
          height: 32,
        },
        {
          source: 'missing.ktx',
          sourceSha256: 'c'.repeat(64),
          png: 'missing.png',
          width: 128,
          height: 128,
        },
        {
          source: '../outside.ktx',
          sourceSha256: 'd'.repeat(64),
          png: '../outside.png',
          width: 128,
          height: 128,
        },
      ],
    }, { imagesDir: images })

    assert.deepEqual(result.candidates, [{
      source: 'nested/accepted.ktx',
      sourceHash: hashA,
      png: 'nested/accepted.png',
      width: 128,
      height: 128,
      format: 'png',
      thumbnailUrl: `thumbnails/${hashA}.webp`,
    }])
    assert.ok(result.candidates.every(candidate => !candidate.thumbnailUrl.split('/').includes('..')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('prepares a compact manifest and 96px WebP thumbnails without copying source PNGs', async () => {
  const { root, images, out } = await makeFixture()
  const manifestPath = path.join(root, 'decoded-images-manifest.json')
  try {
    await fs.writeFile(manifestPath, JSON.stringify({ items: [{
      source: 'nested/accepted.ktx',
      sourceSha256: hashA,
      png: 'nested/accepted.png',
      width: 128,
      height: 128,
    }] }))

    const prepared = await prepareClientIconCandidates({ manifestPath, imagesDir: images, outDir: out })
    const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest, prepared)
    assert.deepEqual(manifest.candidates[0], {
      source: 'nested/accepted.ktx',
      sourceHash: hashA,
      png: 'nested/accepted.png',
      width: 128,
      height: 128,
      format: 'png',
      thumbnailUrl: `thumbnails/${hashA}.webp`,
    })
    const thumbnailPath = path.join(out, 'thumbnails', `${hashA}.webp`)
    const thumbnail = await sharp(await fs.readFile(thumbnailPath)).metadata()
    assert.equal(thumbnail.format, 'webp')
    assert.equal(thumbnail.width, 96)
    assert.equal(thumbnail.height, 96)
    await assert.rejects(fs.access(path.join(out, 'nested/accepted.png')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
