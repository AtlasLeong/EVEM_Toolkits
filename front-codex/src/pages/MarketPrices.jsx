import { useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { AuthContext } from '../context/AuthContext'
import { LoadingBar } from '../components/ui/Primitives'
import { getMarketSeries, listMarketCategories, listMarketItems } from '../services/apiMarket'
import { marketRefetchInterval } from '../utils/marketPolling'
import { formatCompactMarketPrice } from '../utils/marketPrice'
import { marketScopeLabel } from '../utils/marketScope'
import MarketItemIcon from '../components/MarketItemIcon'
import MarketTrendChart from './MarketTrendChart'
import '../styles/market.css'
import '../styles/market-focus.css'

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

export { marketScopeLabel }

function ageLabel(value, now = Date.now()) {
  const elapsed = now - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  if (elapsed < 60000) return '刚刚'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`
  // Switch to a day label slightly before the 24-hour boundary so a clock
  // tick during rendering does not make the compact mobile label oscillate.
  if (elapsed < 23 * 3600000) return `${Math.floor(elapsed / 3600000)} 小时前`
  return `${Math.floor(elapsed / 86400000)} 天前`
}

function quoteStatus(item, now = Date.now()) {
  if (!item.observed_at || item.status === 'uncollected') return { label: '尚未采集', tone: 'neutral' }
  if (item.status === 'empty') return { label: '暂无挂单', tone: 'neutral' }
  if (item.status === 'stale' || now - new Date(item.observed_at).getTime() > 2 * 3600000) return { label: '已过期', tone: 'warning' }
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

function ItemNav({ rows, selectedId, onSelect, now }) {
  return <div className="market-item-nav" role="group" aria-label="快速切换物品">
    {rows.map(item => {
      const status = quoteStatus(item, now)
      return <button type="button" key={item.item_id} aria-current={selectedId === item.item_id ? 'true' : undefined} className={`market-item-choice${selectedId === item.item_id ? ' active' : ''}`} onClick={() => onSelect(item.item_id)}>
        <MarketItemIcon item={item} />
        <span className="market-choice-content"><span className="market-choice-head"><strong title={item.name}>{item.name}</strong><span className={`market-choice-status ${status.tone}${status.tone === 'success' ? ' sr-only' : ''}`}>{status.label}</span></span>
          <span className="market-choice-quote" title={formatMarketPrice(item.best_sell)}>卖价 <b>{item.best_sell == null ? '暂无报价' : formatCompactMarketPrice(item.best_sell)}</b></span>
        </span>
      </button>
    })}
  </div>
}

function PriceLadder({ title, values, tone }) {
  const levels = Array.isArray(values) ? values.slice(0, 5) : []
  return <div className={`market-price-ladder market-price-ladder--${tone}`}>
    <div className="market-price-ladder-head"><span>{title}</span>{levels.length ? <small>前 {levels.length} 档</small> : null}</div>
    {levels.length ? <ol>
      {levels.map((value, index) => {
        const exact = formatMarketPrice(value)
        const numeric = exact.replace(/ ISK$/, '')
        // Adjacent orders can differ by only one ISK. Keep normal prices exact;
        // only unusually long values need the compact form in the narrow rail.
        const visible = numeric.length <= 16 ? numeric : formatCompactMarketPrice(value)
        return <li key={`${value}-${index}`}><span>{index + 1}</span><strong title={exact}><span aria-hidden="true">{visible}</span><span className="sr-only">{exact}</span></strong></li>
      })}
    </ol> : <p className="market-book-empty">暂无挂单</p>}
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
  const [viewMode, setViewMode] = useState('sell')
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { setQueryText(search.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const queryOptions = {
    retry: false,
    staleTime: 15000,
    placeholderData: previousData => previousData,
    refetchInterval: marketRefetchInterval,
    refetchIntervalInBackground: false,
  }
  const categoriesQuery = useQuery({ queryKey: ['market-categories'], queryFn: ({ signal }) => listMarketCategories({ signal }), ...queryOptions })
  const itemsQuery = useQuery({
    queryKey: ['market-items', queryText, categoryId, page],
    queryFn: ({ signal }) => listMarketItems({ q: queryText, categoryId, page, signal }),
    ...queryOptions,
  })
  const rows = itemsQuery.data?.results || []
  const total = itemsQuery.data?.count ?? 0
  const selected = rows.find(item => item.item_id === selectedId) || rows[0] || null
  const listMarketScope = itemsQuery.data?.market_scope || selected?.market_scope || selected?.scope
  const seriesQuery = useQuery({
    queryKey: ['market-series', selected?.item_id, days],
    queryFn: ({ signal }) => getMarketSeries(selected.item_id, days, { signal }),
    enabled: Boolean(selected), ...queryOptions,
  })
  const marketScope = seriesQuery.data?.market_scope || listMarketScope
  const points = seriesQuery.data?.points || []
  const showBuy = viewMode !== 'sell'
  const showSell = viewMode !== 'buy'

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

  return <div className="page-stack market-page market-page--immersive market-terminal market-focus">
    <header className="market-terminal-header">
      <div className="market-terminal-heading"><Activity size={18} aria-hidden="true" /><h1>市场价格</h1><ChevronRight className="market-header-divider" size={15} aria-hidden="true" /><span className="market-header-category">{selected?.category || '行情工作台'}</span><span className="market-header-scope" data-testid="market-scope">价格范围：{marketScopeLabel(marketScope)}</span></div>
      <div className="market-header-actions">{isAuthenticated ? <Link className="market-terminal-action" to="/market/admin">采集管理</Link> : null}<button type="button" className="market-terminal-action" onClick={refresh} aria-label="刷新市场价格"><RefreshCw size={16} aria-hidden="true" />刷新行情</button></div>
    </header>

    <div className="market-terminal-layout">
      <aside className="market-terminal-catalog" aria-label="市场物品目录">
        <div className="market-terminal-section-head"><strong>物品导航</strong></div>
        <label className="market-search market-terminal-search"><Search size={17} aria-hidden="true" /><input type="search" value={search} onChange={event => handleSearch(event.target.value)} aria-label="搜索物品" placeholder="搜索物品名称" /></label>
        {categoriesQuery.isError ? <p className="market-terminal-hint">分类暂不可用，仍可搜索物品。</p> : <CategoryNav categories={categoriesQuery.data || []} active={categoryId} onSelect={selectCategory} />}
        <div className="market-catalog-title"><span>物品列表</span><span>{itemsQuery.isSuccess ? `${total} 件` : '—'}</span></div>
        {itemsQuery.isPending && !itemsQuery.data ? <LoadingBar /> : null}
        {itemsQuery.isFetching && itemsQuery.data ? <span className="market-refresh-status" role="status">目录更新中</span> : null}
        {itemsQuery.isError && !itemsQuery.data ? <div className="market-terminal-empty"><strong>价格暂时无法加载</strong><p>服务暂不可用，请稍后重试。历史报价不会伪装为实时行情。</p></div> : null}
        {itemsQuery.isSuccess && !rows.length ? <div className="market-terminal-empty"><strong>{queryText ? '没有找到物品' : '尚无已启用物品'}</strong><p>{queryText ? '试试其他名称。' : '管理员启用采集物品后，才会出现在这里。'}</p></div> : null}
        {rows.length ? <ItemNav rows={rows} selectedId={selected?.item_id} onSelect={setSelectedId} now={clock} /> : null}
        {itemsQuery.isSuccess && (page > 1 || page * 50 < total) ? <div className="market-terminal-pager"><button type="button" aria-label="上一页物品" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}><ChevronLeft size={16} /></button><span>第 {page} 页</span><button type="button" aria-label="下一页物品" disabled={page * 50 >= total} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}><ChevronRight size={16} /></button></div> : null}
      </aside>

      <main className="market-terminal-main">
        {selected ? <>
          <div className="market-instrument-head"><div><div className="market-instrument-title"><h2>{selected.name}</h2><span className="market-instrument-category">{selected.category || '未分类'}</span></div><p>报价观测 <span aria-hidden="true">·</span> 价格范围：{marketScopeLabel(marketScope)} <span aria-hidden="true">·</span> ISK</p></div></div>
          <div className="market-focus-toolbar">
            <div className="market-view-modes" role="group" aria-label="走势显示方式">{[['both', '双边走势'], ['sell', '只看卖价'], ['buy', '只看买价']].map(([mode, label]) => <button type="button" key={mode} className={viewMode === mode ? 'active' : ''} aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{label}</button>)}</div>
            <div className="market-periods" role="group" aria-label="历史时间范围">{WINDOWS.map(window => <button type="button" key={window.days} className={days === window.days ? 'active' : ''} aria-pressed={days === window.days} onClick={() => setDays(window.days)}>{window.label}</button>)}</div>
          </div>
          <div className="market-legend"><h3>价格走势 <small>ISK</small></h3><span>{seriesQuery.data ? `${seriesQuery.data.count} 次观测` : '等待数据'}{seriesQuery.isFetching && seriesQuery.data ? <small className="market-fetching-label">更新中</small> : null}</span></div>
          <div className="market-chart-frame">
            {seriesQuery.isPending && !seriesQuery.data ? <div className="market-chart-message"><LoadingBar /><span>正在读取真实历史报价…</span></div> : null}
            {seriesQuery.isError && !seriesQuery.data ? <div className="market-chart-message">走势图暂时无法加载；当前报价与历史走势可能不一致，请稍后刷新。</div> : null}
            {seriesQuery.data ? <MarketTrendChart points={points} stats={seriesQuery.data.stats} showBuy={showBuy} showSell={showSell} formatPrice={formatMarketPrice} formatTime={formatMarketTime} /> : null}
          </div>
        </> : <div className="market-terminal-blank"><Activity size={42} aria-hidden="true" /><h2>选择物品，查看价格轨迹</h2><p>左侧列表只展示已启用的市场物品。</p></div>}
      </main>

      <aside className="market-terminal-summary" aria-label="当前物品报价摘要">
        <div className="market-terminal-section-head"><strong>报价档位</strong><span>价格范围：{marketScopeLabel(marketScope)} · ISK · 各侧前 5 档</span></div>
        {selected ? <>
          <section className="market-depth-panel" aria-label="报价档位">
            <div className="market-depth-grid"><PriceLadder title="卖价档位" values={selected.sell_prices} tone="sell" /><PriceLadder title="买价档位" values={selected.buy_prices} tone="buy" /></div>
          </section>
          <div className="market-current-quotes" aria-label="当前最低卖价与最高买价">{[['best_sell', '最低卖价', 'sell'], ['best_buy', '最高买价', 'buy']].map(([field, label, tone]) => <div key={field} className={`market-current-quote market-current-quote--${tone}`}><span>{label}</span><strong className="market-quote-value" title={formatMarketPrice(selected[field])}><span aria-hidden="true">{selected[field] == null ? '暂无报价' : formatCompactMarketPrice(selected[field])}</span><span className="sr-only">{formatMarketPrice(selected[field])}</span></strong><small className={`market-quote-change ${formatChange(seriesQuery.data?.change?.[field]).tone}`} title="所选区间首末有效报价涨跌">{formatChange(seriesQuery.data?.change?.[field]).text}</small></div>)}</div>
          <div className="market-snapshot-meta"><span>最近采集</span><strong>{formatMarketTime(selected.observed_at)}</strong>{selected.observed_at ? <small className="market-sample-age">{ageLabel(selected.observed_at, clock)}</small> : null}</div>
        </> : <p className="market-terminal-hint">选择一件已启用物品后查看报价。</p>}
      </aside>
    </div>
  </div>
}
