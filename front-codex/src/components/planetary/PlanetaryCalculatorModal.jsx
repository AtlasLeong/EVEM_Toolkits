import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { CircleAlert, ChevronDown, Clock3, Coins, Copy, Database, Flame, Gauge, LoaderCircle, Save, Trash2, Upload, X } from 'lucide-react'
import {
  deleteProgremmaByID,
  getDefaultResourcePriceSetting,
  getUserProgremmaByID,
  getUserProgremmaList,
  savePlanetaryProgramme,
  updateProgremma,
} from '../../services/apiPlanetaryResource'
import { EmptyState } from '../ui/Primitives'

const fuelFactorMap = {
  重水: 2,
  悬浮等离子: 5,
  液化臭氧: 13,
  离子溶液: 37,
  同位素燃料: 83,
  等离子体团: 191,
}

const castleOptions = [
  { value: 'dual', label: '双菜插' },
  { value: 'single', label: '单菜插' },
  { value: 'none', label: '无个堡' },
]

const skillOptions = [
  { value: '554', label: '技能554' },
  { value: '555', label: '技能555' },
]

function getSecurityClass(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return 'sec-mid'
  if (num <= 0) return 'sec-null'
  if (num < 0.2) return 'sec-low'
  if (num < 0.5) return 'sec-warm'
  if (num < 0.8) return 'sec-safe'
  return 'sec-high'
}

function SecurityChip({ value }) {
  if (value === null || value === undefined || value === '') return null
  return <span className={`security-badge ${getSecurityClass(value)}`}>{value}</span>
}

function getFuelFactor(resourceName) {
  return fuelFactorMap[resourceName] || 0
}

function toNumber(value) {
  const next = Number(value)
  return Number.isFinite(next) ? next : 0
}

function calculateCalculatorRow(row) {
  const arraysNumber = Math.max(0, toNumber(row.arrays_number))
  const computationTime = Math.max(0, toNumber(row.computation_time))
  const resourceYield = Math.max(0, toNumber(row.resource_yield))
  const unitPrice = Math.max(0, toNumber(row.unit_price))
  const fuelValue =
    row.fuel_value !== undefined && row.fuel_value !== null
      ? Math.max(0, toNumber(row.fuel_value))
      : getFuelFactor(row.resource_name) * resourceYield

  const totalOutput = resourceYield * arraysNumber * computationTime
  const totalFuel = fuelValue * arraysNumber * computationTime
  const totalPrice = totalOutput * unitPrice

  return {
    ...row,
    fuel_value: fuelValue,
    arrays_number: arraysNumber,
    computation_time: computationTime,
    unit_price: unitPrice,
    total_output: totalOutput,
    total_fuel: totalFuel,
    total_price: totalPrice,
  }
}

export function buildCalculatorRow(row) {
  return calculateCalculatorRow({
    ...row,
    arrays_number: row.arrays_number ?? 0,
    computation_time: row.computation_time ?? 0,
    unit_price: row.unit_price ?? 0,
  })
}

function formatHours(totalHours) {
  const hours = Math.max(0, Math.round(totalHours))
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  if (!days) return `${remainHours} 小时`
  if (!remainHours) return `${days} 天`
  return `${days} 天 ${remainHours} 小时`
}

function formatCompactIsk(value) {
  const amount = toNumber(value)
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)} 亿 ISK`
  if (amount >= 10000) return `${(amount / 10000).toFixed(2)} 万 ISK`
  return `${Math.round(amount).toLocaleString('zh-Hans-CN')} ISK`
}

function StatCard({ label, value, hint, icon, tone }) {
  return (
    <article className={`calculator-stat-card ${tone || ''}`.trim()}>
      <div className="calculator-stat-head">
        <span className="calculator-stat-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {hint ? <p>{hint}</p> : null}
    </article>
  )
}

export default function PlanetaryCalculatorModal({ open, onClose, rows, setRows, isAuthenticated }) {
  const queryClient = useQueryClient()
  const programmeMenuRef = useRef(null)
  const [castle, setCastle] = useState('dual')
  const [skill, setSkill] = useState('554')
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('')
  const [programmeMenuOpen, setProgrammeMenuOpen] = useState(false)
  const [currentProgrammeName, setCurrentProgrammeName] = useState('未保存')
  const [saveForm, setSaveForm] = useState({ programmeName: '', programmeDesc: '' })
  const [batchValues, setBatchValues] = useState({ arrays_number: '', computation_time: '', unit_price: '' })
  const [status, setStatus] = useState({ tone: '', message: '' })

  const programmeListQuery = useQuery({
    queryKey: ['planetary-programme-list'],
    queryFn: getUserProgremmaList,
    enabled: isAuthenticated && open,
  })

  const loadProgrammeMutation = useMutation({
    mutationFn: getUserProgremmaByID,
    onSuccess: (data, programmeId) => {
      const programme = Array.isArray(data) ? data[0] : null
      const programmeRows = Array.isArray(programme?.programme_element)
        ? programme.programme_element.map((item) => buildCalculatorRow(item))
        : []

      setRows(programmeRows)
      setSelectedProgrammeId(String(programmeId))
      setProgrammeMenuOpen(false)
      setCurrentProgrammeName(programme?.programme_name || '未命名方案')
      setSaveForm({
        programmeName: programme?.programme_name || '',
        programmeDesc: programme?.programme_desc || '',
      })
      setStatus({ tone: 'success', message: '方案已加载到计算器' })
    },
    onError: (error) => {
      setStatus({ tone: 'error', message: error.message || '加载方案失败' })
    },
  })

  const defaultPriceMutation = useMutation({
    mutationFn: () => getDefaultResourcePriceSetting('user'),
    onSuccess: (defaultPrice) => {
      const priceMap = new Map(
        (Array.isArray(defaultPrice) ? defaultPrice : []).map((item) => [
          item.resource_name,
          toNumber(item.resource_price),
        ]),
      )

      setRows((current) =>
        current.map((item) => {
          if (!priceMap.has(item.resource_name)) return item
          return calculateCalculatorRow({
            ...item,
            unit_price: priceMap.get(item.resource_name),
          })
        }),
      )
      setStatus({ tone: 'success', message: '预设价格已加载' })
    },
    onError: (error) => {
      setStatus({ tone: 'error', message: error.message || '加载预设价格失败' })
    },
  })

  const saveProgrammeMutation = useMutation({
    mutationFn: savePlanetaryProgramme,
    onSuccess: async (data) => {
      const nextId = data?.programme_id ? String(data.programme_id) : ''
      setSelectedProgrammeId(nextId)
      setProgrammeMenuOpen(false)
      setCurrentProgrammeName(saveForm.programmeName.trim())
      setStatus({ tone: 'success', message: '方案已保存' })
      await queryClient.invalidateQueries({ queryKey: ['planetary-programme-list'] })
    },
    onError: (error) => {
      setStatus({ tone: 'error', message: error.message || '保存方案失败' })
    },
  })

  const updateProgrammeMutation = useMutation({
    mutationFn: updateProgremma,
    onSuccess: async () => {
      setCurrentProgrammeName(saveForm.programmeName.trim() || currentProgrammeName)
      setStatus({ tone: 'success', message: '当前方案已更新' })
      await queryClient.invalidateQueries({ queryKey: ['planetary-programme-list'] })
    },
    onError: (error) => {
      setStatus({ tone: 'error', message: error.message || '更新方案失败' })
    },
  })

  const deleteProgrammeMutation = useMutation({
    mutationFn: deleteProgremmaByID,
    onSuccess: async () => {
      setSelectedProgrammeId('')
      setProgrammeMenuOpen(false)
      setCurrentProgrammeName('未保存')
      setSaveForm({ programmeName: '', programmeDesc: '' })
      setStatus({ tone: 'success', message: '方案已删除' })
      await queryClient.invalidateQueries({ queryKey: ['planetary-programme-list'] })
    },
    onError: (error) => {
      setStatus({ tone: 'error', message: error.message || '删除方案失败' })
    },
  })

  const totals = useMemo(() => {
    const totalPrice = rows.reduce((sum, item) => sum + toNumber(item.total_price), 0)
    const totalFuel = rows.reduce((sum, item) => sum + toNumber(item.total_fuel), 0)
    const unitFuel = rows.reduce((sum, item) => sum + toNumber(item.fuel_value) * toNumber(item.arrays_number), 0)
    const maxOutput = Math.max(0, ...rows.map((item) => toNumber(item.arrays_number) * toNumber(item.resource_yield)))

    let centerCost = 0
    let resourceLimit = 100

    if (castle === 'dual') {
      centerCost = 18000
      resourceLimit += 400
    } else if (castle === 'single') {
      centerCost = 9000
      resourceLimit += 200
    }

    if (skill === '554') resourceLimit += 820
    if (skill === '555') resourceLimit += 900

    const hourlyFuelGap = unitFuel - centerCost
    const fullArrayTime = maxOutput ? (resourceLimit * 100) / maxOutput : 0

    return {
      totalPrice,
      totalFuel,
      hourlyFuelGap,
      fullArrayTime,
    }
  }, [rows, castle, skill])

  const isBusy =
    defaultPriceMutation.isPending ||
    saveProgrammeMutation.isPending ||
    updateProgrammeMutation.isPending ||
    deleteProgrammeMutation.isPending ||
    loadProgrammeMutation.isPending

  const selectedProgrammeLabel = useMemo(() => {
    if (!selectedProgrammeId) return '选择已保存方案'
    const target = (programmeListQuery.data || []).find((item) => String(item.programme_id) === selectedProgrammeId)
    return target?.programme_name || currentProgrammeName || '选择已保存方案'
  }, [selectedProgrammeId, programmeListQuery.data, currentProgrammeName])

  useEffect(() => {
    if (!programmeMenuOpen) return undefined

    const handleOutsideClick = (event) => {
      if (!programmeMenuRef.current?.contains(event.target)) {
        setProgrammeMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [programmeMenuOpen])

  const updateRow = (key, patch) => {
    setRows((current) =>
      current.map((item) => (item.key === key ? calculateCalculatorRow({ ...item, ...patch }) : item)),
    )
  }

  const deleteRow = (key) => {
    setRows((current) => current.filter((item) => item.key !== key))
  }

  const clearRows = () => {
    setRows([])
    setSelectedProgrammeId('')
    setProgrammeMenuOpen(false)
    setCurrentProgrammeName('未保存')
    setStatus({ tone: '', message: '' })
  }

  const applyBatchValue = (field) => {
    if (!rows.length) return

    const rawValue = batchValues[field]
    const numericValue = Math.max(0, toNumber(rawValue))

    setRows((current) => current.map((item) => calculateCalculatorRow({ ...item, [field]: numericValue })))
    setStatus({ tone: 'success', message: '批量值已复制到全部行' })
  }

  const handleSaveProgramme = () => {
    const programmeName = saveForm.programmeName.trim()
    if (!programmeName) {
      setStatus({ tone: 'error', message: '请先填写方案名称' })
      return
    }
    if (!rows.length) {
      setStatus({ tone: 'error', message: '计算器为空，无法保存方案' })
      return
    }

    saveProgrammeMutation.mutate({
      calculatorData: {
        programmeName,
        programmeDesc: saveForm.programmeDesc.trim(),
        data: rows,
      },
    })
  }

  const handleUpdateProgramme = () => {
    if (!selectedProgrammeId) {
      setStatus({ tone: 'error', message: '请先选择已保存方案' })
      return
    }
    if (!rows.length) {
      setStatus({ tone: 'error', message: '计算器为空，无法更新方案' })
      return
    }

    updateProgrammeMutation.mutate({
      programme_id: selectedProgrammeId,
      element: rows,
    })
  }

  const handleDeleteProgramme = () => {
    if (!selectedProgrammeId) {
      setStatus({ tone: 'error', message: '当前没有可删除的方案' })
      return
    }
    deleteProgrammeMutation.mutate({ programme_id: selectedProgrammeId })
  }

  if (!open) return null

  const modal = (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal-card calculator-card"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.985 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="modal-kicker">Planetary Calculator</p>
            <h3>行星资源计算器</h3>
          </div>
          <button className="ghost-btn modal-close-btn" type="button" onClick={onClose}>
            <X size={16} />
            关闭
          </button>
        </div>

        <div className="calculator-toolbar">
          <div className="calculator-segments">
            <div className="calculator-segment-group">
              {castleOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`calculator-segment ${castle === item.value ? 'active' : ''}`}
                  onClick={() => setCastle(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="calculator-segment-group">
              {skillOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`calculator-segment ${skill === item.value ? 'active' : ''}`}
                  onClick={() => setSkill(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="calculator-actions">
            <button type="button" className="ghost-btn calculator-price-btn" onClick={() => defaultPriceMutation.mutate()} disabled={!rows.length || isBusy}>
              {defaultPriceMutation.isPending ? <LoaderCircle size={16} className="spin" /> : <Database size={16} />}
              加载预设价格
            </button>
            <button type="button" className="ghost-btn danger-ghost-btn calculator-clear-btn" onClick={clearRows} disabled={!rows.length || isBusy}>
              <Trash2 size={16} />
              清空计算器
            </button>
          </div>
        </div>

        <div className="calculator-stats">
          <StatCard
            label="产出总价"
            value={formatCompactIsk(totals.totalPrice)}
            hint="按当前单价和阵列配置计算"
            icon={<Coins size={18} />}
            tone="is-blue"
          />
          <StatCard
            label="总燃料热值"
            value={totals.totalFuel.toLocaleString('zh-Hans-CN')}
            hint="单位：吉焦"
            icon={<Flame size={18} />}
            tone="is-red"
          />
          <StatCard
            label="每小时燃料差"
            value={totals.hourlyFuelGap.toLocaleString('zh-Hans-CN')}
            hint="阵列燃料减去中心消耗"
            icon={<Gauge size={18} />}
            tone="is-green"
          />
          <StatCard
            label="阵列满仓时间"
            value={formatHours(totals.fullArrayTime)}
            hint="按当前最高时产推算"
            icon={<Clock3 size={18} />}
            tone="is-amber"
          />
        </div>

        <div className="calculator-programme-bar">
          {isAuthenticated ? (
            <>
              <div className="calculator-programme-picker">
                <div className="calculator-programme-current-inline">
                  <span>当前方案</span>
                  <strong>{currentProgrammeName}</strong>
                </div>
                <div className="calculator-dropdown" ref={programmeMenuRef}>
                  <button
                    type="button"
                    className={`calculator-select-trigger ${programmeMenuOpen ? 'active' : ''}`}
                    onClick={() => setProgrammeMenuOpen((current) => !current)}
                    disabled={programmeListQuery.isLoading || loadProgrammeMutation.isPending}
                  >
                    <span>{selectedProgrammeLabel}</span>
                    <ChevronDown size={18} />
                  </button>
                  {programmeMenuOpen ? (
                    <div className="calculator-dropdown-menu">
                      <button
                        type="button"
                        className={`calculator-dropdown-item ${!selectedProgrammeId ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedProgrammeId('')
                          setCurrentProgrammeName('未保存')
                          setProgrammeMenuOpen(false)
                        }}
                      >
                        选择已保存方案
                      </button>
                      {(programmeListQuery.data || []).map((item) => (
                        <button
                          key={item.programme_id}
                          type="button"
                          className={`calculator-dropdown-item ${
                            String(item.programme_id) === selectedProgrammeId ? 'active' : ''
                          }`}
                          onClick={() => loadProgrammeMutation.mutate(String(item.programme_id))}
                        >
                          {item.programme_name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ghost-btn danger-ghost-btn calculator-programme-delete"
                  onClick={handleDeleteProgramme}
                  disabled={!selectedProgrammeId || isBusy}
                >
                  删除方案
                </button>
              </div>

              <div className="calculator-programme-form">
                <div className="field-row">
                  <label>方案名称</label>
                  <input
                    className="text-input"
                    value={saveForm.programmeName}
                    onChange={(e) => setSaveForm((current) => ({ ...current, programmeName: e.target.value }))}
                    maxLength={15}
                    placeholder="输入方案名称"
                  />
                </div>
                <div className="field-row">
                  <label>方案描述</label>
                  <input
                    className="text-input"
                    value={saveForm.programmeDesc}
                    onChange={(e) => setSaveForm((current) => ({ ...current, programmeDesc: e.target.value }))}
                    maxLength={100}
                    placeholder="可选，简要记录用途"
                  />
                </div>
                <div className="calculator-programme-actions">
                  <button type="button" className="primary-btn calculator-programme-btn" onClick={handleSaveProgramme} disabled={isBusy || !rows.length}>
                    <Save size={15} />
                    保存新方案
                  </button>
                  <button
                    type="button"
                    className="ghost-btn calculator-programme-btn"
                    onClick={handleUpdateProgramme}
                    disabled={isBusy || !rows.length || !selectedProgrammeId}
                  >
                    <Upload size={15} />
                    更新当前方案
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="calculator-programme-current-inline single">
              <span>当前方案</span>
              <strong>{currentProgrammeName}</strong>
            </div>
          )}
        </div>

        {!isAuthenticated ? (
          <div className="calculator-auth-hint" role="note" aria-live="polite">
            <span className="calculator-auth-hint-icon">
              <CircleAlert size={16} />
            </span>
            <span className="calculator-auth-hint-copy">
              <strong>未登录无法保存方案</strong>
              <span>当前仍可正常计算，但无法保存、加载或删除方案。登录后即可管理方案。</span>
            </span>
          </div>
        ) : null}

        <div className="calculator-batch-grid">
          <div className="field-row">
            <label>批量阵列数量</label>
            <div className="inline-field">
              <input
                className="text-input"
                type="number"
                min="0"
                step="1"
                value={batchValues.arrays_number}
                onChange={(e) => setBatchValues((current) => ({ ...current, arrays_number: e.target.value }))}
                placeholder="填入统一阵列数"
              />
              <button type="button" className="ghost-btn calculator-copy-btn" onClick={() => applyBatchValue('arrays_number')} disabled={!rows.length || isBusy}>
                <Copy size={14} />
                复制到全部行
              </button>
            </div>
          </div>
          <div className="field-row">
            <label>批量计算时长</label>
            <div className="inline-field">
              <input
                className="text-input"
                type="number"
                min="0"
                step="1"
                value={batchValues.computation_time}
                onChange={(e) => setBatchValues((current) => ({ ...current, computation_time: e.target.value }))}
                placeholder="统一按小时输入"
              />
              <button type="button" className="ghost-btn calculator-copy-btn" onClick={() => applyBatchValue('computation_time')} disabled={!rows.length || isBusy}>
                <Copy size={14} />
                复制到全部行
              </button>
            </div>
          </div>
          <div className="field-row">
            <label>批量单价</label>
            <div className="inline-field">
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={batchValues.unit_price}
                onChange={(e) => setBatchValues((current) => ({ ...current, unit_price: e.target.value }))}
                placeholder="统一资源单价"
              />
              <button type="button" className="ghost-btn calculator-copy-btn" onClick={() => applyBatchValue('unit_price')} disabled={!rows.length || isBusy}>
                <Copy size={14} />
                复制到全部行
              </button>
            </div>
          </div>
        </div>

        {status.message ? <p className={`calculator-status ${status.tone}`}>{status.message}</p> : null}

        {rows.length ? (
          <div className="table-shell tall calculator-table-shell">
            <table className="data-table planetary-table calculator-table">
              <thead>
                <tr>
                  <th>资源</th>
                  <th>星系</th>
                  <th>产量</th>
                  <th>单位热值</th>
                  <th>阵列数量</th>
                  <th>计算时长</th>
                  <th>总热值</th>
                  <th>总产量</th>
                  <th>单价</th>
                  <th>总价</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="resource-result-cell">
                        {row.icon ? <img src={row.icon} alt={row.resource_name} className="resource-result-icon" /> : null}
                        <span>{row.resource_name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="location-cell">
                        <span>
                          {row.solar_system} - {row.planet_id}
                        </span>
                        <SecurityChip value={row.solar_system_security} />
                      </div>
                    </td>
                    <td>{toNumber(row.resource_yield).toLocaleString('zh-Hans-CN')}</td>
                    <td>{toNumber(row.fuel_value).toFixed(2)}</td>
                    <td>
                      <input
                        className="table-inline-input"
                        type="number"
                        min="0"
                        step="1"
                        value={row.arrays_number}
                        onChange={(e) => updateRow(row.key, { arrays_number: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className="table-inline-with-suffix">
                        <input
                          className="table-inline-input"
                          type="number"
                          min="0"
                          step="1"
                          value={row.computation_time}
                          onChange={(e) => updateRow(row.key, { computation_time: e.target.value })}
                        />
                        <span>小时</span>
                      </div>
                    </td>
                    <td>{toNumber(row.total_fuel).toFixed(2)}</td>
                    <td>{toNumber(row.total_output).toLocaleString('zh-Hans-CN')}</td>
                    <td>
                      <input
                        className="table-inline-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.unit_price}
                        onChange={(e) => updateRow(row.key, { unit_price: e.target.value })}
                      />
                    </td>
                    <td>{formatCompactIsk(row.total_price)}</td>
                    <td>
                      <button type="button" className="table-row-action" onClick={() => deleteRow(row.key)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="calculator-empty">
            <EmptyState title="计算器为空" desc="先在结果表勾选资源，再加入计算器开始联动计算" />
          </div>
        )}
      </motion.div>
    </motion.div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}


