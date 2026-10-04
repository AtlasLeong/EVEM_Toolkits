/*
 * Purchase-list presentation and export helpers. The manufacturing summary has
 * already aggregated quantities and resolved prices; these helpers never add
 * them again or include manufacturing and blueprint fees in the purchase list.
 */

import { resolveManufacturingQuote } from './manufacturingPlan.js'

const PURCHASE_COLUMNS = ['ID', '名称', '数量', '单价ISK', '小计ISK', '来源', '采集时间', '下一步']
const MISSING_LABELS = {
  quote_absent: '未找到市场报价',
  quote_uncollected: '尚未采集报价',
  quote_empty: '市场暂无卖价',
  quote_invalid: '市场报价无效',
  price_invalid: '手填单价无效',
}
const MISSING_NEXT_STEP = '查看市场或填写方案单价'
const REFRESH_NEXT_STEP = '刷新存量行情或填写方案单价'

function compareItemIds(left, right) {
  const leftId = String(left.itemId)
  const rightId = String(right.itemId)
  if (/^[0-9]+$/u.test(leftId) && /^[0-9]+$/u.test(rightId)) {
    const leftDigits = leftId.replace(/^0+(?=[0-9])/u, '')
    const rightDigits = rightId.replace(/^0+(?=[0-9])/u, '')
    if (leftDigits.length !== rightDigits.length) return leftDigits.length - rightDigits.length
    if (leftDigits !== rightDigits) return leftDigits < rightDigits ? -1 : 1
  }
  return leftId === rightId ? 0 : leftId < rightId ? -1 : 1
}

function describePrice(row) {
  if (row.reason) {
    return {
      statusLabel: MISSING_LABELS[row.reason] || '待补价格',
      nextStep: row.reason === 'price_invalid' ? '修正或清空手填单价' : MISSING_NEXT_STEP,
    }
  }
  if (row.priceSource === 'manual') {
    return { statusLabel: '方案内手填', nextStep: '清空手填可恢复市场参考价' }
  }
  if (row.priceSource === 'market' && row.quoteStatus === 'stale') {
    return { statusLabel: '市场旧价 · 已计入', nextStep: REFRESH_NEXT_STEP }
  }
  if (row.priceSource === 'market' && row.quoteStatus === 'unknown') {
    return { statusLabel: '市场价 · 时间未知', nextStep: REFRESH_NEXT_STEP }
  }
  if (row.priceSource === 'market') {
    return { statusLabel: '市场参考价', nextStep: MISSING_NEXT_STEP }
  }
  return { statusLabel: '待补价格', nextStep: MISSING_NEXT_STEP }
}

/** Merge purchases, retaining stored diagnostic times without repricing missing rows. */
export function buildManufacturingPurchaseRows(summary, { marketQuotes = {}, now } = {}) {
  const rowsById = new Map()
  for (const [field, missing] of [['purchases', false], ['missing', true]]) {
    for (const purchase of Array.isArray(summary?.[field]) ? summary[field] : []) {
      if (!purchase || purchase.itemId === undefined || purchase.itemId === null) continue
      const itemId = String(purchase.itemId)
      if (rowsById.has(itemId)) continue
      const quote = marketQuotes instanceof Map ? marketQuotes.get(itemId) : marketQuotes?.[itemId]
      const diagnostic = missing && purchase.reason !== 'price_invalid' && quote !== undefined
        ? resolveManufacturingQuote(quote, { now }) : null
      const row = {
        ...purchase,
        itemId,
        name: purchase.name,
        quantity: purchase.quantity,
        unitPrice: missing ? null : purchase.unitPrice ?? null,
        subtotal: missing ? null : purchase.subtotal ?? null,
        priceSource: purchase.priceSource ?? null,
        quoteStatus: purchase.quoteStatus ?? diagnostic?.status ?? null,
        observedAt: purchase.observedAt ?? diagnostic?.observedAt ?? null,
        reason: purchase.reason ?? null,
      }
      rowsById.set(itemId, { ...row, ...describePrice(row) })
    }
  }
  return [...rowsById.values()].sort(compareItemIds)
}

/** Group the integer part of a decimal string without rounding or Number conversion. */
export function formatPurchaseIsk(value) {
  if (value === undefined || value === null) return '待补价格'
  const match = /^([+-]?)([0-9]+)(\.[0-9]+)?$/u.exec(String(value).trim())
  if (!match) return '待补价格'
  return `${match[1]}${match[2].replace(/\B(?=([0-9]{3})+(?![0-9]))/gu, ',')}${match[3] || ''}`
}

function decimalCell(value) {
  if (value === undefined || value === null) return ''
  const text = String(value).trim()
  return /^[0-9]+(?:\.[0-9]+)?$/u.test(text) ? text : ''
}

function quantityCell(value) {
  if (value === undefined || value === null) return ''
  const text = String(value).trim()
  return /^[0-9]+$/u.test(text) ? text : ''
}

function purchaseCells(row, { formatted = false } = {}) {
  const price = row.reason ? '' : decimalCell(row.unitPrice)
  const subtotal = row.reason ? '' : decimalCell(row.subtotal)
  return [
    String(row.itemId ?? ''),
    String(row.name ?? ''),
    quantityCell(row.quantity),
    formatted && price ? formatPurchaseIsk(price) : price,
    formatted && subtotal ? formatPurchaseIsk(subtotal) : subtotal,
    String(row.statusLabel ?? describePrice(row).statusLabel),
    String(row.observedAt ?? ''),
    String(row.nextStep ?? describePrice(row).nextStep),
  ]
}

function quoteDelimitedCell(value, delimiter) {
  const text = String(value)
  return text.includes(delimiter) || /["\r\n]/u.test(text)
    ? `"${text.replace(/"/gu, '""')}"` : text
}

/** Copyable tab-separated rows plus only the target and material purchase subtotal. */
export function serializeManufacturingPurchaseList(rows, { targetName = '', quantity = '', materialSubtotal = null } = {}) {
  const lines = [
    ['制造目标', targetName, '目标数量', quantityCell(quantity)],
    ['材料采购小计ISK', formatPurchaseIsk(materialSubtotal)],
    PURCHASE_COLUMNS,
    ...(Array.isArray(rows) ? rows : []).map(row => purchaseCells(row, { formatted: true })),
  ]
  return lines.map(cells => cells.map(cell => quoteDelimitedCell(cell, '\t')).join('\t')).join('\n')
}

function safeSpreadsheetText(value) {
  const text = String(value)
  return /^(?:[\t\r\n]|[\s\uFEFF]*[=+\-@])/u.test(text) ? `'${text}` : text
}

/** UTF-8 CSV content with Excel-safe text and exact, unrounded decimal price cells. */
export function serializeManufacturingPurchaseCsv(rows) {
  const records = [PURCHASE_COLUMNS, ...(Array.isArray(rows) ? rows : []).map(row => (
    purchaseCells(row).map((cell, index) => [2, 3, 4].includes(index) ? cell : safeSpreadsheetText(cell))
  ))]
  return `\uFEFF${records.map(cells => cells.map(cell => quoteDelimitedCell(cell, ',')).join(',')).join('\r\n')}\r\n`
}
