import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const SCHEMA_VERSION = 1
const THUMBNAIL_SIZE = 96
const MIN_ICON_DIMENSION = 16
const MAX_ICON_DIMENSION = 2048
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_RESEARCH_ROOT = path.resolve(PROJECT_ROOT, '../output/research/client-icons-2026-09-29')
const DEFAULT_ARGUMENTS = {
  manifest: path.join(DEFAULT_RESEARCH_ROOT, 'decoded-images-manifest.json'),
  images: path.join(DEFAULT_RESEARCH_ROOT, 'decoded-images'),
  out: path.join(PROJECT_ROOT, 'output/client-icon-candidates'),
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const portable = value.trim().replaceAll('\\', '/')
  if (portable.startsWith('/') || /^[a-z]:\//i.test(portable)) return null
  const segments = portable.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) return null
  const normalized = path.posix.normalize(portable)
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null
  return normalized
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function getManifestItems(manifest) {
  if (Array.isArray(manifest)) return manifest
  if (manifest && Array.isArray(manifest.items)) return manifest.items
  return []
}

function normalizeCandidate(item, imagesRoot) {
  if (!item || typeof item !== 'object') return null

  const png = safeRelativePath(item.png)
  const source = safeRelativePath(item.source)
  const sourceHash = typeof item.sourceSha256 === 'string' ? item.sourceSha256.toLowerCase() : ''
  const width = Number(item.width)
  const height = Number(item.height)
  if (!png || !source || !png.toLowerCase().endsWith('.png') || !SHA256_PATTERN.test(sourceHash)) return null
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null
  if (width !== height || width < MIN_ICON_DIMENSION || width > MAX_ICON_DIMENSION) return null

  const imagePath = path.resolve(imagesRoot, ...png.split('/'))
  if (!isWithin(imagesRoot, imagePath)) return null

  return {
    source,
    sourceHash,
    png,
    width,
    height,
    format: 'png',
    thumbnailUrl: `thumbnails/${sourceHash}.webp`,
    imagePath,
  }
}

/**
 * Select and normalize entries from the decoded-images manifest.
 * Missing files, unsafe paths, malformed hashes, and non-square dimensions
 * are filtered out so a complete extraction manifest can be processed.
 */
export async function normalizeCandidateManifest(manifest, { imagesDir } = {}) {
  if (!imagesDir) throw new TypeError('imagesDir is required')
  const imagesRoot = path.resolve(imagesDir)
  const candidates = []
  const seenHashes = new Set()
  for (const item of getManifestItems(manifest)) {
    const candidate = normalizeCandidate(item, imagesRoot)
    if (!candidate || seenHashes.has(candidate.sourceHash)) continue
    try {
      const stat = await fs.stat(candidate.imagePath)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    seenHashes.add(candidate.sourceHash)
    const { imagePath: _imagePath, ...publicCandidate } = candidate
    candidates.push(publicCandidate)
  }

  candidates.sort((left, right) => left.sourceHash.localeCompare(right.sourceHash) || left.png.localeCompare(right.png))
  return { schemaVersion: SCHEMA_VERSION, candidates }
}

/**
 * Build a local candidate index and 96px WebP thumbnails from a decoded image
 * directory. The source extraction tree is never copied to the output.
 */
export async function prepareClientIconCandidates({ manifestPath, imagesDir, outDir }) {
  if (!manifestPath || !imagesDir || !outDir) {
    throw new TypeError('manifestPath, imagesDir, and outDir are required')
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const imagesRoot = path.resolve(imagesDir)
  const prepared = await normalizeCandidateManifest(manifest, { imagesDir: imagesRoot })
  const outputRoot = path.resolve(outDir)
  const thumbnailsRoot = path.join(outputRoot, 'thumbnails')
  await fs.mkdir(thumbnailsRoot, { recursive: true })

  for (const candidate of prepared.candidates) {
    const imagePath = path.resolve(imagesRoot, ...candidate.png.split('/'))
    const thumbnailPath = path.join(thumbnailsRoot, `${candidate.sourceHash}.webp`)
    await sharp(imagePath)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp()
      .toFile(thumbnailPath)
  }

  await fs.writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(prepared))
  return prepared
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return {
      manifest: process.env.EVEM_ICON_MANIFEST || DEFAULT_ARGUMENTS.manifest,
      images: process.env.EVEM_ICON_IMAGES || DEFAULT_ARGUMENTS.images,
      out: process.env.EVEM_ICON_OUTPUT || DEFAULT_ARGUMENTS.out,
    }
  }
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--manifest', '--images', '--out'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    values[argument.slice(2)] = value
    index += 1
  }
  if (!values.manifest || !values.images || !values.out) {
    throw new Error('Usage: node scripts/prepare-client-icon-candidates.mjs --manifest <file> --images <dir> --out <dir>')
  }
  return values
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const result = await prepareClientIconCandidates({
    manifestPath: args.manifest,
    imagesDir: args.images,
    outDir: args.out,
  })
  process.stdout.write(`Prepared ${result.candidates.length} client icon candidates in ${path.resolve(args.out)}\n`)
  return result
}

const currentFile = path.resolve(fileURLToPath(import.meta.url))
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedFile === currentFile) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
