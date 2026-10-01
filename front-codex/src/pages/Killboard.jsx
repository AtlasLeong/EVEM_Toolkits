import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Copy, Database, Layers3, LoaderCircle, RefreshCw, Search, Swords, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { getKillReport, getKillboardStatus, listKillReports } from '../services/apiKillboard'
import { copyKillboardTag, equipmentSlotLabel, formatKillboardName, groupEquipmentItems, itemImage, killboardCollectionLabel, killboardSecurityMeta, participantVisibilityNote, reportSourceNote, selectedReport, shouldShowKillboardLiveStatus, shipImage, visibleParticipantRows } from '../utils/killboardPresentation'
import KillParticipantRow from '../components/killboard/KillParticipantRow'
import GameItemImage from '../components/GameItemImage'
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

function statusLabel(value, fallback) {
  return value === 'provided' ? fallback : value === 'summary' ? '仅最后一击' : value === 'missing' ? '来源未提供' : value === 'unknown' ? '来源未提供' : fallback
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
  return <button type="button" className={`kb-report-row${active ? ' is-active' : ''}`} onClick={() => onSelect(report.kill_id)} aria-current={active ? 'true' : undefined} aria-label={`${shipName}，${report.system_name || '未知星系'}，${security.zoneLabel} ${security.valueLabel}`}>
    <span className="kb-report-row-top"><strong>{shipName}</strong><span className="kb-status-chip">{classLabel(report)}</span></span>
    <span className="kb-report-row-meta"><span>{report.victim_name || '未知目标'} · {report.system_name || '未知星系'}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />{security.zoneLabel} {security.valueLabel}</span></span>
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

function Participants({ report, hidden = false, compact = false }) {
  const rows = report?.participants || []
  const visibleRows = visibleParticipantRows(rows)
  const visibilityNote = participantVisibilityNote(rows)
  return <section className="kb-panel kb-participants-panel" id="kb-panel-people" role={compact ? 'tabpanel' : 'region'} aria-labelledby={compact ? 'kb-tab-people' : 'kb-heading-people'} hidden={hidden}>
    <div className="kb-panel-head"><div><span className="kb-eyebrow">COMBATANTS</span><h3 id="kb-heading-people">参战记录</h3></div><span className="kb-panel-count">{report?.participant_count ?? '—'} 条记录</span></div>
    {report?.participants_status !== 'provided' && !rows.length ? <EmptyState title="参与者明细暂不可用">{statusLabel(report?.participants_status, '当前报告未提供攻击列表')}</EmptyState> : visibleRows.length ? <><div className="kb-participant-list">{visibleRows.map((row, index) => <KillParticipantRow row={row} key={`${row.character_id || row.character_name || 'unknown'}-${index}`} />)}</div>{visibilityNote ? <p className="kb-participant-note">{visibilityNote}</p> : null}</> : <EmptyState title="未解析到玩家身份">报告包含伤害记录，但暂未返回可展示的玩家名称。</EmptyState>}
  </section>
}

function Equipment({ report, hidden = false, compact = false }) {
  const rows = report?.items || []
  const groups = useMemo(() => groupEquipmentItems(rows).map(group => ({
    ...group,
    dropItems: group.items.filter(itemHasDrop),
  })), [rows])
  const [activeGroup, setActiveGroup] = useState('all')
  const [dropOnly, setDropOnly] = useState(false)
  useEffect(() => { setActiveGroup('all'); setDropOnly(false) }, [report?.kill_id])
  const groupedRows = activeGroup === 'all' ? rows : groups.find(group => group.key === activeGroup)?.items || []
  const visibleRows = dropOnly ? groupedRows.filter(itemHasDrop) : groupedRows
  const droppedCount = rows.filter(itemHasDrop).length
  return <section className="kb-panel kb-equipment-panel" id="kb-panel-equipment" role={compact ? 'tabpanel' : 'region'} aria-labelledby={compact ? 'kb-tab-equipment' : 'kb-heading-equipment'} hidden={hidden}>
    <div className="kb-panel-head"><div><span className="kb-eyebrow">SALVAGE / FITTING</span><h3 id="kb-heading-equipment">装备与掉落</h3></div><span className="kb-panel-count">{rows.length ? `${rows.length} 项` : '—'}</span></div>
    {report?.equipment_status !== 'provided' && !rows.length ? <EmptyState title="装备明细未提供">不会把空结果误判为“没有掉落”。</EmptyState> : rows.length ? <><div className="kb-equipment-controls"><div className="kb-slot-tabs" role="group" aria-label="装备槽位分类"><button type="button" aria-pressed={activeGroup === 'all'} className={activeGroup === 'all' ? 'is-active' : ''} onClick={() => setActiveGroup('all')}>全部 <b>{rows.length}</b></button>{groups.map(group => <button type="button" aria-pressed={activeGroup === group.key} key={group.key} disabled={!group.items.length} className={activeGroup === group.key ? 'is-active' : ''} onClick={() => setActiveGroup(group.key)}>{group.label} <b>{group.items.length}</b>{group.dropItems.length ? <em title={`${group.dropItems.length} 项已掉落`}>·{group.dropItems.length}</em> : null}</button>)}</div><button type="button" className={`kb-drop-filter${dropOnly ? ' is-active' : ''}`} aria-label="只看已掉落装备" aria-pressed={dropOnly} onClick={() => setDropOnly(value => !value)}><span>已掉落</span><b>{droppedCount}</b></button></div><p className="kb-slot-hint"><Layers3 size={14} />蓝色标记为掉落；点击“已掉落”可快速筛选。</p>{visibleRows.length ? <div className="kb-item-list">{visibleRows.map((row, index) => { const name = formatKillboardName(row.name) || '物品名称待补'; return <div className={`kb-item kb-item--${row.status}`} key={`${row.type_id || 'unknown'}-${index}`}><VisualAsset src={itemImage(row)} kind="item" /><div className="kb-item-main"><strong title={name}>{name}</strong><span>{equipmentSlotLabel(row.slot)}{row.quantity ? ` · ${row.quantity} 件` : ''}</span></div><span className={`kb-item-status kb-item-status--${row.status}`}>{itemStatusLabel(row.status)}{row.quantity_dropped ? ` · ${row.quantity_dropped}` : ''}</span></div> })}</div> : <EmptyState title="没有已掉落装备" />}</> : <EmptyState title="没有可展示的装备" />}
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
  const [compactDetail, setCompactDetail] = useState(false)
  const [activePanel, setActivePanel] = useState('people')
  const [copyState, setCopyState] = useState('')
  const contentRef = useRef(null)
  const revoked = useRef(false)
  const requests = useRef(new Set())
  const activeRequests = useRef(new Set())

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
      if (!selectedId && data.results?.[0]) setSelectedId(data.results[0].kill_id)
    }).catch(err => {
      if (!alive || revoked.current || err.name === 'AbortError') return
      if (err.status === 403) revokeAccess()
      else setError(err.message || '击毁情报暂时无法加载')
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

  const activeReport = useMemo(() => reports.find(row => String(row.kill_id) === String(selectedId)) || null, [reports, selectedId])
  const current = forbidden ? null : selectedReport(selectedId, selected, activeReport)
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
    navigate(`/killboard/${id}`)
  }

  async function copyCurrentKillTag() {
    if (revoked.current || !current?.kill_id) return
    const copied = await copyKillboardTag(current.kill_id)
    setCopyState(copied ? '已复制' : '复制失败')
  }

  const security = killboardSecurityMeta(current)
  return <div className="page-stack kb-page">
    <header className="kb-header">
      <div><div className="kb-brandline"><Swords size={18} aria-hidden="true" /><span>EVE ECHOES / KILL INTELLIGENCE</span></div><h1>击毁情报</h1>{reportSourceNote(current) ? <p>{reportSourceNote(current)}</p> : null}</div>
      <div className="kb-header-actions"><div className="kb-security-legend" aria-label="星系安等图例"><span className="is-high"><i aria-hidden="true" />高安</span><span className="is-low"><i aria-hidden="true" />低安</span><span className="is-nullsec"><i aria-hidden="true" />00地区</span><span className="is-unknown"><i aria-hidden="true" />未知</span></div>{(forbidden || shouldShowKillboardLiveStatus(status)) ? <span className="kb-live-pill"><Activity size={14} />{forbidden ? '访问受限' : killboardCollectionLabel(status)}</span> : null}<button className="kb-action" type="button" disabled={forbidden} onClick={() => { if (!revoked.current) setRefreshKey(value => value + 1) }}><RefreshCw size={15} />刷新</button></div>
    </header>
    <div className="kb-workspace">
      <aside className="kb-sidebar" aria-label="击毁报告筛选">
        <div className="kb-sidebar-head"><div><span className="kb-eyebrow">REPORT INDEX</span><h2>报告索引</h2></div><span>{total || reports.length}</span></div>
        <label className="kb-search"><Search size={16} /><input type="search" value={filters.q} disabled={forbidden} onChange={event => { if (!revoked.current) setFilters(value => ({ ...value, q: event.target.value })) }} placeholder="搜索舰船、星系或角色" aria-label="搜索击毁报告" /></label>
        <div className="kb-filter-label">当前收录规则</div><div className="kb-collection-rule"><span>价值阈值</span><strong>&gt; 200 亿 ISK</strong><span>舰船范围</span><strong>不限船型</strong></div>
        <div className="kb-list-head"><span>最新报告</span><span>{loading ? '读取中' : `${reports.length} / ${total}`}</span></div>
        <div className="kb-report-list">{loading && !reports.length ? <div className="kb-list-loading"><LoaderCircle className="spin" size={20} />读取报告…</div> : reports.length ? reports.map(report => <ReportRow key={report.kill_id} report={report} active={String(report.kill_id) === String(selectedId)} onSelect={selectReport} />) : <EmptyState title="暂无击毁报告">采集器尚未写入符合条件的报告。</EmptyState>}</div>
      </aside>
      <main className="kb-main" aria-busy={detailLoading}>
        {error ? <div className={`kb-error${forbidden ? ' is-forbidden' : ''}`} role="alert"><AlertTriangle size={17} /><div><strong>{forbidden ? '访问受限' : '加载失败'}</strong><span>{error}</span></div>{!forbidden ? <button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button> : null}</div> : null}
        {current ? <>
          <section className="kb-hero kb-panel">
            <VisualAsset src={shipImage(current)} kind="ship" alt={formatKillboardName(current.ship_name) || '舰船'} />
            <div className="kb-hero-copy">
              <span className="kb-eyebrow">报告 {current.kill_id} · {classLabel(current)}</span><h2>{formatKillboardName(current.ship_name) || '未知舰船'}</h2>
              <div className="kb-hero-victim"><strong>{current.victim_name || '目标身份未返回'}</strong><span>{current.victim_corporation_name || '军团资料未返回'}{current.victim_alliance_name ? ` · ${current.victim_alliance_name}` : ''}</span></div>
              <div className="kb-hero-meta"><span className="kb-location" title={[current.system_name, current.constellation_name, current.region_name].filter(Boolean).join(' / ')}>{[current.system_name || '未知星系', current.constellation_name, current.region_name].filter(Boolean).join(' / ')}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />{security.zoneLabel} {security.valueLabel}</span></div>
            </div>
            <div className="kb-hero-value">
              <span>估算损失</span><strong>{formatKillIsk(current.isk_lost)} <small>ISK</small></strong><small className="kb-hero-exact">{exactIsk(current.isk_lost)}</small>
              <time>{formatKillboardTime(current.kill_time_display, current.kill_time_raw, current.source)}</time>
              <button className="kb-copy-km" type="button" onClick={copyCurrentKillTag} aria-label="复制 KM" title="复制游戏内击毁报告标签"><Copy size={14} />{copyState || '复制 KM'}</button>
            </div>
          </section>
          {compactDetail ? <div className="kb-detail-tabs" role="tablist" aria-label="报告详情"><button type="button" role="tab" id="kb-tab-people" aria-controls="kb-panel-people" aria-selected={activePanel === 'people'} tabIndex={activePanel === 'people' ? 0 : -1} onKeyDown={switchPanel} onClick={() => setActivePanel('people')}>人员</button><button type="button" role="tab" id="kb-tab-equipment" aria-controls="kb-panel-equipment" aria-selected={activePanel === 'equipment'} tabIndex={activePanel === 'equipment' ? 0 : -1} onKeyDown={switchPanel} onClick={() => setActivePanel('equipment')}>装备</button></div> : null}
          <div className={`kb-content-grid${compactDetail ? ' is-compact' : ''}`} ref={contentRef}><Participants report={current} compact={compactDetail} hidden={compactDetail && activePanel !== 'people'} /><Equipment report={current} compact={compactDetail} hidden={compactDetail && activePanel !== 'equipment'} /></div>
        </> : <EmptyState title="选择一份报告查看详情">左侧索引展示价值大于 200 亿 ISK 的最新击毁报告。</EmptyState>}
      </main>
    </div>
  </div>
}
