import { useContext, useEffect, useMemo, useState } from 'react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownUp, Calculator, CheckSquare, ChevronDown, ChevronUp, Plus, Search, Square, X } from 'lucide-react'
import { getConstellations, getRegionList, getSolarSystems } from '../services/apiStarField'
import { getPlanetResources, searchPlanetResources } from '../services/apiPlanetaryResource'
import PlanetaryCalculatorModal, { buildCalculatorRow } from '../components/planetary/PlanetaryCalculatorModal'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import { AuthContext } from '../context/AuthContext'
import FilterDisclosure from '../components/ui/FilterDisclosure'

const levelMap = {
  1: '贫瘠',
  2: '中等',
  3: '富饶',
  4: '完美',
}

const fuelFactorMap = {
  重水: 2,
  悬浮等离子: 5,
  液化臭氧: 13,
  离子溶液: 37,
  同位素燃料: 83,
  等离子体团: 191,
}

function getFuelValue(resourceName, resourceYield) {
  return (fuelFactorMap[resourceName] || 0) * Number(resourceYield || 0)
}

function enrichSearchRow(row, index) {
  return {
    ...row,
    key: row.key ?? row.id ?? `${row.solar_system || 'system'}-${row.planet_id || 'planet'}-${row.resource_name || index}-${index}`,
    fuel_value: row.fuel_value ?? getFuelValue(row.resource_name, row.resource_yield),
  }
}

function getSecurityClass(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return 'sec-mid'
  if (num <= 0) return 'sec-null'
  if (num < 0.2) return 'sec-low'
  if (num < 0.5) return 'sec-warm'
  if (num < 0.8) return 'sec-safe'
  return 'sec-high'
}

function SecurityBadge({ value }) {
  if (value === null || value === undefined || value === '') return null
  return <span className={`security-badge ${getSecurityClass(value)}`}>{value}</span>
}

function SelectionSummary({ items }) {
  const first = items[0]
  if (!first) return null
  return (
    <span className="filter-selection">
      {first.icon ? <img className="filter-selection-icon" src={first.icon} alt="" /> : null}
      <span className="filter-selection-name">{first.label || first.value}</span>
      <SecurityBadge value={first.security} />
      {items.length > 1 ? <span className="filter-selection-count">+{items.length - 1} 项</span> : null}
    </span>
  )
}

function LevelBadge({ value }) {
  const label = levelMap[value] || value
  return <span className={`level-badge level-${value}`}>{label}</span>
}

function buildLocationPayload({ regionIds, constellationIds, systemIds }) {
  if (systemIds.length) {
    return {
      regionValue: [],
      constellationValue: [],
      systemValue: systemIds,
    }
  }

  if (constellationIds.length) {
    return {
      regionValue: [],
      constellationValue: constellationIds,
      systemValue: [],
    }
  }

  return {
    regionValue: regionIds,
    constellationValue: [],
    systemValue: [],
  }
}

function SearchableMultiPicker({
  label,
  placeholder,
  options,
  selectedValues,
  onChange,
  disabled = false,
  loading = false,
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues])

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options
    const keyword = query.trim().toLowerCase()
    return options.filter((item) => item.label.toLowerCase().includes(keyword))
  }, [options, query])

  const selectedOptions = useMemo(
    () => options.filter((item) => selectedSet.has(item.value)),
    [options, selectedSet],
  )

  const toggleValue = (value) => {
    if (disabled) return
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((item) => item !== value))
      return
    }
    onChange([...selectedValues, value])
  }

  const clearOne = (value) => {
    searchRef.current?.focus()
    onChange(selectedValues.filter((item) => item !== value))
  }

  return (
    <FilterDisclosure
      className="picker-field"
      label={label}
      value={disabled ? '请先完成上一级筛选' : selectedOptions.length ? selectedOptions.map(item => `${item.label}${item.security != null && item.security !== '' ? `（安等 ${item.security}）` : ''}`).join('、') : '全部'}
      valueContent={!disabled && selectedOptions.length ? <SelectionSummary items={selectedOptions} /> : undefined}
      disabled={disabled}
    >
      <div className="picker-shell">
        <div className="picker-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={disabled ? '请先完成上一级筛选' : placeholder}
            className="picker-input"
            aria-label={placeholder}
            disabled={disabled}
          />
        </div>

        {selectedOptions.length ? (
          <div className="picker-selected" role="group" aria-label="已选地点">
            {selectedOptions.map((item) => (
              <button key={item.value} type="button" className="picker-tag" aria-label={`移除${item.label}`} onClick={() => clearOne(item.value)}>
                <span className="picker-tag-name" title={item.label}>{item.label}</span>
                {item.security !== undefined ? <SecurityBadge value={item.security} /> : null}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="picker-list">
          {loading ? (
            <p className="picker-empty">加载中...</p>
          ) : filteredOptions.length ? (
            filteredOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`picker-option ${selectedSet.has(item.value) ? 'active' : ''}`}
                onClick={() => toggleValue(item.value)}
                disabled={disabled}
                aria-pressed={selectedSet.has(item.value)}
              >
                <span className="picker-option-name">{item.label}</span>
                {item.security !== undefined ? <SecurityBadge value={item.security} /> : null}
              </button>
            ))
          ) : (
            <p className="picker-empty">没有匹配项</p>
          )}
        </div>
      </div>
    </FilterDisclosure>
  )
}

export default function PlanetaryPage() {
  const { isAuthenticated } = useContext(AuthContext)
  const [regionIds, setRegionIds] = useState([])
  const [constellationIds, setConstellationIds] = useState([])
  const [systemIds, setSystemIds] = useState([])
  const [resourceValues, setResourceValues] = useState([])
  const [resourceQuery, setResourceQuery] = useState('')
  const resourceSearchRef = useRef(null)
  const [rows, setRows] = useState([])
  const [selectedCalculatorKeys, setSelectedCalculatorKeys] = useState([])
  const [calculatorRows, setCalculatorRows] = useState([])
  const [showCalculator, setShowCalculator] = useState(false)
  const [searchHint, setSearchHint] = useState('')
  const [tableFilters, setTableFilters] = useState({
    resource_name: '',
    region: '',
    constellation: '',
    solar_system: '',
    resource_level: 'all',
  })
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })

  const resourcesQuery = useQuery({
    queryKey: ['planet-resources-list'],
    queryFn: getPlanetResources,
  })

  const regionsQuery = useQuery({
    queryKey: ['region-list'],
    queryFn: getRegionList,
  })

  const constellationsQuery = useQuery({
    queryKey: ['constellations', regionIds.join(',')],
    queryFn: () => getConstellations(regionIds.join(',')),
    enabled: regionIds.length > 0,
  })

  const systemsQuery = useQuery({
    queryKey: ['systems', constellationIds.join(',')],
    queryFn: () => getSolarSystems(constellationIds.join(',')),
    enabled: constellationIds.length > 0,
  })

  const searchMutation = useMutation({
    mutationFn: searchPlanetResources,
    onError: () => setSearchHint('查询失败，请稍后重试'),
    onSuccess: (data) => {
      setSearchHint('')
      setRows(Array.isArray(data) ? data.map((item, index) => enrichSearchRow(item, index)) : [])
    },
  })

  const regionOptions = useMemo(
    () =>
      (regionsQuery.data || []).map((item) => ({
        value: item.r_id,
        label: item.r_title,
        security: item.r_safetylvl,
      })),
    [regionsQuery.data],
  )

  const constellationOptions = useMemo(
    () =>
      (constellationsQuery.data || []).map((item) => ({
        value: item.co_id,
        label: item.co_title,
        security: item.co_safetylvl,
      })),
    [constellationsQuery.data],
  )

  const systemOptions = useMemo(
    () =>
      (systemsQuery.data || []).map((item) => ({
        value: item.ss_id,
        label: item.ss_title,
        security: item.ss_safetylvl,
      })),
    [systemsQuery.data],
  )

  const flatResources = useMemo(() => {
    if (!resourcesQuery.data) return []
    return resourcesQuery.data.flatMap((group) =>
      group.options.map((opt) => ({
        ...opt,
        group: group.label,
      })),
    )
  }, [resourcesQuery.data])

  const groupedResources = useMemo(() => {
    const map = new Map()
    flatResources
      .filter((item) => {
        if (!resourceQuery.trim()) return true
        const keyword = resourceQuery.trim().toLowerCase()
        return String(item.label || item.value || '')
          .toLowerCase()
          .includes(keyword)
      })
      .forEach((item) => {
        if (!map.has(item.group)) map.set(item.group, [])
        map.get(item.group).push(item)
      })
    return Array.from(map.entries())
  }, [flatResources, resourceQuery])

  const selectedResourceOptions = useMemo(() => {
    const byValue = new Map(flatResources.map(item => [item.value, item]))
    return resourceValues.map(value => byValue.get(value) || { value, label: value })
  }, [flatResources, resourceValues])

  const resultResourceTypeCount = useMemo(() => {
    return new Set(rows.map((row) => row.resource_name).filter(Boolean)).size
  }, [rows])

  const activeResourceTypeCount = resourceValues.length || resultResourceTypeCount

  const calculatorKeySet = useMemo(() => new Set(calculatorRows.map((item) => item.key)), [calculatorRows])

  const onSearch = () => {
    if (!resourceValues.length && !regionIds.length) {
      setSearchHint('请至少选择一个星域或资源')
      return
    }

    const selectedResources = flatResources.filter((item) => resourceValues.includes(item.value))
    const locationPayload = buildLocationPayload({ regionIds, constellationIds, systemIds })

    searchMutation.mutate({
      ...locationPayload,
      planetaryResources: selectedResources,
    })
  }

  const displayRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const resourcePass = String(row.resource_name || '')
        .toLowerCase()
        .includes(tableFilters.resource_name.toLowerCase())
      const regionPass = String(row.region || '')
        .toLowerCase()
        .includes(tableFilters.region.toLowerCase())
      const constellationPass = String(row.constellation || '')
        .toLowerCase()
        .includes(tableFilters.constellation.toLowerCase())
      const systemPass = String(row.solar_system || '')
        .toLowerCase()
        .includes(tableFilters.solar_system.toLowerCase())
      const levelPass =
        tableFilters.resource_level === 'all' || String(row.resource_level) === String(tableFilters.resource_level)
      return resourcePass && regionPass && constellationPass && systemPass && levelPass
    })

    if (!sortConfig.key) return filtered

    const sorted = [...filtered].sort((a, b) => {
      const left = a[sortConfig.key]
      const right = b[sortConfig.key]

      if (sortConfig.key === 'resource_level' || sortConfig.key === 'resource_yield' || sortConfig.key === 'fuel_value') {
        return Number(left || 0) - Number(right || 0)
      }

      return String(left ?? '').localeCompare(String(right ?? ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base',
      })
    })

    return sortConfig.direction === 'asc' ? sorted : sorted.reverse()
  }, [rows, sortConfig, tableFilters])

  useEffect(() => {
    setSelectedCalculatorKeys((current) =>
      current.filter((key) => rows.some((row) => row.key === key) && !calculatorKeySet.has(key)),
    )
  }, [rows, calculatorKeySet])

  const selectableDisplayRows = useMemo(
    () => displayRows.filter((row) => !calculatorKeySet.has(row.key)),
    [displayRows, calculatorKeySet],
  )

  const allVisibleSelected =
    selectableDisplayRows.length > 0 &&
    selectableDisplayRows.every((row) => selectedCalculatorKeys.includes(row.key))

  const toggleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowDownUp size={14} />
    return sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
  }

  const toggleSelectedRow = (key) => {
    setSelectedCalculatorKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  const toggleSelectAll = () => {
    if (!selectableDisplayRows.length) return

    if (allVisibleSelected) {
      setSelectedCalculatorKeys((current) =>
        current.filter((key) => !selectableDisplayRows.some((row) => row.key === key)),
      )
      return
    }

    setSelectedCalculatorKeys((current) => {
      const next = new Set(current)
      selectableDisplayRows.forEach((row) => next.add(row.key))
      return Array.from(next)
    })
  }

  const addToCalculator = () => {
    if (!selectedCalculatorKeys.length) return

    const nextRows = rows
      .filter((row) => selectedCalculatorKeys.includes(row.key))
      .filter((row) => !calculatorKeySet.has(row.key))
      .map((row) => buildCalculatorRow(row))

    if (!nextRows.length) return

    setCalculatorRows((current) => [...current, ...nextRows])
    setSelectedCalculatorKeys([])
    setShowCalculator(true)
  }

  useEffect(() => {
    if (!searchHint) return undefined
    const timer = window.setTimeout(() => setSearchHint(''), 2200)
    return () => window.clearTimeout(timer)
  }, [searchHint])

  const searchHintToast = searchHint
    ? createPortal(
        <div className="floating-toast">
          <AlertTriangle size={16} />
          <span>{searchHint}</span>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      {searchHintToast}
      <PageHeader
        title="行星资源"
        subtitle="按星域、星座、星系和资源组合搜索产出"
      />

      <div className="layout-main-stack planetary-layout">
        <Panel className="planetary-filters">
          <div className="picker-grid">
            <SearchableMultiPicker
              label="星域（可多选）"
              placeholder="搜索星域"
              options={regionOptions}
              selectedValues={regionIds}
              onChange={(next) => {
                setRegionIds(next)
                setConstellationIds([])
                setSystemIds([])
              }}
              loading={regionsQuery.isPending}
            />

            <SearchableMultiPicker
              label="星座（可多选）"
              placeholder="搜索星座"
              options={constellationOptions}
              selectedValues={constellationIds}
              onChange={(next) => {
                setConstellationIds(next)
                setSystemIds([])
              }}
              disabled={!regionIds.length}
              loading={constellationsQuery.isPending}
            />

            <SearchableMultiPicker
              label="星系（可多选）"
              placeholder="搜索星系"
              options={systemOptions}
              selectedValues={systemIds}
              onChange={setSystemIds}
              disabled={!constellationIds.length}
              loading={systemsQuery.isPending}
            />
          <FilterDisclosure
            className="resource-disclosure"
            label="资源（可多选）"
            value={selectedResourceOptions.length ? selectedResourceOptions.map(item => item.label || item.value).join('、') : '全部资源'}
            valueContent={selectedResourceOptions.length ? <SelectionSummary items={selectedResourceOptions} /> : undefined}
          >
          <div className="resource-box planetary-resource-box">
            <div className="planetary-resource-head">
              <div>
                <h3>资源选择</h3>
                <p>支持按名称搜索，点击图标卡片快速加入筛选</p>
              </div>
              <div className="planetary-resource-search">
                <Search size={14} />
                <input
                  ref={resourceSearchRef}
                  value={resourceQuery}
                  onChange={(e) => setResourceQuery(e.target.value)}
                  placeholder="搜索资源名称"
                  className="picker-input"
                  aria-label="搜索资源名称"
                />
              </div>
            </div>

            {selectedResourceOptions.length ? (
              <div className="picker-selected resource-selected" role="group" aria-label="已选资源">
                {selectedResourceOptions.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className="picker-tag"
                    aria-label={`移除${item.label || item.value}`}
                    onClick={() => {
                      resourceSearchRef.current?.focus()
                      setResourceValues(prev => prev.filter(value => value !== item.value))
                    }}
                  >
                    {item.icon ? <img className="filter-selection-icon" src={item.icon} alt="" /> : null}
                    <span className="picker-tag-name" title={item.label || item.value}>{item.label || item.value}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}

            {groupedResources.map(([groupName, list]) => (
              <div className="resource-group" key={groupName}>
                <h4>{groupName}</h4>
                <div className="resource-card-grid">
                  {list.map((item) => {
                    const active = resourceValues.includes(item.value)
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`resource-card ${active ? 'active' : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          setResourceValues((prev) =>
                            prev.includes(item.value)
                              ? prev.filter((x) => x !== item.value)
                              : [...prev, item.value],
                          )
                        }}
                      >
                        {item.icon ? (
                          <span className="resource-card-icon">
                            <img src={item.icon} alt={item.label || item.value} />
                          </span>
                        ) : null}
                        <span className="resource-card-label">{item.label || item.value}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {!groupedResources.length ? <p className="picker-empty">没有匹配的资源</p> : null}
          </div>
          </FilterDisclosure>

          <div className="right-actions">
            <button
              className="ghost-btn"
              onClick={() => {
                setResourceValues([])
                setRegionIds([])
                setConstellationIds([])
                setSystemIds([])
              }}
            >
              清空筛选
            </button>
            <button className="primary-btn" onClick={onSearch} disabled={searchMutation.isPending}>
              <Search size={14} />
              搜索
            </button>
          </div>
          </div>

          {searchMutation.isPending ? <LoadingBar /> : null}
        </Panel>

        <details className="advanced-filters">
          <summary><ChevronDown size={14} />高级筛选{Object.entries(tableFilters).some(([key, value]) => key === 'resource_level' ? value !== 'all' : !!value) && <span className="advanced-active">已启用</span>}</summary>
          <div className="table-filter-row">
            {[
              ['resource_name', '筛选资源'], ['region', '筛选星域'],
              ['constellation', '筛选星座'], ['solar_system', '筛选星系'],
            ].map(([key, label]) => <input key={key} className="table-filter-input" aria-label={label} placeholder={label} value={tableFilters[key]} onChange={e => setTableFilters(prev => ({ ...prev, [key]: e.target.value }))} />)}
            <select className="table-filter-input" aria-label="筛选资源等级" value={tableFilters.resource_level} onChange={e => setTableFilters(prev => ({ ...prev, resource_level: e.target.value }))}>
              <option value="all">全部等级</option><option value="4">完美</option><option value="3">富饶</option><option value="2">中等</option><option value="1">贫瘠</option>
            </select>
          </div>
          <details className="query-help">
          <summary>搜索说明与当前筛选概览 <ChevronDown size={14} /></summary>
          <ul className="hint-list">
            <li>同时选择地点和资源：按当前筛选范围直接查询目标资源。</li>
            <li>只选地点不选资源：返回该地点下所有资源里表现更好的结果。</li>
            <li>只选资源不选地点：返回每个星域里该资源产出更高的位置。</li>
            <li>结果表可直接勾选并加入计算器，继续做阵列和价格联动。</li>
          </ul>
          <div className="pill-row">
            <Pill>星域 {regionIds.length}</Pill><Pill>星座 {constellationIds.length}</Pill>
            <Pill>星系 {systemIds.length}</Pill><Pill>资源类型 {activeResourceTypeCount}</Pill>
          </div>
          </details>
        </details>

        <Panel className="planetary-results">
          <div className="planetary-results-header planetary-bulk-bar">
            <div className="planetary-results-title"><h2>结果列表</h2><span>{displayRows.length} 条结果</span></div>
            <div className="planetary-bulk-actions">
              <button type="button" className="primary-btn planetary-add-btn" disabled={!selectedCalculatorKeys.length} onClick={addToCalculator}>
                <Plus size={20} />{selectedCalculatorKeys.length ? `加入计算器 · ${selectedCalculatorKeys.length} 项` : '加入计算器'}
              </button>
              <button type="button" className="ghost-btn planetary-open-btn" onClick={() => setShowCalculator(true)}>
                <Calculator size={20} />打开计算器<span className="calculator-open-count">{calculatorRows.length}</span>
              </button>
            </div>
            <div className="planetary-selection-copy" aria-live="polite">
              <span>{selectedCalculatorKeys.length ? `已选 ${selectedCalculatorKeys.length} 项` : '勾选资源后可加入计算器'}</span>
              {!!selectedCalculatorKeys.length && <button className="text-btn" onClick={() => setSelectedCalculatorKeys([])}>取消选择</button>}
            </div>
          </div>
          {rows.length ? (
            <div className="table-shell tall">
              <table className="data-table planetary-table">
                <thead>
                  <tr>
                    <th className="checkbox-col">
                      <button type="button" className="table-check-trigger" aria-label="选择全部可用结果" aria-pressed={allVisibleSelected} onClick={toggleSelectAll}>
                        {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('resource_name')}>
                        <span>资源</span>
                        {renderSortIcon('resource_name')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('region')}>
                        <span>星域</span>
                        {renderSortIcon('region')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('constellation')}>
                        <span>星座</span>
                        {renderSortIcon('constellation')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('solar_system')}>
                        <span>星系 / 行星</span>
                        {renderSortIcon('solar_system')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('resource_level')}>
                        <span>等级</span>
                        {renderSortIcon('resource_level')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('resource_yield')}>
                        <span>产量</span>
                        {renderSortIcon('resource_yield')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('fuel_value')}>
                        <span>燃料热值</span>
                        {renderSortIcon('fuel_value')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const checked = selectedCalculatorKeys.includes(row.key)
                    const inCalculator = calculatorKeySet.has(row.key)

                    return (
                      <tr key={row.key} className={checked ? 'is-selected' : inCalculator ? 'is-added' : ''}>
                        <td className="checkbox-col">
                          <button
                            type="button"
                            className={`table-check-trigger ${checked ? 'active' : ''}`}
                            onClick={() => toggleSelectedRow(row.key)}
                            disabled={inCalculator}
                            aria-label={`${inCalculator ? '已加入' : '选择'} ${row.resource_name} ${row.solar_system} ${row.planet_id}`}
                            aria-pressed={checked}
                            title={inCalculator ? '已在计算器中' : '选择此行'}
                          >
                            {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </td>
                        <td>
                          <div className="resource-result-cell">
                            {row.icon ? <img src={row.icon} alt={row.resource_name} className="resource-result-icon" /> : null}
                            <span>{row.resource_name}</span>
                          </div>
                        </td>
                        <td>
                          <div className="location-cell">
                            <span>{row.region}</span>
                            <SecurityBadge value={row.region_security} />
                          </div>
                        </td>
                        <td>
                          <div className="location-cell">
                            <span>{row.constellation}</span>
                            <SecurityBadge value={row.constellation_security} />
                          </div>
                        </td>
                        <td>
                          <div className="location-cell">
                            <span>{row.solar_system}</span>
                            <SecurityBadge value={row.solar_system_security} />
                            <strong className="planetary-planet-id">- {row.planet_id}</strong>
                          </div>
                        </td>
                        <td>
                          <LevelBadge value={row.resource_level} />
                        </td>
                        <td>{row.resource_yield}</td>
                        <td>{Number(row.fuel_value || 0).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="暂无数据" desc="请先设置筛选条件后点击搜索" />
          )}
          {!!rows.length && <p className="planetary-result-count">显示 {displayRows.length} 条结果 · 点击表头排序</p>}
        </Panel>
      </div>

      <PlanetaryCalculatorModal
        open={showCalculator}
        onClose={() => setShowCalculator(false)}
        rows={calculatorRows}
        setRows={setCalculatorRows}
        isAuthenticated={isAuthenticated}
      />
    </>
  )
}
