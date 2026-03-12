import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changePassword } from '../services/apiAuthentication'
import { getDefaultResourcePriceSetting, getPlanetResources, saveUserPrePrice } from '../services/apiPlanetaryResource'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'

export default function SettingPage() {
  const [tab, setTab] = useState('password')

  return (
    <>
      <PageHeader title="用户设置" subtitle="账号安全与资源预设价格" />
      <Panel>
        <div className="tab-row">
          <button className={`tab-btn ${tab === 'password' ? 'active' : ''}`} onClick={() => setTab('password')}>
            修改密码
          </button>
          <button className={`tab-btn ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>
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
          <form className="field-grid two" onSubmit={onSubmit}>
            <div className="field-row">
              <label>旧密码</label>
              <input
                className="text-input"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </div>
            <div className="field-row">
              <label>新密码</label>
              <input
                className="text-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="field-row">
              <label>确认新密码</label>
              <input
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
          {msg ? <p className={msg.includes('已更新') ? 'form-success' : 'form-error'}>{msg}</p> : null}
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
  const [msg, setMsg] = useState('')

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
      setMsg('预设价格已保存')
    },
    onError: (e) => setMsg(e.message || '保存失败'),
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
    setMsg('已恢复默认价格')
  }

  const onSave = () => {
    setMsg('')
    saveMutation.mutate({
      prePriceElement: rows,
    })
  }

  return (
    <div className="layout-split">
      <div className="layout-main-stack">
        <Panel title="价格表" subtitle="支持逐项编辑后统一保存" action={<Pill>{activeRows.length} 条</Pill>}>
          {userPriceQuery.isPending || defaultPriceQuery.isPending ? <LoadingBar /> : null}
          {!rows.length ? (
            <EmptyState title="暂无价格数据" />
          ) : (
            <div className="table-shell tall">
              <table className="data-table compact">
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
                          className="text-input compact-input"
                          value={item.resource_price ?? 0}
                          onChange={(e) => updatePrice(item.resource_name, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="layout-main-stack">
        <Panel className="sticky-panel" title="价格操作" subtitle="分类筛选与保存控制">
          <div className="field-row">
            <label>资源分类</label>
            <select className="text-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全部</option>
              {resourceTypeList.map((typeName) => (
                <option key={typeName} value={typeName}>
                  {typeName}
                </option>
              ))}
            </select>
          </div>

          <div className="right-actions">
            <button className="ghost-btn" onClick={onReset}>
              恢复默认
            </button>
            <button className="primary-btn" onClick={onSave} disabled={saveMutation.isPending}>
              保存价格
            </button>
          </div>

          {msg ? <p className={msg.includes('已') ? 'form-success' : 'form-error'}>{msg}</p> : null}
        </Panel>
      </div>
    </div>
  )
}
