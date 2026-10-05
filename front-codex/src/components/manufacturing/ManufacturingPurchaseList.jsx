import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Download, ExternalLink, RefreshCw, ShoppingCart } from 'lucide-react'
import MarketItemIcon from '../MarketItemIcon'
import { formatManufacturingObservationTime } from '../../utils/manufacturingDisplay'
import { buildManufacturingPurchaseRows, formatPurchaseIsk, serializeManufacturingPurchaseCsv, serializeManufacturingPurchaseList } from '../../utils/manufacturingPurchase'

function formatPrice(value) {
  const formatted = formatPurchaseIsk(value)
  return formatted === '待补价格' ? formatted : `${formatted} ISK`
}

export default function ManufacturingPurchaseList({ summary, targetName, marketQuotes, quoteNow, purchasePrices, onManualPrice, onRefreshQuotes, quoteLoading }) {
  const rows = useMemo(() => buildManufacturingPurchaseRows(summary, { marketQuotes, now: quoteNow }), [summary, marketQuotes, quoteNow])
  const copyText = useMemo(() => serializeManufacturingPurchaseList(rows, {
    targetName,
    quantity: summary.quantity,
    materialSubtotal: summary.materialSubtotal,
  }), [rows, summary.quantity, summary.materialSubtotal, targetName])
  const latestText = useRef(copyText)
  latestText.current = copyText
  const [copyStatus, setCopyStatus] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const fallbackRef = useRef(null)

  useEffect(() => {
    setCopyStatus('')
    setFallbackText('')
  }, [copyText])

  useEffect(() => {
    if (!fallbackText) return
    fallbackRef.current?.focus()
    fallbackRef.current?.select()
  }, [fallbackText])

  const copyList = async () => {
    const text = copyText
    try {
      await navigator.clipboard.writeText(text)
      if (latestText.current === text) {
        setFallbackText('')
        setCopyStatus('采购清单已复制，包含全部购买项与报价来源。')
      }
    } catch {
      if (latestText.current === text) {
        setFallbackText(text)
        setCopyStatus('自动复制未成功，请选择下方清单文本后复制。')
      }
    }
  }

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([serializeManufacturingPurchaseCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'EVEM-采购清单.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return <section id="manufacturing-purchase-list" tabIndex={-1} className="manufacturing-purchase-list" aria-labelledby="manufacturing-purchase-heading" data-testid="manufacturing-purchase-list">
    <div className="manufacturing-purchase-heading">
      <div><h2 id="manufacturing-purchase-heading"><ShoppingCart size={18} aria-hidden="true" />采购清单</h2><p>同一材料已合并数量 · {rows.length} 类购买项 · {summary.missing.length ? `待补 ${summary.missing.length} 项价格` : '材料价格已覆盖'}</p></div>
      <div className="manufacturing-purchase-actions">
        <button type="button" onClick={onRefreshQuotes} disabled={quoteLoading}><RefreshCw size={15} aria-hidden="true" />{quoteLoading ? '正在读取清单行情' : '刷新清单行情'}</button>
        <button type="button" onClick={copyList} disabled={!rows.length}><Copy size={15} aria-hidden="true" />复制采购清单</button>
        <button type="button" onClick={exportCsv} disabled={!rows.length}><Download size={15} aria-hidden="true" />导出 CSV</button>
      </div>
    </div>
    <p className="manufacturing-purchase-note">下表小计仅含购买材料；制造费与蓝图费见成本概览。市场旧价仍计入估算，请核对采集时间。</p>
    {copyStatus ? <p className="manufacturing-purchase-copy-status" role="status">{copyStatus}</p> : null}
    {fallbackText ? <label className="manufacturing-purchase-fallback">可手动复制的采购清单<textarea ref={fallbackRef} aria-label="可手动复制的采购清单" value={fallbackText} readOnly onFocus={event => event.target.select()} /></label> : null}
    {rows.length ? <div className="manufacturing-purchase-table-wrap">
      <table role="table" className="manufacturing-purchase-table">
        <caption className="sr-only">{targetName}制造方案的全部聚合购买项，含缺价材料</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">材料</th><th role="columnheader" scope="col">采购数量</th><th role="columnheader" scope="col">生效单价 / 小计</th><th role="columnheader" scope="col">价格来源与下一步</th><th role="columnheader" scope="col">本方案补价</th></tr></thead>
        <tbody role="rowgroup">{rows.map(row => <tr role="row" key={row.itemId} data-item-id={row.itemId} className={row.reason ? 'is-missing' : ''}>
          <th role="rowheader" scope="row" data-label="材料"><div className="manufacturing-purchase-item"><MarketItemIcon itemId={row.itemId} size={30} /><div><strong>{row.name}</strong></div></div></th>
          <td role="cell" data-label="采购数量" className="manufacturing-purchase-quantity">{new Intl.NumberFormat('zh-CN').format(row.quantity)}</td>
          <td role="cell" data-label="生效单价 / 小计"><strong className="manufacturing-purchase-unit-price">{formatPrice(row.unitPrice)}</strong><small>{row.subtotal == null ? '小计待补价' : `小计 ${formatPrice(row.subtotal)}`}</small></td>
          <td role="cell" data-label="价格来源与下一步"><span className={`manufacturing-purchase-source${row.reason || row.quoteStatus === 'stale' || row.quoteStatus === 'unknown' ? ' is-warning' : ''}`}>{row.statusLabel}</span>{row.priceSource === 'market' || (row.reason && row.reason !== 'price_invalid') ? <small>{row.observedAt ? <time dateTime={row.observedAt}>{formatManufacturingObservationTime(row.observedAt)}</time> : '采集时间未知'}</small> : null}<small>{row.nextStep}</small><Link to="/market" target="_blank" rel="noopener noreferrer" aria-label={`查看 ${row.name} 行情（新标签页）`}>查看行情<ExternalLink size={12} aria-hidden="true" /></Link></td>
          <td role="cell" data-label="本方案补价"><input type="text" inputMode="decimal" maxLength={64} aria-label={`采购单价 ${row.name}`} aria-invalid={row.reason === 'price_invalid'} aria-describedby={`purchase-price-help-${row.itemId}`} value={purchasePrices[row.itemId] ?? ''} onChange={event => onManualPrice(row.itemId, event.target.value)} placeholder="留空用市场价" /><small id={`purchase-price-help-${row.itemId}`}>{row.reason === 'price_invalid' ? '请输入非负普通十进制单价，不支持指数；最多 64 个字符。' : 'ISK / 件 · 留空恢复市场参考价'}</small></td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="manufacturing-purchase-note">当前路线没有需要购买的材料。</p>}
    <div className="manufacturing-purchase-footer"><span>已覆盖材料小计 <strong>{formatPrice(summary.materialSubtotal)}</strong>{summary.missing.length ? ' · 尚有材料未计价' : ''}</span><p>查看行情会另开标签页，请按材料名称搜索。手填只用于当前方案，切换目标或刷新页面会清空。</p></div>
  </section>
}
