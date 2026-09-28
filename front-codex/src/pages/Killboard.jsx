import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ChevronRight, Crosshair, Database, ExternalLink, LoaderCircle, RefreshCw, Search, ShieldAlert, Swords, UserRound, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getKillReport, getKillboardStatus, listKillReports, listKillboardFilters } from '../services/apiKillboard'
import '../styles/killboard.css'

export function formatKillIsk(value) {
  if (value === null || value === undefined || value === '') return '—'
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.\d+)?$/)
  if (!match) return String(value)
  const negative = match[1] === '-'
  const integer = BigInt(match[2])
  const unit = integer >= 100000000n ? '亿' : integer >= 10000n ? '万' : ''
  if (!unit) return `${negative ? '-' : ''}${integer.toString()}`
  const divisor = unit === '亿' ? 100000000n : 10000n
  const major = integer / divisor
  const remainder = integer % divisor
  const fraction = Math.round(Number(remainder) * 100 / Number(divisor))
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
  return <button type="button" className={`kb-report-row${active ? ' is-active' : ''}`} onClick={() => onSelect(report.kill_id)} aria-current={active ? 'true' : undefined}>
    <span className="kb-report-row-top"><strong>{report.ship_name || '未知舰船'}</strong><span className="kb-status-chip">{classLabel(report)}</span></span>
    <span className="kb-report-row-meta">{report.victim_name || '未知目标'} · {report.system_name || '未知星系'}</span>
    <span className="kb-report-row-bottom"><time>{formatTime(report.kill_time_display, report.kill_time_raw)}</time><b title={exactIsk(report.isk_lost)}>{formatKillIsk(report.isk_lost)} ISK</b></span>
  </button>
}

function EmptyState({ title, children }) {
  return <div className="kb-empty"><Database size={28} aria-hidden="true" /><strong>{title}</strong>{children ? <p>{children}</p> : null}</div>
}

function Participants({ report }) {
  const rows = report?.participants || []
  return <section className="kb-panel kb-participants-panel">
    <div className="kb-panel-head"><div><span className="kb-eyebrow">COMBATANTS</span><h3>击毁人员</h3></div><span className="kb-panel-count">{report?.participant_count ?? '—'} 人</span></div>
    {report?.participants_status !== 'provided' && !rows.length ? <EmptyState title="参与者明细暂不可用">{statusLabel(report?.participants_status, '当前报告未提供攻击列表')}</EmptyState> : rows.length ? <div className="kb-participant-list">{rows.map((row, index) => <div className="kb-participant" key={`${row.character_id || 'unknown'}-${index}`}><div className="kb-participant-icon"><UserRound size={17} /></div><div className="kb-participant-main"><strong>{row.character_name || (row.character_id ? `角色 ${row.character_id}` : '未知角色')}</strong><span>{row.corporation_name || (row.corporation_id ? `军团 ${row.corporation_id}` : '军团未知')}</span></div><div className="kb-participant-stats">{row.is_final_blow ? <em>最后一击</em> : null}<b>{row.damage != null ? `${Number(row.damage).toLocaleString()} 伤害` : '伤害未知'}</b></div></div>)}</div> : <EmptyState title="未解析到参与者">该报告仅包含最后一击摘要。</EmptyState>}
  </section>
}

function Equipment({ report }) {
  const rows = report?.items || []
  return <section className="kb-panel kb-equipment-panel">
    <div className="kb-panel-head"><div><span className="kb-eyebrow">SALVAGE / FITTING</span><h3>装备与掉落</h3></div><span className="kb-panel-count">{rows.length ? `${rows.length} 项` : '—'}</span></div>
    {report?.equipment_status !== 'provided' && !rows.length ? <EmptyState title="装备明细未提供">不会把空结果误判为“没有掉落”。</EmptyState> : rows.length ? <div className="kb-item-list">{rows.map((row, index) => <div className="kb-item" key={`${row.type_id || 'unknown'}-${index}`}><div><strong>{row.name || (row.type_id ? `物品 ${row.type_id}` : '未知物品')}</strong><span>{row.slot || '槽位未知'}</span></div><span className={`kb-item-status kb-item-status--${row.status}`}>{itemStatusLabel(row.status)}{row.quantity_dropped ? ` · ${row.quantity_dropped}` : ''}</span></div>)}</div> : <EmptyState title="没有可展示的装备" />}
  </section>
}

export default function KillboardPage() {
  const { killId } = useParams()
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(killId || null)
  const [selected, setSelected] = useState(null)
  const [filters, setFilters] = useState({ q: '', shipClass: '' })
  const [shipClasses, setShipClasses] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    listKillReports({ page: 1, pageSize: 30, ...filters, signal: controller.signal }).then(data => {
      if (!alive) return
      setReports(data.results || [])
      setTotal(data.count || 0)
      setError('')
      if (!selectedId && data.results?.[0]) setSelectedId(data.results[0].kill_id)
    }).catch(err => { if (alive && err.name !== 'AbortError') setError(err.message || '击毁情报暂时无法加载') }).finally(() => alive && setLoading(false))
    return () => { alive = false; controller.abort() }
  }, [filters, refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([listKillboardFilters({ signal: controller.signal }), getKillboardStatus({ signal: controller.signal })]).then(([filterData, statusData]) => { setShipClasses(filterData.ship_classes || []); setStatus(statusData) }).catch(() => {}).finally(() => controller.signal.aborted || undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selectedId) { setSelected(null); return undefined }
    const controller = new AbortController()
    let alive = true
    setDetailLoading(true)
    getKillReport(selectedId, { signal: controller.signal }).then(data => { if (alive) setSelected(data) }).catch(err => { if (alive && err.name !== 'AbortError') setError(err.message || '详情加载失败') }).finally(() => alive && setDetailLoading(false))
    return () => { alive = false; controller.abort() }
  }, [selectedId])

  useEffect(() => {
    if (killId && killId !== selectedId) setSelectedId(killId)
  }, [killId])

  const activeReport = useMemo(() => reports.find(row => String(row.kill_id) === String(selectedId)) || null, [reports, selectedId])
  const current = selected || activeReport

  function selectReport(id) {
    setSelectedId(String(id))
    navigate(`/killboard/${id}`)
  }

  return <div className="page-stack kb-page">
    <header className="kb-header">
      <div><div className="kb-brandline"><Swords size={18} aria-hidden="true" /><span>EVE ECHOES / KILL INTELLIGENCE</span></div><h1>击毁情报</h1><p>收录战列舰及以上级别报告，保留原始来源状态与可验证的掉落信息。</p></div>
      <div className="kb-header-actions"><span className="kb-live-pill"><Activity size={14} />{status?.collection_enabled ? '采集运行中' : '只读归档'}</span><button className="kb-action" type="button" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15} />刷新</button></div>
    </header>
    <div className="kb-workspace">
      <aside className="kb-sidebar" aria-label="击毁报告筛选">
        <div className="kb-sidebar-head"><div><span className="kb-eyebrow">REPORT INDEX</span><h2>报告索引</h2></div><span>{total || reports.length}</span></div>
        <label className="kb-search"><Search size={16} /><input type="search" value={filters.q} onChange={event => setFilters(value => ({ ...value, q: event.target.value }))} placeholder="搜索舰船、星系或角色" aria-label="搜索击毁报告" /></label>
        <div className="kb-filter-label">舰船级别</div><div className="kb-filter-list"><button type="button" className={!filters.shipClass ? 'is-active' : ''} onClick={() => setFilters(value => ({ ...value, shipClass: '' }))}>全部收录 <b>{total || reports.length}</b></button>{shipClasses.map(item => <button type="button" key={item.key} className={filters.shipClass === item.key ? 'is-active' : ''} onClick={() => setFilters(value => ({ ...value, shipClass: item.key }))}>{item.label}<b>{filters.shipClass === item.key ? '筛选中' : ''}</b></button>)}</div>
        <div className="kb-list-head"><span>最新报告</span><span>{loading ? '读取中' : `${reports.length} / ${total}`}</span></div>
        <div className="kb-report-list">{loading && !reports.length ? <div className="kb-list-loading"><LoaderCircle className="spin" size={20} />读取报告…</div> : reports.length ? reports.map(report => <ReportRow key={report.kill_id} report={report} active={String(report.kill_id) === String(selectedId)} onSelect={selectReport} />) : <EmptyState title="暂无击毁报告">采集器尚未写入符合条件的报告。</EmptyState>}</div>
      </aside>
      <main className="kb-main">
        {error ? <div className="kb-error" role="alert"><AlertTriangle size={17} />{error}<button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div> : null}
        {current ? <>
          <section className="kb-hero kb-panel"><div className="kb-hero-copy"><span className="kb-eyebrow">KILL REPORT / {current.kill_id}</span><h2>{current.ship_name || '未知舰船'}</h2><div className="kb-hero-meta"><span>{classLabel(current)}</span><span>{current.system_name || '未知星系'}</span><span>{formatTime(current.kill_time_display, current.kill_time_raw)}</span></div></div><div className="kb-hero-value"><span>估算损失</span><strong title={exactIsk(current.isk_lost)}>{formatKillIsk(current.isk_lost)} <small>ISK</small></strong></div></section>
          <div className="kb-stat-grid"><div className="kb-stat"><span>受击目标</span><strong>{current.victim_name || '未知角色'}</strong><small>{current.victim_corporation_name || '军团未知'}</small></div><div className="kb-stat"><span>参与人数</span><strong>{current.participant_count ?? '—'}</strong><small>{statusLabel(current.participants_status, '来源已提供')}</small></div><div className="kb-stat"><span>报告完整度</span><strong>{current.completeness === 'complete' ? '完整' : '部分'}</strong><small>{current.source || '游戏报告'}</small></div></div>
          <div className="kb-content-grid"><Participants report={selected || current} /><Equipment report={selected || current} /></div>
        </> : <EmptyState title="选择一份报告查看详情">左侧索引展示已收录的战列舰及以上击毁报告。</EmptyState>}
      </main>
      <aside className="kb-inspector" aria-label="报告状态"><div className="kb-inspector-head"><span className="kb-eyebrow">SOURCE TRACE</span><ShieldAlert size={18} /></div><h2>来源与状态</h2><div className="kb-source-card"><Crosshair size={18} /><div><span>报告编号</span><strong>{current?.kill_id || '—'}</strong></div></div><div className="kb-source-card"><Database size={18} /><div><span>装备数据</span><strong>{current ? statusLabel(current.equipment_status, '已解析') : '—'}</strong></div></div><div className="kb-source-note">蓝底装备在原始击毁报告中代表掉落；如果来源未返回装备区块，页面会明确标注“装备明细未提供”。</div>{detailLoading ? <div className="kb-inspector-loading"><LoaderCircle className="spin" size={15} />详情同步中</div> : null}<Link className="kb-inspector-link" to="/market"><span>查看市场估值</span><ExternalLink size={14} /></Link></aside>
    </div>
  </div>
}
