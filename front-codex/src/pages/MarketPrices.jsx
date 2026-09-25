import { useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { AuthContext } from '../context/AuthContext'
import { LoadingBar } from '../components/ui/Primitives'
import { getMarketSeries, listMarketCategories, listMarketItems } from '../services/apiMarket'
import MarketTrendChart from './MarketTrendChart'
import '../styles/market.css'

const WINDOWS = [{ days: 1, label: '24 小时' }, { days: 7, label: '7 天' }, { days: 30, label: '30 天' }]

export function formatMarketPrice(value) {
  if (value === null || value === undefined || value === '') return '暂无报价'
  const match = String(value).match(/^([0-9]+)(?:\.([0-9]+))?$/)
  if (!match) return '暂无报价'
  const whole = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${whole}${match[2] === undefined ? '' : `.${match[2]}`} ISK`
}

export function formatMarketTime(value) {
  if (!value) return '尚未采集'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function marketScopeLabel(value) {
  return value === 'global' ? '市场范围 8' : value || '—'
}

function ageLabel(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  if (elapsed < 60000) return '刚刚'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`
  return `${Math.floor(elapsed / 86400000)} 天前`
}

function quoteStatus(item) {
  if (!item.observed_at || item.status === 'uncollected') return { label: '尚未采集', tone: 'neutral' }
  if (item.status === 'empty') return { label: '暂无挂单', tone: 'neutral' }
  if (item.status === 'stale' || Date.now() - new Date(item.observed_at).getTime() > 2 * 3600000) return { label: '已过期', tone: 'warning' }
  return { label: '最新观测', tone: 'success' }
}

function formatChange(change) {
  if (!change || change.absolute === null || change.percent === null) return { text: '样本不足', tone: 'neutral' }
  const negative = String(change.absolute).startsWith('-')
  const zero = /^-?0(?:\.0+)?$/.test(String(change.absolute))
  const prefix = negative ? '−' : zero ? '' : '+'
  const absolute = String(change.absolute).replace(/^-/, '')
  const percent = String(change.percent).replace(/^-/, '')
  return { text: `${prefix}${formatMarketPrice(absolute)} · ${prefix}${percent}%`, tone: negative ? 'down' : zero ? 'neutral' : 'up' }
}

function CategoryNav({ categories, active, onSelect }) {
  const all = categories.reduce((sum, category) => sum + category.count, 0)
  return <nav className="market-category-nav" aria-label="物品分类">
    <button type="button" aria-current={active === null ? 'true' : undefined} className={active === null ? 'active' : ''} onClick={() => onSelect(null)}><span>全部物品</span><strong>{all}</strong></button>
    {categories.map(category => <button type="button" key={category.id} aria-current={active === String(category.id) ? 'true' : undefined} className={active === String(category.id) ? 'active' : ''} onClick={() => onSelect(String(category.id))}><span>{category.label}</span><strong>{category.count}</strong></button>)}
  </nav>
}

function ItemNav({ rows, selectedId, onSelect }) {
  return <div className="market-item-nav" role="group" aria-label="快速切换物品">
    {rows.map(item => {
      const status = quoteStatus(item)
      return <button type="button" key={item.item_id} aria-current={selectedId === item.item_id ? 'true' : undefined} className={`market-item-choice${selectedId === item.item_id ? ' active' : ''}`} onClick={() => onSelect(item.item_id)}>
        <span className="market-choice-head"><strong>{item.name}</strong><span className={`market-choice-status ${status.tone}`}>{status.label}</span></span>
        <span className="market-choice-meta">{item.category || '未分类'}</span>
        <span className="market-choice-quote">卖 {formatMarketPrice(item.best_sell)}</span>
      </button>
    })}
  </div>
}

function QuoteCard({ title, value, change, tone }) {
  const displayChange = formatChange(change)
  return <div className={`market-quote-card market-quote-card--${tone}`}>
    <span className="market-quote-label">{title}</span>
    <strong className="market-quote-value">{formatMarketPrice(value)}</strong>
    <span className={`market-quote-change ${displayChange.tone}`}>{displayChange.text}</span>
  </div>
}

function PriceLadder({ title, values, tone }) {
  if (!Array.isArray(values) || values.length === 0) return null
  return <div className={`market-price-ladder market-price-ladder--${tone}`}>
    <div className="market-price-ladder-head"><span>{title}</span><small>前 {Math.min(values.length, 5)} 档</small></div>
    <ol>
      {values.slice(0, 5).map((value, index) => <li key={`${value}-${index}`}><span>{index + 1}</span><strong>{formatMarketPrice(value)}</strong></li>)}
    </ol>
  </div>
}

export default function MarketPricesPage() {
  const { isAuthenticated } = useContext(AuthContext)
  const [search, setSearch] = useState('')
  const [queryText, setQueryText] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [days, setDays] = useState(1)
  const [showBuy, setShowBuy] = useState(true)
  const [showSell, setShowSell] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => { setQueryText(search.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const queryOptions = { retry: false, staleTime: 15000, placeholderData: previousData => previousData, refetchInterval: 120000, refetchIntervalInBackground: false }
  const categoriesQuery = useQuery({ queryKey: ['market-categories'], queryFn: ({ signal }) => listMarketCategories({ signal }), ...queryOptions })
  const itemsQuery = useQuery({
    queryKey: ['market-items', queryText, categoryId, page],
    queryFn: ({ signal }) => listMarketItems({ q: queryText, categoryId, page, signal }),
    ...queryOptions,
  })
  const rows = itemsQuery.data?.results || []
  const total = itemsQuery.data?.count ?? 0
  const selected = rows.find(item => item.item_id === selectedId) || rows[0] || null
  const seriesQuery = useQuery({
    queryKey: ['market-series', selected?.item_id, days],
    queryFn: ({ signal }) => getMarketSeries(selected.item_id, days, { signal }),
    enabled: Boolean(selected), ...queryOptions,
  })
  const status = selected ? quoteStatus(selected) : null
  const points = seriesQuery.data?.points || []

  function selectCategory(value) {
    setCategoryId(value)
    setPage(1)
    setSelectedId(null)
  }

  function handleSearch(value) {
    setSearch(value)
    setCategoryId(null)
    setSelectedId(null)
  }

  function refresh() {
    categoriesQuery.refetch()
    itemsQuery.refetch()
    if (selected) seriesQuery.refetch()
  }

  return <div className="page-stack market-page market-terminal">
    <header className="market-terminal-header">
      <div className="market-terminal-heading"><span className="market-eyebrow"><Activity size={15} aria-hidden="true" /> EVE ECHOES / MARKET INTELLIGENCE</span><h1>市场价格</h1><p>真实盘口观测 · 历史涨跌仅供参考，交易前请核对游戏内报价。</p></div>
      <div className="market-header-actions">{isAuthenticated ? <Link className="market-terminal-action" to="/market/admin">采集管理</Link> : null}<button type="button" className="market-terminal-action" onClick={refresh} aria-label="刷新市场价格"><RefreshCw size={16} aria-hidden="true" />刷新行情</button></div>
    </header>

    <div className="market-terminal-layout">
      <aside className="market-terminal-catalog" aria-label="市场物品目录">
        <div className="market-terminal-section-head"><span>MARKET INDEX</span><strong>物品导航</strong></div>
        <label className="market-search market-terminal-search"><Search size={17} aria-hidden="true" /><input type="search" value={search} onChange={event => handleSearch(event.target.value)} aria-label="搜索物品" placeholder="搜索物品名称" /></label>
        {categoriesQuery.isError ? <p className="market-terminal-hint">分类暂不可用，仍可搜索物品。</p> : <CategoryNav categories={categoriesQuery.data || []} active={categoryId} onSelect={selectCategory} />}
        <div className="market-catalog-title"><span>物品列表</span><span>{itemsQuery.isSuccess ? `${total} 件` : '—'}</span></div>
        {itemsQuery.isPending && !itemsQuery.data ? <LoadingBar /> : null}
        {itemsQuery.isFetching && itemsQuery.data ? <span className="market-refresh-status" role="status">目录更新中</span> : null}
        {itemsQuery.isError && !itemsQuery.data ? <div className="market-terminal-empty"><strong>价格暂时无法加载</strong><p>服务暂不可用，请稍后重试。历史报价不会伪装为实时行情。</p></div> : null}
        {itemsQuery.isSuccess && !rows.length ? <div className="market-terminal-empty"><strong>{queryText ? '没有找到物品' : '尚无已启用物品'}</strong><p>{queryText ? '试试其他名称。' : '管理员启用采集物品后，才会出现在这里。'}</p></div> : null}
        {rows.length ? <ItemNav rows={rows} selectedId={selected?.item_id} onSelect={setSelectedId} /> : null}
        {itemsQuery.isSuccess && (page > 1 || page * 50 < total) ? <div className="market-terminal-pager"><button type="button" aria-label="上一页物品" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}><ChevronLeft size={16} /></button><span>第 {page} 页</span><button type="button" aria-label="下一页物品" disabled={page * 50 >= total} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}><ChevronRight size={16} /></button></div> : null}
      </aside>

      <main className="market-terminal-main">
        {selected ? <>
          <div className="market-instrument-head"><div><span className="market-eyebrow">MARKET QUOTE / 实时盘口</span><h2>{selected.name}</h2><p>{selected.category || '未分类'} <span aria-hidden="true">/</span> {marketScopeLabel(selected.scope)}</p></div><span className={`market-instrument-status ${status.tone}`}>{status.label}</span></div>
          <div className="market-trend-heading"><div><span className="market-eyebrow">PRICE HISTORY</span><h3>价格走势</h3></div><div className="market-periods" role="group" aria-label="历史时间范围">{WINDOWS.map(window => <button type="button" key={window.days} className={days === window.days ? 'active' : ''} aria-pressed={days === window.days} onClick={() => setDays(window.days)}>{window.label}</button>)}</div></div>
          <div className="market-legend" role="group" aria-label="走势图图例"><button type="button" className={!showSell ? 'muted' : ''} aria-pressed={showSell} aria-label={`${showSell ? '隐藏' : '显示'}卖价曲线`} onClick={() => setShowSell(value => !value)}><i className="market-legend-swatch sell" />最低卖价</button><button type="button" className={!showBuy ? 'muted' : ''} aria-pressed={showBuy} aria-label={`${showBuy ? '隐藏' : '显示'}买价曲线`} onClick={() => setShowBuy(value => !value)}><i className="market-legend-swatch buy" />最高买价</button><span>{seriesQuery.data ? `${seriesQuery.data.count} 次观测` : '等待数据'}{seriesQuery.isFetching && seriesQuery.data ? <small className="market-fetching-label">更新中</small> : null}</span></div>
          <div className="market-chart-frame">
            {seriesQuery.isPending && !seriesQuery.data ? <div className="market-chart-message"><LoadingBar /><span>正在读取真实历史报价…</span></div> : null}
            {seriesQuery.isError && !seriesQuery.data ? <div className="market-chart-message">走势图暂时无法加载；当前报价与历史走势可能不一致，请稍后刷新。</div> : null}
            {seriesQuery.data ? <MarketTrendChart points={points} showBuy={showBuy} showSell={showSell} formatPrice={formatMarketPrice} formatTime={formatMarketTime} /> : null}
          </div>
          <section className="market-depth-panel" aria-label="盘口深度"><div className="market-depth-head"><div><span className="market-eyebrow">ORDER BOOK</span><h3>盘口深度</h3></div><span>前 5 档</span></div><div className="market-depth-grid"><PriceLadder title="卖价盘口" values={selected.sell_prices} tone="sell" /><PriceLadder title="买价盘口" values={selected.buy_prices} tone="buy" /></div></section>
        </> : <div className="market-terminal-blank"><Activity size={42} aria-hidden="true" /><h2>选择物品，查看价格轨迹</h2><p>左侧列表只展示已启用的市场物品。</p></div>}
      </main>

      <aside className="market-terminal-summary" aria-label="当前物品报价摘要">
        <div className="market-terminal-section-head"><span>QUOTE SUMMARY</span><strong>报价概览</strong></div>
        {selected ? <><div className="market-quote-stack"><QuoteCard title="最低卖价" value={selected.best_sell} change={seriesQuery.data?.change?.best_sell} tone="sell" /><QuoteCard title="最高买价" value={selected.best_buy} change={seriesQuery.data?.change?.best_buy} tone="buy" /></div><div className="market-snapshot-meta"><span>最近采集</span><strong>{formatMarketTime(selected.observed_at)}</strong>{selected.observed_at ? <small className="market-sample-age">{ageLabel(selected.observed_at)}</small> : null}</div></> : <p className="market-terminal-hint">选择一件已启用物品后查看报价。</p>}
      </aside>
    </div>
  </div>
}
