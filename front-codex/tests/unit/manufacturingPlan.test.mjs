import test from 'node:test'
import assert from 'node:assert/strict'

import { loadManufacturingCatalog } from '../../src/utils/manufacturingCatalog.js'
import {
  createPlan as createRawPlan,
  expandPlan,
  summarizePlan,
  MAX_BLUEPRINT_COST,
  resolveBlueprintCost,
  resolveManufacturingQuote,
  DEFAULT_MANUFACTURING_QUOTE_MAX_AGE_MS,
} from '../../src/utils/manufacturingPlan.js'

// Accounting fixtures explicitly use unmodified 100% recipe quantities.
function createPlan(catalog, options) {
  return createRawPlan(catalog, {
    ...options,
    settings: { materialEfficiencyPercent: '100', ...options.settings },
  })
}

function makeCatalog(recipes) {
  const itemIds = new Set()
  for (const recipe of recipes) {
    for (const material of recipe.materials) itemIds.add(material.itemId)
  }

  return loadManufacturingCatalog({
    schemaVersion: 1,
    scope: ['ship', 'material', 'building'],
    items: [...itemIds].map((itemId) => ({ itemId, name: `物品 ${itemId}` })),
    recipes,
  })
}

function recipe(productId, name, materials, options = {}) {
  return {
    productId,
    name,
    category: options.category ?? 'material',
    outputNum: options.outputNum ?? 1,
    materials,
    money: options.money ?? 0,
    time: options.time ?? 0,
    maxInstallQuantity: options.maxInstallQuantity ?? 1,
  }
}

test('ceil-divides requested quantity by outputNum before expanding materials', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 3 }], { outputNum: 200, money: 10 }),
  ])
  const plan = createPlan(catalog, { targetId: '100', quantity: 201 })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)

  assert.equal(expanded.root.batches, 2)
  assert.deepEqual(expanded.purchases, [{ itemId: '200', name: '物品 200', quantity: 6 }])
  assert.equal(summary.manufacturingFee, '20')
})

test('uses the client material percentage as a multiplier, not a reduction', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 10 }], { money: 2 }),
  ])
  const plan = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    settings: { materialEfficiencyPercent: '150' },
    purchasePrices: { '200': '1' },
  })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)

  assert.equal(expanded.root.children[0].quantity, 15)
  assert.deepEqual(expanded.purchases, [{ itemId: '200', name: '物品 200', quantity: 15 }])
  assert.equal(summary.materialSubtotal, '15')
  assert.equal(summary.total, '17')
  assert.equal(summary.materialEfficiencyPercent, 150)
})

test('rounds per-batch materials before multiplying runs, matching the client', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 5 }]),
  ])
  const plan = createPlan(catalog, {
    targetId: '100',
    quantity: 2,
    settings: { materialEfficiencyPercent: '75' },
  })

  const expanded = expandPlan(plan)

  assert.equal(expanded.root.children[0].quantity, 8)
  assert.equal(expanded.purchases[0].quantity, 8)
})

test('defaults absent, blank and invalid efficiency to initial 150%', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 10 }])])
  for (const value of [undefined, null, '', ' ', 'oops', Infinity]) {
    const plan = createRawPlan(catalog, { targetId: '100', settings: { materialEfficiencyPercent: value } })
    assert.equal(expandPlan(plan).purchases[0].quantity, 15)
  }
  assert.equal(expandPlan(createRawPlan(catalog, { targetId: '100' })).purchases[0].quantity, 15)
})

test('clamps at the client 75% floor instead of zeroing materials', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 100 }])])
  for (const value of ['75', '50', '0', '-1']) {
    const summary = summarizePlan(createPlan(catalog, { targetId: '100', settings: { materialEfficiencyPercent: value } }))
    assert.equal(summary.tree.children[0].quantity, 75)
    assert.equal(summary.materialEfficiencyPercent, 75)
  }
})

test('preserves fractional efficiency without floating-point extra material', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 10000 }])])
  const plan = createPlan(catalog, { targetId: '100', settings: { materialEfficiencyPercent: '112.11' } })
  assert.equal(expandPlan(plan).purchases[0].quantity, 11211)
})

test('scales every made recipe but does not scale a purchased product again', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '101', quantity: 2 }]),
    recipe('101', '中间件', [{ itemId: '200', quantity: 3 }]),
  ])
  const plan = createRawPlan(catalog, { targetId: '100' })
  assert.equal(expandPlan(plan).purchases[0].quantity, 15) // ceil(2*1.5) * ceil(3*1.5)
  plan.overrides['101'] = 'buy'
  const bought = expandPlan(plan)
  assert.deepEqual(bought.purchases, [{ itemId: '101', name: '物品 101', quantity: 3 }])
  assert.equal(bought.root.children[0].children.length, 0)
  plan.overrides['100'] = 'buy'
  assert.equal(expandPlan(plan).purchases[0].quantity, 1)
})

test('splits recipe batches into capped installation groups without changing cost', () => {
  const catalog = makeCatalog([
    recipe('100', '批量成品', [{ itemId: '200', quantity: 1 }], {
      outputNum: 1,
      maxInstallQuantity: 10,
      money: 7,
    }),
  ])
  const plan = createPlan(catalog, { targetId: '100', quantity: 23 })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)

  assert.equal(expanded.root.batches, 23)
  assert.equal(expanded.root.installCount, 3)
  assert.deepEqual(expanded.root.installBatches, [10, 10, 3])
  assert.ok(expanded.root.installBatches.every((count) => count <= 10))
  assert.equal(summary.manufacturingFee, '161')
})

test('recursively makes intermediate recipes and aggregates a shared leaf item', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [
      { itemId: '101', quantity: 2 },
      { itemId: '102', quantity: 1 },
    ], { money: 3 }),
    recipe('101', '中间件甲', [{ itemId: '200', quantity: 10 }], { money: 2 }),
    recipe('102', '中间件乙', [{ itemId: '200', quantity: 5 }], { money: 4 }),
  ])
  const plan = createPlan(catalog, { targetId: '100', quantity: 1 })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)

  assert.equal(expanded.root.children[0].mode, 'make')
  assert.equal(expanded.root.children[1].mode, 'make')
  assert.deepEqual(expanded.purchases, [{ itemId: '200', name: '物品 200', quantity: 25 }])
  assert.equal(summary.manufacturingFee, '11')
})

test('aggregates a shared makeable intermediate by productId before batching its cost', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [
      { itemId: '101', quantity: 1 },
      { itemId: '102', quantity: 1 },
    ]),
    recipe('101', '路径甲', [{ itemId: '300', quantity: 1 }]),
    recipe('102', '路径乙', [{ itemId: '300', quantity: 1 }]),
    recipe('300', '共享中间品', [{ itemId: '200', quantity: 1 }], {
      outputNum: 3,
      money: 10,
    }),
  ])
  const plan = createPlan(catalog, { targetId: '100', quantity: 1 })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)
  const sharedNodes = expanded.root.children.flatMap((branch) => branch.children)

  assert.equal(summary.manufacturingFee, '10')
  assert.deepEqual(expanded.purchases, [{ itemId: '200', name: '物品 200', quantity: 1 }])
  assert.equal(sharedNodes.length, 2)
  assert.ok(sharedNodes.every((node) => node.aggregateRequestedQuantity === 2))
  assert.ok(sharedNodes.every((node) => node.aggregateBatches === 1))
})

test('buy override turns an intermediate recipe into a purchase and prunes its subtree', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '101', quantity: 2 }]),
    recipe('101', '中间件', [{ itemId: '200', quantity: 10 }], { money: 9 }),
  ])
  const plan = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    overrides: { '101': 'buy' },
    purchasePrices: { '101': '12.50' },
  })

  const expanded = expandPlan(plan)
  const summary = summarizePlan(plan)

  assert.equal(expanded.root.children[0].mode, 'buy')
  assert.equal(expanded.root.children[0].children.length, 0)
  assert.deepEqual(expanded.purchases, [{ itemId: '101', name: '物品 101', quantity: 2 }])
  assert.equal(summary.total, '25')
  assert.equal(summary.missing.length, 0)
})

test('manual purchase price wins over a fresh market quote and remains isolated per plan', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '101', quantity: 2 }]),
    recipe('101', '中间件', [{ itemId: '200', quantity: 10 }]),
  ])
  const marketQuotes = { '101': { status: 'fresh', bestSell: '2' } }
  const first = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    overrides: { '101': 'buy' },
    purchasePrices: { '101': '1.80' },
    marketQuotes,
  })
  const second = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    overrides: { '101': 'buy' },
    marketQuotes,
  })

  assert.equal(summarizePlan(first).total, '3.6')
  assert.equal(summarizePlan(second).total, '4')
  first.purchasePrices['101'] = '99'
  assert.equal(summarizePlan(second).total, '4')
})

test('missing quote never becomes zero and reports a covered subtotal', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 2 }], { money: 5 }),
  ])
  const plan = createPlan(catalog, { targetId: '100', quantity: 1 })

  const summary = summarizePlan(plan)

  assert.equal(summary.complete, false)
  assert.equal(summary.total, null)
  assert.equal(summary.coveredSubtotal, '5')
  assert.deepEqual(summary.missing, [{ itemId: '200', name: '物品 200', quantity: 2, reason: 'quote_absent' }])
})

test('fresh and stale positive sell quotes both complete the total with distinct age metadata', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 2 }]),
  ])
  const fresh = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    settings: { now: '2026-10-04T12:00:00Z' },
    marketQuotes: { '200': { status: 'fresh', bestSell: '1.25', observed_at: '2026-10-04T11:00:00Z' } },
  })
  const stale = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    settings: { now: '2026-10-04T12:00:00Z' },
    marketQuotes: { '200': { status: 'stale', bestSell: '1.25', observed_at: '2026-10-03T11:00:00Z' } },
  })

  assert.equal(summarizePlan(fresh).complete, true)
  assert.equal(summarizePlan(fresh).total, '2.5')
  assert.equal(summarizePlan(fresh).hasStaleQuotes, false)
  assert.equal(summarizePlan(fresh).purchases[0].quoteStatus, 'fresh')
  const summary = summarizePlan(stale)
  assert.equal(summary.complete, true)
  assert.equal(summary.total, '2.5')
  assert.deepEqual(summary.missing, [])
  assert.equal(summary.purchases[0].quoteStatus, 'stale')
  assert.equal(summary.purchases[0].observedAt, '2026-10-03T11:00:00.000Z')
  assert.equal(summary.hasStaleQuotes, true)
  assert.deepEqual(summary.stalePurchases, summary.purchases)
})

test('quote resolver accepts expired sell prices and separates exact age thresholds from availability', () => {
  const now = '2026-10-04T12:00:00Z'
  assert.equal(DEFAULT_MANUFACTURING_QUOTE_MAX_AGE_MS, 7_200_000)
  for (const status of ['fresh', 'stale', 'expired', 'available', 'collected', 'ok']) {
    const quote = resolveManufacturingQuote({ status, best_sell: '001.250', observed_at: '2026-10-04T11:00:00+00:00' }, { now })
    assert.deepEqual(quote, {
      price: '1.25', reason: null, status: ['stale', 'expired'].includes(status) ? 'stale' : 'fresh',
      observedAt: '2026-10-04T11:00:00.000Z',
    })
  }
  assert.equal(resolveManufacturingQuote({ bestSell: '0.1', collectedAt: '2026-10-04T10:00:00Z' }, { now }).status, 'fresh')
  assert.equal(resolveManufacturingQuote({ bestSell: '0.1', collectedAt: '2026-10-04T09:59:59.999Z' }, { now }).status, 'stale')
  assert.equal(resolveManufacturingQuote({ fresh: true, bestSell: '0.1', observedAt: '2026-10-03T10:00:00Z' }, { now }).status, 'stale')
  assert.equal(resolveManufacturingQuote({ bestSell: '0.1', observedAt: '2026-10-04T11:59:59.999Z' }, { now, quoteMaxAgeMs: 0 }).status, 'stale')
  for (const extra of [{ stale: true }, { isStale: true }, { fresh: false }, { expiresAt: now }]) {
    const quote = resolveManufacturingQuote({ bestSell: '0.1', observedAt: now, ...extra }, { now: Date.parse(now) })
    assert.equal(quote.price, '0.1')
    assert.equal(quote.reason, null)
    assert.equal(quote.status, 'stale')
  }
  assert.equal(resolveManufacturingQuote({ best_sell: '0.1', observed_at: '2026-10-04T19:00:00.123456+08:00' }, { now }).observedAt, '2026-10-04T11:00:00.123Z')
})

test('stale status cannot turn an empty or invalid sell book into a zero-cost purchase', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 2 }], { money: 5 })])
  for (const status of ['fresh', 'stale', 'expired']) {
    for (const best_sell of [undefined, null, '', ' ', '0', 0, '-1', 'not a price', NaN, Infinity, 'Infinity', '1e999999', '1e-999999']) {
      const quote = { status, best_sell, best_buy: '9.99', observed_at: '2026-10-03T10:00:00Z' }
      const reason = best_sell === undefined || best_sell === null || (typeof best_sell === 'string' && best_sell.trim() === '')
        ? 'quote_empty' : 'quote_invalid'
      assert.equal(resolveManufacturingQuote(quote).reason, reason)
      const summary = summarizePlan(createPlan(catalog, { targetId: '100', marketQuotes: { '200': quote } }))
      assert.equal(summary.complete, false)
      assert.equal(summary.total, null)
      assert.equal(summary.coveredSubtotal, '5')
      assert.equal(summary.materialSubtotal, '0')
      assert.deepEqual(summary.purchases, [])
      assert.deepEqual(summary.stalePurchases, [])
      assert.equal(summary.hasStaleQuotes, false)
      assert.equal(summary.missing[0].reason, reason)
    }
  }
  assert.deepEqual(resolveManufacturingQuote({ status: 'expired', best_sell: null, price: '10', best_buy: '9' }), {
    price: null, reason: 'quote_empty', status: 'empty', observedAt: null,
  })
  assert.deepEqual(resolveManufacturingQuote({ status: 'stale', best_sell: null, observed_at: '2026-10-03T10:00:00Z' }, { now: '2026-10-04T12:00:00Z' }), {
    price: null, reason: 'quote_empty', status: 'empty', observedAt: '2026-10-03T10:00:00.000Z',
  })
})

test('uncollected, absent, explicitly empty and unknown-status quotes remain missing even with a price', () => {
  for (const [quote, reason, status] of [
    [undefined, 'quote_absent', 'absent'], [null, 'quote_absent', 'absent'],
    [{ status: 'absent', bestSell: '1' }, 'quote_absent', 'absent'],
    [{ status: 'empty', bestSell: '1' }, 'quote_empty', 'empty'],
    [{ status: 'invalid', bestSell: '1' }, 'quote_invalid', 'invalid'],
    ...['uncollected', 'not_collected', 'pending', 'unexpected'].map((status) => [{ status, bestSell: '1' }, 'quote_uncollected', 'uncollected']),
    [{ collected: false, status: 'stale', bestSell: '1' }, 'quote_uncollected', 'uncollected'],
    [[], 'quote_empty', 'empty'], [42, 'quote_empty', 'empty'],
  ]) {
    assert.deepEqual(resolveManufacturingQuote(quote), { price: null, reason, status, observedAt: null })
  }
})

test('legacy, invalid and future observation times stay unknown without rejecting valid sell prices', () => {
  const settings = { now: '2026-10-04T12:00:00Z' }
  for (const observed_at of [undefined, null, '', 'not a date', '0', '2026-02-30T12:00:00Z', '2026-10-04T24:00:00Z', Infinity, '2026-10-04T12:00:00.001Z']) {
    assert.deepEqual(resolveManufacturingQuote({ status: 'fresh', best_sell: '0.20', observed_at }, settings), {
      price: '0.2', reason: null, status: 'unknown', observedAt: null,
    })
    assert.deepEqual(resolveManufacturingQuote({ status: 'expired', best_sell: '0.20', observed_at }, settings), {
      price: '0.2', reason: null, status: 'stale', observedAt: null,
    })
  }
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 2 }])])
  const summary = summarizePlan(createPlan(catalog, { targetId: '100', settings, marketQuotes: { '200': { bestSell: '0.2' } } }))
  assert.equal(summary.total, '0.4')
  assert.equal(summary.purchases[0].quoteStatus, 'unknown')
  assert.equal(summary.purchases[0].observedAt, null)
  assert.equal(summary.hasStaleQuotes, false)
})

test('only actually used stale market prices enter whole-plan warnings, with manual prices taking priority', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 2 }])])
  const marketQuotes = { '200': { status: 'expired', best_sell: '1.25', observed_at: '2026-10-03T12:00:00Z' } }
  for (const manual of ['0', '0.10']) {
    const summary = summarizePlan(createPlan(catalog, { targetId: '100', marketQuotes, purchasePrices: { '200': manual } }))
    assert.equal(summary.total, manual === '0' ? '0' : '0.2')
    assert.equal(summary.purchases[0].priceSource, 'manual')
    assert.equal('quoteStatus' in summary.purchases[0], false)
    assert.equal('observedAt' in summary.purchases[0], false)
    assert.deepEqual(summary.stalePurchases, [])
    assert.equal(summary.hasStaleQuotes, false)
  }
  const invalid = summarizePlan(createPlan(catalog, { targetId: '100', marketQuotes, purchasePrices: { '200': 'invalid' } }))
  assert.equal(invalid.total, null)
  assert.equal(invalid.missing[0].reason, 'price_invalid')
  assert.equal(invalid.hasStaleQuotes, false)
  const blank = summarizePlan(createPlan(catalog, { targetId: '100', marketQuotes, purchasePrices: { '200': '' } }))
  assert.equal(blank.total, '2.5')
  assert.equal(blank.hasStaleQuotes, true)
  assert.equal(marketQuotes['200'].best_sell, '1.25')
})

test('fresh, stale and genuinely missing inputs preserve exact covered costs and per-input status', () => {
  const catalog = makeCatalog([recipe('100', '成品', [
    { itemId: '200', quantity: 3 }, { itemId: '201', quantity: 1 }, { itemId: '202', quantity: 2 },
  ], { money: 3 })])
  const summary = summarizePlan(createPlan(catalog, {
    targetId: '100', settings: { now: '2026-10-04T12:00:00Z', blueprintCost: '0.10' },
    marketQuotes: {
      '200': { status: 'expired', best_sell: '0.10', observed_at: '2026-10-03T12:00:00Z' },
      '201': { status: 'fresh', best_sell: '0.20', observed_at: '2026-10-04T11:00:00Z' },
      '202': { status: 'stale', best_sell: null, best_buy: '100' },
    },
  }))
  assert.equal(summary.total, null)
  assert.equal(summary.complete, false)
  assert.equal(summary.materialSubtotal, '0.5')
  assert.equal(summary.manufacturingFee, '3')
  assert.equal(summary.blueprintCost, '0.1')
  assert.equal(summary.coveredSubtotal, '3.6')
  assert.deepEqual(summary.missing.map(({ itemId, reason }) => ({ itemId, reason })), [{ itemId: '202', reason: 'quote_empty' }])
  assert.deepEqual(summary.purchases.map(({ itemId, quoteStatus }) => ({ itemId, quoteStatus })), [
    { itemId: '200', quoteStatus: 'stale' }, { itemId: '201', quoteStatus: 'fresh' },
  ])
  assert.deepEqual(summary.stalePurchases, [summary.purchases[0]])
})

test('stale prices retain batch, installation, hierarchy and one-time blueprint calculations exactly', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '101', quantity: 3 }], { outputNum: 2, money: 1, maxInstallQuantity: 1 }),
    recipe('101', '中间件', [{ itemId: '200', quantity: 1 }], { outputNum: 2, money: 2, maxInstallQuantity: 2 }),
  ])
  const options = {
    targetId: '100', quantity: 5, settings: { blueprintCost: '0.10' },
    marketQuotes: { '200': { status: 'stale', best_sell: '0.10' }, '101': { status: 'expired', best_sell: '0.20' } },
  }
  const made = summarizePlan(createPlan(catalog, options))
  assert.equal(made.tree.batches, 3)
  assert.equal(made.tree.installCount, 3)
  assert.equal(made.tree.children[0].batches, 5)
  assert.equal(made.tree.children[0].installCount, 3)
  assert.equal(made.manufacturingFee, '13')
  assert.equal(made.materialSubtotal, '0.5')
  assert.equal(made.total, '13.6')
  assert.deepEqual(made.stalePurchases.map(({ itemId, quantity }) => ({ itemId, quantity })), [{ itemId: '200', quantity: 5 }])
  const bought = summarizePlan(createPlan(catalog, { ...options, overrides: { '101': 'buy' } }))
  assert.equal(bought.tree.children[0].children.length, 0)
  assert.equal(bought.manufacturingFee, '3')
  assert.equal(bought.materialSubtotal, '1.8')
  assert.equal(bought.total, '4.9')
  assert.deepEqual(bought.stalePurchases.map(({ itemId, quantity }) => ({ itemId, quantity })), [{ itemId: '101', quantity: 9 }])
  assert.equal(made.blueprintCost, '0.1')
  assert.equal(bought.blueprintCost, '0.1')
})

test('quote metadata is snapshotted per plan without mutating a caller quote or leaking result edits', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 1 }])])
  const options = {
    targetId: '100', settings: { now: '2026-10-04T12:00:00Z' },
    marketQuotes: { '200': { status: 'expired', best_sell: '1.25', observed_at: '2026-10-03T12:00:00Z' } },
  }
  const first = createPlan(catalog, options)
  options.marketQuotes['200'].best_sell = '2.5'
  const second = createPlan(catalog, options)
  const summary = summarizePlan(first)
  summary.purchases[0].unitPrice = '99'
  summary.purchases[0].observedAt = null
  assert.equal(summarizePlan(first).total, '1.25')
  assert.equal(summarizePlan(first).purchases[0].observedAt, '2026-10-03T12:00:00.000Z')
  assert.equal(summarizePlan(second).total, '2.5')
  assert.equal(first.marketQuotes['200'].best_sell, '1.25')
  assert.equal(options.marketQuotes['200'].best_sell, '2.5')
})

test('market decimal prices retain their original precision instead of using the validation number', () => {
  const catalog = makeCatalog([recipe('100', '成品', [{ itemId: '200', quantity: 2 }])])
  const summary = summarizePlan(createPlan(catalog, {
    targetId: '100', marketQuotes: { '200': { status: 'expired', best_sell: '99999999999999999999.99' } },
  }))
  assert.equal(summary.purchases[0].unitPrice, '99999999999999999999.99')
  assert.equal(summary.total, '199999999999999999999.98')
  assert.equal(resolveManufacturingQuote({ best_sell: '1e-8' }).price, '0.00000001')
})

test('adds decimal prices exactly without binary floating-point drift', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [
      { itemId: '200', quantity: 1 },
      { itemId: '201', quantity: 1 },
    ]),
  ])
  const plan = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    purchasePrices: { '200': '0.1', '201': '0.2' },
  })

  assert.equal(summarizePlan(plan).total, '0.3')
})

test('exposes unverified formula status and includes an optional blueprint cost', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 1 }], { money: 2 }),
  ])
  const plan = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    settings: { blueprintCost: '0.10' },
    purchasePrices: { '200': '3.20' },
  })

  const summary = summarizePlan(plan)

  assert.equal(summary.formulaStatus, 'unverified')
  assert.equal(summary.blueprintCost, '0.1')
  assert.equal(summary.total, '5.3')
})

test('empty blueprint cost is zero and ordinary decimals are normalized exactly', () => {
  for (const value of [undefined, null, '', '   ', 0, '0', '+0', '000.00']) {
    assert.deepEqual(resolveBlueprintCost(value), { value: '0', error: null })
  }
  for (const [value, expected] of [['0.10', '0.1'], ['.5', '0.5'], ['+000123.40', '123.4'], [' 12.34 ', '12.34']]) {
    assert.deepEqual(resolveBlueprintCost(value), { value: expected, error: null })
  }
})

test('blueprint cost accepts its exact maximum and distinguishes an excessive amount', () => {
  assert.equal(MAX_BLUEPRINT_COST, '999999999999.99')
  assert.deepEqual(resolveBlueprintCost(MAX_BLUEPRINT_COST), { value: MAX_BLUEPRINT_COST, error: null })
  for (const value of ['1000000000000', '1000000000000.00', '99999999999999999999999999999999']) {
    assert.deepEqual(resolveBlueprintCost(value), { value: null, error: 'too_large' })
  }
})

test('blueprint cost rejects unsafe, negative, fractional precision, and exponent inputs without throwing', () => {
  for (const value of ['-1', '-0', 'not a price', '1,000', '0.001', '.', '+', '1e999999', '1e2', '9'.repeat(65), ' '.repeat(65), NaN, Infinity, -Infinity, {}, true]) {
    assert.deepEqual(resolveBlueprintCost(value), { value: null, error: 'invalid' }, `value: ${String(value)}`)
  }
})

test('blueprint cost is added once while product quantity, batches, and installs change', () => {
  const catalog = makeCatalog([
    recipe('100', '多批成品', [{ itemId: '200', quantity: 3 }], { outputNum: 200, money: 10, maxInstallQuantity: 2 }),
  ])
  for (const [quantity, batches, installs, materials, total] of [[1, 1, 1, '0.6', '10.7'], [201, 2, 1, '1.2', '21.3'], [801, 5, 3, '3', '53.1']]) {
    const summary = summarizePlan(createPlan(catalog, {
      targetId: '100', quantity, settings: { blueprintCost: '0.10' }, purchasePrices: { '200': '0.20' },
    }))
    assert.equal(summary.tree.batches, batches)
    assert.equal(summary.tree.installCount, installs)
    assert.equal(summary.blueprintCost, '0.1')
    assert.equal(summary.blueprintCostError, null)
    assert.equal(summary.materialSubtotal, materials)
    assert.equal(summary.manufacturingFee, String(batches * 10))
    assert.equal(summary.total, total)
  }
})

test('shared manufacturing recipes do not duplicate the plan-level blueprint cost', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '101', quantity: 1 }, { itemId: '102', quantity: 1 }], { money: 1 }),
    recipe('101', '部件 A', [{ itemId: '103', quantity: 1 }], { money: 2 }),
    recipe('102', '部件 B', [{ itemId: '103', quantity: 1 }], { money: 3 }),
    recipe('103', '共享部件', [{ itemId: '200', quantity: 1 }], { outputNum: 2, money: 4 }),
  ])
  const summary = summarizePlan(createPlan(catalog, {
    targetId: '100', quantity: 1, settings: { blueprintCost: '0.10' }, purchasePrices: { '200': '0.20' },
  }))
  assert.equal(summary.manufacturingFee, '10')
  assert.equal(summary.materialSubtotal, '0.2')
  assert.equal(summary.blueprintCost, '0.1')
  assert.equal(summary.total, '10.3')
  assert.deepEqual(summary.purchases.map(({ itemId, quantity }) => ({ itemId, quantity })), [{ itemId: '200', quantity: 1 }])
})

test('buying the target retains the explicitly entered plan cost without adding a purchase item', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 3 }], { money: 10 }),
  ])
  const summary = summarizePlan(createPlan(catalog, {
    targetId: '100', quantity: 3, overrides: { '100': 'buy' },
    settings: { blueprintCost: '.50' }, purchasePrices: { '100': '2.10' },
  }))
  assert.equal(summary.manufacturingFee, '0')
  assert.equal(summary.materialSubtotal, '6.3')
  assert.equal(summary.blueprintCost, '0.5')
  assert.equal(summary.total, '6.8')
  assert.deepEqual(summary.purchases.map(({ itemId, quantity }) => ({ itemId, quantity })), [{ itemId: '100', quantity: 3 }])
})

test('invalid blueprint input leaves known costs visible without claiming a complete total', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 2 }], { money: 5 }),
  ])
  for (const [value, error] of [['-1', 'invalid'], ['1e999999', 'invalid'], ['1000000000000', 'too_large']]) {
    const plan = createPlan(catalog, { targetId: '100', settings: { blueprintCost: value }, purchasePrices: { '200': '0.1' } })
    const summary = summarizePlan(plan)
    assert.equal(summary.complete, false)
    assert.equal(summary.total, null)
    assert.equal(summary.coveredSubtotal, '5.2')
    assert.equal(summary.blueprintCost, null)
    assert.equal(summary.blueprintCostError, error)
    assert.deepEqual(summary.missing, [])
    assert.deepEqual(summary.purchases.map(({ itemId, quantity }) => ({ itemId, quantity })), [{ itemId: '200', quantity: 2 }])
  }
})

test('missing material quote remains missing when a valid one-time blueprint cost is entered', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 2 }], { money: 5 }),
  ])
  const summary = summarizePlan(createPlan(catalog, { targetId: '100', settings: { blueprintCost: '12.34' } }))
  assert.equal(summary.complete, false)
  assert.equal(summary.total, null)
  assert.equal(summary.coveredSubtotal, '17.34')
  assert.equal(summary.blueprintCost, '12.34')
  assert.equal(summary.blueprintCostError, null)
  assert.deepEqual(summary.missing, [{ itemId: '200', name: '物品 200', quantity: 2, reason: 'quote_absent' }])
})

test('legacy JSON plans default to zero and settings snapshots isolate blueprint edits', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 1 }], { money: 2 }),
  ])
  const oldOptions = JSON.parse('{"targetId":"100","quantity":1,"settings":{},"purchasePrices":{"200":"3.20"}}')
  const legacy = createPlan(catalog, oldOptions)
  assert.equal(legacy.schemaVersion, 1)
  assert.equal(summarizePlan(legacy).blueprintCost, '0')
  assert.equal(summarizePlan(legacy).blueprintCostError, null)
  assert.equal(summarizePlan(legacy).total, '5.2')
  const options = JSON.parse('{"targetId":"100","quantity":1,"settings":{"blueprintCost":"0.10"},"purchasePrices":{"200":"3.20"}}')
  const first = createPlan(catalog, options)
  options.settings.blueprintCost = '9.99'
  const second = createPlan(catalog, options)
  first.settings.blueprintCost = '0.20'
  assert.equal(options.settings.blueprintCost, '9.99')
  assert.equal(summarizePlan(first).total, '5.4')
  assert.equal(summarizePlan(second).total, '15.19')
  assert.equal(summarizePlan(legacy).total, '5.2')
})
