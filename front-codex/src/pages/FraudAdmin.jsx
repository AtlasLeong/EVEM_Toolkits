import { useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FilePenLine,
  History,
  Plus,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import {
  addFraudRecord,
  checkFraudAdmin,
  deleteFraudByID,
  editFraudRecord,
  getAdminFraudByAuth,
  getFraudAdminGroup,
  getFraudBehaviorFlow,
  getFraudReportListAdmin,
  submitReportApprove,
} from '../services/apiFraudList'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'

const ACCOUNT_TYPE_OPTIONS = ['游戏ID', 'QQ', '微信', '咸鱼号']
const FRAUD_TYPE_OPTIONS = ['诈骗', '中间人纠纷']

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getStatusLabel(status) {
  if (status === 'pending') return '等待审核'
  if (status === 'accept') return '审核通过'
  if (status === 'reject') return '审核拒绝'
  return '未知状态'
}

function getStatusTone(status) {
  if (status === 'pending') return 'warning'
  if (status === 'accept') return 'success'
  if (status === 'reject') return 'danger'
  return 'neutral'
}

function getActionLabel(actionType) {
  if (actionType === 'add') return '新增'
  if (actionType === 'delete') return '删除'
  if (actionType === 'update') return '修改'
  if (actionType === 'accept') return '审核通过'
  if (actionType === 'reject') return '审核拒绝'
  return actionType || '未知操作'
}

function normalizeGroupOptions(groups) {
  if (!Array.isArray(groups)) return []

  return groups
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return { value: String(item), label: String(item) }
      }

      const value =
        item?.value ??
        item?.id ??
        item?.group_id ??
        item?.source_group_id ??
        item?.source_group ??
        ''
      const label =
        item?.label ??
        item?.source_group_name ??
        item?.group_name ??
        item?.name ??
        String(value || '')

      if (!value) return null
      return {
        value: String(value),
        label,
      }
    })
    .filter(Boolean)
}

function normalizeEvidenceList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function toSourceGroupId(value) {
  if (value === '' || value === null || value === undefined) return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}

function createRecordForm(record = {}) {
  return {
    fraud_account: record.fraud_account || '',
    account_type: record.account_type || '游戏ID',
    fraud_type: record.fraud_type || '诈骗',
    remark: record.remark || '',
    source_group_id: record.source_group_id ? String(record.source_group_id) : '',
  }
}

function AdminModal({ kicker, title, onClose, children, className = '' }) {
  const modal = (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-card admin-modal ${className}`.trim()} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            {kicker ? <p className="modal-kicker">{kicker}</p> : null}
            <h3>{title}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={16} />
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

function RecordEditorModal({
  mode,
  form,
  setForm,
  groupOptions,
  onClose,
  onSubmit,
  isPending,
}) {
  return (
    <AdminModal kicker="Fraud Admin" title={mode === 'edit' ? '编辑诈骗记录' : '新增诈骗记录'} onClose={onClose}>
      <div className="field-grid two admin-modal-grid">
        <div className="field-row">
          <label>诈骗账号</label>
          <input
            className="text-input"
            value={form.fraud_account}
            onChange={(event) => setForm((current) => ({ ...current, fraud_account: event.target.value }))}
            placeholder="输入账号或角色名"
          />
        </div>

        <div className="field-row">
          <label>账号类型</label>
          <select
            className="text-input admin-select"
            value={form.account_type}
            onChange={(event) => setForm((current) => ({ ...current, account_type: event.target.value }))}
          >
            {ACCOUNT_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <label>纠纷类型</label>
          <select
            className="text-input admin-select"
            value={form.fraud_type}
            onChange={(event) => setForm((current) => ({ ...current, fraud_type: event.target.value }))}
          >
            {FRAUD_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <label>来源群组</label>
          <select
            className="text-input admin-select"
            value={form.source_group_id}
            onChange={(event) => setForm((current) => ({ ...current, source_group_id: event.target.value }))}
          >
            <option value="">选择来源群组</option>
            {groupOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row admin-span-two">
          <label>备注</label>
          <textarea
            className="text-input textarea"
            value={form.remark}
            onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
            placeholder="补充交易背景、可核验信息或处理说明"
          />
        </div>
      </div>

      <div className="right-actions admin-modal-actions">
        <button type="button" className="ghost-btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary-btn" onClick={onSubmit} disabled={isPending}>
          {isPending ? '提交中...' : mode === 'edit' ? '保存修改' : '新增记录'}
        </button>
      </div>
    </AdminModal>
  )
}

function ReportDetailModal({
  report,
  onClose,
  onApprove,
  isPending,
}) {
  const [approveStatus, setApproveStatus] = useState('accept')
  const [approveRemark, setApproveRemark] = useState('')
  const evidenceList = normalizeEvidenceList(report?.evidence_dict)
  const isReviewMode = report?.report_status === 'pending'

  return (
    <AdminModal
      kicker="Fraud Report"
      title={isReviewMode ? '审核社区举报' : '查看举报详情'}
      onClose={onClose}
      className="admin-report-modal"
    >
      <div className="admin-report-header">
        <Pill tone={getStatusTone(report.report_status)}>{getStatusLabel(report.report_status)}</Pill>
        <p className="muted-line">提交时间：{formatDate(report.create_time)}</p>
      </div>

      <div className="admin-detail-grid">
        <div>
          <span>举报账号</span>
          <strong>{report.fraud_account || '-'}</strong>
        </div>
        <div>
          <span>账号类型</span>
          <strong>{report.account_type || '-'}</strong>
        </div>
        <div>
          <span>联系方式</span>
          <strong>{report.contact_number || '-'}</strong>
        </div>
        <div>
          <span>审核群组</span>
          <strong>{report.approver_group || '-'}</strong>
        </div>
        <div className="admin-span-two">
          <span>举报描述</span>
          <strong>{report.description || '-'}</strong>
        </div>
        <div className="admin-span-two">
          <span>审核备注</span>
          <strong>{report.approve_remark || '-'}</strong>
        </div>
      </div>

      <div className="admin-evidence-block">
        <div className="panel-head">
          <div>
            <h2>证据截图</h2>
            <p>点击图片可在新标签页查看原图</p>
          </div>
        </div>
        {!evidenceList.length ? (
          <EmptyState title="暂无证据图片" desc="举报记录里没有附带截图。" />
        ) : (
          <div className="admin-evidence-grid">
            {evidenceList.map((item) => (
              <a
                key={item}
                href={item}
                target="_blank"
                rel="noreferrer"
                className="admin-evidence-item"
              >
                <img src={item} alt="举报证据" />
              </a>
            ))}
          </div>
        )}
      </div>

      {isReviewMode ? (
        <>
          <div className="field-row">
            <label>审核备注</label>
            <textarea
              className="text-input textarea"
              value={approveRemark}
              onChange={(event) => setApproveRemark(event.target.value)}
              placeholder="填写通过或拒绝的处理说明"
            />
          </div>

          <div className="pill-row">
            <button
              type="button"
              className={`ghost-btn ${approveStatus === 'accept' ? 'active-approve' : ''}`}
              onClick={() => setApproveStatus('accept')}
            >
              <CheckCircle2 size={14} />
              通过
            </button>
            <button
              type="button"
              className={`ghost-btn danger ${approveStatus === 'reject' ? 'active-approve' : ''}`}
              onClick={() => setApproveStatus('reject')}
            >
              <XCircle size={14} />
              拒绝
            </button>
          </div>

          <div className="right-actions admin-modal-actions">
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() =>
                onApprove({
                  report_id: report.id,
                  approve_status: approveStatus,
                  approve_remark: approveRemark.trim(),
                })
              }
              disabled={isPending}
            >
              {isPending ? '提交中...' : '提交审核'}
            </button>
          </div>
        </>
      ) : null}
    </AdminModal>
  )
}

function FlowDetailModal({ pair, onClose }) {
  const beforeRecord = pair?.before
  const afterRecord = pair?.after

  const renderRow = (label, key) => {
    const beforeValue = beforeRecord?.[key] || '-'
    const afterValue = afterRecord?.[key] || '-'
    const changed = beforeValue !== afterValue

    return (
      <div className={`admin-compare-row ${changed ? 'changed' : ''}`} key={key}>
        <span>{label}</span>
        <strong>{beforeValue}</strong>
        <strong>{afterValue}</strong>
      </div>
    )
  }

  return (
    <AdminModal kicker="Change Log" title="查看修改详情" onClose={onClose}>
      <div className="admin-compare-grid admin-compare-header">
        <div>
          <span>字段</span>
        </div>
        <div>
          <span>修改前</span>
        </div>
        <div>
          <span>修改后</span>
        </div>
      </div>
      <div className="admin-compare-grid">
        {renderRow('诈骗账号', 'fraud_account')}
        {renderRow('账号类型', 'account_type')}
        {renderRow('纠纷类型', 'fraud_type')}
        {renderRow('备注', 'remark')}
        {renderRow('来源群组', 'source_group_name')}
      </div>
    </AdminModal>
  )
}

export default function FraudAdminPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated } = useContext(AuthContext)
  const [activeTab, setActiveTab] = useState('records')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const [createForm, setCreateForm] = useState(createRecordForm())
  const [editingRecord, setEditingRecord] = useState(null)
  const [editingForm, setEditingForm] = useState(createRecordForm())
  const [activeReport, setActiveReport] = useState(null)
  const [activeFlowPair, setActiveFlowPair] = useState(null)

  const adminAuthQuery = useQuery({
    queryKey: ['fraud-admin-auth'],
    queryFn: checkFraudAdmin,
    enabled: isAuthenticated,
    retry: false,
  })

  const isAdmin = adminAuthQuery.data?.message === 'Authorized Users'

  const groupQuery = useQuery({
    queryKey: ['fraud-admin-group'],
    queryFn: getFraudAdminGroup,
    enabled: isAdmin,
  })

  const adminListQuery = useQuery({
    queryKey: ['fraud-admin-list'],
    queryFn: getAdminFraudByAuth,
    enabled: isAdmin,
  })

  const behaviorQuery = useQuery({
    queryKey: ['fraud-admin-behavior'],
    queryFn: getFraudBehaviorFlow,
    enabled: isAdmin,
  })

  const reportListQuery = useQuery({
    queryKey: ['fraud-admin-report-list'],
    queryFn: getFraudReportListAdmin,
    enabled: isAdmin,
  })

  const setFeedback = (type, text) => {
    setMessageType(type)
    setMessage(text)
  }

  const invalidateAdminQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fraud-admin-list'] }),
      queryClient.invalidateQueries({ queryKey: ['fraud-admin-behavior'] }),
      queryClient.invalidateQueries({ queryKey: ['fraud-admin-report-list'] }),
    ])

  const addMutation = useMutation({
    mutationFn: addFraudRecord,
    onSuccess: async () => {
      setFeedback('success', '已新增诈骗记录。')
      setCreateForm(createRecordForm())
      await invalidateAdminQueries()
    },
    onError: (err) => {
      setFeedback('error', err.message || '新增记录失败。')
    },
  })

  const editMutation = useMutation({
    mutationFn: editFraudRecord,
    onSuccess: async () => {
      setFeedback('success', '已更新诈骗记录。')
      setEditingRecord(null)
      await invalidateAdminQueries()
    },
    onError: (err) => {
      setFeedback('error', err.message || '更新记录失败。')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFraudByID,
    onSuccess: async () => {
      setFeedback('success', '已删除诈骗记录。')
      await invalidateAdminQueries()
    },
    onError: (err) => {
      setFeedback('error', err.message || '删除记录失败。')
    },
  })

  const approveMutation = useMutation({
    mutationFn: submitReportApprove,
    onSuccess: async () => {
      setFeedback('success', '已提交审核结果。')
      setActiveReport(null)
      await invalidateAdminQueries()
    },
    onError: (err) => {
      setFeedback('error', err.message || '提交审核失败。')
    },
  })

  const groupOptions = useMemo(() => normalizeGroupOptions(groupQuery.data), [groupQuery.data])

  const flowPairs = useMemo(() => {
    const rows = behaviorQuery.data || []
    return rows
      .filter((item) => item.change !== 'F')
      .map((item) => ({
        before: item,
        after:
          rows.find(
            (record) => record.operation_id === item.operation_id && record.change === 'F',
          ) || null,
      }))
  }, [behaviorQuery.data])

  if (!isAuthenticated) {
    return <Navigate replace to="/fraudlogin" />
  }

  if (adminAuthQuery.isPending) {
    return (
      <>
        <PageHeader title="诈骗名单管理" subtitle="正在验证管理员权限。" />
        <Panel>
          <LoadingBar />
        </Panel>
      </>
    )
  }

  if (adminAuthQuery.isError || adminAuthQuery.data?.message === 'UnAuthorized Users') {
    navigate('/fraudlogin', { replace: true })
    return null
  }

  const createRecord = () => {
    if (!createForm.fraud_account.trim() || !createForm.source_group_id) {
      setFeedback('error', '请填写账号并选择来源群组。')
      return
    }

    addMutation.mutate({
      fraudRecord: {
        fraud_account: createForm.fraud_account.trim(),
        account_type: createForm.account_type,
        fraud_type: createForm.fraud_type,
        remark: createForm.remark.trim(),
        source_group_id: toSourceGroupId(createForm.source_group_id),
      },
    })
  }

  const saveEdit = () => {
    if (!editingRecord) return
    if (!editingForm.fraud_account.trim() || !editingForm.source_group_id) {
      setFeedback('error', '请填写账号并选择来源群组。')
      return
    }

    editMutation.mutate({
      fraudRecord: {
        fraud_id: editingRecord.id,
        fraud_account: editingForm.fraud_account.trim(),
        account_type: editingForm.account_type,
        fraud_type: editingForm.fraud_type,
        remark: editingForm.remark.trim(),
        source_group_id: toSourceGroupId(editingForm.source_group_id),
      },
    })
  }

  const removeRecord = (row) => {
    const confirmed = window.confirm(`确认删除记录 ${row.fraud_account}？`)
    if (!confirmed) return
    deleteMutation.mutate({ fraudID: row.id })
  }

  return (
    <>
      <PageHeader
        title="诈骗名单管理"
        subtitle="恢复管理员登录、来源群组、记录编辑、行为流水和举报审批。"
        action={
          <div className="pill-row">
            <Pill>{adminListQuery.data?.length || 0} 条名单</Pill>
            <Pill tone="warning">{reportListQuery.data?.filter((item) => item.report_status === 'pending').length || 0} 条待审核</Pill>
          </div>
        }
      />

      <div className="tab-row admin-tab-row">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'records' ? 'active' : ''}`}
          onClick={() => setActiveTab('records')}
        >
          <ShieldAlert size={14} />
          名单管理
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={14} />
          修改流水
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <ClipboardCheck size={14} />
          举报审批
        </button>
      </div>

      {message ? <p className={messageType === 'error' ? 'form-error' : 'form-success'}>{message}</p> : null}

      {activeTab === 'records' ? (
        <>
          <Panel
            title="新增记录"
            subtitle="来源群组已接回管理员接口，不再手填群组 ID。"
            action={
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setCreateForm(createRecordForm())
                  setMessage('')
                }}
              >
                重置表单
              </button>
            }
          >
            {groupQuery.isPending ? <LoadingBar /> : null}
            <div className="field-grid four">
              <div className="field-row">
                <label>诈骗账号</label>
                <input
                  className="text-input"
                  value={createForm.fraud_account}
                  onChange={(event) => setCreateForm((current) => ({ ...current, fraud_account: event.target.value }))}
                  placeholder="输入账号或角色名"
                />
              </div>

              <div className="field-row">
                <label>账号类型</label>
                <select
                  className="text-input admin-select"
                  value={createForm.account_type}
                  onChange={(event) => setCreateForm((current) => ({ ...current, account_type: event.target.value }))}
                >
                  {ACCOUNT_TYPE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <label>纠纷类型</label>
                <select
                  className="text-input admin-select"
                  value={createForm.fraud_type}
                  onChange={(event) => setCreateForm((current) => ({ ...current, fraud_type: event.target.value }))}
                >
                  {FRAUD_TYPE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <label>来源群组</label>
                <select
                  className="text-input admin-select"
                  value={createForm.source_group_id}
                  onChange={(event) => setCreateForm((current) => ({ ...current, source_group_id: event.target.value }))}
                >
                  <option value="">选择来源群组</option>
                  {groupOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row admin-span-all">
                <label>备注</label>
                <textarea
                  className="text-input textarea"
                  value={createForm.remark}
                  onChange={(event) => setCreateForm((current) => ({ ...current, remark: event.target.value }))}
                  placeholder="填写补充说明、交易背景或可核验信息"
                />
              </div>
            </div>

            <div className="right-actions">
              <button type="button" className="primary-btn" onClick={createRecord} disabled={addMutation.isPending}>
                <Plus size={14} />
                {addMutation.isPending ? '新增中...' : '新增记录'}
              </button>
            </div>
          </Panel>

          <Panel
            title="名单记录"
            subtitle="支持编辑、删除和来源群组回填。"
            action={<Pill>{adminListQuery.data?.length || 0} 条</Pill>}
          >
            {(adminListQuery.isPending || deleteMutation.isPending) && <LoadingBar />}
            {!adminListQuery.data?.length ? (
              <EmptyState title="暂无可管理名单" desc="当前管理员账户还没有分配到可维护的数据。" />
            ) : (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>账号</th>
                      <th>类型</th>
                      <th>纠纷类型</th>
                      <th>来源群组</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminListQuery.data.map((row) => (
                      <tr key={row.id}>
                        <td>{row.id}</td>
                        <td>{row.fraud_account}</td>
                        <td>{row.account_type}</td>
                        <td>{row.fraud_type}</td>
                        <td>
                          <span className="source-cell">
                            {row.icon ? <img src={row.icon} alt={row.source_group_name} className="source-icon" /> : null}
                            <span>{row.source_group_name}</span>
                          </span>
                        </td>
                        <td>{row.remark || '-'}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="ghost-btn compact"
                              onClick={() => {
                                setEditingRecord(row)
                                setEditingForm(createRecordForm(row))
                              }}
                            >
                              <FilePenLine size={14} />
                              编辑
                            </button>
                            <button
                              type="button"
                              className="ghost-btn compact danger"
                              onClick={() => removeRecord(row)}
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}

      {activeTab === 'history' ? (
        <Panel
          title="修改流水"
          subtitle="展示管理员对诈骗记录的新增、删除、修改和审核操作。"
          action={<Pill>{flowPairs.length} 条变更</Pill>}
        >
          {behaviorQuery.isPending ? <LoadingBar /> : null}
          {!flowPairs.length ? (
            <EmptyState title="暂无变更流水" desc="列表修改后会在这里形成前后版本对照。" />
          ) : (
            <div className="table-shell">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>管理员</th>
                    <th>操作</th>
                    <th>账号</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {flowPairs.map((pair) => (
                    <tr key={`${pair.before.operation_id}-${pair.before.change}`}>
                      <td>{formatDate(pair.before.change_time)}</td>
                      <td>{pair.before.username || '-'}</td>
                      <td>{getActionLabel(pair.before.action_type)}</td>
                      <td>{pair.before.fraud_account || '-'}</td>
                      <td>
                        {pair.after ? (
                          <button type="button" className="ghost-btn compact" onClick={() => setActiveFlowPair(pair)}>
                            <Eye size={14} />
                            查看详情
                          </button>
                        ) : (
                          <span className="muted-line">无后置版本</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      {activeTab === 'reports' ? (
        <Panel
          title="举报审批"
          subtitle="管理员可直接审核社区举报，并查看完整证据截图。"
          action={
            <div className="pill-row">
              <Pill tone="warning">{reportListQuery.data?.filter((item) => item.report_status === 'pending').length || 0} 条待审核</Pill>
              <Pill>{reportListQuery.data?.length || 0} 条举报</Pill>
            </div>
          }
        >
          {reportListQuery.isPending ? <LoadingBar /> : null}
          {!reportListQuery.data?.length ? (
            <EmptyState title="暂无举报审批数据" desc="当前没有可处理的社区举报记录。" />
          ) : (
            <div className="table-shell">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>联系方式</th>
                    <th>状态</th>
                    <th>被举报账号</th>
                    <th>账号类型</th>
                    <th>审核备注</th>
                    <th>提交时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reportListQuery.data.map((row) => (
                    <tr key={row.id}>
                      <td>{row.contact_number || '-'}</td>
                      <td>
                        <Pill tone={getStatusTone(row.report_status)}>{getStatusLabel(row.report_status)}</Pill>
                      </td>
                      <td>{row.fraud_account || '-'}</td>
                      <td>{row.account_type || '-'}</td>
                      <td>{row.approve_remark || '-'}</td>
                      <td>{formatDate(row.create_time)}</td>
                      <td>
                        <button type="button" className="ghost-btn compact" onClick={() => setActiveReport(row)}>
                          {row.report_status === 'pending' ? (
                            <>
                              <ClipboardCheck size={14} />
                              审核
                            </>
                          ) : (
                            <>
                              <Eye size={14} />
                              详情
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      {editingRecord ? (
        <RecordEditorModal
          mode="edit"
          form={editingForm}
          setForm={setEditingForm}
          groupOptions={groupOptions}
          onClose={() => setEditingRecord(null)}
          onSubmit={saveEdit}
          isPending={editMutation.isPending}
        />
      ) : null}

      {activeReport ? (
        <ReportDetailModal
          report={activeReport}
          onClose={() => setActiveReport(null)}
          onApprove={(payload) => approveMutation.mutate(payload)}
          isPending={approveMutation.isPending}
        />
      ) : null}

      {activeFlowPair ? <FlowDetailModal pair={activeFlowPair} onClose={() => setActiveFlowPair(null)} /> : null}
    </>
  )
}
