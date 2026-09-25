import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clock3, Crosshair, MapPinned, Plus, Radar, RefreshCw, Search, Users, X } from 'lucide-react'
import { getPirateMap, getPirateSnapshot, newRequestId, sendPirateCommand, sendTacticalCommand } from '../../services/apiTacticalCollaboration'
import { ageLabel } from '../../utils/tacticalCollaboration'
import { activityWindowLabel, currentPirateTargets, groupPirateSightings, isHistoricalSighting } from '../../utils/pirateIntel'
import { buildPirateCoverage, isLocationInPirateMap } from '../../utils/pirateCoverage'
import { pirateRefreshDelay } from '../../utils/piratePolling'
import { ScopeEditor, TacticalDialog } from './TacticalControls'
import TacticalMembers from './TacticalMembers'
import PirateSightingForm from './PirateSightingForm'
import PirateIntelMap from './PirateIntelMap'
import '../../styles/pirateIntelBoard.css'

const LIST_BATCH_SIZE = 80

function WithdrawDialog({ sighting, organizationId, boardId, onClose, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(newRequestId())
  const withdraw = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await sendPirateCommand(organizationId, boardId, { action: 'sighting.withdraw', request_id: requestId.current,
        id: sighting.id, expected_version: sighting.version })
      await onSaved(); onClose()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <TacticalDialog title="撤下目标线索" onClose={onClose} confirm>
    <p>这条目击将从地图标记中移除，历史仍会保留供组织复盘。</p>
    <div className="tac-confirm-target"><span>目击目标</span><strong>{sighting.character_name} · {sighting.ship_type}</strong><small>{sighting.location_name}</small></div>
    {error && <p role="alert" className="tac-error">{error}</p>}
    <div className="tac-form-footer"><button type="button" className="tac-btn" onClick={onClose}>取消</button>
      <button type="button" className="tac-btn is-confirm-danger" disabled={busy} onClick={withdraw}>{busy ? '处理中…' : '确认撤下'}</button></div>
  </TacticalDialog>
}

export default function PirateIntelBoard({ organization, board, organizationControls, onOpenOrganization }) {
  const [snapshot, setSnapshot] = useState(null)
  const [mapData, setMapData] = useState(null)
  const [mapError, setMapError] = useState('')
  const [mapRetry, setMapRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [targetPage, setTargetPage] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [focusRequestId, setFocusRequestId] = useState(0)
  const [targetListOpen, setTargetListOpen] = useState(true)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [serverClockOffset, setServerClockOffset] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [reportLocation, setReportLocation] = useState(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [withdrawRow, setWithdrawRow] = useState(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1099px)').matches)
  const readSequence = useRef(0)
  const snapshotRef = useRef(null)
  const mounted = useRef(true)
  const activeReads = useRef(new Set())
  const lastPermission = useRef(null)
  const detailRef = useRef(null)
  const loadedMapKey = useRef(null)
  const selectTarget = useCallback(key => {
    setSelectedKey(key)
    setHistoryPage(0)
    setFocusRequestId(previous => previous + 1)
  }, [])
  const refresh = useCallback(async ({ quiet = false } = {}) => {
    const sequence = ++readSequence.current
    if (!quiet) setLoading(true)
    const controller = new AbortController()
    activeReads.current.add(controller)
    const deadline = setTimeout(() => controller.abort(), 10000)
    try {
      const cached = snapshotRef.current
      const data = await getPirateSnapshot(organization.id, board.id,
        { signal: controller.signal, revision: cached?.revision })
      if (mounted.current && sequence === readSequence.current) {
        if (data.unchanged && (!cached || cached.revision !== data.revision))
          throw new Error('情报修订号已变化，请重新读取。')
        const serverTime = Date.parse(data.server_time || '')
        setServerClockOffset(Number.isFinite(serverTime) ? serverTime - Date.now() : 0)
        if (!data.unchanged) {
          snapshotRef.current = data
          setSnapshot(data)
        }
        setError(''); setAccessDenied(false)
      }
      return data.unchanged ? cached : data
    } catch (failure) {
      if (mounted.current && sequence === readSequence.current) {
        if ([401, 403, 404].includes(failure.status)) {
          snapshotRef.current = null
          setSnapshot(null); setMapData(null); setAccessDenied(true)
          setSelectedKey(null); setMembersOpen(false); setWithdrawRow(null); setFormOpen(false); setScopeOpen(false); setNotice('')
        }
        setError(controller.signal.aborted ? '读取目标线索超时，请重试。' : failure.message)
      }
      return null
    } finally {
      clearTimeout(deadline)
      activeReads.current.delete(controller)
      if (mounted.current && sequence === readSequence.current) setLoading(false)
    }
  }, [organization.id, board.id])
  useEffect(() => {
    mounted.current = true
    let timer = null
    let stopped = false
    let failures = 0
    let activeRequest = null
    const schedule = () => {
      clearTimeout(timer)
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(poll, pirateRefreshDelay(failures))
    }
    const poll = async () => {
      if (stopped || document.visibilityState !== 'visible' || activeRequest) return
      activeRequest = refresh({ quiet: true })
      const data = await activeRequest
      activeRequest = null
      if (stopped) return
      failures = data ? 0 : Math.min(2, failures + 1)
      schedule()
    }
    activeRequest = refresh()
    activeRequest.then(data => {
      activeRequest = null
      if (stopped) return
      failures = data ? 0 : 1
      schedule()
    })
    const onVisible = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true; mounted.current = false; readSequence.current += 1; clearTimeout(timer)
      for (const controller of activeReads.current) controller.abort()
      activeReads.current.clear()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1099px)')
    if (!media) return undefined
    const update = () => setMobileViewport(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    let timer
    const tick = () => {
      setClockNow(Date.now())
      timer = window.setTimeout(tick, 60_000)
    }
    timer = window.setTimeout(tick, 60_000)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!snapshot) return
    const permission = `${snapshot.role}:${snapshot.permission_version}`
    if (lastPermission.current && lastPermission.current !== permission) {
      setMembersOpen(false); setWithdrawRow(null); setFormOpen(false); setScopeOpen(false); setNotice('')
    }
    lastPermission.current = permission
  }, [snapshot?.role, snapshot?.permission_version])
  const scopeVersion = snapshot?.scope?.version
  const hasScope = Boolean(snapshot?.scope?.region_ids?.length)
  useEffect(() => {
    let active = true
    const key = `${organization.id}:${board.id}:${scopeVersion}:${mapRetry}`
    if (!hasScope || (mobileViewport && !mapOpen)) {
      if (!hasScope) { setMapData(null); setMapError(''); loadedMapKey.current = null }
      return () => { active = false }
    }
    if (loadedMapKey.current === key && mapData) return () => { active = false }
    setMapData(null); setMapError('')
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 10000)
    getPirateMap(organization.id, board.id, { signal: controller.signal }).then(data => {
      if (active) { loadedMapKey.current = key; setMapData(data) }
    }).catch(failure => { if (active) setMapError(controller.signal.aborted ? '星图读取超时，请重试。' : failure.message) })
      .finally(() => clearTimeout(deadline))
    return () => { active = false; controller.abort(); clearTimeout(deadline) }
  }, [organization.id, board.id, scopeVersion, hasScope, mobileViewport, mapOpen, mapRetry])
  const targets = useMemo(() => groupPirateSightings(snapshot?.sightings || []), [snapshot?.sightings])
  const serverNow = clockNow + serverClockOffset
  const currentTargets = useMemo(() => currentPirateTargets(targets, serverNow), [targets, serverNow])
  const coverage = useMemo(() => buildPirateCoverage(mapData), [mapData])
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return search ? targets.filter(target =>
      `${target.character_name} ${target.ship_type} ${target.latest?.location_name || ''}`.toLocaleLowerCase().includes(search)) : targets
  }, [targets, query])
  const selected = targets.find(target => target.key === selectedKey) || null
  const targetPageCount = Math.ceil(filtered.length / LIST_BATCH_SIZE)
  const currentTargetPage = Math.min(targetPage, Math.max(0, targetPageCount - 1))
  const targetStart = currentTargetPage * LIST_BATCH_SIZE
  const visibleTargets = filtered.slice(targetStart, targetStart + LIST_BATCH_SIZE)
  const historyCount = selected?.history.length ?? 0
  const historyPageCount = Math.ceil(historyCount / LIST_BATCH_SIZE)
  const currentHistoryPage = Math.min(historyPage, Math.max(0, historyPageCount - 1))
  const historyStart = currentHistoryPage * LIST_BATCH_SIZE
  useEffect(() => {
    setTargetPage(page => Math.min(page, Math.max(0, targetPageCount - 1)))
  }, [targetPageCount])
  useEffect(() => {
    setHistoryPage(page => Math.min(page, Math.max(0, historyPageCount - 1)))
  }, [historyPageCount])
  useEffect(() => {
    if (!mobileViewport || !selectedKey) return undefined
    const frame = requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' }))
    return () => cancelAnimationFrame(frame)
  }, [mobileViewport, selectedKey])
  const canManage = !accessDenied && ['founder', 'commander'].includes(snapshot?.role || organization.role)
  const runPirate = useCallback(async (action, payload) => {
    const response = await sendPirateCommand(organization.id, board.id, { action, request_id: newRequestId(), ...payload })
    await refresh({ quiet: true })
    return response.result
  }, [organization.id, board.id, refresh])
  const runAdmin = useCallback(async (action, payload) => {
    const response = await sendTacticalCommand(organization.id, { action, request_id: newRequestId(), ...payload })
    return response.result
  }, [organization.id])
  if (accessDenied) return <section className="pirate-board" aria-label="海盗情报板工作区">
    <div className="pirate-organization-controls">{organizationControls}</div>
    <div className="pirate-access-denied" role="alert"><strong>无法读取这块情报板</strong>
      <p>组织权限或战术板状态已变化。可以切换组织，或刷新后重试。</p>
      <button type="button" className="tac-btn" onClick={() => refresh()}>重新读取</button></div>
  </section>
  return <section className={`pirate-board pirate-immersive${mobileViewport ? '' : ' tac-immersive'}`} aria-label="海盗情报板工作区">
    <header className="pirate-board-head tac-command-bar">
      <div className="pirate-board-identity tac-command-identity">
        <div className="pirate-board-title tac-command-title"><Radar size={20} /><h1>海盗情报板</h1></div>
        <div className="pirate-organization-controls">{organizationControls}</div>
        <span className="pirate-board-name">{board.name}</span>
      </div>
      <div className="pirate-board-actions tac-command-links">
        {canManage && <button type="button" className="tac-btn is-small" onClick={() => setMembersOpen(true)}><Users size={16} /> 成员管理</button>}
        <button type="button" className="tac-icon-btn" aria-label="创建或加入组织" title="创建或加入组织" onClick={onOpenOrganization}><Plus size={18} /></button>
        <button type="button" className="tac-icon-btn" aria-label="刷新目标线索" title="刷新目标线索" onClick={() => refresh()}><RefreshCw size={17} /></button>
        <button type="button" className="tac-btn is-primary" onClick={() => { setReportLocation(null); setFormOpen(true) }}><Plus size={16} /> 上报目标线索</button>
      </div>
    </header>
    <div className="pirate-board-summary" aria-label="情报概况">
      <span><strong>{snapshot?.target_count ?? '—'}</strong> 未撤下目标</span>
      <span><strong>{currentTargets.length}</strong> 当前时段可能活跃</span>
      <small>{snapshot?.role === 'scout' ? '仅统计你上报的线索' : '组织可见线索'} · 非实时定位</small>
    </div>
    <div className="pirate-board-messages" aria-live="polite">
      {error && <p role="alert" className="tac-error">{error}</p>}
      {notice && <p role="status" className="tac-notice">{notice}</p>}
    </div>
    <div className="pirate-board-layout">
      <aside className="pirate-target-panel" aria-label="目标线索列表">
        <label className="pirate-target-search"><Search size={17} /><input type="search" value={query} onChange={event => {
          setQuery(event.target.value)
          setTargetPage(0)
          if (event.target.value.trim()) setTargetListOpen(true)
        }} placeholder="搜索角色、船型或地点" aria-label="搜索目标线索" /></label>
        <section className="pirate-active-targets" aria-label="当前时段可能活跃">
          <div className="pirate-active-head"><span>当前时段可能活跃</span><strong>{currentTargets.length}</strong></div>
          <p>按目击与每日 UTC 时段推测，不代表实时位置。</p>
          {currentTargets.length ? <div className="pirate-active-list">{currentTargets.slice(0, 4).map(target => <button type="button" key={target.key}
            onClick={() => selectTarget(target.key)}><span><strong>{target.character_name}</strong><small>{target.ship_type} · {target.latest.location_name}</small></span>
            <small>{ageLabel(target.latest.observed_at, serverNow)}</small></button>)}</div> :
            <small className="pirate-active-empty">暂无符合时段且近 48 小时内目击的目标</small>}
          {currentTargets.length > 4 && <small className="pirate-active-more">另有 {currentTargets.length - 4} 个，可用上方搜索框查找。</small>}
        </section>
        <div className="pirate-target-list-head"><span>目标线索 <strong>{filtered.length}</strong></span>
          <button type="button" aria-expanded={targetListOpen} onClick={() => setTargetListOpen(open => !open)}>
            {targetListOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{targetListOpen ? '收起' : '展开'}
          </button></div>
        {targetListOpen && (loading && !snapshot ? <p className="pirate-empty">正在读取目标线索…</p> : filtered.length ?
          <div className="pirate-target-list">{visibleTargets.map(target => <button type="button" key={target.key}
            className={`pirate-target-row ${selectedKey === target.key ? 'is-selected' : ''}`} onClick={() => selectTarget(target.key)}>
            <span className="pirate-target-identity"><strong>{target.character_name} · {target.ship_type}</strong><small>{target.latest ? `${target.latest.location_name} · ${target.latest.location_kind === 'system' ? '精确星系' : '星座范围'}${isLocationInPirateMap(target.latest, coverage) === false ? ' · 当前星图范围外' : ''}` : '已撤下'}</small></span>
            <span className="pirate-target-meta">{target.latest ? `${isHistoricalSighting(target.latest, serverNow) ? '历史线索 · ' : '最近目击 · '}${ageLabel(target.latest.observed_at, serverNow)}` : '仅有历史记录'}</span>
          </button>)}{targetPageCount > 1 && <div className="pirate-list-pager">
            <span role="status">已显示 {targetStart + 1}–{targetStart + visibleTargets.length} / {filtered.length}</span>
            <div className="pirate-list-pager-actions">
              <button type="button" aria-label="上一页目标" disabled={currentTargetPage === 0} onClick={event => {
                setTargetPage(currentTargetPage - 1); event.currentTarget.closest('.pirate-target-list')?.scrollTo(0, 0)
              }}>上一页</button>
              <button type="button" aria-label="下一页目标" disabled={currentTargetPage >= targetPageCount - 1} onClick={event => {
                setTargetPage(currentTargetPage + 1); event.currentTarget.closest('.pirate-target-list')?.scrollTo(0, 0)
              }}>下一页</button>
            </div>
          </div>}</div> : <div className="pirate-empty"><Crosshair size={22} /><strong>{query ? '没有匹配的目标' : '尚无目标线索'}</strong>
            <span>{query ? '试试角色名或船型的其他关键词。' : '上报角色名、船型与观测地点，开始积累线索。'}</span></div>)}
      </aside>
      {selected && <section ref={detailRef} className="pirate-detail" aria-label="目标详情"><div className="pirate-detail-head"><div><small>目标档案</small><h2>{selected.character_name} · {selected.ship_type}</h2></div>
          <button type="button" aria-label="关闭目标详情" onClick={() => setSelectedKey(null)}><X size={17} /></button></div>
          {selected.latest && isHistoricalSighting(selected.latest, serverNow) && <p className="pirate-history-caution">历史线索：这次目击已超过 48 小时，并非实时位置。</p>}
          {selected.latest && isLocationInPirateMap(selected.latest, coverage) === false && <p className="pirate-history-caution">该地点在当前覆盖星域外，线索仍保留在列表中；调整范围后才会出现在星图上。</p>}
          {selected.latest ? <div className="pirate-detail-facts"><span><MapPinned size={16} /> {selected.latest.location_name} · {selected.latest.location_kind === 'system' ? '精确星系' : '星座范围'}</span>
            <span><Clock3 size={16} /> {new Date(selected.latest.observed_at).toLocaleString()}</span>
            <span>{activityWindowLabel(selected.latest.activity_start_utc, selected.latest.activity_end_utc)}</span></div> : <p>当前没有有效目击，以下为历史记录。</p>}
          <div className="pirate-history"><h3>目击记录 · {selected.count}</h3>{selected.history.slice(historyStart, historyStart + LIST_BATCH_SIZE).map(row => <div className="pirate-history-row" key={row.id}>
            <div><strong>{row.location_name}</strong><small>{row.location_kind === 'system' ? '精确星系' : '星座范围'} · {new Date(row.observed_at).toLocaleString()}</small>
              <small>{row.author_name || '上报者'} 上报 {row.status === 'withdrawn' ? '· 已撤下' : ''}</small>{row.notes && <p>{row.notes}</p>}</div>
            {row.status === 'active' && (canManage || row.author_id === snapshot?.user_id) && <button type="button" className="tac-btn is-small" onClick={() => setWithdrawRow(row)}>撤下</button>}
          </div>)}{historyPageCount > 1 && <div className="pirate-list-pager">
            <span role="status">已显示 {historyStart + 1}–{historyStart + Math.min(LIST_BATCH_SIZE, historyCount - historyStart)} / {historyCount}</span>
            <div className="pirate-list-pager-actions">
              <button type="button" aria-label="上一页目击记录" disabled={currentHistoryPage === 0} onClick={() => {
                setHistoryPage(currentHistoryPage - 1); detailRef.current?.scrollTo(0, 0)
              }}>上一页</button>
              <button type="button" aria-label="下一页目击记录" disabled={currentHistoryPage >= historyPageCount - 1} onClick={() => {
                setHistoryPage(currentHistoryPage + 1); detailRef.current?.scrollTo(0, 0)
              }}>下一页</button>
            </div>
          </div>}</div>
        </section>}
      <div className="pirate-map-toolbar"><span><MapPinned size={16} /> {snapshot?.scope?.region_ids?.length || 0} 个星域</span>
        {canManage && <button type="button" onClick={() => setScopeOpen(true)}>调整范围</button>}</div>
      <button type="button" className="pirate-mobile-map-toggle" onClick={() => setMapOpen(current => !current)}>{mapOpen ? '收起星图' : '查看星图'}</button>
      <div className={`pirate-map-frame ${mapOpen ? 'is-mobile-open' : ''}`}>
        {!hasScope ? <div className="pirate-map-empty"><MapPinned size={28} />
          <strong>尚未选择情报覆盖星域</strong><p>先选星域，目标位置会依照真实星系与星门呈现。</p>
          {canManage && <button type="button" className="tac-btn is-primary" onClick={() => setScopeOpen(true)}>选择覆盖星域</button>}</div> :
          mapError ? <div className="pirate-map-empty" role="alert"><strong>星图暂时无法读取</strong><p>{mapError}</p>
            <button type="button" className="tac-btn" onClick={() => setMapRetry(value => value + 1)}>重试加载星图</button></div> :
          mapData && !(mobileViewport && !mapOpen) ? <PirateIntelMap mapData={mapData} targets={targets} selectedKey={selectedKey} now={serverNow} selectedSystemId={reportLocation?.id}
            focusTargetKey={selectedKey} focusRequestId={focusRequestId}
            onSelectTarget={target => { selectTarget(target.key); setMapOpen(true) }}
            onSelectSystem={system => { const location = { ...system, id: system.id ?? system.system_id, name: system.zh_name ?? system.name ?? system.system_name ?? system.location_name }; setReportLocation(location); setFormOpen(true); setMapOpen(true) }} /> :
            <div className="pirate-map-empty">正在加载真实星图…</div>}
      </div>
    </div>
    {formOpen && <PirateSightingForm organizationId={organization.id} boardId={board.id} initialLocation={reportLocation}
      onClose={() => { setFormOpen(false); setReportLocation(null) }}
      onSaved={async () => { await refresh({ quiet: true }); setNotice('目标线索已记录。') }} />}
    {scopeOpen && snapshot && <ScopeEditor variant="pirate" organizationId={organization.id} scope={snapshot.scope} execute={runPirate} onClose={() => setScopeOpen(false)} />}
    {membersOpen && <TacticalMembers organizationId={organization.id} role={snapshot?.role || organization.role} execute={runAdmin}
      onClose={() => setMembersOpen(false)} onAccessDenied={() => {
        setMembersOpen(false); setSnapshot(null); setMapData(null); setAccessDenied(true)
        setSelectedKey(null); setFormOpen(false); setScopeOpen(false); setWithdrawRow(null)
        setError('组织访问权限已变化。')
      }} />}
    {withdrawRow && <WithdrawDialog sighting={withdrawRow} organizationId={organization.id} boardId={board.id}
      onClose={() => setWithdrawRow(null)} onSaved={async () => { await refresh({ quiet: true }); setNotice('线索已撤下，历史记录仍保留。') }} />}
  </section>
}
