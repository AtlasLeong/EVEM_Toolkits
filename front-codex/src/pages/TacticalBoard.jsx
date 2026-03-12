import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Route, Sparkles } from 'lucide-react'
import {
  getBoardStarGate,
  getBoardSystems,
  getConstellations,
  getRegions,
  postJumpInfo,
} from '../services/apiTacticalBoard'
import TacticalStarMap from '../components/tactical/TacticalStarMap'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'

function getSystemDisplayName(system) {
  return system?.zh_name || system?.name || system?.en_name || system?.system_name || ''
}

function getSystemAliases(system) {
  return [
    ...new Set(
      [
        getSystemDisplayName(system),
        system?.zh_name,
        system?.name,
        system?.en_name,
        system?.system_name,
        system?.english_name,
        system?.name_en,
      ]
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim()),
    ),
  ]
}

function rankAlias(alias, query) {
  const lowerAlias = alias.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const startsWith = lowerAlias.startsWith(lowerQuery)
  const index = lowerAlias.indexOf(lowerQuery)

  return {
    startsWith,
    index: index === -1 ? Number.MAX_SAFE_INTEGER : index,
    length: alias.length,
  }
}

function getSecurityColor(value) {
  const level = Number(value)
  if (Number.isNaN(level)) return '#94a3b8'
  if (level <= 0) return '#ef4444'
  if (level < 0.2) return '#f97316'
  if (level < 0.5) return '#f59e0b'
  if (level < 0.8) return '#10b981'
  return '#60a5fa'
}

function getRouteTypeMeta(moveType) {
  const raw = String(moveType || '').trim()
  if (raw.includes('土路')) {
    return { label: '土路', kind: 'dirt', tone: 'warning' }
  }
  if (raw.includes('不安全')) {
    return { label: raw || '不安全诱导', kind: 'unsafe-induction', tone: 'danger' }
  }
  if (raw.includes('诱导')) {
    return { label: raw || '诱导跃迁', kind: 'induction', tone: 'danger' }
  }
  return { label: raw || '常规跳跃', kind: 'standard', tone: 'info' }
}

function RouteTypeBadge({ moveType }) {
  const meta = getRouteTypeMeta(moveType)
  return <span className={`route-type-badge is-${meta.kind}`}>{meta.label}</span>
}

function RouteSystemCombobox({ label, value, onChange, systems, placeholder }) {
  const wrapperRef = useRef(null)
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const query = value.trim()
    const source = Array.isArray(systems) ? systems : []

    return source
      .map((item) => {
        const displayName = getSystemDisplayName(item)
        const aliases = getSystemAliases(item)
        if (!displayName || !aliases.length) return null

        if (!query) {
          return {
            item,
            displayName,
            matchedAlias: aliases[0],
            rank: { startsWith: true, index: 0, length: displayName.length },
          }
        }

        let bestMatch = null
        aliases.forEach((alias) => {
          if (!alias.toLowerCase().includes(query.toLowerCase())) return
          const rank = rankAlias(alias, query)
          const isBetter =
            !bestMatch ||
            (rank.startsWith && !bestMatch.rank.startsWith) ||
            (rank.startsWith === bestMatch.rank.startsWith && rank.index < bestMatch.rank.index) ||
            (rank.startsWith === bestMatch.rank.startsWith &&
              rank.index === bestMatch.rank.index &&
              rank.length < bestMatch.rank.length)

          if (isBetter) {
            bestMatch = { alias, rank }
          }
        })

        if (!bestMatch) return null

        return {
          item,
          displayName,
          matchedAlias: bestMatch.alias,
          rank: bestMatch.rank,
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.rank.startsWith !== right.rank.startsWith) {
          return left.rank.startsWith ? -1 : 1
        }
        if (left.rank.index !== right.rank.index) {
          return left.rank.index - right.rank.index
        }
        if (left.rank.length !== right.rank.length) {
          return left.rank.length - right.rank.length
        }
        return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN')
      })
      .slice(0, 16)
  }, [systems, value])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const handleSelect = (system) => {
    onChange(getSystemDisplayName(system))
    setOpen(false)
  }

  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="route-system-picker tactical-map-search-shell" ref={wrapperRef}>
        <input
          className="text-input tactical-map-search-input"
          value={value}
          aria-label={label}
          onFocus={() => setOpen(Boolean(value.trim()))}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue)
            setOpen(Boolean(nextValue.trim()))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches.length) {
              event.preventDefault()
              handleSelect(matches[0].item)
            }
            if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
        />

        {open ? (
          <div className="tactical-search-dropdown route-system-dropdown">
            {matches.length ? (
              matches.map((match) => (
                <button
                  key={`${match.item.system_id}-${match.displayName}`}
                  type="button"
                  className="tactical-search-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(match.item)}
                >
                  <span className="tactical-search-option-copy">
                    <strong>{match.displayName}</strong>
                    {match.matchedAlias && match.matchedAlias !== match.displayName ? (
                      <em>{match.matchedAlias}</em>
                    ) : null}
                  </span>
                  <span
                    className="tactical-search-security"
                    style={{ color: getSecurityColor(match.item.security_status) }}
                  >
                    {Number(match.item.security_status).toFixed(1)}
                  </span>
                </button>
              ))
            ) : (
              <p className="route-system-empty">未找到匹配星系</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function TacticalBoardPage() {
  const [startSystem, setStartSystem] = useState('')
  const [endSystem, setEndSystem] = useState('')
  const [maxDistance, setMaxDistance] = useState(8)
  const [dictRoad, setDictRoad] = useState(false)
  const [inHighSecurity, setInHighSecurity] = useState(true)
  const [pathRows, setPathRows] = useState([])
  const [error, setError] = useState('')

  const systemsQuery = useQuery({
    queryKey: ['board-systems'],
    queryFn: getBoardSystems,
  })
  const regionsQuery = useQuery({
    queryKey: ['board-regions'],
    queryFn: getRegions,
  })
  const constellationsQuery = useQuery({
    queryKey: ['board-constellations'],
    queryFn: getConstellations,
  })
  const stargateQuery = useQuery({
    queryKey: ['board-stargate'],
    queryFn: getBoardStarGate,
  })

  const systemAliasMap = useMemo(() => {
    const map = new Map()
    ;(systemsQuery.data || []).forEach((item) => {
      const displayName = getSystemDisplayName(item)
      getSystemAliases(item).forEach((alias) => {
        map.set(alias.toLowerCase(), displayName)
      })
    })
    return map
  }, [systemsQuery.data])

  const jumpMutation = useMutation({
    mutationFn: postJumpInfo,
    onSuccess: (data) => {
      setError('')
      setPathRows(Array.isArray(data) ? data : [])
    },
    onError: (err) => {
      setPathRows([])
      setError(err.message || '路径计算失败')
    },
  })

  const totalDistance = useMemo(() => {
    return pathRows.reduce((sum, row) => sum + Number(row.distance || 0), 0).toFixed(2)
  }, [pathRows])

  const routeSummary = useMemo(() => {
    if (!pathRows.length) return []

    const groups = []
    let current = null

    pathRows.forEach((step) => {
      const meta = getRouteTypeMeta(step?.end?.move_type || step?.start?.move_type || '')
      if (!current || current.kind !== meta.kind || current.label !== meta.label) {
        current = {
          kind: meta.kind,
          label: meta.label,
          startName: step?.start?.zh_name || '-',
          endName: step?.end?.zh_name || '-',
          count: 1,
        }
        groups.push(current)
      } else {
        current.endName = step?.end?.zh_name || current.endName
        current.count += 1
      }
    })

    return groups
  }, [pathRows])

  const onPlanRoute = () => {
    const resolvedStart = systemAliasMap.get(startSystem.trim().toLowerCase()) || startSystem.trim()
    const resolvedEnd = systemAliasMap.get(endSystem.trim().toLowerCase()) || endSystem.trim()

    if (!resolvedStart || !resolvedEnd) {
      setError('请先选择起点和终点星系')
      return
    }

    if (resolvedStart !== startSystem) setStartSystem(resolvedStart)
    if (resolvedEnd !== endSystem) setEndSystem(resolvedEnd)

    jumpMutation.mutate({
      start_system: resolvedStart,
      end_system: resolvedEnd,
      max_distance: Number(maxDistance),
      dict_road: dictRoad,
      inHighSecurity,
    })
  }

  const clearPlannedRoute = () => {
    setStartSystem('')
    setEndSystem('')
    setPathRows([])
    setError('')
  }

  return (
    <>
      <PageHeader
        title="星系导航"
        subtitle="支持搜索定位、拖拽缩放、点击星系设起终点和路径高亮"
        action={
          <div className="pill-row">
            <Pill>星域 {regionsQuery.data?.length || 0}</Pill>
            <Pill>星座 {constellationsQuery.data?.length || 0}</Pill>
            <Pill>星系 {systemsQuery.data?.length || 0}</Pill>
            <Pill>星门 {stargateQuery.data?.length || 0}</Pill>
          </div>
        }
      />

      <div className="layout-main-stack">
        <Panel title="交互星图" subtitle="支持搜索定位、拖拽缩放、点击星系设起终点和路径高亮">
          {systemsQuery.isPending || stargateQuery.isPending || constellationsQuery.isPending || regionsQuery.isPending ? (
            <LoadingBar />
          ) : (
            <TacticalStarMap
              systems={systemsQuery.data || []}
              stargates={stargateQuery.data || []}
              constellations={constellationsQuery.data || []}
              regions={regionsQuery.data || []}
              pathRows={pathRows}
              startSystem={startSystem}
              endSystem={endSystem}
              onSetStart={setStartSystem}
              onSetEnd={setEndSystem}
              onClearRoute={clearPlannedRoute}
            />
          )}
        </Panel>

        <Panel
          title="路径条件"
          subtitle="可在上方星图点选星系，也可在这里搜索选择起点和终点"
          className="route-condition-panel"
        >
          <div className="field-grid route-condition-grid">
            <RouteSystemCombobox
              label="起点星系"
              value={startSystem}
              onChange={setStartSystem}
              systems={systemsQuery.data || []}
              placeholder="输入中文或英文星系名"
            />
            <RouteSystemCombobox
              label="终点星系"
              value={endSystem}
              onChange={setEndSystem}
              systems={systemsQuery.data || []}
              placeholder="输入中文或英文星系名"
            />
            <div className="field-row">
              <label>最大跳跃距离</label>
              <input
                className="text-input"
                type="number"
                min={1}
                max={20}
                value={maxDistance}
                onChange={(event) => setMaxDistance(event.target.value)}
              />
            </div>
            <div className="field-row">
              <label>规划条件</label>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={inHighSecurity}
                    onChange={(event) => setInHighSecurity(event.target.checked)}
                  />
                  包含高安
                </label>
                <label>
                  <input type="checkbox" checked={dictRoad} onChange={(event) => setDictRoad(event.target.checked)} />
                  是否走土路
                </label>
              </div>
            </div>
          </div>

          <div className="right-actions">
            <button className="primary-btn" onClick={onPlanRoute} disabled={jumpMutation.isPending}>
              <Route size={14} />
              计算路径
            </button>
          </div>

          {jumpMutation.isPending ? <LoadingBar /> : null}
        </Panel>

        <Panel title="路径结果" subtitle={pathRows.length ? `总跳数 ${pathRows.length} · 总距离 ${totalDistance}` : '尚未计算'}>
          {error ? <p className="form-error">{error}</p> : null}
          {pathRows.length ? (
            <div className="table-shell tall">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>起点</th>
                    <th>终点</th>
                    <th>方式</th>
                    <th>距离</th>
                  </tr>
                </thead>
                <tbody>
                  {pathRows.map((step, index) => (
                    <tr key={`${step.start.system_id}-${step.end.system_id}-${index}`}>
                      <td>{step.start.zh_name}</td>
                      <td>{step.end.zh_name}</td>
                      <td>
                        <div className="route-type-cell">
                          <RouteTypeBadge moveType={step.end.move_type || step.start.move_type} />
                        </div>
                      </td>
                      <td>{step.distance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="暂无路径" desc="请先设置参数后计算路径" />
          )}
        </Panel>

        {routeSummary.length ? (
          <Panel title="分段预览" subtitle="按移动方式聚合当前规划结果">
            <div className="pill-row">
              {routeSummary.map((item, index) => (
                <Pill key={`${item.label}-${item.startName}-${index}`} tone={getRouteTypeMeta(item.label).tone}>
                  <RouteTypeBadge moveType={item.label} />
                  {item.startName} → {item.endName} · {item.count} 段
                </Pill>
              ))}
            </div>
          </Panel>
        ) : null}

        <Panel title="提示" subtitle="提升规划成功率">
          <ul className="hint-list">
            <li>先在星图中定位系统，再点选星系查看详情，命中率会比手输更高。</li>
            <li>缩放到中近景时会显示星门网络，便于判断路径结构。</li>
            <li>不同移动方式现在会用独立颜色显示，方便快速分辨常规跳跃、土路和诱导段。</li>
          </ul>
          <div className="right-actions">
            <Pill>
              <Sparkles size={12} />
              核心星图已恢复
            </Pill>
          </div>
        </Panel>
      </div>
    </>
  )
}
