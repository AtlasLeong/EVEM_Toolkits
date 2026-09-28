import test from 'node:test'
import assert from 'node:assert/strict'

import { loadManufacturingCatalog } from '../../src/utils/manufacturingCatalog.js'
import {
  createPlan,
  expandPlan,
  summarizePlan,
} from '../../src/utils/manufacturingPlan.js'

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
