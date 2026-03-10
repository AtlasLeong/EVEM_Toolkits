import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Route, Sparkles } from 'lucide-react'
import {
  getBoardSystems,
  getBoardStarGate,
  getConstellations,
  getRegions,
  postJumpInfo,
} from '../services/apiTacticalBoard'
import TacticalStarMap from '../components/tactical/TacticalStarMap'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'

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

  const systemNames = useMemo(() => {
    if (!systemsQuery.data) return []
    return systemsQuery.data
      .map((s) => s.zh_name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [systemsQuery.data])

  const totalDistance = useMemo(() => {
    return pathRows.reduce((sum, row) => sum + Number(row.distance || 0), 0).toFixed(2)
  }, [pathRows])

  const routeSummary = useMemo(() => {
    if (!pathRows.length) return []

    const groups = []
    let current = null

    pathRows.forEach((step) => {
      const moveType = step?.end?.move_type || step?.start?.move_type || '常规跃迁'
      if (!current || current.moveType !== moveType) {
        current = {
          moveType,
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
    if (!startSystem || !endSystem) {
      setError('请先选择起点和终点星系')
      return
    }

    jumpMutation.mutate({
      start_system: startSystem,
      end_system: endSystem,
      max_distance: Number(maxDistance),
      dict_road: dictRoad,
      inHighSecurity,
    })
  }

  return (
    <>
      <PageHeader
        title="星系导航"
        subtitle="恢复核心交互星图浏览，并将自动路径规划直接映射到星图高亮"
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
        <Panel title="交互星图" subtitle="支持搜索定位、拖拽缩放、点击设起终点和路径高亮">
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
            />
          )}
        </Panel>

        <Panel title="路径条件" subtitle="也可直接在上方星图里点选起点和终点">
          <div className="field-grid route-condition-grid">
            <div className="field-row">
              <label>起点星系</label>
              <input
                className="text-input"
                list="systems-list"
                value={startSystem}
                onChange={(e) => setStartSystem(e.target.value)}
                placeholder="输入中文星系名"
              />
            </div>
            <div className="field-row">
              <label>终点星系</label>
              <input
                className="text-input"
                list="systems-list"
                value={endSystem}
                onChange={(e) => setEndSystem(e.target.value)}
                placeholder="输入中文星系名"
              />
            </div>
            <div className="field-row">
              <label>最大跃迁距离</label>
              <input
                className="text-input"
                type="number"
                min={1}
                max={20}
                value={maxDistance}
                onChange={(e) => setMaxDistance(e.target.value)}
              />
            </div>
            <div className="field-row">
              <label>策略</label>
              <div className="toggle-row">
                <label>
                  <input type="checkbox" checked={inHighSecurity} onChange={(e) => setInHighSecurity(e.target.checked)} />
                  包含高安
                </label>
                <label>
                  <input type="checkbox" checked={dictRoad} onChange={(e) => setDictRoad(e.target.checked)} />
                  允许人工跳点
                </label>
              </div>
            </div>
          </div>

          <datalist id="systems-list">
            {systemNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <div className="right-actions">
            <button className="primary-btn" onClick={onPlanRoute} disabled={jumpMutation.isPending}>
              <Route size={14} />
              计算路径
            </button>
          </div>

          {jumpMutation.isPending && <LoadingBar />}
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
                  {pathRows.map((step, idx) => (
                    <tr key={`${step.start.system_id}-${step.end.system_id}-${idx}`}>
                      <td>{step.start.zh_name}</td>
                      <td>{step.end.zh_name}</td>
                      <td>{step.end.move_type}</td>
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
                <Pill key={`${item.moveType}-${index}`}>
                  {item.moveType} · {item.startName} → {item.endName} · {item.count} 段
                </Pill>
              ))}
            </div>
          </Panel>
        ) : null}

        <Panel title="提示" subtitle="提升规划成功率">
          <ul className="hint-list">
            <li>先在星图中定位系统，再点选起点和终点，命中率比手输更高。</li>
            <li>缩放到中近景时会显示星门网络，便于判断路径结构。</li>
            <li>若跨区路径失败，可先用较短距离分段规划，再串联结果。</li>
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
