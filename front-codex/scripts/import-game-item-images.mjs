import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { MARKET_ITEM_ICON_IDS } from '../src/utils/marketItemIcons.js'

const SHA256 = /^[a-f0-9]{64}$/iu
const ID = /^[1-9]\d*$/u
const PUBLIC_IMAGE = /^\/images\/game-items\/([a-f0-9]{64})\.png$/iu
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const exists = async file => fs.access(file).then(() => true, () => false)
const cleanId = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null
  return ID.test(String(value)) ? String(value) : null
}
const within = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
function fail(message) { throw new Error(`Game item image import failed: ${message}`) }
function sourceDirs(sourceRoot) {
  return {
    data: path.resolve(sourceRoot, 'backend/GameData/data'),
    images: path.resolve(sourceRoot, 'front-codex/public/images/game-items'),
  }
}
function manufacturingIds(frontRoot) {
  const scopeFile = path.resolve(frontRoot, 'public/industry/manufacturing-scope.json')
  if (!fsSync.existsSync(scopeFile)) return new Set()
  const scope = JSON.parse(fsSync.readFileSync(scopeFile, 'utf8'))
  const ids = new Set()
  for (const item of scope.items || []) { const id = cleanId(item?.itemId); if (id) ids.add(id) }
  for (const recipe of scope.recipes || []) {
    const product = cleanId(recipe?.productId); if (product) ids.add(product)
    for (const material of recipe?.materials || []) { const id = cleanId(material?.itemId); if (id) ids.add(id) }
  }
  return ids
}
function requestedIds(frontRoot, itemIds) {
  if (itemIds) {
    if (!Array.isArray(itemIds) || itemIds.some(id => !cleanId(id))) fail('invalid requested item ID')
    return new Set(itemIds.map(cleanId))
  }
  return new Set([...manufacturingIds(frontRoot), ...MARKET_ITEM_ICON_IDS])
}
async function readVerifiedCatalog(sourceRoot) {
  const dirs = sourceDirs(sourceRoot)
  const pointer = await json(path.join(dirs.data, 'current.json'))
  if (pointer.schema_version !== 1 || !SHA256.test(pointer.catalog_sha256) || !SHA256.test(pointer.revision)) fail('invalid current catalog pointer')
  const versionFile = path.join(dirs.data, 'versions', `${pointer.revision}.json`)
  const versionBytes = await fs.readFile(versionFile)
  const versionHash = hash(versionBytes)
  if (versionHash !== pointer.catalog_sha256.toLowerCase()) fail(`catalog hash mismatch (expected ${pointer.catalog_sha256}, got ${versionHash})`)
  const catalog = JSON.parse(versionBytes)
  if (catalog.schema_version !== 1 || catalog.revision !== pointer.revision || !catalog.items || !catalog.assets) fail('invalid immutable catalog')
  return { dirs, pointer, catalog }
}
async function inspectPng(file, digest, asset) {
  const bytes = await fs.readFile(file)
  if (hash(bytes) !== digest) fail(`PNG hash mismatch for ${digest}`)
  let metadata
  try { metadata = await sharp(bytes).metadata() } catch { fail(`invalid PNG for ${digest}`) }
  if (metadata.format !== 'png' || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) fail(`invalid PNG metadata for ${digest}`)
  if (Number(asset.width) !== metadata.width || Number(asset.height) !== metadata.height) fail(`PNG dimensions mismatch for ${digest}`)
  return { bytes, width: metadata.width, height: metadata.height }
}
function collectRecord(itemId, item, assets) {
  if (!item || item.image_status !== 'verified' || item.image_role !== 'item-icon') fail(`verified item-icon required for ${itemId}`)
  const asset = assets[item.asset_key]
  if (!asset || typeof asset.path !== 'string') fail(`missing image asset for ${itemId}`)
  const match = PUBLIC_IMAGE.exec(asset.path)
  if (!match || match[1].toLowerCase() !== String(asset.png_sha256 || '').toLowerCase() || !SHA256.test(asset.png_sha256)) fail(`invalid public image path for ${itemId}`)
  return { itemId, digest: match[1].toLowerCase(), asset }
}
async function prepareImport({ sourceRoot, frontRoot, itemIds }) {
  if (!sourceRoot || !frontRoot) fail('sourceRoot and frontRoot are required')
  const source = await readVerifiedCatalog(sourceRoot)
  const ids = requestedIds(frontRoot, itemIds)
  if (!ids.size) fail('requested scope is empty')
  const records = []
  for (const itemId of [...ids].sort()) {
    const record = source.catalog.items[itemId]
    if (!record) fail(`missing item ${itemId}`)
    records.push(collectRecord(itemId, record, source.catalog.assets))
  }
  const unique = new Map()
  for (const record of records) {
    if (!unique.has(record.digest)) unique.set(record.digest, record)
  }
  const checked = []
  const sourceImageRoot = await fs.realpath(source.dirs.images)
  for (const [digest, record] of unique) {
    const imagePath = path.resolve(source.dirs.images, `${digest}.png`)
    if (!within(source.dirs.images, imagePath) || !(await exists(imagePath))) fail(`missing source PNG ${digest}`)
    const realImagePath = await fs.realpath(imagePath)
    if (!within(sourceImageRoot, realImagePath)) fail(`source PNG escapes image root for ${digest}`)
    const inspected = await inspectPng(realImagePath, digest, record.asset)
    checked.push({ digest, ...inspected })
  }
  const checkedByDigest = new Map(checked.map(image => [image.digest, image]))
  for (const { digest, asset } of records) {
    const image = checkedByDigest.get(digest)
    if (Number(asset.width) !== image.width || Number(asset.height) !== image.height) fail(`PNG dimensions mismatch for ${digest}`)
  }
  const manifest = {
    schemaVersion: 1,
    sourceRevision: source.pointer.revision.toLowerCase(),
    catalogSha256: source.pointer.catalog_sha256.toLowerCase(),
    items: Object.fromEntries(records.map(({ itemId, digest }) => [itemId, digest])),
  }
  return { source, records, checked, manifest }
}
async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${crypto.randomUUID()}`
  try { await fs.writeFile(temp, content); await fs.rename(temp, file) } catch (error) { await fs.rm(temp, { force: true }); throw error }
}
async function verifyDestination(frontRoot, target) {
  const realFrontRoot = await fs.realpath(frontRoot)
  let ancestor = path.resolve(target)
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) fail('destination has no existing parent')
    ancestor = parent
  }
  if (!within(realFrontRoot, await fs.realpath(ancestor))) fail('destination escapes frontend')
}
export async function importGameItemImages({ sourceRoot, frontRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), itemIds, apply = false } = {}) {
  const prepared = await prepareImport({ sourceRoot, frontRoot, itemIds })
  const destination = path.resolve(frontRoot, 'public/images/game-items')
  const manifestTarget = path.resolve(frontRoot, 'src/data/game-item-images.json')
  await verifyDestination(frontRoot, destination)
  await verifyDestination(frontRoot, path.dirname(manifestTarget))
  const additions = []
  for (const image of prepared.checked) {
    const target = path.join(destination, `${image.digest}.png`)
    if (await exists(target)) {
      if (!within(await fs.realpath(frontRoot), await fs.realpath(target))) fail('destination escapes frontend')
      if (hash(await fs.readFile(target)) !== image.digest) fail(`destination hash mismatch for ${image.digest}`)
    } else additions.push({ ...image, target })
  }
  if (apply) {
    await fs.mkdir(destination, { recursive: true })
    for (const image of additions) await fs.writeFile(image.target, image.bytes, { flag: 'wx' })
    await writeAtomic(manifestTarget, `${JSON.stringify(prepared.manifest, null, 2)}\n`)
  }
  return {
    manifest: prepared.manifest,
    itemCount: prepared.records.length,
    imageCount: prepared.checked.length,
    imageBytes: prepared.checked.reduce((total, image) => total + image.bytes.length, 0),
  }
}
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') args.apply = true
    else if (arg === '--source-root') args.sourceRoot = argv[++i]
    else if (arg === '--front-root') args.frontRoot = argv[++i]
    else fail(`unknown argument ${arg}`)
  }
  return args
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  importGameItemImages(parseArgs(process.argv.slice(2)))
    .then(result => console.log(`${result.itemCount} item references, ${result.imageCount} unique PNGs, ${(result.imageBytes / 1048576).toFixed(2)} MiB${parseArgs(process.argv.slice(2)).apply ? ' imported' : ' validated (dry-run)'}`))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
