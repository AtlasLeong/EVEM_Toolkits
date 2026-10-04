import test from 'node:test'
import assert from 'node:assert/strict'

import { loadManufacturingCatalog } from '../../src/utils/manufacturingCatalog.js'
import {
  createPlan as createRawPlan,
  expandPlan,
  summarizePlan,
  MAX_BLUEPRINT_COST,
  resolveBlueprintCost,
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

test('fresh quote completes the total while stale quote keeps it incomplete', () => {
  const catalog = makeCatalog([
    recipe('100', '成品', [{ itemId: '200', quantity: 2 }]),
  ])
  const fresh = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    marketQuotes: { '200': { status: 'fresh', bestSell: '1.25' } },
  })
  const stale = createPlan(catalog, {
    targetId: '100',
    quantity: 1,
    marketQuotes: { '200': { status: 'stale', bestSell: '1.25' } },
  })

  assert.equal(summarizePlan(fresh).complete, true)
  assert.equal(summarizePlan(fresh).total, '2.5')
  assert.equal(summarizePlan(stale).complete, false)
  assert.equal(summarizePlan(stale).total, null)
  assert.equal(summarizePlan(stale).missing[0].reason, 'quote_stale')
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
