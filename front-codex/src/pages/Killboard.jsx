import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, Copy, Database, Layers3, LoaderCircle, RefreshCw, Search, Swords, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { getKillReport, getKillboardStatus, listKillReports } from '../services/apiKillboard'
import { copyKillboardTag, corporationLabel, equipmentSlotLabel, formatKillboardName, groupEquipmentItems, itemImage, killboardCollectionLabel, killboardSecurityMeta, killboardSystemLabel, participantVisibilityNote, reportSourceNote, selectedReport, shouldShowKillboardLiveStatus, shipImage, visibleParticipantRows } from '../utils/killboardPresentation'
import KillParticipantRow from '../components/killboard/KillParticipantRow'
import GameItemImage from '../components/GameItemImage'
import { useResponsiveDisclosureFocus } from '../hooks/useResponsiveDisclosureFocus'
import '../styles/killboard.css'

export function formatKillIsk(value) {
  if (value === null || value === undefined || value === '') return '—'
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.\d+)?$/)
  if (!match) return String(value)
  const negative = match[1] === '-'
  const integer = BigInt(match[2])
  let unit = integer >= 100000000n ? '亿' : integer >= 10000n ? '万' : ''
  if (!unit) return `${negative ? '-' : ''}${integer.toString()}`
  let divisor = unit === '亿' ? 100000000n : 10000n
  let rounded = (integer * 100n + divisor / 2n) / divisor
  if (unit === '万' && rounded >= 1000000n) {
    unit = '亿'
    divisor = 100000000n
    rounded = (integer * 100n + divisor / 2n) / divisor
  }
  const major = rounded / 100n
  const fraction = rounded % 100n
  const suffix = fraction ? `.${String(fraction).padStart(2, '0').replace(/0+$/, '')}` : ''
  return `${negative ? '-' : ''}${major}${suffix}${unit}`
}

function exactIsk(value) {
  if (value === null || value === undefined || value === '') return '暂无估值'
  const [integer, fraction] = String(value).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}${fraction ? `.${fraction}` : ''} ISK`
}

export function formatKillboardTime(value, raw = '', source = '') {
  let candidate = value || raw
  if ((source === 'kill_api' || source.startsWith('kill_api_')) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(candidate)) candidate += 'Z'
  if (candidate) {
    const date = new Date(candidate)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  }
  return raw || '时间未知'
}

function classLabel(row) {
  return row?.ship_class_label || row?.ship_class_key || '舰船'
}

function itemStatusLabel(value) {
  return { dropped: '已掉落', destroyed: '已毁', mixed: '部分掉落', unknown: '状态未知' }[value] || '状态未知'
}

function itemHasDrop(row = {}) {
  return row.status === 'dropped' || row.status === 'mixed' || Number(row.quantity_dropped) > 0
}

function ReportRow({ report, active, onSelect }) {
  const security = killboardSecurityMeta(report)
  const shipName = formatKillboardName(report.ship_name) || '未知舰船'
  const systemName = killboardSystemLabel(report)
  return <button type="button" className={`kb-report-row${active ? ' is-active' : ''}`} onClick={() => onSelect(report.kill_id)} aria-current={active ? 'true' : undefined} aria-label={`${shipName}，${systemName}，${security.zoneLabel} ${security.valueLabel}`}>
    <span className="kb-report-row-top"><strong>{shipName}</strong><span className="kb-status-chip">{classLabel(report)}</span></span>
    <span className="kb-report-row-meta"><span>{report.victim_name || '未知目标'} · {systemName}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />{security.zoneLabel} {security.valueLabel}</span></span>
    <span className="kb-report-row-bottom"><time>{formatKillboardTime(report.kill_time_display, report.kill_time_raw, report.source)}</time><b title={exactIsk(report.isk_lost)}>{formatKillIsk(report.isk_lost)} ISK</b></span>
  </button>
}

function EmptyState({ title, children }) {
  return <div className="kb-empty"><Database size={28} aria-hidden="true" /><strong>{title}</strong>{children ? <p>{children}</p> : null}</div>
}

function VisualAsset({ src, kind = 'item', alt = '' }) {
  return <div className={`kb-asset kb-asset--${kind}`} aria-hidden={alt ? undefined : 'true'}>
    <GameItemImage src={src} alt={alt} missingLabel={kind === 'ship' ? '舰船图像待补' : '图像待补'} />
  </div>
}

function Participants({ report, hidden = false, compact = false, pending = false, unavailable = false }) {
  const rows = report?.participants || []
  const visibleRows = visibleParticipantRows(rows)
  const visibilityNote = participantVisibilityNote(rows)
  return <section className="kb-panel kb-participants-panel" id="kb-panel-people" role={compact ? 'tabpanel' : 'region'} aria-labelledby={compact ? 'kb-tab-people' : 'kb-heading-people'} hidden={hidden}>
    <div className="kb-panel-head"><div><span className="kb-eyebrow">COMBATANTS</span><h3 id="kb-heading-people">参战记录</h3></div><span className="kb-panel-count">{report?.participant_count ?? '—'} 条记录</span></div>
    {pending ? <EmptyState title="正在读取参战记录…" /> : unavailable ? <EmptyState title="参战详情未读取">当前仅有报告摘要，请刷新重试。</EmptyState> : visibleRows.length ? <><div className="kb-participant-list">{visibleRows.map((row, index) => <KillParticipantRow row={row} key={`${row.character_id || row.character_name || 'unknown'}-${index}`} />)}</div>{visibilityNote ? <p className="kb-participant-note">{visibilityNote}</p> : null}</> : <EmptyState title="暂无参战记录" />}
  </section>
}

function Equipment({ report, hidden = false, compact = false, pending = false, unavailable = false }) {
  const rows = report?.items || []
  const groups = useMemo(() => groupEquipmentItems(rows).map(group => ({
    ...group,
    dropItems: group.items.filter(itemHasDrop),
  })), [rows])
  const [activeGroup, setActiveGroup] = useState('all')
  const [dropOnly, setDropOnly] = useState(false)
  useEffect(() => { setActiveGroup('all'); setDropOnly(false) }, [report?.kill_id])
  const visibleGroups = groups.filter(group => activeGroup === 'all' || group.key === activeGroup)
    .map(group => ({ ...group, items: dropOnly ? group.dropItems : group.items }))
    .filter(group => group.items.length)
  const droppedCount = rows.filter(itemHasDrop).length
  return <section className="kb-panel kb-equipment-panel" id="kb-panel-equipment" role={compact ? 'tabpanel' : 'region'} aria-labelledby={compact ? 'kb-tab-equipment' : 'kb-heading-equipment'} hidden={hidden}>
    <div className="kb-panel-head"><div><span className="kb-eyebrow">SALVAGE / FITTING</span><h3 id="kb-heading-equipment">装备与掉落</h3></div><span className="kb-panel-count">{rows.length ? `${rows.length} 项` : '—'}</span></div>
    {pending ? <EmptyState title="正在读取装备记录…" /> : unavailable ? <EmptyState title="装备详情未读取">当前仅有报告摘要，请刷新重试。</EmptyState> : rows.length ? <>
      <div className="kb-equipment-controls">
        <div className="kb-slot-tabs" role="group" aria-label="装备槽位分类">
          <button type="button" aria-pressed={activeGroup === 'all'} className={activeGroup === 'all' ? 'is-active' : ''} onClick={() => setActiveGroup('all')}>全部 <b>{rows.length}</b></button>
          {groups.map(group => <button type="button" aria-pressed={activeGroup === group.key} key={group.key} disabled={!group.items.length} className={activeGroup === group.key ? 'is-active' : ''} onClick={() => setActiveGroup(group.key)}>{group.label} <b>{group.items.length}</b>{group.dropItems.length ? <em title={`${group.dropItems.length} 项已掉落`}>·{group.dropItems.length}</em> : null}</button>)}
        </div>
        <button type="button" className={`kb-drop-filter${dropOnly ? ' is-active' : ''}`} aria-label="只看已掉落装备" aria-pressed={dropOnly} onClick={() => setDropOnly(value => !value)}><span>已掉落</span><b>{droppedCount}</b></button>
      </div>
      <p className="kb-slot-hint"><Layers3 size={14} />蓝色标记为掉落；点击“已掉落”可快速筛选。</p>
      {visibleGroups.length ? <div className="kb-item-list">{visibleGroups.map(group => <section className="kb-equipment-group" data-slot={group.key} key={group.key} aria-label={`${group.label}装备`}>
        <div className="kb-equipment-group-head"><h4>{group.label}</h4><span>{group.items.length} 项{` · 掉落 ${group.dropItems.length} 项`}</span></div>
        <div className="kb-equipment-group-items">{group.items.map((row, index) => {
          const name = formatKillboardName(row.name) || '物品'
          return <div className={`kb-item kb-item--${row.status}`} key={`${row.type_id || 'unknown'}-${index}`}>
            <VisualAsset src={itemImage(row)} kind="item" />
            <div className="kb-item-main"><strong title={name}>{name}</strong><span>{equipmentSlotLabel(row.slot)}{row.quantity ? ` · ${row.quantity} 件` : ''}</span></div>
            <span className={`kb-item-status kb-item-status--${row.status}`}>{itemStatusLabel(row.status)}{row.quantity_dropped ? ` · ${row.quantity_dropped}` : ''}</span>
          </div>
        })}</div>
      </section>)}</div> : <EmptyState title="没有已掉落装备" />}
    </> : <EmptyState title="暂无装备记录" />}
  </section>
}

function LoadingReportHero() {
  return <section className="kb-hero kb-panel kb-hero-loading" aria-label="正在读取报告">
    <div className="kb-asset kb-asset--ship kb-skeleton" aria-hidden="true" />
    <div className="kb-hero-copy" aria-hidden="true"><span className="kb-skeleton kb-skeleton-line" /><span className="kb-skeleton kb-skeleton-title" /><span className="kb-skeleton kb-skeleton-line" /><span className="kb-skeleton kb-skeleton-block" /></div>
    <div className="kb-hero-value" aria-hidden="true"><span>估算损失</span><span className="kb-skeleton kb-skeleton-value" /><span className="kb-skeleton kb-skeleton-line" /><span className="kb-skeleton kb-skeleton-line" /></div>
  </section>
}

export default function KillboardPage() {
  const { killId } = useParams()
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(killId || null)
  const [selected, setSelected] = useState(null)
  const [filters, setFilters] = useState({ q: '' })
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [compactDetail, setCompactDetail] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 1099px)')?.matches))
  const [activePanel, setActivePanel] = useState('people')
  const [copyState, setCopyState] = useState('')
  const [indexExpanded, setIndexExpanded] = useState(false)
  const contentRef = useRef(null)
  const indexToggleRef = useRef(null)
  const indexContentRef = useRef(null)
  const revoked = useRef(false)
  const requests = useRef(new Set())
  const activeRequests = useRef(new Set())
  const copyRequest = useRef(0)

  useResponsiveDisclosureFocus({ mobileQuery: '(max-width: 760px)', toggleRef: indexToggleRef, contentRef: indexContentRef, setOpen: setIndexExpanded })

  function revokeAccess() {
    // Latch synchronously: already queued successes must not restore private data.
    // Only a fresh capability-gated page mount can reset this boundary.
    revoked.current = true
    for (const controller of requests.current) controller.abort()
    setReports([])
    setTotal(0)
    setSelectedId(null)
    setSelected(null)
    setStatus(null)
    setFilters({ q: '' })
    setLoading(false)
    setDetailLoading(false)
    setForbidden(true)
    setError('访问权限已失效，私有报告已清除。请离开此页或重新登录后验证权限。')
  }

  useEffect(() => {
    if (revoked.current) return undefined
    const controller = new AbortController()
    requests.current.add(controller)
    activeRequests.current.add(controller)
    let alive = true
    setLoading(true)
    listKillReports({ page: 1, pageSize: 30, ...filters, signal: controller.signal }).then(data => {
      if (!alive || revoked.current) return
      setReports(data.results || [])
      setTotal(data.count || 0)
      setError('')
      if (data.results?.[0]) setSelectedId(currentId => currentId || String(data.results[0].kill_id))
    }).catch(err => {
      if (!alive || revoked.current || err.name === 'AbortError') return
      if (err.status === 403) revokeAccess()
      else setError(err.message || '击毁情报 KM 暂时无法加载')
    }).finally(() => { activeRequests.current.delete(controller); if (alive && !revoked.current) setLoading(false) })
    return () => { alive = false; controller.abort(); requests.current.delete(controller); activeRequests.current.delete(controller) }
  }, [filters, refreshKey])

  useEffect(() => {
    if (revoked.current) return undefined
    const controller = new AbortController()
    requests.current.add(controller)
    activeRequests.current.add(controller)
    let alive = true
    getKillboardStatus({ signal: controller.signal }).then(statusData => {
      if (alive && !revoked.current) setStatus(statusData)
    }).catch(err => {
      if (!alive || revoked.current || err.name === 'AbortError') return
      if (err.status === 403) revokeAccess()
      else setStatus(null)
    }).finally(() => activeRequests.current.delete(controller))
    return () => { alive = false; controller.abort(); requests.current.delete(controller); activeRequests.current.delete(controller) }
  }, [refreshKey])

  useEffect(() => {
    if (revoked.current) return undefined
    if (!selectedId) { setSelected(null); return undefined }
    const controller = new AbortController()
    requests.current.add(controller)
    activeRequests.current.add(controller)
    let alive = true
    setDetailLoading(true)
    setError('')
    getKillReport(selectedId, { signal: controller.signal }).then(data => {
      if (alive && !revoked.current) setSelected(data)
    }).catch(err => {
      if (!alive || revoked.current || err.name === 'AbortError') return
      if (err.status === 403) revokeAccess()
      else setError(err.message || '详情加载失败')
    }).finally(() => { activeRequests.current.delete(controller); if (alive && !revoked.current) setDetailLoading(false) })
    return () => { alive = false; controller.abort(); requests.current.delete(controller); activeRequests.current.delete(controller) }
  }, [selectedId, refreshKey])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || forbidden) return undefined
    // These calls only read our stored API data; they never trigger game RPCs.
    const refreshWhenVisible = () => {
      if (!revoked.current && document.visibilityState === 'visible' && activeRequests.current.size === 0) setRefreshKey(value => value + 1)
    }
    const timer = window.setInterval(refreshWhenVisible, 180000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [forbidden])

  useEffect(() => {
    if (!revoked.current && killId && killId !== selectedId) setSelectedId(killId)
  }, [killId])

  const routeSelectedId = killId || selectedId
  useEffect(() => {
    copyRequest.current += 1
    setCopyState('')
    return () => { copyRequest.current += 1 }
  }, [routeSelectedId])
  const activeReport = useMemo(() => reports.find(row => String(row.kill_id) === String(routeSelectedId)) || null, [reports, routeSelectedId])
  const current = forbidden ? null : selectedReport(routeSelectedId, selected, activeReport)
  useEffect(() => {
    const element = contentRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (Number.isFinite(width)) setCompactDetail(width < 720)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [current?.kill_id])

  function switchPanel(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'people' : event.key === 'End' ? 'equipment' : activePanel === 'people' ? 'equipment' : 'people'
    setActivePanel(next)
    event.currentTarget.parentElement.querySelector(`#kb-tab-${next}`)?.focus()
  }

  function selectReport(id) {
    if (revoked.current) return
    setSelectedId(String(id))
    setIndexExpanded(false)
    if (indexToggleRef.current?.getClientRects().length) indexToggleRef.current.focus({ preventScroll: true })
    navigate(`/killboard/${id}`)
  }

  async function copyCurrentKillTag() {
    if (revoked.current || !current?.kill_id) return
    const requestId = ++copyRequest.current
    const copied = await copyKillboardTag(current.kill_id)
    if (revoked.current || requestId !== copyRequest.current) return
    setCopyState(copied ? '已复制' : '复制失败')
  }

  const security = killboardSecurityMeta(current)
  const detailReady = Boolean(current && String(selected?.kill_id) === String(current.kill_id))
  const initialPending = !current && !forbidden && !error && (loading || detailLoading)
  const pendingContent = initialPending || (detailLoading && !detailReady)
  const summaryOnly = Boolean(current && !detailLoading && !detailReady)
  return <div className="page-stack kb-page">
    <header className="kb-header">
      <div><div className="kb-brandline"><Swords size={18} aria-hidden="true" /><span>EVE ECHOES / KILL INTELLIGENCE</span></div><h1>击毁情报 KM</h1>{reportSourceNote(current) ? <p>{reportSourceNote(current)}</p> : null}</div>
      <div className="kb-header-actions"><div className="kb-security-legend" aria-label="星系安等图例"><span className="is-high"><i aria-hidden="true" />高安</span><span className="is-low"><i aria-hidden="true" />低安</span><span className="is-nullsec"><i aria-hidden="true" />00地区</span><span className="is-unknown"><i aria-hidden="true" />未知</span></div><span className="kb-status-slot">{(forbidden || shouldShowKillboardLiveStatus(status)) ? <span className="kb-live-pill"><Activity size={14} />{forbidden ? '访问受限' : killboardCollectionLabel(status)}</span> : null}</span><button className="kb-action" type="button" disabled={forbidden} onClick={() => { if (!revoked.current) setRefreshKey(value => value + 1) }}><RefreshCw size={15} />刷新</button></div>
    </header>
    <div className="kb-workspace">
      <aside className={`kb-sidebar${indexExpanded ? ' is-index-open' : ''}`} aria-label="击毁报告筛选">
        <div className="kb-sidebar-head"><div><span className="kb-eyebrow">REPORT INDEX</span><h2>报告索引</h2></div><span>{loading && !reports.length ? '—' : total || reports.length}</span></div>
        <button ref={indexToggleRef} className="kb-mobile-index-toggle" type="button" aria-controls="kb-index-content" aria-expanded={indexExpanded} onClick={() => setIndexExpanded(value => !value)}><span>{indexExpanded ? '收起索引' : '筛选 / 切换报告'}</span><ChevronDown size={16} aria-hidden="true" /></button>
        <div ref={indexContentRef} className="kb-index-content" id="kb-index-content" tabIndex={-1}>
        <label className="kb-search"><Search size={16} /><input type="search" value={filters.q} disabled={forbidden} onChange={event => { if (!revoked.current) setFilters(value => ({ ...value, q: event.target.value })) }} placeholder="搜索舰船、星系或角色" aria-label="搜索击毁报告" /></label>
        <div className="kb-filter-label">当前收录规则</div><div className="kb-collection-rule"><span>价值阈值</span><strong>&gt; 200 亿 ISK</strong><span>舰船范围</span><strong>不限船型</strong></div>
        <div className="kb-list-head"><span>最新报告</span><span>{loading ? '读取中' : `${reports.length} / ${total}`}</span></div>
        <div className="kb-report-list" role="region" aria-label="最新击毁报告" tabIndex={forbidden ? -1 : 0} aria-busy={loading}>{loading && !reports.length ? <div className="kb-list-loading" role="status"><LoaderCircle className="spin" size={20} aria-hidden="true" />读取报告…</div> : reports.length ? reports.map(report => <ReportRow key={report.kill_id} report={report} active={String(report.kill_id) === String(selectedId)} onSelect={selectReport} />) : <EmptyState title={filters.q.trim() ? '没有匹配报告' : '暂无击毁报告'}>{filters.q.trim() ? '尝试其他舰船、星系或角色名称。' : '采集器尚未写入符合条件的报告。'}</EmptyState>}</div>
        </div>
      </aside>
      <main className="kb-main" aria-busy={initialPending || detailLoading}>
        {error ? <div className={`kb-error${forbidden ? ' is-forbidden' : ''}`} role="alert"><AlertTriangle size={17} /><div><strong>{forbidden ? '访问受限' : '加载失败'}</strong><span>{error}</span></div>{!forbidden ? <button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button> : null}</div> : null}
        {(current || initialPending) ? <div className="kb-detail-loading" role="status">{initialPending || detailLoading ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Database size={16} aria-hidden="true" />}{initialPending && loading ? '正在读取报告索引…' : initialPending || detailLoading ? '正在读取报告详情…' : detailReady ? '报告详情已读取' : '仅展示报告摘要，详情未读取'}</div> : null}
        {(current || initialPending) ? <>
          {current ?
          <section className="kb-hero kb-panel">
            <VisualAsset src={shipImage(current)} kind="ship" alt={formatKillboardName(current.ship_name) || '舰船'} />
            <div className="kb-hero-copy">
              <span className="kb-eyebrow kb-report-id">报告 {current.kill_id}</span><h2>{formatKillboardName(current.ship_name) || '舰船'}</h2>
              <span className="kb-hull-class">{classLabel(current)}</span>
              <div className="kb-hero-victim">
                {current.victim_name ? <strong className="kb-victim-name">{current.victim_name}</strong> : null}
                {corporationLabel(current.victim_corporation_name, current.victim_corporation_ticker) ? <div className="kb-hero-corporation"><span>军团</span><strong>{corporationLabel(current.victim_corporation_name, current.victim_corporation_ticker)}</strong></div> : null}
                {current.victim_alliance_name ? <span className="kb-hero-alliance">联盟 · {current.victim_alliance_name}</span> : null}
              </div>
              <div className="kb-hero-meta"><span className="kb-location" title={[killboardSystemLabel(current), current.constellation_name, current.region_name].filter(Boolean).join(' / ')}>{[killboardSystemLabel(current), current.constellation_name, current.region_name].filter(Boolean).join(' / ')}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />{security.zoneLabel} {security.valueLabel}</span></div>
            </div>
            <div className="kb-hero-value">
              <span>估算损失</span><strong>{formatKillIsk(current.isk_lost)} <small>ISK</small></strong><small className="kb-hero-exact">{exactIsk(current.isk_lost)}</small>
              <time>{formatKillboardTime(current.kill_time_display, current.kill_time_raw, current.source)}</time>
              <button className="kb-copy-km" type="button" onClick={copyCurrentKillTag} aria-label="复制 KM" title="复制游戏内击毁报告标签"><Copy size={14} />{copyState || '复制 KM'}</button>{copyState ? <span className="kb-copy-feedback" role="status">{copyState === '已复制' ? '击毁报告标签已复制' : '复制失败，请重试'}</span> : null}
            </div>
          </section> : <LoadingReportHero />}
          {compactDetail ? <div className="kb-detail-tabs" role="tablist" aria-label="报告详情"><button type="button" role="tab" id="kb-tab-people" aria-controls="kb-panel-people" aria-selected={activePanel === 'people'} tabIndex={activePanel === 'people' ? 0 : -1} onKeyDown={switchPanel} onClick={() => setActivePanel('people')}>人员</button><button type="button" role="tab" id="kb-tab-equipment" aria-controls="kb-panel-equipment" aria-selected={activePanel === 'equipment'} tabIndex={activePanel === 'equipment' ? 0 : -1} onKeyDown={switchPanel} onClick={() => setActivePanel('equipment')}>装备</button></div> : null}
          <div className={`kb-content-grid${compactDetail ? ' is-compact' : ''}`} ref={contentRef}><Participants report={current} pending={pendingContent} unavailable={summaryOnly} compact={compactDetail} hidden={compactDetail && activePanel !== 'people'} /><Equipment report={current} pending={pendingContent} unavailable={summaryOnly} compact={compactDetail} hidden={compactDetail && activePanel !== 'equipment'} /></div>
        </> : <EmptyState title="选择一份报告查看详情">左侧索引展示价值大于 200 亿 ISK 的最新击毁报告。</EmptyState>}
      </main>
    </div>
  </div>
}
