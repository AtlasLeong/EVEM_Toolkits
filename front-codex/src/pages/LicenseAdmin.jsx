import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Link2Off, Plus, RefreshCw, Search, TimerReset, ToggleLeft, ToggleRight } from 'lucide-react'
import {
  createLicenseCode,
  extendLicenseCode,
  listLicenseCodes,
  parseScriptIds,
  PLAN_OPTIONS,
  scriptLabel,
  SCRIPT_OPTIONS,
  unbindLicenseCode,
  updateLicenseCode,
} from '../services/apiLicense'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getPlanLabel(plan) {
  if (!plan) return '-'
  return plan.name || PLAN_OPTIONS.find((item) => item.value === plan.code)?.label || plan.code
}

function getStatusTone(item) {
  if (!item?.is_active) return 'danger'
  if (item?.expires_at && new Date(item.expires_at).getTime() < Date.now()) return 'warning'
  return 'success'
}

function getStatusText(item) {
  if (!item?.is_active) return '已停用'
  if (item?.expires_at && new Date(item.expires_at).getTime() < Date.now()) return '已过期'
  return '可用'
}

function LicenseCodeRow({ item, onCopy, onExtend, onUnbind, onToggle }) {
  const scripts = item?.permissions?.scripts || []
  return (
    <tr>
      <td className="license-code-cell">
        <button type="button" className="license-code-copy" onClick={() => onCopy(item.code)} title="复制激活码">
          <Copy size={14} />
        </button>
        <span>{item.code}</span>
      </td>
      <td>{getPlanLabel(item.plan)}</td>
      <td>
        <Pill tone={getStatusTone(item)}>{getStatusText(item)}</Pill>
      </td>
      <td>{formatDate(item.expires_at)}</td>
      <td className="license-pc-cell">{item.pc_identifier || '未绑定'}</td>
      <td>
        <div className="license-script-list">
          {scripts.slice(0, 4).map((scriptId) => (
            <span key={scriptId}>{scriptLabel(scriptId)}</span>
          ))}
          {scripts.length > 4 ? <span>+{scripts.length - 4}</span> : null}
        </div>
      </td>
      <td>{item.remark || '-'}</td>
      <td className="admin-row-actions license-actions">
        <button type="button" className="ghost-btn compact" onClick={() => onExtend(item.id)}>
          <TimerReset size={14} />
          延期
        </button>
        <button type="button" className="ghost-btn compact" onClick={() => onUnbind(item.id)} disabled={!item.pc_identifier}>
          <Link2Off size={14} />
          解绑
        </button>
        <button type="button" className="ghost-btn compact" onClick={() => onToggle(item)}>
          {item.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {item.is_active ? '停用' : '启用'}
        </button>
      </td>
    </tr>
  )
}

export default function LicenseAdminPage() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({ search: '', plan: '', is_active: '' })
  const [form, setForm] = useState({
    expiration_days: '30',
    plan: 'default',
    remark: '',
    extra_scripts_text: '',
  })
  const [extendDays, setExtendDays] = useState('30')
  const [notice, setNotice] = useState('')

  const queryParams = useMemo(
    () => ({
      search: filters.search.trim(),
      plan: filters.plan,
      is_active: filters.is_active,
      limit: 100,
    }),
    [filters],
  )

  const codesQuery = useQuery({
    queryKey: ['license-codes', queryParams],
    queryFn: () => listLicenseCodes(queryParams),
  })

  const invalidateCodes = () => queryClient.invalidateQueries({ queryKey: ['license-codes'] })

  const createMutation = useMutation({
    mutationFn: createLicenseCode,
    onSuccess: (data) => {
      setNotice(`已生成激活码 ${data.code}`)
      setForm((current) => ({ ...current, remark: '', extra_scripts_text: '' }))
      invalidateCodes()
    },
    onError: (error) => setNotice(error.message),
  })

  const extendMutation = useMutation({
    mutationFn: ({ id, days }) => extendLicenseCode(id, days),
    onSuccess: () => {
      setNotice('延期完成')
      invalidateCodes()
    },
    onError: (error) => setNotice(error.message),
  })

  const unbindMutation = useMutation({
    mutationFn: unbindLicenseCode,
    onSuccess: () => {
      setNotice('设备绑定已清空')
      invalidateCodes()
    },
    onError: (error) => setNotice(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: (item) => updateLicenseCode(item.id, { is_active: !item.is_active }),
    onSuccess: () => {
      setNotice('激活码状态已更新')
      invalidateCodes()
    },
    onError: (error) => setNotice(error.message),
  })

  const items = codesQuery.data?.results || []

  const handleCreate = (event) => {
    event.preventDefault()
    const expirationDays = Number(form.expiration_days)
    if (!Number.isFinite(expirationDays) || expirationDays <= 0) {
      setNotice('有效天数必须大于 0')
      return
    }
    createMutation.mutate({
      expiration_days: expirationDays,
      plan: form.plan,
      remark: form.remark.trim(),
      extra_script_ids: parseScriptIds(form.extra_scripts_text),
    })
  }

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code)
      setNotice('激活码已复制')
    } catch {
      setNotice(`复制失败，请手动复制：${code}`)
    }
  }

  const runExtend = (id) => {
    const days = Number(extendDays)
    if (!Number.isFinite(days) || days <= 0) {
      setNotice('延期天数必须大于 0')
      return
    }
    extendMutation.mutate({ id, days })
  }

  return (
    <div className="page-stack license-admin-page">
      <PageHeader
        title="激活码管理"
        subtitle="管理脚本套餐、客户授权、设备解绑和到期时间。"
        action={
          <button type="button" className="ghost-btn" onClick={() => codesQuery.refetch()}>
            <RefreshCw size={15} />
            刷新
          </button>
        }
      />

      {notice ? <div className="inline-notice">{notice}</div> : null}

      <Panel title="生成激活码" subtitle="默认组只包含基础脚本；定制客户可填写额外脚本 ID。">
        <form className="field-grid four license-create-form" onSubmit={handleCreate}>
          <div className="field-row">
            <label htmlFor="license-days">有效天数</label>
            <input
              id="license-days"
              aria-label="有效天数"
              className="text-input"
              value={form.expiration_days}
              onChange={(event) => setForm((current) => ({ ...current, expiration_days: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label htmlFor="license-plan">套餐</label>
            <select
              id="license-plan"
              aria-label="套餐"
              className="text-input admin-select"
              value={form.plan}
              onChange={(event) => setForm((current) => ({ ...current, plan: event.target.value }))}
            >
              {PLAN_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="license-remark">备注</label>
            <input
              id="license-remark"
              aria-label="备注"
              className="text-input"
              value={form.remark}
              onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
              placeholder="客户名 / 渠道"
            />
          </div>
          <div className="field-row">
            <label htmlFor="license-extra-scripts">额外脚本</label>
            <input
              id="license-extra-scripts"
              aria-label="额外脚本"
              className="text-input"
              value={form.extra_scripts_text}
              onChange={(event) => setForm((current) => ({ ...current, extra_scripts_text: event.target.value }))}
              placeholder="big_mining, system_monitor"
              list="license-script-options"
            />
            <datalist id="license-script-options">
              {SCRIPT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="right-actions license-form-actions">
            <button type="submit" className="primary-btn" disabled={createMutation.isPending}>
              <Plus size={15} />
              生成激活码
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="激活码列表" subtitle={`当前 ${codesQuery.data?.count ?? 0} 条记录`}>
        <div className="admin-review-toolbar license-toolbar">
          <div className="search-box compact-search">
            <Search size={15} />
            <input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="搜索激活码、备注或设备"
            />
          </div>
          <select
            className="text-input admin-select"
            value={filters.plan}
            onChange={(event) => setFilters((current) => ({ ...current, plan: event.target.value }))}
          >
            <option value="">全部套餐</option>
            {PLAN_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="text-input admin-select"
            value={filters.is_active}
            onChange={(event) => setFilters((current) => ({ ...current, is_active: event.target.value }))}
          >
            <option value="">全部状态</option>
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
          <label className="license-extend-control">
            延期天数
            <input
              className="text-input"
              value={extendDays}
              onChange={(event) => setExtendDays(event.target.value)}
            />
          </label>
        </div>

        {codesQuery.isLoading ? <LoadingBar /> : null}
        {codesQuery.isError ? <EmptyState title="加载失败" desc={codesQuery.error.message} /> : null}
        {!codesQuery.isLoading && !codesQuery.isError && items.length === 0 ? (
          <EmptyState title="暂无激活码" desc="生成一个默认组或 VIP 激活码后会显示在这里。" />
        ) : null}
        {items.length > 0 ? (
          <div className="admin-record-table-shell license-table-shell">
            <table className="admin-record-table license-table">
              <thead>
                <tr>
                  <th>激活码</th>
                  <th>套餐</th>
                  <th>状态</th>
                  <th>到期时间</th>
                  <th>设备</th>
                  <th>脚本权限</th>
                  <th>备注</th>
                  <th className="admin-col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <LicenseCodeRow
                    key={item.id}
                    item={item}
                    onCopy={copyCode}
                    onExtend={runExtend}
                    onUnbind={(id) => unbindMutation.mutate(id)}
                    onToggle={(code) => toggleMutation.mutate(code)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Panel title="脚本 ID 对照">
        <div className="license-script-reference">
          {SCRIPT_OPTIONS.map((item) => (
            <span key={item.value}>
              <KeyRound size={13} />
              <strong>{item.value}</strong>
              {item.label}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  )
}

