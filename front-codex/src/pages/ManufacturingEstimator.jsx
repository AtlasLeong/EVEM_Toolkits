import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Boxes, Check, ChevronDown, ChevronRight, Factory, Minus, Plus, RefreshCw, Search, Settings2, ShoppingCart, Wrench, X } from 'lucide-react'
import { loadManufacturingCatalog } from '../utils/manufacturingCatalog'
import { createManufacturingPlan, summarizeManufacturingPlan, DEFAULT_MATERIAL_EFFICIENCY, MIN_MATERIAL_EFFICIENCY, resolveMaterialEfficiency, resolveManufacturingQuote, resolveManualPurchasePrice } from '../utils/manufacturingPlan'
import { fetchManufacturingQuotes } from '../services/apiManufacturing'
import { MANUFACTURING_QUOTE_AGE_TICK_MS, manufacturingQuoteIdsDue, mergeManufacturingQuoteSnapshots } from '../utils/manufacturingQuoteCache'
import { formatCompactIsk, formatMissingMaterialReason, formatManufacturingObservationTime } from '../utils/manufacturingDisplay'
import MarketItemIcon from '../components/MarketItemIcon'
import ManufacturingPurchaseList from '../components/manufacturing/ManufacturingPurchaseList'
import '../styles/manufacturing.css'

const CATEGORY_LABELS = { ship: '舰船', material: '材料', building: '建筑' }
const DEFAULT_SETTINGS = { manufacturingSkill: '5', researchSkill: '5', efficiencySkill: '4', materialEfficiencyPercent: String(DEFAULT_MATERIAL_EFFICIENCY), building: '标准工厂', blueprintCost: '' }

function formatIsk(value) {
  if (value === null || value === undefined || value === '') return '待补价格'
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} ISK`
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)} ISK`
}

function formatQuantity(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value || 0)
}

function quoteState(status) {
  if (status === 'stale') return '报价已过期'
  if (status === 'empty') return '暂无有效卖价'
  if (status === 'invalid') return '报价无效，不参与估算'
  if (status === 'unknown') return '采集时间未知'
  return status === 'fresh' ? '最新存量报价' : '尚未采集'
}

function QuoteAgeWarning({ summary }) {
  const stale = summary.stalePurchases || []
  const unknown = summary.purchases.filter(item => item.quoteStatus === 'unknown')
  if (!stale.length && !unknown.length) return null
  const times = stale.map(item => item.observedAt).filter(Boolean).sort()
  const staleWithoutTime = stale.filter(item => !item.observedAt).length
  return <p className="manufacturing-quote-warning" data-testid="manufacturing-quote-warning" role="status">
    {stale.length ? <><b>使用 {stale.length} 项过期报价估算</b><span>已计入最新存量卖价，成交价可能已变化。{times[0] ? <>最早采集时间：<time dateTime={times[0]}>{formatManufacturingObservationTime(times[0])}</time>。</> : null}</span></> : null}
    {staleWithoutTime ? <span>其中 {staleWithoutTime} 项采集时间未知。</span> : null}
    {unknown.length ? <span>{unknown.length} 项报价采集时间未知，请核对市场价格。</span> : null}
  </p>
}

function TreeNode({ node, catalog, onModeChange, selectedId, onSelect, path, expandedNodes, onToggleExpanded }) {
  const recipe = catalog.byId.get(node.itemId)
  const canRoute = Boolean(recipe)
  const buying = node.mode === 'buy'
  const selected = selectedId === node.itemId
  const hasChildren = node.children?.length > 0
  const expanded = expandedNodes.has(path)
  return (
    <li className={`manufacturing-tree-node manufacturing-tree-node--${node.kind}${selected ? ' is-selected' : ''}`} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined}>
      <div className="manufacturing-tree-row" data-testid="manufacturing-tree-row" data-selected={selected ? 'true' : 'false'}>
        <button type="button" className="manufacturing-tree-select" aria-label={`查看 ${node.name}`} onClick={() => onSelect(node.itemId)}>
          <MarketItemIcon itemId={node.itemId} size={34} className="manufacturing-tree-icon" priority={path === '0' || path.split('.').length === 2 ? 'high' : undefined} />
          <span className="manufacturing-tree-copy">
            <strong>{node.name}</strong>
            <small>{formatQuantity(node.quantity)} 件 · {node.kind === 'recipe' && !buying ? `自造 · ${CATEGORY_LABELS[node.category] || '制造'}` : '购买'}</small>
          </span>
        </button>
        {canRoute ? (
          <div className="manufacturing-route-segmented" role="group" aria-label={`生产方式 ${node.name}`}>
            <button type="button" className={`manufacturing-route-toggle manufacturing-route-toggle--make${!buying ? ' is-active' : ''}`} aria-pressed={!buying} data-state={!buying ? 'active' : 'idle'} onClick={() => onModeChange(node.itemId, 'make')}>
              {!buying ? <Check size={13} aria-hidden="true" /> : <Wrench size={13} aria-hidden="true" />}自造
            </button>
            <button type="button" className={`manufacturing-route-toggle manufacturing-route-toggle--buy${buying ? ' is-active' : ''}`} aria-pressed={buying} data-state={buying ? 'active' : 'idle'} onClick={() => onModeChange(node.itemId, 'buy')}>
              {buying ? <Check size={13} aria-hidden="true" /> : <ShoppingCart size={13} aria-hidden="true" />}购买
            </button>
          </div>
        ) : <span className="manufacturing-route-leaf" aria-label={`市场采购 ${node.name}`}>市场采购</span>}
        {hasChildren ? (
          <button type="button" className="manufacturing-tree-expand" aria-label={`${expanded ? '收起' : '展开'} ${node.name}层级`} aria-expanded={expanded} onClick={() => onToggleExpanded(path)}>
            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          </button>
        ) : <span className="manufacturing-tree-chevron-spacer" />}
      </div>
      {hasChildren && expanded ? (
        <ul className="manufacturing-tree-children">
          {node.children.map((child, index) => <TreeNode key={`${path}.${index}`} node={child} catalog={catalog} onModeChange={onModeChange} selectedId={selectedId} onSelect={onSelect} path={`${path}.${index}`} expandedNodes={expandedNodes} onToggleExpanded={onToggleExpanded} />)}
        </ul>
      ) : null}
    </li>
  )
}

const TARGET_CATEGORY_ORDER = ['ship', 'material', 'building']

function TargetPicker({ recipes, selectedId, search, onSearch, onSelect }) {
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState('ship')
  const [activeOptionId, setActiveOptionId] = useState(null)
  const pickerRef = useRef(null)
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const openerRef = useRef(null)
  const groupsRef = useRef(null)
  const tabRefs = useRef({})
  const [dialogPosition, setDialogPosition] = useState(null)
  const selected = recipes.find(recipe => recipe.productId === selectedId)
  const groups = useMemo(() => {
    const text = search.trim().toLowerCase()
    return TARGET_CATEGORY_ORDER.map(category => {
      const matching = recipes.filter(recipe => recipe.category === category && (!text || recipe.name.toLowerCase().includes(text)))
      return { category, label: CATEGORY_LABELS[category], count: matching.length, recipes: matching }
    }).filter(group => group.recipes.length)
  }, [recipes, search])
  const categoryCounts = useMemo(() => Object.fromEntries(TARGET_CATEGORY_ORDER.map(category => [category, recipes.filter(recipe => recipe.category === category).length])), [recipes])
  const visibleGroups = useMemo(() => search.trim() ? groups : groups.filter(group => group.category === activeCategory), [activeCategory, groups, search])

  const updatePosition = useCallback(() => {
    const rect = pickerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 20)
    const height = Math.min(window.innerWidth < 768 ? 650 : 520, window.innerHeight - 20)
    setDialogPosition({
      top: Math.max(10, Math.min(rect.bottom + 6, window.innerHeight - height - 10)),
      left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)),
      width,
      height,
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const root = document.getElementById('root')
    const wasInert = root?.inert
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus({ preventScroll: true })
    const handleKeyDown = event => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll('button, input, [tabindex]') || [])
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      if (root) root.inert = wasInert
      document.body.style.overflow = previousOverflow
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true })
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (groupsRef.current) groupsRef.current.scrollTop = 0
    setActiveOptionId(null)
  }, [activeCategory, search])

  const openPicker = event => {
    openerRef.current = event.currentTarget
    onSearch('')
    setActiveCategory(selected?.category || 'ship')
    updatePosition()
    setOpen(true)
  }
  const chooseTarget = productId => {
    onSelect(productId)
    onSearch('')
    setOpen(false)
  }
  const selectCategory = category => {
    onSearch('')
    setActiveCategory(category)
  }
  const handleCategoryKeyDown = (event, category) => {
    const index = TARGET_CATEGORY_ORDER.indexOf(category)
    const nextIndex = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key]
    if (nextIndex === undefined) return
    event.preventDefault()
    const nextCategory = TARGET_CATEGORY_ORDER[nextIndex]
    selectCategory(nextCategory)
    tabRefs.current[nextCategory]?.focus()
  }
  const handleOptionKeyDown = event => {
    const options = Array.from(event.currentTarget.querySelectorAll('[role="option"]'))
    const index = options.indexOf(document.activeElement)
    const nextIndex = { ArrowDown: Math.min(index + 1, options.length - 1), ArrowUp: Math.max(index - 1, 0), Home: 0, End: options.length - 1 }[event.key]
    if (nextIndex === undefined) return
    event.preventDefault()
    options[nextIndex]?.focus()
  }
  const handleSearchKeyDown = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const options = dialogRef.current?.querySelectorAll('[role="option"]')
    if (!options?.length) return
    event.preventDefault()
    options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus()
  }
  const targetDialog = open && typeof document !== 'undefined' ? createPortal(<div className="manufacturing-target-portal manufacturing-page--terminal">
    <div className="manufacturing-target-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
    <div ref={dialogRef} className="manufacturing-target-dialog" style={dialogPosition ? { '--target-dialog-top': `${dialogPosition.top}px`, '--target-dialog-left': `${dialogPosition.left}px`, '--target-dialog-width': `${dialogPosition.width}px`, '--target-dialog-height': `${dialogPosition.height}px` } : undefined} role="dialog" aria-label="选择制造目标" aria-modal="true">
      <div className="manufacturing-target-dialog-heading"><div><span className="eyebrow">目标目录</span><strong>选择制造目标</strong></div><button type="button" className="manufacturing-target-dialog-close" aria-label="关闭目标选择器" onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></button></div>
      <div className="manufacturing-search-field">
        <Search size={17} aria-hidden="true" />
        <input ref={inputRef} id={`${pickerId}-search`} aria-label="搜索制造目标" role="searchbox" value={search} onChange={event => onSearch(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="按名称搜索舰船、材料或建筑" />
      </div>
      <div className="manufacturing-target-tabs" role="tablist" aria-label="制造分类">
        {TARGET_CATEGORY_ORDER.map(category => <button ref={node => { tabRefs.current[category] = node }} key={category} id={`${pickerId}-${category}`} type="button" role="tab" tabIndex={activeCategory === category ? 0 : -1} aria-selected={activeCategory === category} aria-controls={`${pickerId}-panel`} onClick={() => selectCategory(category)} onKeyDown={event => handleCategoryKeyDown(event, category)}><span>{CATEGORY_LABELS[category]}</span><small>{categoryCounts[category]}</small></button>)}
      </div>
      <div ref={groupsRef} className="manufacturing-target-groups" id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={search.trim() ? undefined : `${pickerId}-${activeCategory}`} aria-label={search.trim() ? '所有分类搜索结果' : undefined}>
        {visibleGroups.length ? visibleGroups.map(group => {
          const tabStop = group.recipes.find(item => item.productId === activeOptionId) || group.recipes.find(item => item.productId === selectedId) || group.recipes[0]
          return <section key={group.category} className="manufacturing-target-group" data-testid={`manufacturing-target-group-${group.category}`} aria-label={group.label}>
          <div className="manufacturing-target-group-heading"><strong>{group.label}</strong><span>{group.count}</span></div>
          <div className="manufacturing-target-options" role="listbox" aria-label={`${group.label}目标`} onKeyDown={handleOptionKeyDown}>
            {group.recipes.map(recipe => <button role="option" aria-selected={recipe.productId === selectedId} aria-label={recipe.name} key={recipe.productId} type="button" tabIndex={recipe.productId === tabStop.productId ? 0 : -1} onFocus={() => setActiveOptionId(recipe.productId)} onClick={() => chooseTarget(recipe.productId)}><MarketItemIcon itemId={recipe.productId} size={28} priority={recipe.productId === selectedId ? 'high' : undefined} /><span className="manufacturing-target-copy"><strong>{recipe.name}</strong><small>产出 {recipe.outputNum} 件</small></span>{recipe.productId === selectedId ? <Check size={15} aria-hidden="true" /> : null}</button>)}
          </div>
        </section>
        }) : <p className="manufacturing-empty">没有匹配目标</p>}
      </div>
    </div>
  </div>, document.body) : null

  return <>
    <div ref={pickerRef} className={`manufacturing-target-picker${open ? ' is-open' : ''}`} aria-label="制造目标">
      <div className="manufacturing-target-label"><h3>制造目标</h3><button type="button" className="manufacturing-change-target" aria-label="切换制造目标" aria-haspopup="dialog" aria-expanded={open} onClick={openPicker}>切换目标</button></div>
      {selected ? <button type="button" className="manufacturing-selected-target" aria-label={`当前制造目标：${selected.name}`} aria-haspopup="dialog" aria-expanded={open} onClick={openPicker}><MarketItemIcon itemId={selected.productId} size={40} priority="high" /><span className="manufacturing-target-copy"><strong>{selected.name}</strong><small>{CATEGORY_LABELS[selected.category]}配方 · 产出 {selected.outputNum} 件</small></span><ChevronDown size={15} aria-hidden="true" /></button> : null}
    </div>
    {targetDialog}
  </>
}

function SettingField({ label, children }) {
  return <label className="manufacturing-setting"><span>{label}</span>{children}</label>
}

function EfficiencyRateField({ value, onChange }) {
  const belowFloor = value.trim() !== '' && Number(value) < MIN_MATERIAL_EFFICIENCY
  return <label className="manufacturing-efficiency-field"><span><strong>制造材料效率</strong><small>最终值 · 全链应用</small></span><div className="manufacturing-efficiency-input"><input aria-label="制造效率百分比" aria-describedby="manufacturing-efficiency-help" type="number" min={MIN_MATERIAL_EFFICIENCY} step="0.01" inputMode="decimal" placeholder={String(DEFAULT_MATERIAL_EFFICIENCY)} value={value} onChange={event => onChange(event.target.value)} /><b>%</b></div><em id="manufacturing-efficiency-help">{belowFloor ? '低于客户端下限，按 75% 计算。' : `生效 ${resolveMaterialEfficiency(value)}% · 数值越低，材料越省。`}</em></label>
}

function BlueprintCostField({ value, error, onChange }) {
  const errorMessage = error === 'too_large'
    ? '蓝图价格不得超过 999,999,999,999.99 ISK；请填写非负普通金额，最多 2 位小数。'
    : '请输入非负普通金额，最多 2 位小数，上限 999,999,999,999.99 ISK。'
  return <div className="manufacturing-blueprint-field">
    <label htmlFor="manufacturing-blueprint-price">蓝图价格（本次合计）</label>
    <div className={`manufacturing-efficiency-input manufacturing-blueprint-input${error ? ' is-invalid' : ''}`}>
      <input id="manufacturing-blueprint-price" aria-label="蓝图价格（本次合计）" aria-invalid={Boolean(error)} aria-describedby={`manufacturing-blueprint-price-help${error ? ' manufacturing-blueprint-price-error' : ''}`} type="text" inputMode="decimal" maxLength={64} placeholder="0" value={value} onChange={event => onChange(event.target.value)} />
      <b aria-hidden="true">ISK</b>
    </div>
    <small id="manufacturing-blueprint-price-help" className="manufacturing-blueprint-help">留空按 0 ISK；当前方案只计一次。多个蓝图请填合计，不随制造数量重复计费。</small>
    {error ? <p id="manufacturing-blueprint-price-error" className="manufacturing-inline-error" role="status">{errorMessage}</p> : null}
  </div>
}

function MobileCostOverview({ summary }) {
  const blueprintCostError = summary.blueprintCostError
  return <section className="manufacturing-mobile-overview" aria-label="当前方案成本摘要" data-testid="manufacturing-mobile-overview">
    <div><span>{summary.complete ? '当前方案总成本' : '已覆盖小计'}</span><span className={`manufacturing-complete-state ${summary.complete ? 'is-complete' : 'is-partial'}`}>{blueprintCostError ? '检查蓝图价格' : summary.complete ? '可计算' : `待补 ${summary.missing.length} 项`}</span></div>
    <strong>{formatIsk(summary.complete ? summary.total : summary.coveredSubtotal)}</strong>
    <small>{blueprintCostError ? '蓝图价格待修正 · 此处仅为已覆盖的材料与制造费用' : '含市场材料、制造费用与蓝图费用 · 蓝图按本次合计计入一次'}</small>
    <QuoteAgeWarning summary={summary} />
  </section>
}

function SummaryPanel({ summary, selectedNode, quote, quoteNow, manualPrice, onManualPrice, onRefreshQuotes, quoteLoading, quoteError }) {
  const complete = summary?.complete
  const blueprintCostError = summary.blueprintCostError
  const selectedPurchase = selectedNode?.mode === 'buy'
  const resolvedQuote = resolveManufacturingQuote(quote, { now: quoteNow })
  const manualPriceError = resolveManualPurchasePrice(manualPrice).error
  return (
    <aside className="manufacturing-summary" data-testid="manufacturing-cost-rail">
       <div className="manufacturing-summary-heading"><h2>成本概览</h2><span className={`manufacturing-complete-state ${complete ? 'is-complete' : 'is-partial'}`}>{blueprintCostError ? '检查蓝图价格' : complete ? '可计算' : '待补报价'}</span></div>
      <div className="manufacturing-total-card">
        <span>{complete ? '总成本' : '已覆盖小计'}</span>
        <strong>{formatIsk(complete ? summary.total : summary.coveredSubtotal)}</strong>
        <b className="manufacturing-total-compact" data-testid="manufacturing-total-compact">{formatCompactIsk(complete ? summary.total : summary.coveredSubtotal)}</b>
        <small>{blueprintCostError ? '蓝图价格待修正；这里只显示已覆盖的材料与制造费用。' : complete ? '当前方案所有购买项均有价格' : `缺少 ${summary.missing.length} 项购买价格`}</small>
      </div>
      <QuoteAgeWarning summary={summary} />
      <dl className="manufacturing-cost-breakdown">
        <div><dt>市场材料</dt><dd>{formatIsk(summary.materialSubtotal)}</dd></div>
        <div><dt>制造费用</dt><dd>{formatIsk(summary.manufacturingFee)}</dd></div>
        <div><dt>蓝图费用</dt><dd>{blueprintCostError ? '待修正' : formatIsk(summary.blueprintCost)}</dd></div>
      </dl>
      <div className="manufacturing-formula-note"><Settings2 size={15} aria-hidden="true" /><span>材料效率 {summary.materialEfficiencyPercent}% 已应用</span></div>
      <p className="manufacturing-price-help">材料按客户端逐批取整；制造费用与时间暂按基础配方估算。</p>
      {summary.missing.length > 0 ? <div className="manufacturing-missing" role="status"><strong>尚未计入</strong><span>{summary.missing.slice(0, 3).map(entry => `${entry.name}（${formatMissingMaterialReason(entry.reason)}）`).join('、')}{summary.missing.length > 3 ? ` 等 ${summary.missing.length} 项` : ''}</span></div> : null}
      <section className="manufacturing-price-editor" aria-label="方案价格编辑">
        <div className="manufacturing-price-editor-heading"><div><span className="eyebrow">节点报价</span><h3>{selectedNode?.name || '选择购买节点'}</h3></div>{selectedPurchase ? <span className="manufacturing-route-pill is-buy">购买</span> : selectedNode ? <span className="manufacturing-route-pill is-make">自造</span> : null}</div>
        {selectedPurchase ? <>
          <div className="manufacturing-market-reference"><span>市场参考价</span><strong>{formatIsk(resolvedQuote.price)}</strong><small>{quoteState(resolvedQuote.status)}{resolvedQuote.observedAt ? <> · 采集时间：<time dateTime={resolvedQuote.observedAt}>{formatManufacturingObservationTime(resolvedQuote.observedAt)}</time></> : resolvedQuote.price && resolvedQuote.status !== 'unknown' ? ' · 采集时间未知' : null}</small></div>
          <label className="manufacturing-manual-price"><span>方案手填单价 {manualPrice ? <em className="manufacturing-manual-badge">方案内手填</em> : null}</span><div><input aria-label="方案手填单价" inputMode="decimal" maxLength={64} aria-invalid={Boolean(manualPriceError)} aria-describedby="manufacturing-manual-price-help" value={manualPrice ?? ''} onChange={event => onManualPrice(event.target.value)} placeholder="留空使用市场参考价" /><span>ISK</span></div></label>
          <p id="manufacturing-manual-price-help" className={manualPriceError ? 'manufacturing-inline-error' : 'manufacturing-price-help'}>{manualPriceError ? '请输入非负普通十进制单价，不支持指数；最多 64 个字符。清空可恢复市场价。' : '仅保存到当前方案，不会修改公共行情。'}</p>
        </> : <p className="manufacturing-price-help">{selectedNode ? '该节点当前为自造，不需要单独购买报价。切换为购买后可设置本方案单价。' : '点击制造链中的节点，可查看市场参考价并设置本方案的购买单价。'}</p>}
      </section>
      <button className="manufacturing-refresh-button" type="button" onClick={onRefreshQuotes} disabled={quoteLoading}><RefreshCw size={15} className={quoteLoading ? 'is-spinning' : ''} />{quoteLoading ? '正在读取行情' : '刷新购买项行情'}</button>
      <p className="manufacturing-price-help">读取后台已采集行情，不触发实时采集；页面每 5 分钟重新检查存量报价。</p>
      {quoteError ? <p className="manufacturing-inline-error" role="status">{quoteError}</p> : null}
    </aside>
  )
}

export default function ManufacturingEstimatorPage() {
  const location = useLocation()
  const manufacturingPageRef = useRef(null)
  const headingRef = useRef(null)
  const navigationRef = useRef(null)
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [overrides, setOverrides] = useState({})
  const [purchasePrices, setPurchasePrices] = useState({})
  const [marketQuotes, setMarketQuotes] = useState({})
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [quoteNow, setQuoteNow] = useState(() => Date.now())
  const quoteChecksRef = useRef({})
  const quoteRequestRef = useRef({ generation: 0, controller: null })
  const quoteScopeRef = useRef('')
  const [expandedNodes, setExpandedNodes] = useState(() => new Set(['0']))
  const [routeActionMessage, setRouteActionMessage] = useState('')

  const loadCatalog = useCallback(async () => {
    setCatalogError('')
    try {
      const response = await fetch('/industry/manufacturing-scope.json', { cache: 'no-store' })
      if (!response.ok) throw new Error(`catalog ${response.status}`)
      const loaded = loadManufacturingCatalog(await response.json())
      setCatalog(loaded)
      setSelectedId(previous => previous && loaded.byId.has(previous) ? previous : loaded.recipes[0]?.productId || '')
    } catch (error) {
      setCatalogError('制造目录暂时无法加载，请稍后重试。')
    }
  }, [])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  useEffect(() => {
    setExpandedNodes(new Set(['0']))
  }, [selectedId])

  const plan = useMemo(() => {
    if (!catalog || !selectedId) return null
    return createManufacturingPlan(catalog, { targetId: selectedId, quantity, overrides, purchasePrices, marketQuotes, settings: { ...settings, now: quoteNow } })
  }, [catalog, selectedId, quantity, overrides, purchasePrices, marketQuotes, settings, quoteNow])
  const summary = useMemo(() => plan ? summarizeManufacturingPlan(catalog, plan) : null, [catalog, plan])
  const catalogReady = Boolean(catalog && summary)
  useEffect(() => {
    if (!catalogReady) return undefined
    const navigation = `${location.key}:${location.hash}`
    if (navigationRef.current === navigation) return undefined
    const purchasing = location.hash === '#manufacturing-purchase-list'
    const returningToEstimate = !location.hash && navigationRef.current !== null
    if (!purchasing && !returningToEstimate) {
      navigationRef.current = navigation
      return undefined
    }
    // A rapid history reversal can cancel this frame. Record the navigation
    // now so the next destination is still handled even when its key repeats.
    navigationRef.current = navigation
    const frame = window.requestAnimationFrame(() => {
      const main = manufacturingPageRef.current
      const destination = purchasing ? document.getElementById('manufacturing-purchase-list') : headingRef.current
      if (!main || !destination) return
      if (window.matchMedia('(min-width: 1100px)').matches) {
        // Keep the journey and hidden shell ancestors in place on desktop.
        const margin = parseFloat(window.getComputedStyle(destination).scrollMarginTop) || 0
        const top = purchasing ? main.scrollTop + destination.getBoundingClientRect().top - main.getBoundingClientRect().top - main.clientTop - margin : 0
        main.scrollTo({ top, behavior: 'auto' })
      } else if (purchasing) {
        destination.scrollIntoView({ block: 'start', behavior: 'auto' })
      } else {
        // Stacked layouts may scroll the page frame rather than the window.
        main.closest('.site-frame')?.scrollTo({ top: 0, behavior: 'auto' })
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
      destination.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [catalogReady, location.hash, location.key])
  const selectedNode = useMemo(() => {
    if (!summary || !selectedNodeId) return null
    const stack = [summary.tree]
    while (stack.length) {
      const node = stack.pop()
      if (node.itemId === selectedNodeId) return node
      stack.push(...(node.children || []))
    }
    return null
  }, [summary, selectedNodeId])
  const purchaseIds = useMemo(() => {
    if (!summary) return []
    return [...new Set([
      ...summary.purchases.map(item => item.itemId),
      ...summary.missing.map(item => item.itemId),
    ])]
  }, [summary])
  // Quantity changes rebuild the summary tree, so keep the quote dependency
  // stable when the set of purchasable item ids did not actually change.
  const purchaseIdsKey = useMemo(() => [...purchaseIds].sort().join(','), [purchaseIds])
  const stablePurchaseIds = useMemo(() => purchaseIdsKey ? purchaseIdsKey.split(',') : [], [purchaseIdsKey])
  const quoteScope = `${selectedId}:${purchaseIdsKey}`
  quoteScopeRef.current = quoteScope

  const cancelQuoteRequest = useCallback(() => {
    quoteRequestRef.current.controller?.abort()
    quoteRequestRef.current = { generation: quoteRequestRef.current.generation + 1, controller: null }
  }, [])

  const refreshQuotes = useCallback(async (ids = stablePurchaseIds) => {
    if (!ids.length) return
    cancelQuoteRequest()
    const controller = new AbortController()
    const generation = quoteRequestRef.current.generation
    quoteRequestRef.current.controller = controller
    const isCurrent = () => !controller.signal.aborted && quoteRequestRef.current.generation === generation && quoteScopeRef.current === quoteScope
    setQuoteLoading(true)
    setQuoteError('')
    try {
      const result = await fetchManufacturingQuotes(ids, { signal: controller.signal })
      if (!isCurrent()) return
      for (const id of ids) quoteChecksRef.current[id] = Date.now()
      setMarketQuotes(previous => isCurrent() ? mergeManufacturingQuoteSnapshots(previous, result) : previous)
      setQuoteNow(Date.now())
    } catch (error) {
      if (isCurrent()) {
        // Failed automatic checks wait for the normal TTL. Cancelled requests
        // never count as a completed check for a subsequently selected target.
        for (const id of ids) quoteChecksRef.current[id] = Date.now()
        setQuoteError('市场参考价刷新失败；已保留现有报价。仍可手动填写方案价格。')
      }
    } finally {
      if (isCurrent()) {
        quoteRequestRef.current.controller = null
        setQuoteLoading(false)
      }
    }
  }, [stablePurchaseIds, quoteScope, cancelQuoteRequest])

  useEffect(() => {
    setQuoteLoading(false)
    setQuoteError('')
    const due = manufacturingQuoteIdsDue(stablePurchaseIds, quoteChecksRef.current)
    if (due.length) refreshQuotes(due)
    return cancelQuoteRequest
  }, [stablePurchaseIds, refreshQuotes, cancelQuoteRequest])

  useEffect(() => {
    const recheck = () => {
      const now = Date.now()
      setQuoteNow(now)
      if (document.visibilityState === 'hidden' || quoteRequestRef.current.controller) return
      const due = manufacturingQuoteIdsDue(stablePurchaseIds, quoteChecksRef.current, now)
      if (due.length) refreshQuotes(due)
    }
    const interval = window.setInterval(recheck, MANUFACTURING_QUOTE_AGE_TICK_MS)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [stablePurchaseIds, refreshQuotes])

  const recipeIds = useMemo(() => catalog?.recipes.map(recipe => recipe.productId) || [], [catalog])

  const onModeChange = (itemId, mode) => {
    setSelectedNodeId(itemId)
    setOverrides(previous => ({ ...previous, [itemId]: mode }))
    setRouteActionMessage(`${catalog.items.get(itemId)?.name || catalog.byId.get(itemId)?.name || '节点'}：已切换为${mode === 'buy' ? '购买' : '自造'}`)
  }

  const applyRoutePolicy = policy => {
    if (!selectedId || !recipeIds.length) return
    const nextOverrides = Object.fromEntries(recipeIds.map(itemId => {
      if (policy === 'buy-intermediates') return [itemId, itemId === selectedId ? 'make' : 'buy']
      if (policy === 'make-all') return [itemId, 'make']
      return [itemId, undefined]
    }).filter(([, mode]) => mode !== undefined))
    setOverrides(nextOverrides)
    setSelectedNodeId('')
    setRouteActionMessage(policy === 'make-all' ? '已应用：全部自造（包含所有中间件）' : policy === 'buy-intermediates' ? '已应用：购买中间件（根目标保持自造）' : '已恢复默认路线（全部节点按配方自造）')
  }

  const handleTargetSelect = id => {
    cancelQuoteRequest()
    setQuoteLoading(false)
    setQuoteError('')
    setSelectedId(id)
    setSettings(current => ({ ...current, blueprintCost: '' }))
    setOverrides({})
    setPurchasePrices({})
    setSelectedNodeId('')
    setSearch('')
    setExpandedNodes(new Set(['0']))
    setRouteActionMessage('')
  }
  const updateManualPrice = value => {
    if (!selectedNodeId) return
    setPurchasePrices(previous => ({ ...previous, [selectedNodeId]: value }))
  }
  const updatePurchasePrice = (itemId, value) => {
    setPurchasePrices(previous => ({ ...previous, [itemId]: value }))
  }
  const selectedQuote = selectedNodeId ? marketQuotes[selectedNodeId] : null

  const treePaths = useMemo(() => {
    if (!summary?.tree) return []
    const paths = []
    const visit = (node, path) => {
      paths.push(path)
      node.children?.forEach((child, index) => visit(child, `${path}.${index}`))
    }
    visit(summary.tree, '0')
    return paths
  }, [summary])

  const toggleExpanded = path => setExpandedNodes(previous => {
    const next = new Set(previous)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const expandAll = () => setExpandedNodes(new Set(treePaths))
  const collapseAll = () => setExpandedNodes(new Set())

  if (catalogError) return <main className="manufacturing-page"><div className="manufacturing-error"><Factory size={30} /><h1>制造估价</h1><p>{catalogError}</p><button type="button" onClick={loadCatalog}>重新加载目录</button></div></main>
  if (!catalog || !summary) return <main className="manufacturing-page"><div className="manufacturing-loading"><Factory size={24} /><span>正在加载制造目录…</span></div></main>
  const selectedRecipe = catalog.byId.get(selectedId)

  return (
    <main ref={manufacturingPageRef} className="manufacturing-page manufacturing-page--terminal">
      <header className="manufacturing-page-header" data-testid="manufacturing-terminal-header">
        <div className="manufacturing-terminal-brand"><span className="eyebrow">EVEM INDUSTRY / COST PLANNER</span><h1 ref={headingRef} tabIndex={-1}>制造估价</h1><p>拆解制造链，按节点选择自造或购买。</p></div>
        <div className="manufacturing-header-meta"><span><Boxes size={16} />{catalog.counts.all} 个配方</span><span><Factory size={16} />舰船 · 材料 · 建筑</span></div>
      </header>
      <section className="manufacturing-workspace">
        <aside className="manufacturing-controls" data-testid="manufacturing-config-rail">
          <div className="manufacturing-panel-heading"><h2>方案设置</h2><span className="manufacturing-save-state">本地方案</span></div>
          <TargetPicker recipes={catalog.recipes} selectedId={selectedId} search={search} onSearch={setSearch} onSelect={handleTargetSelect} />
          <SettingField label="制造数量"><div className="manufacturing-quantity-control"><button type="button" aria-label="减少制造数量" onClick={() => setQuantity(value => Math.max(1, value - 1))}><Minus size={15} /></button><input data-testid="manufacturing-quantity-value" aria-label="制造数量" type="number" min="1" value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value) || 1))} /><button type="button" aria-label="增加制造数量" onClick={() => setQuantity(value => value + 1)}><Plus size={15} /></button></div></SettingField>
          <BlueprintCostField value={settings.blueprintCost} error={summary.blueprintCostError} onChange={value => setSettings(current => ({ ...current, blueprintCost: value }))} />
          <fieldset className="manufacturing-settings" aria-label="技能与效率">
            <legend>技能与效率</legend>
            <EfficiencyRateField value={settings.materialEfficiencyPercent} onChange={value => setSettings(current => ({ ...current, materialEfficiencyPercent: value }))} />
            <p className="manufacturing-price-help">填写游戏中含技能、设施加成的最终值；初始 150%，最低 75%。当前统一用于所有自造层级。</p>
          </fieldset>
        </aside>
        <MobileCostOverview summary={summary} />
        <section className="manufacturing-tree-panel" data-testid="manufacturing-route-workspace" aria-label="制造链路">
           <div className="manufacturing-panel-heading manufacturing-tree-heading"><div><span className="eyebrow">制造路线</span><h2>{selectedRecipe.name}</h2></div><div className="manufacturing-tree-actions"><div className="manufacturing-tree-legend"><span><i className="dot dot-make" />自造</span><span><i className="dot dot-buy" />购买</span></div><div className="manufacturing-tree-expand-actions"><button type="button" aria-label="展开全部层级" onClick={expandAll}>展开全部</button><button type="button" aria-label="收起全部层级" onClick={collapseAll}>收起全部</button></div></div></div>
          <div className="manufacturing-route-policy" aria-label="批量路线策略"><span>批量策略</span><button type="button" aria-label="全部自造" onClick={() => applyRoutePolicy('make-all')}>全部自造</button><button type="button" aria-label="购买中间件" onClick={() => applyRoutePolicy('buy-intermediates')}>购买中间件</button><button type="button" aria-label="恢复默认" onClick={() => applyRoutePolicy('default')}>恢复默认</button></div>
          {routeActionMessage ? <p className="manufacturing-route-action-message" role="status" aria-live="polite">{routeActionMessage}</p> : null}
          <p className="manufacturing-tree-hint">点击节点查看价格；将中间产物切换为购买后，其下游制造会从本方案中移除。</p>
          <ul className="manufacturing-tree" role="tree" aria-label="制造链路"><TreeNode node={summary.tree} catalog={catalog} onModeChange={onModeChange} selectedId={selectedNodeId} onSelect={setSelectedNodeId} path="0" expandedNodes={expandedNodes} onToggleExpanded={toggleExpanded} /></ul>
          <div className="manufacturing-route-footer"><span>制造时间</span><strong>{Math.ceil((summary.manufacturingTime || 0) / 3600)} 小时</strong><span>购买项</span><strong>{purchaseIds.length} 类</strong></div>
        </section>
        <SummaryPanel summary={summary} selectedNode={selectedNode} quote={selectedQuote} quoteNow={quoteNow} manualPrice={selectedNodeId ? purchasePrices[selectedNodeId] || '' : ''} onManualPrice={updateManualPrice} onRefreshQuotes={() => refreshQuotes()} quoteLoading={quoteLoading} quoteError={quoteError} />
      </section>
      <ManufacturingPurchaseList summary={summary} targetName={selectedRecipe.name} marketQuotes={marketQuotes} quoteNow={quoteNow} purchasePrices={purchasePrices} onManualPrice={updatePurchasePrice} onRefreshQuotes={() => refreshQuotes()} quoteLoading={quoteLoading} />
    </main>
  )
}

