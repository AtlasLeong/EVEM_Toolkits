import mappingFixture from '../data/confirmed-client-icon-mapping.json' with { type: 'json' }

const CLIENT_ICON_PATH_PREFIX = '/images/client-items/'
const MAPPING_STATUSES = new Set(['confirmed', 'conflict', 'revoked'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

function fail(message) {
  throw new TypeError(`Invalid client icon mapping: ${message}`)
}

function normalizeItemId(value, field = 'itemId') {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
    fail(`${field} must be a positive numeric ID`)
  }

  const itemId = typeof value === 'string' ? value.trim() : String(value ?? '')
  if (!/^[1-9][0-9]*$/.test(itemId)) {
    fail(`${field} must be a positive numeric ID`)
  }
  return itemId
}

function normalizeIconPath(value, field) {
  if (typeof value !== 'string' || !value.startsWith(CLIENT_ICON_PATH_PREFIX)) {
    fail(`${field} must be a local ${CLIENT_ICON_PATH_PREFIX} path`)
  }

  const relativePath = value.slice(CLIENT_ICON_PATH_PREFIX.length)
  const segments = relativePath.split('/')
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes('?') ||
    relativePath.includes('#') ||
    /%2e|%2f|%5c/i.test(relativePath) ||
    segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    fail(`${field} must not contain path traversal or an invalid local path`)
  }

  return value
}

function normalizeSourceHash(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value.trim())) {
    fail(`${field} must be a SHA-256 hex digest`)
  }
  return value.trim().toLowerCase()
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail(`mappings[${index}] must be an object`)
  }

  const itemId = normalizeItemId(record.itemId, `mappings[${index}].itemId`)
  const iconPath = normalizeIconPath(record.iconPath, `mappings[${index}].iconPath`)
  const sourceHash = normalizeSourceHash(record.sourceHash, `mappings[${index}].sourceHash`)

  if (!MAPPING_STATUSES.has(record.status)) {
    fail(`mappings[${index}].status must be confirmed, conflict, or revoked`)
  }

  let iconId = null
  if (record.iconId !== undefined && record.iconId !== null && record.iconId !== '') {
    if (typeof record.iconId !== 'string' && typeof record.iconId !== 'number') {
      fail(`mappings[${index}].iconId must be a string or number`)
    }
    iconId = String(record.iconId)
  }

  const dimensions = {}
  for (const field of ['width', 'height']) {
    if (record[field] === undefined || record[field] === null) {
      dimensions[field] = null
    } else if (!Number.isSafeInteger(record[field]) || record[field] <= 0) {
      fail(`mappings[${index}].${field} must be a positive integer`)
    } else {
      dimensions[field] = record[field]
    }
  }

  let format = null
  if (record.format !== undefined && record.format !== null && record.format !== '') {
    if (typeof record.format !== 'string' || !/^[a-z0-9][a-z0-9.+-]*$/i.test(record.format)) {
      fail(`mappings[${index}].format must be a valid format name`)
    }
    format = record.format.toLowerCase()
  }

  let confirmedAt = null
  if (record.confirmedAt !== undefined && record.confirmedAt !== null && record.confirmedAt !== '') {
    if (typeof record.confirmedAt !== 'string' || !record.confirmedAt.trim()) {
      fail(`mappings[${index}].confirmedAt must be a timestamp string`)
    }
    confirmedAt = record.confirmedAt
  }

  return {
    itemId,
    iconId,
    iconPath,
    sourceHash,
    width: dimensions.width,
    height: dimensions.height,
    format,
    status: record.status,
    confirmedAt,
  }
}

/**
 * Validate and normalize the reviewed client icon mapping fixture.
 *
 * Non-confirmed records remain available for status inspection, but only
 * confirmed records are returned by getConfirmedClientIcon.
 */
export function normalizeClientIconMapping(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('source must be an object')
  }
  if (source.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (!Array.isArray(source.mappings)) fail('mappings must be an array')

  const mappings = source.mappings.map(normalizeRecord)
  const byItemId = new Map()
  const byPath = new Map()

  for (const mapping of mappings) {
    if (byItemId.has(mapping.itemId)) {
      fail(`duplicate itemId ${mapping.itemId}`)
    }
    if (byPath.has(mapping.iconPath)) {
      fail(`duplicate iconPath ${mapping.iconPath}`)
    }
    byItemId.set(mapping.itemId, mapping)
    byPath.set(mapping.iconPath, mapping)
  }

  return { schemaVersion: 1, mappings, byItemId, byPath }
}

const DEFAULT_MAPPING = normalizeClientIconMapping(mappingFixture)

function isNormalizedMapping(value) {
  return Boolean(value && typeof value === 'object' && value.byItemId instanceof Map)
}

function resolveArguments(first, second) {
  if (second === undefined) return { mapping: DEFAULT_MAPPING, itemId: first }
  if (isNormalizedMapping(first) || (first && typeof first === 'object' && 'mappings' in first)) {
    return { mapping: isNormalizedMapping(first) ? first : normalizeClientIconMapping(first), itemId: second }
  }
  if (isNormalizedMapping(second) || (second && typeof second === 'object' && 'mappings' in second)) {
    return { mapping: isNormalizedMapping(second) ? second : normalizeClientIconMapping(second), itemId: first }
  }
  return { mapping: DEFAULT_MAPPING, itemId: first }
}

function lookupRecord(first, second) {
  const { mapping, itemId } = resolveArguments(first, second)
  let normalizedId
  try {
    normalizedId = normalizeItemId(itemId)
  } catch {
    return null
  }
  return mapping.byItemId.get(normalizedId) ?? null
}

/** Return the production path for a confirmed item, or null when unavailable. */
export function getConfirmedClientIcon(first, second) {
  const mapping = lookupRecord(first, second)
  return mapping?.status === 'confirmed' ? mapping.iconPath : null
}

/** Return a mapping's review status, or null when the item has no mapping. */
export function getClientIconMappingStatus(first, second) {
  return lookupRecord(first, second)?.status ?? null
}

export { CLIENT_ICON_PATH_PREFIX }
