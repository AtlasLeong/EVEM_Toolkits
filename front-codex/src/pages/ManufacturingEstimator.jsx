import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, Factory, Minus, Plus, RefreshCw, Search, Settings2, ShoppingCart, Wrench } from 'lucide-react'
import { loadManufacturingCatalog } from '../utils/manufacturingCatalog'
import { createManufacturingPlan, summarizeManufacturingPlan } from '../utils/manufacturingPlan'
import { fetchManufacturingQuotes } from '../services/apiManufacturing'
import MarketItemIcon from '../components/MarketItemIcon'
import '../styles/manufacturing.css'

const CATEGORY_LABELS = { ship: '舰船', material: '材料', building: '建筑' }
const DEFAULT_SETTINGS = { manufacturingSkill: '5', researchSkill: '5', efficiencySkill: '4', building: '标准工厂', blueprintOwned: true }

function formatIsk(value) {
  if (value === null || value === undefined || value === '') return '待补价格'
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} ISK`
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)} ISK`
}

function formatQuantity(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value || 0)
}

function quotePrice(quote) {
  if (!quote) return null
  return quote.best_sell ?? quote.bestSell ?? quote.lowestSell ?? quote.price ?? null
}

function quoteState(quote) {
  if (!quote || quote.status === 'absent' || quote.status === 'uncollected') return '尚未采集'
  if (quote.status === 'stale' || quote.status === 'expired') return '报价已过期'
  if (quote.status === 'empty') return '暂无挂单'
  return quotePrice(quote) ? '最新观测' : '尚未采集'
}

function TreeNode({ node, catalog, onToggle, selectedId, onSelect, path, expandedNodes, onToggleExpanded }) {
  const recipe = catalog.byId.get(node.itemId)
  const canRoute = Boolean(recipe)
  const buying = node.mode === 'buy'
  const selected = selectedId === node.itemId
  const hasChildren = node.children?.length > 0
  const expanded = expandedNodes.has(path)
  return (
    <li className={`manufacturing-tree-node manufacturing-tree-node--${node.kind}${selected ? ' is-selected' : ''}`} role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className="manufacturing-tree-row">
        <button type="button" className="manufacturing-tree-select" aria-label={`查看 ${node.name}`} onClick={() => onSelect(node.itemId)}>
          <MarketItemIcon itemId={node.itemId} size={34} className="manufacturing-tree-icon" />
          <span className="manufacturing-tree-copy">
            <strong>{node.name}</strong>
            <small>{formatQuantity(node.quantity)} 件 · {node.kind === 'recipe' && !buying ? `自造 · ${CATEGORY_LABELS[node.category] || '制造'}` : '购买'}</small>
          </span>
        </button>
        <span className={`manufacturing-route-pill ${buying ? 'is-buy' : 'is-make'}`}>{buying ? '购买' : '自造'}</span>
        {canRoute ? (
          <button
            type="button"
            className="manufacturing-route-toggle"
            aria-label={`${buying ? '切换为自造' : '切换为购买'} ${node.name}`}
            onClick={() => onToggle(node.itemId)}
          >
            {buying ? <Wrench size={14} aria-hidden="true" /> : <ShoppingCart size={14} aria-hidden="true" />}
            {buying ? '自造' : '购买'}
          </button>
        ) : null}
        {hasChildren ? (
          <button type="button" className="manufacturing-tree-expand" aria-label={`${expanded ? '收起' : '展开'} ${node.name}层级`} aria-expanded={expanded} onClick={() => onToggleExpanded(path)}>
            {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          </button>
        ) : <span className="manufacturing-tree-chevron-spacer" />}
      </div>
      {hasChildren && expanded ? (
        <ul className="manufacturing-tree-children">
          {node.children.map((child, index) => <TreeNode key={`${path}.${index}`} node={child} catalog={catalog} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} path={`${path}.${index}`} expandedNodes={expandedNodes} onToggleExpanded={onToggleExpanded} />)}
        </ul>
      ) : null}
    </li>
  )
}

function TargetPicker({ recipes, selectedId, search, onSearch, onSelect, onFocusSearch, inputRef }) {
  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase()
    return recipes.filter(recipe => !text || recipe.name.toLowerCase().includes(text) || recipe.productId.includes(text)).slice(0, 12)
  }, [recipes, search])
  const selected = recipes.find(recipe => recipe.productId === selectedId)
  return (
    <div className="manufacturing-target-picker" aria-label="制造目标">
      <div className="manufacturing-target-label"><h3>制造目标</h3><button type="button" className="manufacturing-change-target" aria-label="切换制造目标" onClick={onFocusSearch}>切换目标</button></div>
      <div className="manufacturing-search-field">
        <Search size={17} aria-hidden="true" />
        <input ref={inputRef} id="manufacturing-target-search" aria-label="搜索制造目标" role="searchbox" value={search} onChange={event => onSearch(event.target.value)} placeholder={selected?.name || '搜索舰船、材料或建筑'} />
      </div>
      {search.trim() ? (
        <div className="manufacturing-target-options" role="listbox" aria-label="制造目标结果">
          {filtered.length ? filtered.map(recipe => (
            <button role="option" aria-selected={recipe.productId === selectedId} key={recipe.productId} type="button" onClick={() => onSelect(recipe.productId)}>
              <span>{recipe.name}</span><small>{CATEGORY_LABELS[recipe.category]} · {recipe.productId}</small>
            </button>
          )) : <p className="manufacturing-empty">没有匹配目标</p>}
        </div>
      ) : null}
      {selected ? <div className="manufacturing-selected-target"><MarketItemIcon itemId={selected.productId} size={40} /><span><strong>{selected.name}</strong><small>{CATEGORY_LABELS[selected.category]}配方 · 产出 {selected.outputNum} 件</small></span></div> : null}
    </div>
  )
}

function SettingField({ label, children }) {
  return <label className="manufacturing-setting"><span>{label}</span>{children}</label>
}

function LevelControl({ label, value, onChange, options = ['3', '4', '5'] }) {
  return <div className="manufacturing-level-field"><span>{label}</span><div className="manufacturing-level-control" role="group" aria-label={label}>{options.map(option => <button key={option} type="button" className={String(value) === option ? 'is-active' : ''} aria-pressed={String(value) === option} onClick={() => onChange(option)}>{option}</button>)}</div></div>
}

function SummaryPanel({ summary, selectedNode, quote, manualPrice, onManualPrice, onRefreshQuotes, quoteLoading }) {
  const complete = summary?.complete
  const selectedPurchase = selectedNode?.mode === 'buy'
  return (
    <aside className="manufacturing-summary" data-testid="manufacturing-summary">
      <div className="manufacturing-summary-heading"><div><span className="eyebrow">COST SUMMARY</span><h2>成本概览</h2></div><span className={`manufacturing-complete-state ${complete ? 'is-complete' : 'is-partial'}`}>{complete ? '可计算' : '待补报价'}</span></div>
      <div className="manufacturing-total-card">
        <span>{complete ? '总成本' : '已覆盖小计'}</span>
        <strong>{formatIsk(complete ? summary.total : summary.coveredSubtotal)}</strong>
        <small>{complete ? '当前方案所有购买项均有价格' : `缺少 ${summary.missing.length} 项购买价格`}</small>
      </div>
      <dl className="manufacturing-cost-breakdown">
        <div><dt>市场材料</dt><dd>{formatIsk(summary.materialSubtotal)}</dd></div>
        <div><dt>制造费用</dt><dd>{formatIsk(summary.manufacturingFee)}</dd></div>
        <div><dt>蓝图费用</dt><dd>{formatIsk(summary.blueprintCost)}</dd></div>
      </dl>
      <div className="manufacturing-formula-note"><Settings2 size={15} aria-hidden="true" /><span>效率公式待核实</span></div>
      {summary.missing.length > 0 ? <div className="manufacturing-missing" role="status"><strong>尚未计入</strong><span>{summary.missing.slice(0, 3).map(entry => `${entry.name}（${entry.reason}）`).join('、')}{summary.missing.length > 3 ? ` 等 ${summary.missing.length} 项` : ''}</span></div> : null}
      <section className="manufacturing-price-editor" aria-label="方案价格编辑">
        <div className="manufacturing-price-editor-heading"><div><span className="eyebrow">PLAN OVERRIDE</span><h3>{selectedNode?.name || '选择购买节点'}</h3></div>{selectedPurchase ? <span className="manufacturing-route-pill is-buy">购买</span> : selectedNode ? <span className="manufacturing-route-pill is-make">自造</span> : null}</div>
        {selectedPurchase ? <>
          <div className="manufacturing-market-reference"><span>市场参考价</span><strong>{formatIsk(quotePrice(quote))}</strong><small>{quoteState(quote)}{quote?.observed_at ? ` · ${new Date(quote.observed_at).toLocaleString('zh-CN', { hour12: false })}` : ''}</small></div>
          <label className="manufacturing-manual-price"><span>方案手填单价 {manualPrice ? <em className="manufacturing-manual-badge">方案内手填</em> : null}</span><div><input aria-label="方案手填单价" inputMode="decimal" value={manualPrice ?? ''} onChange={event => onManualPrice(event.target.value)} placeholder="留空使用市场参考价" /><span>ISK</span></div></label>
          <p className="manufacturing-price-help">仅保存到当前方案，不会修改公共行情。</p>
        </> : <p className="manufacturing-price-help">{selectedNode ? '该节点当前为自造，不需要单独购买报价。切换为购买后可设置本方案单价。' : '点击制造链中的节点，可查看市场参考价并设置本方案的购买单价。'}</p>}
      </section>
      <button className="manufacturing-refresh-button" type="button" onClick={onRefreshQuotes} disabled={quoteLoading}><RefreshCw size={15} className={quoteLoading ? 'is-spinning' : ''} />{quoteLoading ? '正在读取行情' : '刷新购买项行情'}</button>
    </aside>
  )
}

export default function ManufacturingEstimatorPage() {
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
  const [expandedNodes, setExpandedNodes] = useState(() => new Set(['0']))
  const searchRef = useRef(null)

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
    return createManufacturingPlan(catalog, { targetId: selectedId, quantity, overrides, purchasePrices, marketQuotes, settings: { ...settings, blueprintCost: settings.blueprintOwned ? 0 : 0 } })
  }, [catalog, selectedId, quantity, overrides, purchasePrices, marketQuotes, settings])
  const summary = useMemo(() => plan ? summarizeManufacturingPlan(catalog, plan) : null, [catalog, plan])
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

  const refreshQuotes = useCallback(async (ids = purchaseIds) => {
    if (!ids.length) return
    setQuoteLoading(true)
    setQuoteError('')
    try {
      const result = await fetchManufacturingQuotes(ids)
      setMarketQuotes(previous => ({ ...previous, ...result }))
    } catch (error) {
      setQuoteError('市场参考价暂时无法读取，仍可手动填写方案价格。')
    } finally {
      setQuoteLoading(false)
    }
  }, [purchaseIds])

  useEffect(() => {
    if (!purchaseIds.length) return
    const missing = purchaseIds.filter(itemId => !Object.prototype.hasOwnProperty.call(marketQuotes, itemId))
    if (missing.length) refreshQuotes(missing)
  }, [purchaseIds, marketQuotes, refreshQuotes])

  const toggleRoute = itemId => {
    setSelectedNodeId(itemId)
    setOverrides(previous => ({ ...previous, [itemId]: previous[itemId] === 'buy' ? 'make' : 'buy' }))
  }
  const updateManualPrice = value => {
    if (!selectedNodeId) return
    setPurchasePrices(previous => ({ ...previous, [selectedNodeId]: value }))
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
    <main className="manufacturing-page">
      <header className="manufacturing-page-header"><div><span className="eyebrow">EVEM INDUSTRY / COST PLANNER</span><h1>制造估价</h1><p>拆解制造链，按节点选择自造或购买。</p></div><div className="manufacturing-header-meta"><span><Boxes size={16} />{catalog.counts.all} 个配方</span><span><Factory size={16} />舰船 · 材料 · 建筑</span></div></header>
      <section className="manufacturing-workspace">
        <aside className="manufacturing-controls">
          <div className="manufacturing-panel-heading"><div><span className="eyebrow">PLAN SETUP</span><h2>方案设置</h2></div><span className="manufacturing-save-state">本地方案</span></div>
          <TargetPicker recipes={catalog.recipes} selectedId={selectedId} search={search} onSearch={setSearch} inputRef={searchRef} onFocusSearch={() => { setSearch(''); searchRef.current?.focus() }} onSelect={id => { setSelectedId(id); setSearch(''); setSelectedNodeId(''); setExpandedNodes(new Set(['0'])) }} />
          <SettingField label="制造数量"><div className="manufacturing-quantity-control"><button type="button" aria-label="减少制造数量" onClick={() => setQuantity(value => Math.max(1, value - 1))}><Minus size={15} /></button><input aria-label="制造数量" type="number" min="1" value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value) || 1))} /><button type="button" aria-label="增加制造数量" onClick={() => setQuantity(value => value + 1)}><Plus size={15} /></button></div></SettingField>
          <fieldset className="manufacturing-settings" aria-label="技能与效率"><legend>技能与效率</legend><div className="manufacturing-level-grid"><LevelControl label="制造" value={settings.manufacturingSkill} onChange={value => setSettings(current => ({ ...current, manufacturingSkill: value }))} /><LevelControl label="研究" value={settings.researchSkill} onChange={value => setSettings(current => ({ ...current, researchSkill: value }))} /><LevelControl label="效率" value={settings.efficiencySkill} onChange={value => setSettings(current => ({ ...current, efficiencySkill: value }))} /></div><label className="manufacturing-building-field"><span>生产建筑</span><select aria-label="生产建筑" value={settings.building} onChange={event => setSettings(value => ({ ...value, building: event.target.value }))}><option>标准工厂</option><option>高级工厂</option><option>旗舰工业设施</option></select></label></fieldset>
          <label className="manufacturing-blueprint-toggle"><input type="checkbox" checked={settings.blueprintOwned} onChange={event => setSettings(value => ({ ...value, blueprintOwned: event.target.checked }))} /><span>已拥有蓝图</span><small>蓝图费用暂不计入</small></label>
          <div className="manufacturing-formula-callout"><Settings2 size={16} /><div><strong>效率公式待核实</strong><span>技能、建筑与蓝图状态先保留在方案中，等待公式校准后再影响数值。</span></div></div>
        </aside>
        <section className="manufacturing-tree-panel" aria-label="制造链路">
          <div className="manufacturing-panel-heading manufacturing-tree-heading"><div><span className="eyebrow">MANUFACTURING ROUTE</span><h2>{selectedRecipe.name}</h2></div><div className="manufacturing-tree-actions"><div className="manufacturing-tree-legend"><span><i className="dot dot-make" />自造</span><span><i className="dot dot-buy" />购买</span></div><div className="manufacturing-tree-expand-actions"><button type="button" aria-label="展开全部层级" onClick={expandAll}>展开全部</button><button type="button" aria-label="收起全部层级" onClick={collapseAll}>收起全部</button></div></div></div>
          <p className="manufacturing-tree-hint">点击节点查看价格；将中间产物切换为购买后，其下游制造会从本方案中移除。</p>
          <ul className="manufacturing-tree" role="tree" aria-label="制造链路"><TreeNode node={summary.tree} catalog={catalog} onToggle={toggleRoute} selectedId={selectedNodeId} onSelect={setSelectedNodeId} path="0" expandedNodes={expandedNodes} onToggleExpanded={toggleExpanded} /></ul>
          {quoteError ? <p className="manufacturing-inline-error" role="status">{quoteError}</p> : null}
          <div className="manufacturing-route-footer"><span>制造时间</span><strong>{Math.ceil((summary.manufacturingTime || 0) / 3600)} 小时</strong><span>购买项</span><strong>{summary.purchases.length} 类</strong></div>
        </section>
        <SummaryPanel summary={summary} selectedNode={selectedNode} quote={selectedQuote} manualPrice={selectedNodeId ? purchasePrices[selectedNodeId] || '' : ''} onManualPrice={updateManualPrice} onRefreshQuotes={() => refreshQuotes()} quoteLoading={quoteLoading} />
      </section>
    </main>
  )
}

