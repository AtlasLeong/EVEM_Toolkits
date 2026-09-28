/*
 * Pure manufacturing-plan expansion and costing helpers.
 *
 * The catalog is deliberately kept separate from a plan.  A plan owns its
 * overrides, manual prices, and market-quote snapshot so editing one plan
 * cannot change another plan (or the public market data).  Monetary values in
 * the summary are canonical decimal strings; all arithmetic is performed with
 * BigInt coefficients rather than binary floating point numbers.
 */

const QUOTE_STATUS_REASON = new Map([
  ['stale', 'quote_stale'],
  ['expired', 'quote_stale'],
  ['empty', 'quote_empty'],
  ['uncollected', 'quote_uncollected'],
  ['not_collected', 'quote_uncollected'],
  ['pending', 'quote_uncollected'],
])

const FRESH_QUOTE_STATUSES = new Set(['fresh', 'ok', 'collected', 'available'])

function fail(message) {
  throw new TypeError(`Invalid manufacturing plan: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function asId(value, field = 'itemId') {
  const id = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(id)) fail(`${field} must be a positive numeric ID`)
  return id
}

function asPositiveInteger(value, field) {
  const parsed = typeof value === 'string' && /^[0-9]+$/u.test(value.trim())
    ? Number(value.trim())
    : value
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${field} must be a positive safe integer`)
  return parsed
}

function cloneValue(value) {
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [String(key), cloneValue(entry)]))
  }
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]))
  return value
}

function cloneRecord(value) {
  if (value === undefined || value === null) return {}
  if (value instanceof Map) return cloneValue(value)
  if (!isObject(value) || Array.isArray(value)) fail('record options must be objects or Maps')
  return cloneValue(value)
}

function recordValue(record, itemId) {
  if (record instanceof Map) return record.get(itemId) ?? record.get(String(itemId))
  return record?.[itemId]
}

function normalizeTargetId(catalog, options) {
  const requested = options.targetId ?? options.targetItemId ?? options.itemId ?? (
    typeof options.target === 'string' && /^[0-9]+$/u.test(options.target) ? options.target : undefined
  )
  if (requested !== undefined) return asId(requested, 'targetId')
  const targetName = options.targetName ?? (typeof options.target === 'string' && !/^[0-9]+$/u.test(options.target) ? options.target : undefined)
  if (targetName !== undefined) {
    const recipe = catalog.byName?.get(String(targetName).trim())
    if (recipe) return recipe.productId
  }
  if (isObject(options.target)) {
    if (options.target.productId !== undefined) return asId(options.target.productId, 'targetId')
    if (options.target.itemId !== undefined) return asId(options.target.itemId, 'targetId')
  }
  fail('targetId (or a known targetName) is required')
}

function resolveCreateArgs(first, second) {
  if (second !== undefined) return { catalog: first, options: second ?? {} }
  if (first?.catalog && first?.targetId !== undefined) return { catalog: first.catalog, options: first }
  if (first?.byId instanceof Map) return { catalog: first, options: {} }
  if (first?.catalog?.byId instanceof Map) return { catalog: first.catalog, options: first }
  fail('createPlan expects (catalog, options) or an options object containing catalog')
}

function assertCatalog(catalog) {
  if (!isObject(catalog) || !(catalog.byId instanceof Map) || !(catalog.items instanceof Map)) {
    fail('catalog must be a validated manufacturing catalog')
  }
}

/**
 * Create a plan snapshot.  `purchasePrices` and `marketQuotes` are cloned;
 * they are not references to global market state.
 */
export function createPlan(first, second) {
  const { catalog, options } = resolveCreateArgs(first, second)
  assertCatalog(catalog)

  const targetId = normalizeTargetId(catalog, options)
  if (!catalog.byId.has(targetId)) fail(`unknown target recipe ${targetId}`)

  const quantity = asPositiveInteger(options.quantity ?? options.targetQuantity ?? 1, 'quantity')
  const overrides = cloneRecord(options.overrides)
  const purchasePrices = cloneRecord(options.purchasePrices)
  const marketQuotes = cloneRecord(options.marketQuotes ?? options.quotes)
  const settings = cloneRecord(options.settings)

  return {
    schemaVersion: 1,
    catalog,
    targetId,
    quantity,
    overrides,
    purchasePrices,
    marketQuotes,
    settings,
  }
}

function overrideMode(overrides, itemId) {
  const override = recordValue(overrides, itemId)
  if (override === undefined || override === null || override === false) return 'make'
  if (override === true || override === 'buy') return 'buy'
  if (typeof override === 'string') return override.toLowerCase() === 'buy' ? 'buy' : 'make'
  if (isObject(override)) {
    const mode = String(override.mode ?? override.route ?? '').toLowerCase()
    return mode === 'buy' || override.buy === true ? 'buy' : 'make'
  }
  return 'make'
}

function itemName(catalog, itemId, recipe) {
  return catalog.items.get(itemId)?.name ?? recipe?.name ?? `物品 ${itemId}`
}

function addPurchase(purchases, catalog, itemId, quantity, source = 'leaf') {
  const existing = purchases.get(itemId)
  if (existing) {
    existing.quantity += quantity
    if (existing.source !== 'override' && source === 'override') existing.source = source
    return existing
  }
  const entry = {
    itemId,
    name: itemName(catalog, itemId, catalog.byId.get(itemId)),
    quantity,
    source,
  }
  purchases.set(itemId, entry)
  return entry
}

function ceilDiv(quantity, outputNum) {
  return Math.floor((quantity + outputNum - 1) / outputNum)
}

function resolveExpandArgs(first, second) {
  if (second !== undefined) return { catalog: first, plan: second }
  if (first?.catalog) return { catalog: first.catalog, plan: first }
  fail('expandPlan expects a plan or (catalog, plan)')
}

/**
 * Expand the requested product into a tree.  Recipes default to `make`; an
 * override with mode `buy` is a terminal node and removes its recipe subtree.
 */
export function expandPlan(first, second) {
  const { catalog, plan } = resolveExpandArgs(first, second)
  assertCatalog(catalog)
  if (!plan || typeof plan !== 'object') fail('plan must be an object')

  const targetId = asId(plan.targetId, 'plan.targetId')
  const quantity = asPositiveInteger(plan.quantity, 'plan.quantity')
  const overrides = plan.overrides ?? {}
  const purchases = new Map()
  let manufacturingFee = decimalZero()
  let manufacturingTime = 0

  function expandItem(itemId, requiredQuantity, path) {
    const recipe = catalog.byId.get(itemId)
    const name = itemName(catalog, itemId, recipe)
    if (!recipe) {
      addPurchase(purchases, catalog, itemId, requiredQuantity, 'leaf')
      return {
        kind: 'purchase',
        mode: 'buy',
        itemId,
        name,
        quantity: requiredQuantity,
        source: 'leaf',
        children: [],
      }
    }

    if (overrideMode(overrides, itemId) === 'buy') {
      addPurchase(purchases, catalog, itemId, requiredQuantity, 'override')
      return {
        kind: 'purchase',
        mode: 'buy',
        itemId,
        name: recipe.name,
        quantity: requiredQuantity,
        source: 'override',
        children: [],
      }
    }

    if (path.has(itemId)) {
      fail(`recipe cycle detected at ${itemId}`)
    }
    const batches = ceilDiv(requiredQuantity, recipe.outputNum)
    const producedQuantity = batches * recipe.outputNum
    const installCount = ceilDiv(batches, recipe.maxInstallQuantity)
    const installBatches = Array.from({ length: installCount }, (_, index) => (
      Math.min(recipe.maxInstallQuantity, batches - (index * recipe.maxInstallQuantity))
    ))
    manufacturingFee = decimalAdd(manufacturingFee, decimalMultiplyInt(decimalFrom(recipe.money, 'recipe.money'), batches))
    manufacturingTime += recipe.time * batches
    const nextPath = new Set(path)
    nextPath.add(itemId)
    const node = {
      kind: 'recipe',
      mode: 'make',
      itemId,
      name: recipe.name,
      category: recipe.category,
      quantity: requiredQuantity,
      requestedQuantity: requiredQuantity,
      producedQuantity,
      batches,
      outputNum: recipe.outputNum,
      maxInstallQuantity: recipe.maxInstallQuantity,
      installCount,
      installBatches,
      manufacturingFee: decimalToString(decimalMultiplyInt(decimalFrom(recipe.money, 'recipe.money'), batches)),
      manufacturingTime: recipe.time * batches,
      children: [],
    }

    for (const material of recipe.materials) {
      node.children.push(expandItem(material.itemId, material.quantity * batches, nextPath))
    }
    return node
  }

  const root = expandItem(targetId, quantity, new Set())
  return {
    schemaVersion: 1,
    root,
    purchases: [...purchases.values()].map(({ source, ...purchase }) => purchase),
    purchaseDetails: [...purchases.values()],
    manufacturingFee: decimalToString(manufacturingFee),
    manufacturingTime,
  }
}

function resolveSummaryArgs(first, second) {
  if (second !== undefined) return { catalog: first, plan: second }
  if (first?.catalog) return { catalog: first.catalog, plan: first }
  fail('summarizePlan expects a plan or (catalog, plan)')
}

function parseDecimal(value, field = 'price') {
  if (typeof value === 'bigint') {
    if (value < 0n) fail(`${field} must be non-negative`)
    return { coefficient: value, scale: 0 }
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${field} must be finite`)
  const text = String(value ?? '').trim()
  const match = text.match(/^([+]?)([0-9]*\.?[0-9]*)(?:[eE]([+-]?[0-9]+))?$/u)
  if (!match || !/[0-9]/u.test(match[2])) fail(`${field} must be a non-negative decimal`)
  const [whole = '', fractional = ''] = match[2].split('.')
  const exponent = Number(match[3] ?? 0)
  const digits = `${whole}${fractional}`.replace(/^0+(?=[0-9])/u, '') || '0'
  let coefficient = BigInt(digits)
  let scale = fractional.length - exponent
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

function decimalZero() {
  return { coefficient: 0n, scale: 0 }
}

function decimalFrom(value, field) {
  return parseDecimal(value, field)
}

function decimalAlign(left, right) {
  if (left.scale === right.scale) return [left.coefficient, right.coefficient, left.scale]
  if (left.scale > right.scale) return [left.coefficient, right.coefficient * (10n ** BigInt(left.scale - right.scale)), left.scale]
  return [left.coefficient * (10n ** BigInt(right.scale - left.scale)), right.coefficient, right.scale]
}

function decimalAdd(left, right) {
  const [leftCoefficient, rightCoefficient, scale] = decimalAlign(left, right)
  return decimalNormalize({ coefficient: leftCoefficient + rightCoefficient, scale })
}

function decimalMultiplyInt(value, multiplier) {
  return decimalNormalize({ coefficient: value.coefficient * BigInt(multiplier), scale: value.scale })
}

function decimalNormalize(value) {
  let coefficient = value.coefficient
  let scale = value.scale
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

function decimalToString(value) {
  const normalized = decimalNormalize(value)
  if (normalized.coefficient === 0n) return '0'
  const digits = normalized.coefficient.toString()
  if (normalized.scale === 0) return digits
  if (digits.length <= normalized.scale) {
    return `0.${'0'.repeat(normalized.scale - digits.length)}${digits}`
  }
  const split = digits.length - normalized.scale
  return `${digits.slice(0, split)}.${digits.slice(split)}`
}

function decimalFromString(value, field) {
  return decimalToString(decimalFrom(value, field))
}

function quoteReason(quote, settings = {}) {
  if (quote === undefined || quote === null) return 'quote_absent'
  if (!isObject(quote)) return 'quote_empty'
  const status = String(quote.status ?? '').trim().toLowerCase()
  if (QUOTE_STATUS_REASON.has(status)) return QUOTE_STATUS_REASON.get(status)
  if (quote.collected === false || quote.collectedAt === null) return 'quote_uncollected'
  if (quote.stale === true || quote.isStale === true || quote.fresh === false) return 'quote_stale'
  if (quote.expiresAt !== undefined) {
    const expiresAt = Date.parse(quote.expiresAt)
    const now = Date.parse(settings.now ?? new Date().toISOString())
    if (Number.isFinite(expiresAt) && Number.isFinite(now) && now >= expiresAt) return 'quote_stale'
  }
  const price = quote.bestSell ?? quote.best_sell ?? quote.lowestSell ?? quote.lowest_sell ?? quote.sell ?? quote.sellPrice ?? quote.sell_price ?? quote.price
  if (price === undefined || price === null || price === '') return 'quote_empty'
  try {
    const parsed = decimalFrom(price, 'market quote bestSell')
    if (parsed.coefficient <= 0n) return 'quote_empty'
  } catch {
    return 'quote_empty'
  }
  if (status && !FRESH_QUOTE_STATUSES.has(status)) return 'quote_uncollected'
  if (quote.fresh === undefined && settings.quoteMaxAgeMs !== undefined && quote.collectedAt !== undefined) {
    const collectedAt = Date.parse(quote.collectedAt)
    const now = Date.parse(settings.now ?? new Date().toISOString())
    if (Number.isFinite(collectedAt) && Number.isFinite(now) && now - collectedAt > settings.quoteMaxAgeMs) return 'quote_stale'
  }
  return null
}

function quotePrice(quote) {
  return quote.bestSell ?? quote.best_sell ?? quote.lowestSell ?? quote.lowest_sell ?? quote.sell ?? quote.sellPrice ?? quote.sell_price ?? quote.price
}

/**
 * Resolve the expanded purchase leaves against plan-local prices and quotes.
 * `total` is null when any purchase price is missing; `coveredSubtotal` is the
 * exact subtotal that is known and safe to show while the plan is incomplete.
 */
export function summarizePlan(first, second) {
  const { catalog, plan } = resolveSummaryArgs(first, second)
  assertCatalog(catalog)
  const expanded = expandPlan(catalog, plan)
  let materialSubtotal = decimalZero()
  const missing = []
  const resolvedPurchases = []
  const purchasePrices = plan.purchasePrices ?? {}
  const marketQuotes = plan.marketQuotes ?? {}
  const settings = plan.settings ?? {}

  for (const purchase of expanded.purchases) {
    const manualValue = recordValue(purchasePrices, purchase.itemId)
    let price
    let priceSource
    if (manualValue !== undefined && manualValue !== null && String(manualValue).trim() !== '') {
      try {
        price = decimalFrom(manualValue, `purchase price ${purchase.itemId}`)
        priceSource = 'manual'
      } catch {
        missing.push({ ...purchase, reason: 'price_invalid' })
      }
    } else if (!missing.some((entry) => entry.itemId === purchase.itemId)) {
      const quote = recordValue(marketQuotes, purchase.itemId)
      const reason = quoteReason(quote, settings)
      if (!reason) {
        try {
          price = decimalFrom(quotePrice(quote), `market quote ${purchase.itemId}`)
          priceSource = 'market'
        } catch {
          missing.push({ ...purchase, reason: 'quote_empty' })
        }
      } else {
        missing.push({ ...purchase, reason })
      }
    }

    if (price) {
      const cost = decimalMultiplyInt(price, purchase.quantity)
      materialSubtotal = decimalAdd(materialSubtotal, cost)
      resolvedPurchases.push({
        ...purchase,
        unitPrice: decimalToString(price),
        priceSource,
        subtotal: decimalToString(cost),
      })
    }
  }

  const manufacturingFee = decimalFrom(expanded.manufacturingFee, 'manufacturing fee')
  const blueprintCost = decimalFrom(settings.blueprintCost ?? 0, 'settings.blueprintCost')
  const coveredSubtotal = decimalAdd(decimalAdd(manufacturingFee, blueprintCost), materialSubtotal)
  const complete = missing.length === 0

  return {
    schemaVersion: 1,
    targetId: plan.targetId,
    quantity: plan.quantity,
    formulaStatus: 'unverified',
    complete,
    total: complete ? decimalToString(coveredSubtotal) : null,
    coveredSubtotal: decimalToString(coveredSubtotal),
    manufacturingFee: decimalToString(manufacturingFee),
    blueprintCost: decimalToString(blueprintCost),
    materialSubtotal: decimalToString(materialSubtotal),
    manufacturingTime: expanded.manufacturingTime,
    purchases: resolvedPurchases,
    missing,
    tree: expanded.root,
  }
}

// Descriptive aliases make the API convenient for callers that prefer the
// longer domain name while keeping the compact names used by the UI helpers.
export const createManufacturingPlan = createPlan
export const expandManufacturingPlan = expandPlan
export const summarizeManufacturingPlan = summarizePlan
