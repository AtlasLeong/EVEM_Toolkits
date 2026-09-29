import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SHA256 = /^[a-f0-9]{64}$/i
const STATUSES = new Set(['confirmed', 'conflict', 'revoked'])
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const within = (root, target) => { const r = path.relative(root, target); return r === '' || (!r.startsWith(`..${path.sep}`) && !path.isAbsolute(r)) }
const rel = value => typeof value === 'string' && value && !path.isAbsolute(value) && !value.split(/[\\/]/).some(x => x === '..' || x === '') && !/[?#]/.test(value)

function fail(message) { throw new Error(`Promotion failed: ${message}`) }
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }
function catalog(frontRoot) {
  const ids = new Set([...requireText(frontRoot)].flatMap(line => [...line.matchAll(/'([0-9]+)'/g)].map(m => m[1])))
  try {
    const scope = JSON.parse(fsSync.readFileSync(path.join(frontRoot, 'public/industry/manufacturing-scope.json'), 'utf8'))
    for (const item of scope.items || []) if (item?.itemId) ids.add(String(item.itemId))
    for (const recipe of scope.recipes || []) {
      if (recipe?.productId) ids.add(String(recipe.productId))
      for (const item of recipe.materials || []) if (item?.itemId) ids.add(String(item.itemId))
    }
  } catch { /* optional in isolated tests */ }
  return ids
}
function requireText(frontRoot) { return fsSync.readFileSync(path.join(frontRoot, 'src/utils/marketItemIcons.js'), 'utf8').split('\n') }
function normalizeMapping(source) {
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.mappings)) fail('invalid mapping schema')
  return source
}
async function promoteClientIcons({ mappingPath, manifestPath, imagesDir, sourcesDir, apply = false, replace = false, frontRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') }) {
  if (!mappingPath || !manifestPath || !imagesDir || !sourcesDir) fail('mapping, manifest, images, and sources are required')
  const mapping = normalizeMapping(await readJson(mappingPath))
  const target = path.join(frontRoot, 'src/data/confirmed-client-icon-mapping.json')
  let installed = { schemaVersion: 1, mappings: [] }
  try { installed = normalizeMapping(await readJson(target)) } catch { /* target may not exist in test fixtures */ }
  const manifest = await readJson(manifestPath)
  const items = Array.isArray(manifest) ? manifest : manifest.items
  if (!Array.isArray(items)) fail('invalid manifest')
  const byHash = new Map(items.filter(x => x && SHA256.test(x.sourceSha256 || '')).map(x => [x.sourceSha256.toLowerCase(), x]))
  const imageRoot = await fs.realpath(imagesDir); const sourceRoot = await fs.realpath(sourcesDir)
  const existing = new Map(installed.mappings.map(x => [String(x.itemId), x]))
  for (const x of mapping.mappings) existing.set(String(x.itemId), x)
  const ids = catalog(frontRoot); const additions = []
  for (const record of mapping.mappings) {
    if (!record || !/^\d+$/.test(String(record.itemId)) || !ids.has(String(record.itemId))) fail(`unknown item ${record?.itemId}`)
    if (!STATUSES.has(record.status) || !SHA256.test(record.sourceHash || '') || !iso(record.confirmedAt)) fail(`invalid record ${record.itemId}`)
    if (record.status === 'revoked') { additions.push(record); continue }
    const candidate = byHash.get(record.sourceHash.toLowerCase()); if (!candidate || !rel(candidate.png) || !rel(candidate.source)) fail(`missing source for ${record.itemId}`)
    const pngPath = path.resolve(imageRoot, candidate.png); const srcPath = path.resolve(sourceRoot, candidate.source)
    if (!within(imageRoot, pngPath) || !within(sourceRoot, srcPath)) fail(`path escapes root for ${record.itemId}`)
    const [png, src] = await Promise.all([fs.readFile(pngPath), fs.readFile(srcPath)])
    if (hash(src) !== record.sourceHash.toLowerCase()) fail(`source hash mismatch for ${record.itemId}`)
    const meta = await sharp(png).metadata(); if (!meta.width || !meta.height || meta.width !== meta.height || meta.format !== 'png' || (candidate.width && Number(candidate.width) !== meta.width) || (candidate.height && Number(candidate.height) !== meta.height)) fail(`invalid PNG for ${record.itemId}`)
    const pngHash = hash(png); const outName = `${record.itemId}-${pngHash}.webp`; const outPath = path.join(frontRoot, 'public/images/client-items', outName)
    if (existing.has(String(record.itemId)) && existing.get(String(record.itemId)).status === 'confirmed' && existing.get(String(record.itemId)).iconPath !== `/images/client-items/${outName}` && !replace) fail(`replacement requires --replace for ${record.itemId}`)
    const webp = await sharp(png).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer()
    additions.push({ ...record, iconPath: `/images/client-items/${outName}`, sourceHash: hash(src), width: 128, height: 128, format: 'webp' , _webp: webp, _outPath: outPath })
  }
  const merged = new Map(installed.mappings.map(x => [String(x.itemId), x]))
  for (const x of additions) { const { _webp, _outPath, ...clean } = x; merged.set(String(clean.itemId), clean) }
  const output = { schemaVersion: 1, mappings: [...merged.values()] }
  if (!apply) return { mapping: output, writes: additions.filter(x => x._webp).map(x => x._outPath) }
  await fs.mkdir(path.dirname(target), { recursive: true })
  for (const x of additions) if (x._webp) await fs.writeFile(x._outPath, x._webp)
  const temp = `${target}.tmp-${process.pid}`; await fs.writeFile(temp, JSON.stringify(output, null, 2) + '\n'); await fs.rename(temp, target)
  return { mapping: output, writes: additions.filter(x => x._webp).map(x => x._outPath) }
}
function parseArgs(argv) { const out = {}; for (let i=0;i<argv.length;i++) { const a=argv[i]; if (a==='--apply'||a==='--replace') out[a.slice(2)]=true; else if (['--mapping','--manifest','--images','--sources'].includes(a)) out[a.slice(2)] = argv[++i]; else fail(`unknown argument ${a}`) } return out }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) promoteClientIcons(parseArgs(process.argv.slice(2))).then(r => console.log(`${r.writes.length} icon(s) ${parseArgs(process.argv.slice(2)).apply ? 'promoted' : 'validated (dry-run)'}`)).catch(e => { console.error(e.message); process.exitCode=1 })
export { promoteClientIcons }
