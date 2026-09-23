import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_BUDGET = {
  entryBytes: 120 * 1024,
  javascriptBytes: 240 * 1024,
  stylesheetBytes: 120 * 1024,
}

export function inspectBundle(distDirectory, budget = DEFAULT_BUDGET) {
  const assetsDirectory = resolve(distDirectory, 'assets')
  const files = readdirSync(assetsDirectory)
    .map(name => ({ name, bytes: statSync(join(assetsDirectory, name)).size }))
    .filter(file => /\.(?:js|css)$/.test(file.name))
  const violations = files.flatMap(file => {
    const isEntry = /^index-[^/]+\.js$/.test(file.name)
    const limit = file.name.endsWith('.css')
      ? budget.stylesheetBytes
      : isEntry
        ? budget.entryBytes
        : budget.javascriptBytes
    return file.bytes > limit ? [{ ...file, limit }] : []
  })
  return { files, violations }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const distDirectory = process.argv[2] || resolve(process.cwd(), 'dist')
  const report = inspectBundle(distDirectory)
  for (const file of report.files.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`${file.name}\t${file.bytes} bytes`)
  }
  if (report.violations.length) {
    console.error('\nBundle budget exceeded:')
    for (const file of report.violations) {
      console.error(`- ${file.name}: ${file.bytes} > ${file.limit} bytes`)
    }
    process.exitCode = 1
  }
}
