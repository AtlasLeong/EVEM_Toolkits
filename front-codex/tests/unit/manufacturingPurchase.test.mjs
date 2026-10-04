import test from 'node:test'
import assert from 'node:assert/strict'

import { loadManufacturingCatalog } from '../../src/utils/manufacturingCatalog.js'
import { createPlan, summarizePlan } from '../../src/utils/manufacturingPlan.js'
import {
  buildManufacturingPurchaseRows,
  formatPurchaseIsk,
  serializeManufacturingPurchaseList,
  serializeManufacturingPurchaseCsv,
} from '../../src/utils/manufacturingPurchase.js'

const headings = ['ID', '名称', '数量', '单价ISK', '小计ISK', '来源', '采集时间', '下一步']
const observedAt = '2026-10-03T12:00:00.000Z'

function purchase(overrides = {}) {
  return {
    itemId: '2', name: '矿石', quantity: 2,
    unitPrice: '1.25', subtotal: '2.5', priceSource: 'market',
    quoteStatus: 'fresh', observedAt, reason: null,
    ...overrides,
  }
}

function exportRow(overrides = {}) {
  return {
    ...purchase(),
    statusLabel: '市场参考价', nextStep: '查看市场或填写方案单价',
    ...overrides,
  }
}

// Parse quoted records independently so embedded commas, quotes and newlines
// can be checked as cell values rather than split into misleading fragments.
function parseCsv(value) {
  const records = []
  let record = []
  let cell = ''
  let quoted = false
  const text = value.replace(/^\uFEFF/u, '')
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (!quoted && character === ',') {
      record.push(cell)
      cell = ''
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      record.push(cell)
      records.push(record)
      record = []
      cell = ''
    } else cell += character
  }
  assert.equal(quoted, false, 'CSV must close quoted cells')
  if (cell !== '' || record.length > 0) records.push([...record, cell])
  return records
}

test('merges every resolved and missing purchase in exact numeric ID order while retaining quote evidence', () => {
  const resolved = [
    purchase({ itemId: '9007199254740993', name: '大编号材料', unitPrice: '99999999999999999999.99', subtotal: '199999999999999999999.98' }),
    purchase({ itemId: '10', name: '手填材料', priceSource: 'manual', quoteStatus: null, observedAt: null }),
    purchase({ itemId: '2' }),
  ]
  const missing = [
    { itemId: '9007199254740992', name: '待采集材料', quantity: 4, reason: 'quote_uncollected', observedAt: null },
    { itemId: '100', name: '暂无卖价材料', quantity: 3, reason: 'quote_empty', observedAt },
  ]
  const summary = { purchases: resolved, missing }
  const original = structuredClone(summary)
  const rows = buildManufacturingPurchaseRows(summary)

  assert.deepEqual(rows.map(row => row.itemId), ['2', '10', '100', '9007199254740992', '9007199254740993'])
  for (const source of resolved) {
    const row = rows.find(entry => entry.itemId === source.itemId)
    for (const key of ['itemId', 'name', 'quantity', 'unitPrice', 'subtotal', 'priceSource', 'quoteStatus', 'observedAt', 'reason']) {
      assert.equal(row[key], source[key], `preserves ${key} for ${source.itemId}`)
    }
  }
  for (const source of missing) {
    const row = rows.find(entry => entry.itemId === source.itemId)
    assert.equal(row.quantity, source.quantity)
    assert.equal(row.reason, source.reason)
    assert.equal(row.observedAt, source.observedAt)
    assert.equal(row.unitPrice, null)
    assert.equal(row.subtotal, null)
  }
  assert.deepEqual(summary, original, 'building display rows must not mutate the cost summary')
})

test('deduplicates repeated IDs without adding their already aggregated quantities and favors resolved purchases', () => {
  const resolved = purchase({ itemId: '2', quantity: 4, subtotal: '5' })
  const missing = { itemId: '2', name: '旧缺价记录', quantity: 4, reason: 'quote_absent' }
  const rows = buildManufacturingPurchaseRows({
    purchases: [resolved, { ...resolved }],
    missing: [missing, { ...missing }, { itemId: '10', name: '缺价材料', quantity: 7, reason: 'quote_empty' }, { itemId: '10', name: '缺价材料', quantity: 7, reason: 'quote_empty' }],
  })
  assert.deepEqual(rows.map(row => [row.itemId, row.quantity]), [['2', 4], ['10', 7]])
  assert.equal(rows[0].name, '矿石')
  assert.equal(rows[0].unitPrice, '1.25')
  assert.equal(rows[0].subtotal, '5')
  assert.equal(rows[0].reason, null)
})

test('resolved price sources have explicit labels and actionable next steps', () => {
  for (const [priceSource, quoteStatus, statusLabel, nextStep] of [
    ['manual', null, '方案内手填', '清空手填可恢复市场参考价'],
    ['market', 'fresh', '市场参考价', '查看市场或填写方案单价'],
    ['market', 'stale', '市场旧价 · 已计入', '刷新存量行情或填写方案单价'],
    ['market', 'unknown', '市场价 · 时间未知', '刷新存量行情或填写方案单价'],
  ]) {
    const [row] = buildManufacturingPurchaseRows({ purchases: [purchase({ priceSource, quoteStatus })], missing: [] })
    assert.equal(row.statusLabel, statusLabel)
    assert.equal(row.nextStep, nextStep)
    assert.equal(row.unitPrice, '1.25')
    assert.equal(row.subtotal, '2.5')
  }
})

test('each missing-price reason stays distinct and never exposes a placeholder as a zero price', () => {
  for (const [reason, statusLabel] of [
    ['quote_absent', '未找到市场报价'],
    ['quote_uncollected', '尚未采集报价'],
    ['quote_empty', '市场暂无卖价'],
    ['quote_invalid', '市场报价无效'],
    ['price_invalid', '手填单价无效'],
  ]) {
    const [row] = buildManufacturingPurchaseRows({ purchases: [], missing: [{ itemId: '2', name: '缺价材料', quantity: 2, reason }] })
    assert.equal(row.statusLabel, statusLabel)
    assert.equal(row.nextStep, reason === 'price_invalid' ? '修正或清空手填单价' : '查看市场或填写方案单价')
    assert.equal(row.unitPrice, null)
    assert.equal(row.subtotal, null)
  }
})

test('real plan rows retain included stale costs and recover market references when a manual price is cleared', () => {
  const catalog = loadManufacturingCatalog({
    schemaVersion: 1, scope: ['ship', 'material', 'building'],
    items: [{ itemId: '200', name: '矿石' }],
    recipes: [{ productId: '100', name: '制造目标', category: 'ship', outputNum: 1, materials: [{ itemId: '200', quantity: 2 }], money: 99, time: 0, maxInstallQuantity: 1 }],
  })
  const plan = createPlan(catalog, {
    targetId: '100', quantity: 1,
    settings: { materialEfficiencyPercent: '100', blueprintCost: '123', now: '2026-10-04T12:00:00Z' },
    marketQuotes: { '200': { status: 'stale', best_sell: '0.25', observed_at: observedAt } },
  })
  const staleSummary = summarizePlan(plan)
  const [stale] = buildManufacturingPurchaseRows(staleSummary)
  assert.equal(staleSummary.materialSubtotal, '0.5')
  assert.equal(stale.subtotal, '0.5')
  assert.equal(stale.statusLabel, '市场旧价 · 已计入')
  assert.equal(stale.observedAt, observedAt)

  plan.purchasePrices['200'] = '1.125'
  const [manual] = buildManufacturingPurchaseRows(summarizePlan(plan))
  assert.equal(manual.statusLabel, '方案内手填')
  assert.equal(manual.unitPrice, '1.125')
  assert.equal(manual.subtotal, '2.25')
  plan.purchasePrices['200'] = ''
  const [restored] = buildManufacturingPurchaseRows(summarizePlan(plan))
  assert.equal(restored.priceSource, 'market')
  assert.equal(restored.quoteStatus, 'stale')
  assert.equal(restored.unitPrice, '0.25')
  assert.equal(restored.subtotal, '0.5')
})

test('real missing empty and invalid quote leaves retain diagnostic states and observed times in CSV', () => {
  const catalog = loadManufacturingCatalog({
    schemaVersion: 1, scope: ['ship', 'material', 'building'],
    items: [{ itemId: '200', name: '暂无卖价材料' }, { itemId: '201', name: '无效报价材料' }],
    recipes: [{ productId: '100', name: '制造目标', category: 'ship', outputNum: 1, materials: [{ itemId: '200', quantity: 2 }, { itemId: '201', quantity: 3 }], money: 0, time: 0, maxInstallQuantity: 1 }],
  })
  const now = '2026-10-04T12:00:00Z'
  const marketQuotes = {
    '200': { status: 'empty', best_sell: null, observed_at: observedAt },
    '201': { status: 'invalid', best_sell: 'invalid', observed_at: '2026-10-04T17:30:00+08:00' },
  }
  const summary = summarizePlan(createPlan(catalog, {
    targetId: '100', quantity: 1,
    settings: { materialEfficiencyPercent: '100', now }, marketQuotes,
  }))
  assert.deepEqual(summary.purchases, [])
  assert.deepEqual(summary.missing.map(row => row.reason), ['quote_empty', 'quote_invalid'])
  const rows = buildManufacturingPurchaseRows(summary, { marketQuotes, now })
  assert.deepEqual(rows.map(row => [row.itemId, row.reason, row.quoteStatus, row.observedAt, row.unitPrice, row.subtotal]), [
    ['200', 'quote_empty', 'empty', observedAt, null, null],
    ['201', 'quote_invalid', 'invalid', '2026-10-04T09:30:00.000Z', null, null],
  ])
  const [, ...records] = parseCsv(serializeManufacturingPurchaseCsv(rows))
  assert.deepEqual(records.map(cells => [cells[0], cells[3], cells[4], cells[6]]), [
    ['200', '', '', observedAt],
    ['201', '', '', '2026-10-04T09:30:00.000Z'],
  ])
})

test('missing absent and uncollected quotes never invent a time and invalid manual prices do not borrow market metadata', () => {
  const rows = buildManufacturingPurchaseRows({ purchases: [], missing: [
    { itemId: '200', name: '无报价材料', quantity: 2, reason: 'quote_absent' },
    { itemId: '201', name: '未采集材料', quantity: 3, reason: 'quote_uncollected' },
    { itemId: '202', name: '手填无效材料', quantity: 4, reason: 'price_invalid' },
  ] }, {
    now: '2026-10-04T12:00:00Z',
    marketQuotes: {
      '201': { status: 'uncollected', best_sell: null },
      '202': { status: 'fresh', best_sell: '10', observed_at: '2026-10-04T11:00:00Z' },
    },
  })
  assert.deepEqual(rows.map(row => row.observedAt), [null, null, null])
  assert.equal(rows[1].quoteStatus, 'uncollected')
  assert.equal(rows[2].quoteStatus, null)
  assert.equal(rows[2].reason, 'price_invalid')
  assert.equal(rows[2].unitPrice, null)
  assert.equal(rows[2].subtotal, null)
  assert.equal(rows[2].nextStep, '修正或清空手填单价')
})

test('missing rows retain their existing diagnostic metadata when optional market quotes conflict', () => {
  const [row] = buildManufacturingPurchaseRows({ purchases: [], missing: [
    { itemId: '200', name: '缺价材料', quantity: 2, reason: 'quote_empty', quoteStatus: 'empty', observedAt },
  ] }, {
    now: '2026-10-04T12:00:00Z',
    marketQuotes: { '200': { status: 'invalid', best_sell: 'invalid', observed_at: '2026-10-04T11:00:00Z' } },
  })
  assert.equal(row.reason, 'quote_empty')
  assert.equal(row.quoteStatus, 'empty')
  assert.equal(row.observedAt, observedAt)
  assert.equal(row.unitPrice, null)
  assert.equal(row.subtotal, null)
})

test('priced summary rows keep their quote metadata and prices even when optional market quotes conflict', () => {
  const rows = buildManufacturingPurchaseRows({ purchases: [
    purchase({ itemId: '200', quoteStatus: 'stale', observedAt }),
    purchase({ itemId: '201', quoteStatus: 'unknown', observedAt: null }),
  ], missing: [] }, {
    now: '2026-10-04T12:00:00Z',
    marketQuotes: {
      '200': { status: 'invalid', best_sell: 'invalid', observed_at: '2026-10-04T11:00:00Z' },
      '201': { status: 'fresh', best_sell: '99', observed_at: '2026-10-04T11:00:00Z' },
    },
  })
  assert.deepEqual(rows.map(row => [row.quoteStatus, row.observedAt, row.unitPrice, row.subtotal]), [
    ['stale', observedAt, '1.25', '2.5'],
    ['unknown', null, '1.25', '2.5'],
  ])
})

test('formats decimal strings with exact grouping without losing large integers or fractional digits', () => {
  assert.equal(formatPurchaseIsk('99999999999999999999.9900'), '99,999,999,999,999,999,999.9900')
  assert.equal(formatPurchaseIsk('9007199254740993.12345678901234567890'), '9,007,199,254,740,993.12345678901234567890')
  assert.equal(formatPurchaseIsk('0.00000000000000000001'), '0.00000000000000000001')
  assert.equal(formatPurchaseIsk('1234.00'), '1,234.00')
  assert.equal(formatPurchaseIsk('0'), '0')
  assert.equal(formatPurchaseIsk(null), '待补价格')
})

test('copied purchase lists contain target metadata and material subtotal followed by all eight columns', () => {
  const rows = buildManufacturingPurchaseRows({ purchases: [purchase({ unitPrice: '1234.50', subtotal: '2469.00', quoteStatus: 'stale' })], missing: [{ itemId: '10', name: '缺价材料', quantity: 3, reason: 'quote_absent' }] })
  const text = serializeManufacturingPurchaseList(rows, {
    targetName: '测试舰船', quantity: 5, materialSubtotal: '2469.00',
    manufacturingFee: '918273645', blueprintCost: '102938475',
  })
  const lines = text.trimEnd().split(/\r?\n/u)
  assert.equal(lines[0], '制造目标\t测试舰船\t目标数量\t5')
  assert.equal(lines[1], '材料采购小计ISK\t2,469.00')
  assert.equal(lines[2], headings.join('\t'))
  assert.deepEqual(lines[3].split('\t'), ['2', '矿石', '2', '1,234.50', '2,469.00', '市场旧价 · 已计入', observedAt, '刷新存量行情或填写方案单价'])
  assert.deepEqual(lines[4].split('\t').slice(0, 6), ['10', '缺价材料', '3', '', '', '未找到市场报价'])
  assert.doesNotMatch(text, /manufacturingFee|blueprintCost|918273645|102938475|制造费|蓝图/u)
})

test('copied lists quote text with tabs, quotes and newlines without creating extra logical cells', () => {
  const text = serializeManufacturingPurchaseList([exportRow({ name: '矿石\t"特选"\n第二行' })], { targetName: '测试舰船', quantity: 1, materialSubtotal: '2.5' })
  assert.ok(text.includes('\t"矿石\t""特选""\n第二行"\t2\t'), 'TSV must quote multiline names and double literal quotes')
})

test('CSV has a UTF-8 BOM, CRLF records and exact ungrouped decimal amounts', () => {
  const row = exportRow({ unitPrice: '9007199254740993.0100', subtotal: '18014398509481986.0200', statusLabel: '市场旧价 · 已计入', nextStep: '刷新存量行情或填写方案单价' })
  const csv = serializeManufacturingPurchaseCsv([row])
  assert.equal(csv, '\uFEFF' + headings.join(',') + '\r\n' + ['2', '矿石', '2', '9007199254740993.0100', '18014398509481986.0200', '市场旧价 · 已计入', observedAt, '刷新存量行情或填写方案单价'].join(',') + '\r\n')
})

test('CSV quotes commas, double quotes and embedded newlines while retaining all eight columns', () => {
  const name = '矿石, "特选"\n第二行'
  const csv = serializeManufacturingPurchaseCsv([exportRow({ name, nextStep: '查看市场, 或填写"方案"单价' })])
  assert.ok(csv.includes('"矿石, ""特选""\n第二行"'))
  const records = parseCsv(csv)
  assert.deepEqual(records[0], headings)
  assert.equal(records.length, 2)
  assert.equal(records[1].length, 8)
  assert.equal(records[1][1], name)
  assert.equal(records[1][7], '查看市场, 或填写"方案"单价')
})

test('CSV escapes formulas and leading spreadsheet controls in every text column', () => {
  for (const dangerous of ['=1+1', '+1', '-2', '@SUM(1)', '  =1+1', '\uFEFF@SUM(1)', '\tPlain', '\rPlain', '\nPlain']) {
    const csv = serializeManufacturingPurchaseCsv([exportRow({ itemId: dangerous, name: dangerous, statusLabel: dangerous, observedAt: dangerous, nextStep: dangerous })])
    const [, cells] = parseCsv(csv)
    for (const index of [0, 1, 5, 6, 7]) assert.equal(cells[index], `'${dangerous}`, `escapes text column ${index} for ${JSON.stringify(dangerous)}`)
    assert.deepEqual(cells.slice(2, 5), ['2', '1.25', '2.5'], 'valid numeric cells must not receive apostrophe escaping')
  }
})

test('CSV leaves missing prices and invalid numeric inputs blank while preserving genuine zero amounts', () => {
  const missing = buildManufacturingPurchaseRows({ purchases: [], missing: [{ itemId: '10', name: '缺价材料', quantity: 3, reason: 'quote_empty' }] })[0]
  const rows = [
    missing,
    exportRow({ itemId: '20', quantity: '=2+2', unitPrice: '=1+1', subtotal: '+SUM(1)' }),
    exportRow({ itemId: '30', quantity: '1e3', unitPrice: 'Infinity', subtotal: 'NaN' }),
    exportRow({ itemId: '40', quantity: 1, unitPrice: '0', subtotal: '0' }),
  ]
  const [, ...records] = parseCsv(serializeManufacturingPurchaseCsv(rows))
  assert.deepEqual(records.map(cells => cells.slice(2, 5)), [['3', '', ''], ['', '', ''], ['', '', ''], ['1', '0', '0']])
  assert.ok(records.every(cells => cells.length === 8))
})
