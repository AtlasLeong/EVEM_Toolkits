import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changePassword } from '../services/apiAuthentication'
import { getDefaultResourcePriceSetting, getPlanetResources, saveUserPrePrice } from '../services/apiPlanetaryResource'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import '../styles/secondaryRoutes.css'

export default function SettingPage() {
  const [tab, setTab] = useState('password')

  return (
    <>
      <PageHeader title="用户设置" subtitle="账号安全与资源预设价格" />
      <Panel>
        <div className="tab-row">
          <button type="button" aria-pressed={tab === 'password'} className={`tab-btn ${tab === 'password' ? 'active' : ''}`} onClick={() => setTab('password')}>
            修改密码
          </button>
          <button type="button" aria-pressed={tab === 'prices'} className={`tab-btn ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>
            预设价格
          </button>
        </div>
      </Panel>

      {tab === 'password' ? <ChangePasswordCard /> : <PriceSettingCard />}
    </>
  )
}

function ChangePasswordCard() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [msg, setMsg] = useState('')

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setMsg('密码已更新')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err) => {
      setMsg(err.message || '修改失败')
    },
  })

  const onSubmit = (e) => {
    e.preventDefault()
    setMsg('')
    if (newPassword !== confirmPassword) {
      setMsg('两次输入的新密码不一致')
      return
    }
    mutation.mutate({
      oldPassword,
      newPassword,
      confirmPassword,
    })
  }

  return (
    <div className="layout-split">
      <div className="layout-main-stack">
        <Panel title="修改密码" subtitle="8-15 位，支持字母数字和 @._-">
          <form className="field-grid two settings-password-form" onSubmit={onSubmit}>
            <div className="field-row">
              <label htmlFor="settings-old-password">旧密码</label>
              <input
                id="settings-old-password"
                autoComplete="current-password"
                className="text-input"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="field-row">
              <label htmlFor="settings-new-password">新密码</label>
              <input
                id="settings-new-password"
                autoComplete="new-password"
                className="text-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="field-row">
              <label htmlFor="settings-confirm-password">确认新密码</label>
              <input
                id="settings-confirm-password"
                autoComplete="new-password"
                className="text-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <div className="right-actions">
              <button className="primary-btn" type="submit" disabled={mutation.isPending}>
                保存密码
              </button>
            </div>
          </form>
          {msg ? <p role={msg.includes('已更新') ? 'status' : 'alert'} className={msg.includes('已更新') ? 'form-success' : 'form-error'}>{msg}</p> : null}
        </Panel>
      </div>

      <div className="layout-main-stack">
        <Panel className="sticky-panel" title="安全提示" subtitle="建议定期更新账号密码">
          <ul className="hint-list">
            <li>避免使用与游戏昵称、邮箱前缀高度相关的弱口令。</li>
            <li>不建议在第三方群共享账号凭据，降低撞库风险。</li>
            <li>修改后建议重新登录各终端，确保新令牌生效。</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function PriceSettingCard() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)

  const userPriceQuery = useQuery({
    queryKey: ['price-user'],
    queryFn: () => getDefaultResourcePriceSetting('user'),
  })
  const defaultPriceQuery = useQuery({
    queryKey: ['price-default'],
    queryFn: () => getDefaultResourcePriceSetting('default'),
  })
  const resourcesQuery = useQuery({
    queryKey: ['planet-resource-icons'],
    queryFn: getPlanetResources,
  })

  const saveMutation = useMutation({
    mutationFn: saveUserPrePrice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['price-user'] })
      setMsg({ text: '预设价格已保存', severity: 'success' })
    },
    onError: (e) => setMsg({ text: e.message || '保存失败', severity: 'error' }),
  })

  const resourceTypeList = useMemo(() => {
    const source = rows.length ? rows : userPriceQuery.data || defaultPriceQuery.data || []
    return Array.from(new Set(source.map((item) => item.resource_type))).filter(Boolean)
  }, [rows, userPriceQuery.data, defaultPriceQuery.data])

  const iconMap = useMemo(() => {
    const map = new Map()
    ;(resourcesQuery.data || []).forEach((group) => {
      group.options.forEach((item) => map.set(item.value, item.icon))
    })
    return map
  }, [resourcesQuery.data])

  const activeRows = useMemo(() => {
    const data = rows.length ? rows : userPriceQuery.data || []
    return typeFilter ? data.filter((item) => item.resource_type === typeFilter) : data
  }, [rows, userPriceQuery.data, typeFilter])

  useEffect(() => {
    if (!rows.length && userPriceQuery.data?.length) {
      setRows(userPriceQuery.data.map((item) => ({ ...item })))
    }
  }, [rows.length, userPriceQuery.data])

  const updatePrice = (resourceName, value) => {
    setRows((prev) =>
      prev.map((item) =>
        item.resource_name === resourceName ? { ...item, resource_price: Number(value) || 0 } : item,
      ),
    )
  }

  const onReset = () => {
    setRows((defaultPriceQuery.data || []).map((item) => ({ ...item })))
    setMsg({ text: '已恢复默认价格', severity: 'success' })
  }

  const onSave = () => {
    setMsg(null)
    saveMutation.mutate({
      prePriceElement: rows,
    })
  }

  return (
    <div className="layout-split">
      <div className="layout-main-stack">
        <Panel title="价格表" subtitle="支持逐项编辑后统一保存" action={<Pill>{activeRows.length} 条</Pill>}>
          {userPriceQuery.isPending ? <LoadingBar /> : null}
          {userPriceQuery.isError ? (
            <div className="settings-price-error" role="alert">
              <p>预设价格加载失败{rows.length ? '，当前编辑内容已保留。' : '，请重试后再编辑。'}</p>
              <button type="button" className="ghost-btn" disabled={userPriceQuery.isFetching} onClick={() => userPriceQuery.refetch()}>重试预设价格</button>
            </div>
          ) : null}
          {!rows.length && !userPriceQuery.isPending && !userPriceQuery.isError ? (
            <EmptyState title="暂无价格数据" />
          ) : rows.length ? (
            <>
            <div className="table-shell tall settings-price-table-shell" role="region" aria-label="预设价格表，可横向滚动" aria-describedby="settings-price-scroll-hint" tabIndex={0}>
              <table className="data-table compact price-table">
                <thead>
                  <tr>
                    <th>资源</th>
                    <th>分类</th>
                    <th>价格</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((item) => (
                    <tr key={item.resource_name}>
                      <td>
                        <div className="inline-cell">
                          {iconMap.get(item.resource_name) ? (
                            <img className="mini-icon" src={iconMap.get(item.resource_name)} alt={item.resource_name} />
                          ) : null}
                          <span>{item.resource_name}</span>
                        </div>
                      </td>
                      <td>{item.resource_type}</td>
                      <td>
                        <input
                          type="number"
                          aria-label={`${item.resource_name}预设价格`}
                          className="text-input compact-input settings-price-input"
                          value={item.resource_price ?? 0}
                          onChange={(e) => updatePrice(item.resource_name, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p id="settings-price-scroll-hint" className="settings-price-scroll-hint">左右滚动查看完整价格；点击价格可编辑。</p>
            </>
          ) : null}
        </Panel>
      </div>

      <div className="layout-main-stack">
        <Panel className="sticky-panel" title="价格操作" subtitle="分类筛选与保存控制">
          {defaultPriceQuery.isError ? (
            <div className="settings-price-error" role="alert">
              <p>默认价格加载失败，恢复默认暂不可用。</p>
              <button type="button" className="ghost-btn" disabled={defaultPriceQuery.isFetching} onClick={() => defaultPriceQuery.refetch()}>重试默认价格</button>
            </div>
          ) : null}
          <div className="field-row">
            <label htmlFor="settings-resource-type">资源分类</label>
            <select id="settings-resource-type" className="text-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全部</option>
              {resourceTypeList.map((typeName) => (
                <option key={typeName} value={typeName}>
                  {typeName}
                </option>
              ))}
            </select>
          </div>

          <div className="right-actions">
            <button className="ghost-btn" onClick={onReset} disabled={defaultPriceQuery.isPending || defaultPriceQuery.isError || !defaultPriceQuery.data?.length}>
              恢复默认
            </button>
            <button className="primary-btn" onClick={onSave} disabled={saveMutation.isPending || userPriceQuery.isPending || !rows.length}>
              保存价格
            </button>
          </div>

          {msg ? <p role={msg.severity === 'error' ? 'alert' : 'status'} className={msg.severity === 'error' ? 'form-error' : 'form-success'}>{msg.text}</p> : null}
        </Panel>
      </div>
    </div>
  )
}
