import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { anomalySnapshotState, formatAnomalyUpdatedAt, rankAnomalyRegions, rankAnomalySystems } from '../../utils/anomalyHotspots'
import './AnomalyHotspotLeaderboard.css'

const stopMapInteraction = event => event.stopPropagation()
const countLabel = value => value.toLocaleString('en-US')

export default function AnomalyHotspotLeaderboard({
  snapshot, requestFailed = false, loading = false, allowLocate = true,
  canLocateSystem = () => false, canLocateRegion = () => false,
  onLocateSystem, onLocateRegion, layerVisible = true, onLayerVisibilityChange,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState('systems')
  const [now, setNow] = useState(Date.now)
  const panelRef = useRef(null)
  const contentId = useId()
  const rows = snapshot?.systems
  const systems = useMemo(() => rankAnomalySystems(rows), [rows])
  const regionData = useMemo(() => rankAnomalyRegions(rows), [rows])
  const state = anomalySnapshotState(snapshot, { now, requestFailed, loading })

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

  const rankings = tab === 'systems' ? systems : regionData.regions
  return (
    <section ref={panelRef} className={`anomaly-hotspots-panel${collapsed ? ' is-collapsed' : ''}`}
      aria-label="异常摧毁排行榜"
      onMouseDown={stopMapInteraction} onMouseMove={stopMapInteraction}
      onMouseUp={stopMapInteraction} onClick={stopMapInteraction} onWheel={stopMapInteraction}>
      <button type="button" className="anomaly-hotspots-heading" aria-expanded={!collapsed}
        aria-controls={contentId} onClick={() => setCollapsed(value => !value)}>
        <span><strong>异常摧毁热点</strong><small>星系 / 星域 TOP 10</small></span>
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      <div id={contentId} className="anomaly-hotspots-content" hidden={collapsed}>
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
        <div className="anomaly-hotspots-rows" role="tabpanel" aria-label={tab === 'systems' ? '星系排名' : '星域排名'}>
          {state.hasSnapshot && rankings.map((row, index) => {
            const isSystem = tab === 'systems'
            const id = isSystem ? row.solar_system_id : row.region_id
            const canLocate = isSystem ? canLocateSystem(id) : canLocateRegion(row)
            const content = <>
              <span className="anomaly-hotspots-rank">{index + 1}</span>
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
            <p className="anomaly-hotspots-note">当前快照没有已确认星域归属的记录。</p> : null}
        </div>
        {tab === 'regions' && regionData.unknownRegionSystems > 0 ? (
          <p className="anomaly-hotspots-note">{countLabel(regionData.unknownRegionSystems)} 个星系归属待确认，
            共 {countLabel(regionData.unknownRegionDestroyCount)} 次摧毁未计入星域排名。</p>
        ) : null}
        {allowLocate && onLayerVisibilityChange ? (
          <label className="anomaly-hotspots-layer"><input type="checkbox" checked={layerVisible}
            onChange={event => onLayerVisibilityChange(event.target.checked)} />显示热圈</label>
        ) : null}
        <div className="anomaly-hotspots-legend" aria-label="网站显示分档">
          <span><i className="is-low" />1–80</span><span><i className="is-medium" />81–200</span><span><i className="is-high" />&gt;200</span>
        </div>
        <p className="anomaly-hotspots-updated">更新时间（北京时间）<br />{formatAnomalyUpdatedAt(snapshot?.collected_at_ms)}</p>
        <p className="anomaly-hotspots-note">统计时间范围尚未确认；以上为网站显示分档。</p>
      </div>
    </section>
  )
}
