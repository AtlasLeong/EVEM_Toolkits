import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Database, Layers3, LoaderCircle, RefreshCw, Search, Swords, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { getKillReport, getKillboardStatus, listKillReports } from '../services/apiKillboard'
import { groupEquipmentItems, itemImage, killboardSecurityMeta, participantIdentity, participantVisibilityNote, reportSourceNote, selectedReport, shipImage, visibleParticipantRows } from '../utils/killboardPresentation'
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

function formatTime(value, raw = '') {
  if (value) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-CN', { hour12: false })
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

function ReportRow({ report, active, onSelect }) {
  const security = killboardSecurityMeta(report)
  return <button type="button" className={`kb-report-row${active ? ' is-active' : ''}`} onClick={() => onSelect(report.kill_id)} aria-current={active ? 'true' : undefined} aria-label={`${report.ship_name || '未知舰船'}，${report.system_name || '未知星系'}，${security.zoneLabel} ${security.valueLabel}`}>
    <span className="kb-report-row-top"><strong>{report.ship_name || '未知舰船'}</strong><span className="kb-status-chip">{classLabel(report)}</span></span>
    <span className="kb-report-row-meta"><span>{report.victim_name || '未知目标'} · {report.system_name || '未知星系'}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />{security.zoneLabel} {security.valueLabel}</span></span>
    <span className="kb-report-row-bottom"><time>{formatTime(report.kill_time_display, report.kill_time_raw)}</time><b title={exactIsk(report.isk_lost)}>{formatKillIsk(report.isk_lost)} ISK</b></span>
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

function Participants({ report }) {
  const rows = report?.participants || []
  const visibleRows = visibleParticipantRows(rows)
  const visibilityNote = participantVisibilityNote(rows)
  return <section className="kb-panel kb-participants-panel">
    <div className="kb-panel-head"><div><span className="kb-eyebrow">COMBATANTS</span><h3>击毁人员</h3></div><span className="kb-panel-count">{report?.participant_count ?? '—'} 条记录</span></div>
    {report?.participants_status !== 'provided' && !rows.length ? <EmptyState title="参与者明细暂不可用">{statusLabel(report?.participants_status, '当前报告未提供攻击列表')}</EmptyState> : visibleRows.length ? <><div className="kb-participant-list">{visibleRows.map((row, index) => <KillParticipantRow row={row} key={`${row.character_id || row.character_name || 'unknown'}-${index}`} />)}</div>{visibilityNote ? <p className="kb-participant-note">{visibilityNote}</p> : null}</> : <EmptyState title="未解析到玩家身份">报告包含伤害记录，但暂未返回可展示的玩家名称。</EmptyState>}
  </section>
}

function Equipment({ report }) {
  const rows = report?.items || []
  const groups = useMemo(() => groupEquipmentItems(rows), [rows])
  const [activeGroup, setActiveGroup] = useState('all')
  useEffect(() => setActiveGroup('all'), [report?.kill_id])
  const visibleRows = activeGroup === 'all' ? rows : groups.find(group => group.key === activeGroup)?.items || []
  return <section className="kb-panel kb-equipment-panel">
    <div className="kb-panel-head"><div><span className="kb-eyebrow">SALVAGE / FITTING</span><h3>装备与掉落</h3></div><span className="kb-panel-count">{rows.length ? `${rows.length} 项` : '—'}</span></div>
    {report?.equipment_status !== 'provided' && !rows.length ? <EmptyState title="装备明细未提供">不会把空结果误判为“没有掉落”。</EmptyState> : rows.length ? <><div className="kb-slot-tabs" role="tablist" aria-label="装备槽位分类"><button type="button" role="tab" aria-selected={activeGroup === 'all'} className={activeGroup === 'all' ? 'is-active' : ''} onClick={() => setActiveGroup('all')}>全部 <b>{rows.length}</b></button>{groups.map(group => <button type="button" role="tab" aria-selected={activeGroup === group.key} key={group.key} disabled={!group.items.length} className={activeGroup === group.key ? 'is-active' : ''} onClick={() => setActiveGroup(group.key)}>{group.label} <b>{group.items.length}</b></button>)}</div><p className="kb-slot-hint"><Layers3 size={13} />按报告槽位标记归类，未识别项保留在“其他”。</p><div className="kb-item-list">{visibleRows.map((row, index) => <div className="kb-item" key={`${row.type_id || 'unknown'}-${index}`}><VisualAsset src={itemImage(row)} kind="item" /><div className="kb-item-main"><strong>{row.name || (row.type_id ? `物品 ID ${row.type_id}` : '未知物品')}</strong><span>{row.slot || '槽位未知'}</span></div><span className={`kb-item-status kb-item-status--${row.status}`}>{itemStatusLabel(row.status)}{row.quantity_dropped ? ` · ${row.quantity_dropped}` : ''}</span></div>)}</div></> : <EmptyState title="没有可展示的装备" />}
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
  const revoked = useRef(false)
  const requests = useRef(new Set())

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
    }).finally(() => { if (alive && !revoked.current) setLoading(false) })
    return () => { alive = false; controller.abort(); requests.current.delete(controller) }
  }, [filters, refreshKey])

  useEffect(() => {
    if (revoked.current) return undefined
    const controller = new AbortController()
    requests.current.add(controller)
    let alive = true
    getKillboardStatus({ signal: controller.signal }).then(statusData => {
      if (alive && !revoked.current) setStatus(statusData)
    }).catch(err => {
      if (alive && !revoked.current && err.status === 403) revokeAccess()
    })
    return () => { alive = false; controller.abort(); requests.current.delete(controller) }
  }, [])

  useEffect(() => {
    if (revoked.current) return undefined
    if (!selectedId) { setSelected(null); return undefined }
    const controller = new AbortController()
    requests.current.add(controller)
    let alive = true
    setDetailLoading(true)
    getKillReport(selectedId, { signal: controller.signal }).then(data => {
      if (alive && !revoked.current) setSelected(data)
    }).catch(err => {
      if (!alive || revoked.current || err.name === 'AbortError') return
      if (err.status === 403) revokeAccess()
      else setError(err.message || '详情加载失败')
    }).finally(() => { if (alive && !revoked.current) setDetailLoading(false) })
    return () => { alive = false; controller.abort(); requests.current.delete(controller) }
  }, [selectedId])

  useEffect(() => {
    if (!revoked.current && killId && killId !== selectedId) setSelectedId(killId)
  }, [killId])

  const activeReport = useMemo(() => reports.find(row => String(row.kill_id) === String(selectedId)) || null, [reports, selectedId])
  const current = forbidden ? null : selectedReport(selectedId, selected, activeReport)
  const finalBlow = useMemo(() => (current?.participants || []).find(row => row.is_final_blow && String(row.character_name || '').trim()), [current])

  function selectReport(id) {
    if (revoked.current) return
    setSelectedId(String(id))
    navigate(`/killboard/${id}`)
  }

  const security = killboardSecurityMeta(current)
  return <div className="page-stack kb-page">
    <header className="kb-header">
      <div><div className="kb-brandline"><Swords size={18} aria-hidden="true" /><span>EVE ECHOES / KILL INTELLIGENCE</span></div><h1>击毁情报</h1><p>{reportSourceNote(current) || '仅收录价值大于 200 亿 ISK 的最新报告，保留星系安等与可验证的掉落信息。'}</p></div>
      <div className="kb-header-actions"><div className="kb-security-legend" aria-label="星系安等图例"><span className="is-high"><i aria-hidden="true" />高安</span><span className="is-low"><i aria-hidden="true" />低安</span><span className="is-nullsec"><i aria-hidden="true" />零安</span><span className="is-unknown"><i aria-hidden="true" />未知</span></div><span className="kb-live-pill"><Activity size={14} />{forbidden ? '访问受限' : status?.collection_enabled ? '采集运行中' : '只读归档'}</span><button className="kb-action" type="button" disabled={forbidden} onClick={() => { if (!revoked.current) setRefreshKey(value => value + 1) }}><RefreshCw size={15} />刷新</button></div>
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
          <section className="kb-hero kb-panel"><VisualAsset src={shipImage(current)} kind="ship" alt={current.ship_name || '舰船'} /><div className="kb-hero-copy"><span className="kb-eyebrow">KILL REPORT / {current.kill_id}</span><h2>{current.ship_name || '未知舰船'}</h2><div className="kb-hero-meta"><span>{classLabel(current)}</span><span>{current.system_name || '未知星系'}</span><span className={`kb-security-chip ${security.className}`} title={`安等 ${security.valueLabel} · ${security.zoneLabel}`}><i aria-hidden="true" />安等 {security.valueLabel} · {security.zoneLabel}</span><span>{formatTime(current.kill_time_display, current.kill_time_raw)}</span></div></div><div className="kb-hero-value"><span>估算损失</span><strong title={exactIsk(current.isk_lost)}>{formatKillIsk(current.isk_lost)} <small>ISK</small></strong></div></section>
          <div className="kb-stat-grid"><div className="kb-stat"><span>受击目标</span><strong>{current.victim_name || '目标身份未返回'}</strong><small>{current.victim_corporation_name || '军团资料未返回'}{current.victim_alliance_name ? ` · ${current.victim_alliance_name}` : ''}</small></div><div className="kb-stat"><span>火力记录</span><strong>{current.participant_count ?? '—'} 条记录</strong><small>{statusLabel(current.participants_status, '来源已提供，含未识别身份')}</small></div><div className="kb-stat"><span>最后一击</span><strong>{finalBlow ? participantIdentity(finalBlow).name : '最后一击资料未返回'}</strong><small>击毁人员</small></div></div>
          <div className="kb-content-grid"><Participants report={current} /><Equipment report={current} /></div>
        </> : <EmptyState title="选择一份报告查看详情">左侧索引展示价值大于 200 亿 ISK 的最新击毁报告。</EmptyState>}
      </main>
    </div>
  </div>
}
