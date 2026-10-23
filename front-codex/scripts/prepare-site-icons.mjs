import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const project = new URL('../', import.meta.url)
export const SITE_ICONS = Object.freeze([
  { name: 'favicon-32.png', size: 32 },
  { name: 'mark-96.png', size: 96 },
  { name: 'touch-180.png', size: 180 },
].map(Object.freeze))

export async function prepareSiteIcons() {
  const source = fileURLToPath(new URL('public/evem-compass-solid.png', project))
  const output = new URL('public/brand/', project)
  await mkdir(output, { recursive: true })
  for (const { name, size } of SITE_ICONS) {
    await sharp(source)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(fileURLToPath(new URL(name, output)))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareSiteIcons()
}
