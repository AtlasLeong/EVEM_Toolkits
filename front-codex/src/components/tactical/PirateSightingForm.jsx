import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { getTacticalCatalog, newRequestId, sendPirateCommand } from '../../services/apiTacticalCollaboration'
import { localDateTime } from '../../utils/tacticalCollaboration'
import { sightingPayload } from '../../utils/pirateIntel'
import { TacticalDialog } from './TacticalControls'

function LocationPicker({ organizationId, kind, selected, onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const label = kind === 'system' ? '搜索星系' : '搜索星座'
  useEffect(() => {
    let active = true
    if (!query.trim()) { setResults([]); setLoading(false); return () => { active = false } }
    setLoading(true)
    const timer = setTimeout(() => getTacticalCatalog(organizationId, kind === 'system' ? 'systems' : 'constellations', query.trim())
      .then(data => { if (active) { setResults(data.results || []); setError('') } })
      .catch(failure => { if (active) setError(failure.message) })
      .finally(() => { if (active) setLoading(false) }), 250)
    return () => { active = false; clearTimeout(timer) }
  }, [organizationId, kind, query])
  return <div className="tac-system-picker">
    <label className="tac-field"><span>{label}</span><div className="tac-search"><Search size={16} />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`输入${kind === 'system' ? '星系' : '星座'}名称`} aria-label={label} autoComplete="off" />
    </div></label>
    {selected && <div className="tac-location-value"><span>已选：{selected.name}</span>
      <button type="button" aria-label="清除所选地点" onClick={() => onSelect(null)}><X size={14} /></button></div>}
    {query && <div className="tac-system-results" role="group" aria-label={`${label}结果`}>
      {loading ? <p>搜索中…</p> : results.length ? results.map(item => <button type="button" key={item.id}
        onClick={() => { onSelect(item); setQuery('') }}><span>{item.name}<small>{item.region_name}</small></span>
        {kind === 'system' && <span className="tac-security">{Number(item.security_status).toFixed(2)}</span>}</button>) : <p>未找到，请更换关键词</p>}
    </div>}
    {error && <p role="alert" className="tac-error">{error}</p>}
  </div>
}

export default function PirateSightingForm({ organizationId, boardId, initialLocation = null, onClose, onSaved }) {
  const [characterName, setCharacterName] = useState('')
  const [shipType, setShipType] = useState('')
  const [locationKind, setLocationKind] = useState('system')
  const [location, setLocation] = useState(initialLocation)
  const [observedAt, setObservedAt] = useState(() => localDateTime())
  const [activityStart, setActivityStart] = useState('')
  const [activityEnd, setActivityEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef(null)
  useEffect(() => {
    if (!initialLocation) return
    setLocationKind('system')
    setLocation(initialLocation)
  }, [initialLocation])
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    let payload
    try {
      payload = sightingPayload({ character_name: characterName, ship_type: shipType,
        location_kind: locationKind, location_id: location?.id, observed_at: observedAt,
        activity_start_utc: activityStart, activity_end_utc: activityEnd, notes })
    } catch (failure) { setError(failure.message); return }
    const signature = JSON.stringify(payload)
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: newRequestId() }
    setBusy(true); setError('')
    try {
      await sendPirateCommand(organizationId, boardId, { action: 'sighting.create', request_id: attempt.current.requestId, ...payload })
      await onSaved()
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <TacticalDialog title="上报目标线索" onClose={onClose}>
    <form className="tac-form" onSubmit={submit}>
      <p className="tac-muted">一条线索对应一名角色与一种精确船型；下次目击可继续为同一目标上报。观测不等于目标仍在现场。</p>
      <div className="tac-form-grid">
        <label className="tac-field"><span>目标角色名</span><input required maxLength={120} value={characterName} onChange={event => setCharacterName(event.target.value)} placeholder="游戏内角色名" /></label>
        <label className="tac-field"><span>精确船型</span><input required maxLength={120} value={shipType} onChange={event => setShipType(event.target.value)} placeholder="如：夜神级" /></label>
      </div>
      <fieldset className="tac-field"><legend>地点精度</legend><div className="tac-segmented">
        <button type="button" aria-pressed={locationKind === 'system'} onClick={() => { setLocationKind('system'); setLocation(null) }}>精确星系</button>
        <button type="button" aria-pressed={locationKind === 'constellation'} onClick={() => { setLocationKind('constellation'); setLocation(null) }}>星座范围</button>
      </div></fieldset>
      <LocationPicker organizationId={organizationId} kind={locationKind} selected={location} onSelect={setLocation} />
      <label className="tac-field"><span>观测时间</span><input type="datetime-local" required value={observedAt} onChange={event => setObservedAt(event.target.value)} /></label>
      <fieldset className="tac-field"><legend>常见活跃时段 <small>选填 · UTC</small></legend>
        <div className="tac-form-grid"><label className="tac-field"><span>开始</span><input type="time" value={activityStart} onChange={event => setActivityStart(event.target.value)} /></label>
          <label className="tac-field"><span>结束</span><input type="time" value={activityEnd} onChange={event => setActivityEnd(event.target.value)} /></label></div>
        <small>跨午夜的时段会显示“次日”，这是活动规律，不代表实时在线。</small>
      </fieldset>
      <label className="tac-field"><span>线索备注 <small>选填</small></span><textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="如：工作日深夜常见；来源及可信度" /></label>
      {error && <p role="alert" className="tac-error">{error}</p>}
      <div className="tac-form-footer"><button type="button" className="tac-btn" onClick={onClose}>取消</button><button className="tac-btn is-primary" disabled={busy || !location}>{busy ? '提交中…' : '提交线索'}</button></div>
    </form>
  </TacticalDialog>
}
