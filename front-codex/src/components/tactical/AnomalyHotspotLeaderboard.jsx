import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { ANOMALY_HEAT_BANDS, anomalySnapshotState, formatAnomalyUpdatedAt, rankAnomalyRegions, rankAnomalySystems } from '../../utils/anomalyHotspots'
import { formatHotspotElapsed, rankHotspotChanges } from '../../utils/hotspotChanges'
import './AnomalyHotspotLeaderboard.css'

const stopMapInteraction = event => event.stopPropagation()
const countLabel = value => value.toLocaleString('en-US')
const cannotLocate = () => false
const DEFAULT_RESULT_LIMIT = 10
const SEARCH_RESULT_LIMIT = 100

function ChangesContent({ changes, allowLocate, canLocateSystem, onLocateSystem, now }) {
  const [query, setQuery] = useState('')
  const rowsRef = useRef(null)
  const rows = useMemo(() => rankHotspotChanges(changes.data?.systems), [changes.data?.systems])
  const search = query.trim().toLocaleLowerCase()
  const matching = useMemo(() => rows.filter(row => !search || [row.displayName, row.region_name, row.solar_system_id]
    .some(value => String(value ?? '').toLocaleLowerCase().includes(search))), [rows, search])
  useEffect(() => { if (rowsRef.current) rowsRef.current.scrollTop = 0 }, [search, changes.data?.interval?.id])
  const data = changes.error ? null : changes.data
  const latestStale = changes.interval == null && data?.status === 'ok'
    && now - data.interval.end_at_ms >= 20 * 60_000
  return <>
    <div className="anomaly-hotspots-search">
      <Search size={14} aria-hidden="true" />
      <input type="search" aria-label="变化榜内搜索" placeholder="搜索名称、星域或 ID" value={query} onChange={event => setQuery(event.target.value)} />
      {query ? <button type="button" aria-label="清空变化榜搜索" onClick={() => setQuery('')}><X size={14} /></button> : null}
    </div>
    <label className="anomaly-changes-history">历史区间（保留 30 天）
      <select aria-label="变化榜历史区间" value={changes.interval || ''} onChange={event => changes.onSelectInterval?.(event.target.value ? Number(event.target.value) : null)}>
        <option value="">最新成功区间</option>
        {(changes.intervals || data?.intervals || []).map(item => <option key={item.id} value={item.id}>
          {formatAnomalyUpdatedAt(item.end_at_ms)} · {formatHotspotElapsed(item.elapsed_ms)}
        </option>)}
      </select>
    </label>
    {changes.nextBefore ? <button className="anomaly-changes-more" type="button" disabled={changes.historyLoading} onClick={changes.onLoadOlder}>
      {changes.historyLoading ? '正在读取历史…' : changes.historyError ? '重试加载更早区间' : '加载更早区间'}</button> : null}
    {changes.historyError ? <p className="anomaly-hotspots-note" role="alert">历史区间加载失败，当前区间仍可查看。点击上方按钮重试。</p> : null}
    <p className="anomaly-hotspots-status" role="status">{changes.error ? '变化榜暂时无法读取，请稍后重试。'
      : changes.loading ? '正在读取变化榜'
        : data?.status === 'baseline' ? '等待第二次成功采集'
          : data?.status === 'ok' ? '相邻成功快照净增量' : '暂无可比较快照'}</p>
    {latestStale ? <p className="anomaly-hotspots-status is-warning" role="status">最新区间已超过 20 分钟未更新。</p> : null}
    {data?.interval ? <p className="anomaly-hotspots-note anomaly-changes-period">
      {formatAnomalyUpdatedAt(data.interval.start_at_ms)}<br />→ {formatAnomalyUpdatedAt(data.interval.end_at_ms)}
      <br />实际间隔 {formatHotspotElapsed(data.interval.elapsed_ms)}
    </p> : null}
    {search && data?.status === 'ok' ? <p className="anomaly-hotspots-search-summary">匹配 {matching.length} 条 · 保留全榜排名</p> : null}
    <div ref={rowsRef} className="anomaly-hotspots-rows" role="tabpanel" aria-label="变化排名">
      {data?.status === 'ok' && matching.slice(0, search ? 100 : 10).map(row => {
        const canLocate = canLocateSystem(row.solar_system_id)
        const content = <>
          <span className="anomaly-hotspots-rank">{row.globalRank}</span>
          <span className="anomaly-hotspots-name"><strong>{row.displayName}</strong><small>{row.region_name || '星域归属待确认'}</small>
            <small>{countLabel(row.previous_destroy_num)} → {countLabel(row.destroy_num)}</small>
            {allowLocate && !canLocate ? <small>暂无地图坐标</small> : null}</span>
          <span className="anomaly-hotspots-count anomaly-changes-count">+{countLabel(row.delta)}<small>净增量</small></span>
        </>
        return allowLocate ? <button className="anomaly-hotspots-row" key={row.solar_system_id} type="button" disabled={!canLocate}
          aria-label={`定位星系 ${row.displayName}，净增量 ${row.delta}`} onClick={() => onLocateSystem?.(row.solar_system_id)}>{content}</button>
          : <div className="anomaly-hotspots-row" key={row.solar_system_id}>{content}</div>
      })}
      {data?.status === 'ok' && !matching.length ? <p className="anomaly-hotspots-note">{search ? '没有匹配的星系。' : '该区间没有可确认的正增长星系。'}</p> : null}
    </div>
    <div className="anomaly-hotspots-footer">
      {data?.coverage && data.status === 'ok' ? <p className="anomaly-hotspots-note">可比 {data.coverage.comparable} · 新增 {data.coverage.new} · 缺失 {data.coverage.missing} · 回落 {data.coverage.negative}</p> : null}
      <p className="anomaly-hotspots-note">仅排行正增长；新增、缺失、回落不计。失败不会记为零。统计周期未确认，快照净增量不等于精确新增摧毁量。</p>
    </div>
  </>
}

function AnomalyHotspotLeaderboard({
  snapshot, requestFailed = false, loading = false, allowLocate = true,
  canLocateSystem = cannotLocate, canLocateRegion = cannotLocate,
  onLocateSystem, onLocateRegion, layerVisible = true, onLayerVisibilityChange, onMapInteractionEnd,
  changes = null,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState('systems')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(Date.now)
  const panelRef = useRef(null)
  const rowsRef = useRef(null)
  const contentId = useId()
  const rows = snapshot?.systems
  const systems = useMemo(() => rankAnomalySystems(rows, rows?.length || 0)
    .map((row, index) => ({ ...row, globalRank: index + 1 })), [rows])
  const regionData = useMemo(() => {
    const ranked = rankAnomalyRegions(rows, rows?.length || 0)
    return { ...ranked, regions: ranked.regions.map((row, index) => ({ ...row, globalRank: index + 1 })) }
  }, [rows])
  const updatedAt = useMemo(() => formatAnomalyUpdatedAt(snapshot?.collected_at_ms), [snapshot?.collected_at_ms])
  const state = anomalySnapshotState(snapshot, { now, requestFailed, loading })
  const isChanges = changes?.allowed === true && changes.mode === 'changes'

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    // The map has a native wheel listener. Stop at this node before it reaches
    // that listener, while allowing the leaderboard's own row scrolling.
    const panel = panelRef.current
    panel?.addEventListener('wheel', stopMapInteraction, { passive: true })
    return () => panel?.removeEventListener('wheel', stopMapInteraction)
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingRows = useMemo(() => {
    const rankings = tab === 'systems' ? systems : regionData.regions
    if (!normalizedQuery) return rankings
    return rankings.filter(row => [row.displayName, row.region_name,
      tab === 'systems' ? row.solar_system_id : row.region_id]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery)))
  }, [systems, regionData, tab, normalizedQuery])
  const rankings = matchingRows.slice(0, normalizedQuery ? SEARCH_RESULT_LIMIT : DEFAULT_RESULT_LIMIT)
  useEffect(() => {
    if (rowsRef.current) rowsRef.current.scrollTop = 0
  }, [normalizedQuery, tab])
  return (
    <section ref={panelRef} className={`anomaly-hotspots-panel${collapsed ? ' is-collapsed' : ''}`}
      aria-label="犁地热点排行榜"
      onMouseDown={stopMapInteraction} onMouseMove={stopMapInteraction}
      onMouseUp={event => { stopMapInteraction(event); onMapInteractionEnd?.() }}
      onClick={stopMapInteraction} onWheel={stopMapInteraction}>
      <div className="anomaly-hotspots-header">
        <button type="button" className="anomaly-hotspots-heading" aria-expanded={!collapsed}
          aria-controls={contentId} onClick={() => setCollapsed(value => !value)}>
          <span><strong>{isChanges ? '犁地变化榜' : '犁地热点'}</strong><small>{isChanges ? '相邻快照 · 正增长 TOP 10' : '星系 / 星域 TOP 10'}</small></span>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <p className="anomaly-hotspots-updated"><span>{isChanges ? '区间结束时间（北京时间）' : '更新时间（北京时间）'}</span><br />{isChanges ? changes.error ? '暂时无法读取' : formatAnomalyUpdatedAt(changes.data?.interval?.end_at_ms) : updatedAt}</p>
      </div>
      <div id={contentId} className="anomaly-hotspots-content" hidden={collapsed}>
        {changes?.allowed === true ? <div className="anomaly-hotspots-tabs anomaly-hotspots-modes" role="tablist" aria-label="热点榜单类型">
          <button type="button" role="tab" aria-selected={!isChanges} onClick={() => changes.onModeChange?.('total')}>总量</button>
          <button type="button" role="tab" aria-selected={isChanges} onClick={() => changes.onModeChange?.('changes')}>变化</button>
        </div> : null}
        {isChanges ? <ChangesContent changes={changes} allowLocate={allowLocate} canLocateSystem={canLocateSystem} onLocateSystem={onLocateSystem} now={now} /> : <>
        <div className="anomaly-hotspots-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="榜内搜索" placeholder="搜索名称、星域或 ID"
            value={query} onChange={event => setQuery(event.target.value)} />
          {query ? <button type="button" aria-label="清空榜内搜索" onClick={() => setQuery('')}><X size={14} /></button> : null}
        </div>
        <div className="anomaly-hotspots-tabs" role="tablist" aria-label="热点排名范围">
          <button type="button" role="tab" aria-selected={tab === 'systems'}
            onClick={() => setTab('systems')}>星系</button>
          <button type="button" role="tab" aria-selected={tab === 'regions'}
            onClick={() => setTab('regions')}>星域</button>
        </div>
        <p className={`anomaly-hotspots-status is-${state.kind}`} role="status">
          {state.label}{state.stale ? <span> · 快照已陈旧</span> : null}
        </p>
        {state.detail ? <p className="anomaly-hotspots-note">{state.detail}</p> : null}
        {normalizedQuery ? <p className="anomaly-hotspots-search-summary" role="status">
          匹配 {countLabel(matchingRows.length)} 条{matchingRows.length > SEARCH_RESULT_LIMIT ? `，仅显示前 ${SEARCH_RESULT_LIMIT} 条` : ''}
          <span> · 保留全榜排名</span>
        </p> : null}
        <div ref={rowsRef} className="anomaly-hotspots-rows" role="tabpanel" aria-label={tab === 'systems' ? '星系排名' : '星域排名'}>
          {state.hasSnapshot && rankings.map(row => {
            const isSystem = tab === 'systems'
            const id = isSystem ? row.solar_system_id : row.region_id
            const canLocate = isSystem ? canLocateSystem(id) : canLocateRegion(row)
            const content = <>
              <span className="anomaly-hotspots-rank">{row.globalRank}</span>
              <span className="anomaly-hotspots-name"><strong>{row.displayName}</strong>
                <small>{isSystem ? row.region_name || '星域归属待确认' : `${row.memberSystemIds.length} 个有记录星系`}</small>
                {allowLocate && !canLocate ? <small>暂无地图坐标</small> : null}
              </span>
              <span className="anomaly-hotspots-count">{countLabel(row.destroy_num)}<small>摧毁</small></span>
            </>
            return allowLocate ? (
              <button key={id} type="button" className="anomaly-hotspots-row" disabled={!canLocate}
                aria-label={`${isSystem ? '定位星系' : '定位该星域热点'} ${row.displayName}，异常摧毁 ${row.destroy_num}`}
                title={canLocate ? isSystem ? '定位星系' : '定位该星域热点' : '暂无地图坐标'}
                onClick={() => isSystem ? onLocateSystem?.(id) : onLocateRegion?.(row)}>{content}</button>
            ) : <div key={id} className="anomaly-hotspots-row">{content}</div>
          })}
          {state.hasSnapshot && !rankings.length && tab === 'regions' ?
            <p className="anomaly-hotspots-note">{normalizedQuery ? '没有匹配的星域。' : '当前快照没有已确认星域归属的记录。'}</p> : null}
          {state.hasSnapshot && !rankings.length && normalizedQuery && tab === 'systems' ?
            <p className="anomaly-hotspots-note">没有匹配的星系。</p> : null}
        </div>
        <div className="anomaly-hotspots-footer">
        {tab === 'regions' && regionData.unknownRegionSystems > 0 ? (
          <p className="anomaly-hotspots-note">{countLabel(regionData.unknownRegionSystems)} 个星系归属待确认，
            共 {countLabel(regionData.unknownRegionDestroyCount)} 次摧毁未计入星域排名。</p>
        ) : null}
        {allowLocate && onLayerVisibilityChange ? (
          <label className="anomaly-hotspots-layer"><input type="checkbox" checked={layerVisible}
            onChange={event => onLayerVisibilityChange(event.target.checked)} />显示热圈</label>
        ) : null}
        <div className="anomaly-hotspots-legend" aria-label="热点等级与范围">
          {ANOMALY_HEAT_BANDS.map(band => <span key={band.level} data-level={band.level} aria-label={`${band.level}级热点，范围 ${band.name}`}>
            <i aria-hidden="true" style={{ backgroundColor: band.color }} />{band.level}级 {band.name}
          </span>)}
        </div>
        <p className="anomaly-hotspots-note">统计时间范围尚未确认；等级范围不是精确摧毁数。</p>
        </div>
        </>}
      </div>
    </section>
  )
}

export default memo(AnomalyHotspotLeaderboard)
