import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Search,
  Send,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  getFraudListReportFlowByUserId,
  searchFraud,
  submitFraudReport,
  uploadFraudEvidence,
} from '../services/apiFraudList'
import { AuthContext } from '../context/AuthContext'
import { hasActiveSession } from '../services/fetchWithAuth'
import { EmptyState, PageHeader, Panel } from '../components/ui/Primitives'

const accountTypeOptions = ['游戏ID', 'QQ', '微信', '其他']
const allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']

function ReportModal({ open, onClose }) {
  const [form, setForm] = useState({
    fraud_account: '',
    account_type: '游戏ID',
    description: '',
    contact_number: '',
  })
  const [err, setErr] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])
  const fileInputRef = useRef(null)

  const uploadMutation = useMutation({
    mutationFn: uploadFraudEvidence,
  })

  const reportMutation = useMutation({
    mutationFn: submitFraudReport,
    onSuccess: () => {
      setForm({
        fraud_account: '',
        account_type: '游戏ID',
        description: '',
        contact_number: '',
      })
      setUploadedFiles([])
      setErr('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      onClose()
    },
    onError: (error) => {
      setErr(error.message || '提交失败，请检查字段。')
    },
  })

  if (!open) return null

  const handleUploadFiles = async (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    event.target.value = ''

    if (!pickedFiles.length) return

    const slotsLeft = Math.max(0, 5 - uploadedFiles.length)
    if (slotsLeft === 0) {
      setErr('最多上传 5 张图片。')
      return
    }

    const nextFiles = pickedFiles.slice(0, slotsLeft)
    const invalidFile = nextFiles.find((file) => !allowedFileTypes.includes(file.type))
    if (invalidFile) {
      setErr('仅支持 JPG、PNG、GIF、WEBP、BMP、SVG 图片。')
      return
    }

    setErr('')
    const uploadedBatch = []

    for (const file of nextFiles) {
      try {
        const result = await uploadMutation.mutateAsync(file)
        if (!result?.file_url) {
          throw new Error('图片上传失败，请重试。')
        }
        uploadedBatch.push({
          name: file.name,
          file_url: result.file_url,
        })
      } catch (error) {
        setErr(error.message || '图片上传失败，请重试。')
        break
      }
    }

    if (uploadedBatch.length) {
      setUploadedFiles((prev) => [...prev, ...uploadedBatch])
    }
  }

  const handleRemoveFile = (fileUrl) => {
    setUploadedFiles((prev) => prev.filter((item) => item.file_url !== fileUrl))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setErr('')

    if (!uploadedFiles.length) {
      setErr('请上传至少一张证据图片。')
      return
    }

    reportMutation.mutate({
      fraud_account: form.fraud_account.trim(),
      account_type: form.account_type,
      description: form.description.trim(),
      contact_number: form.contact_number.trim(),
      evidence_dict: uploadedFiles.map((item) => item.file_url),
    })
  }

  const modal = (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.form
        className="modal-card report-card"
        onSubmit={handleSubmit}
        initial={{ opacity: 0, scale: 0.985, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.985, y: 18 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="modal-head">
          <div>
            <p className="modal-kicker">Fraud Report</p>
            <h3>提交举报</h3>
          </div>
          <button className="ghost-btn modal-close-btn" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="field-grid two report-grid">
          <div className="field-row">
            <label>目标账号</label>
            <input
              className="text-input"
              value={form.fraud_account}
              onChange={(e) => setForm((s) => ({ ...s, fraud_account: e.target.value }))}
              required
            />
          </div>
          <div className="field-row">
            <label>账号类型</label>
            <div className="report-type-group" role="tablist" aria-label="账号类型">
              {accountTypeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`report-type-btn ${form.account_type === option ? 'active' : ''}`}
                  onClick={() => setForm((s) => ({ ...s, account_type: option }))}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field-row report-field-block">
          <label>描述</label>
          <textarea
            className="text-input textarea"
            rows={4}
            value={form.description}
            onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            required
          />
        </div>

        <div className="field-grid two report-grid">
          <div className="field-row">
            <label>联系方式</label>
            <input
              className="text-input"
              value={form.contact_number}
              onChange={(e) => setForm((s) => ({ ...s, contact_number: e.target.value }))}
              required
            />
          </div>
          <div className="field-row">
            <label>证据图片</label>
            <div className="report-upload-block">
              <p className="field-help">支持 JPG、PNG、GIF、WEBP、BMP、SVG，最多 5 张。</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={allowedFileTypes.join(',')}
                multiple
                hidden
                onChange={handleUploadFiles}
              />
              <div className="report-upload-actions">
                <button
                  type="button"
                  className="ghost-btn report-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending || uploadedFiles.length >= 5}
                >
                  <ImagePlus size={16} />
                  {uploadMutation.isPending ? '上传中...' : '上传图片'}
                </button>
                <span className="upload-count">{uploadedFiles.length} / 5</span>
              </div>
              <div className="upload-list">
                {uploadedFiles.length ? (
                  uploadedFiles.map((file) => (
                    <div className="upload-item" key={file.file_url}>
                      <span className="upload-item-name">{file.name}</span>
                      <button type="button" className="upload-remove-btn" onClick={() => handleRemoveFile(file.file_url)}>
                        <X size={14} />
                        移除
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="upload-empty">请上传聊天记录或其他证据截图</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {err ? <p className="form-error">{err}</p> : null}
        <button className="primary-btn block report-submit-btn" disabled={reportMutation.isPending || uploadMutation.isPending}>
          {reportMutation.isPending ? '提交中...' : '提交举报'}
        </button>
      </motion.form>
    </motion.div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}

function FloatingToast({ message }) {
  if (!message) return null

  const toast = (
    <motion.div
      className="floating-toast"
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <AlertTriangle size={16} />
      <span>{message}</span>
    </motion.div>
  )

  if (typeof document === 'undefined') return toast
  return createPortal(toast, document.body)
}

export default function FraudListPage() {
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState([])
  const [showReport, setShowReport] = useState(false)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [toastMessage, setToastMessage] = useState('')
  const toastTimerRef = useRef(null)
  const { isAuthenticated } = useContext(AuthContext)
  const canLoadMyReports = isAuthenticated && hasActiveSession()

  const searchMutation = useMutation({
    mutationFn: searchFraud,
    onSuccess: (data) => {
      setRows(Array.isArray(data) ? data : [])
    },
  })

  const myReports = useQuery({
    queryKey: ['my-reports'],
    queryFn: getFraudListReportFlowByUserId,
    enabled: canLoadMyReports,
    retry: false,
  })

  const reportCount = useMemo(() => {
    if (!myReports.data || !Array.isArray(myReports.data)) return 0
    return myReports.data.length
  }, [myReports.data])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  const showTopToast = (message) => {
    setToastMessage(message)
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('')
      toastTimerRef.current = null
    }, 2200)
  }

  const onSearch = () => {
    if (!keyword.trim()) {
      showTopToast('请输入查询账号')
      return
    }
    setToastMessage('')
    searchMutation.mutate({ searchNumber: keyword.trim() })
  }

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return rows

    const sorted = [...rows].sort((a, b) => {
      const left = a[sortConfig.key]
      const right = b[sortConfig.key]

      if (sortConfig.key === 'fraud_account') {
        const leftNumber = Number(left)
        const rightNumber = Number(right)
        if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
          return leftNumber - rightNumber
        }
      }

      return String(left ?? '').localeCompare(String(right ?? ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base',
      })
    })

    return sortConfig.direction === 'asc' ? sorted : sorted.reverse()
  }, [rows, sortConfig])

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

  return (
    <>
      <PageHeader
        title="诈骗名单"
        subtitle="快速验证账号风险并提交社区举报"
        action={
          <div className="head-actions">
            {isAuthenticated ? (
              <button className="ghost-btn report-open-btn" onClick={() => setShowReport(true)}>
                <Send size={14} />
                举报
              </button>
            ) : null}

          </div>
        }
      />

      <Panel className="fraud-hero-panel">
        <div className="fraud-hero">
          <div className="fraud-search-block">
            <div className="fraud-search-meta">
              <p className="fraud-search-label">账号检索</p>
            </div>

            <div className="search-row search-row-hero">
              <div className="search-box">
                <Search size={14} />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="输入游戏ID / QQ / 微信号"
                  className="search-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSearch()
                  }}
                />
              </div>
              <button className="primary-btn search-submit-btn" onClick={onSearch} disabled={searchMutation.isPending}>
                {searchMutation.isPending ? '查询中...' : '查询'}
              </button>
            </div>

            <div className="fraud-inline-hints">
              <span>建议使用完整昵称或社交账号，简称容易漏检。</span>
              <span>结果建议结合聊天记录与交易证据二次核验。</span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="layout-main-stack">
        <Panel
          title="检索结果"
          subtitle={searchMutation.isPending ? '查询中，请稍候。' : rows.length ? `命中 ${rows.length} 条记录` : undefined}
        >
          {rows.length === 0 ? (
            <EmptyState title="暂无结果" desc="输入目标账号后开始查询" />
          ) : (
            <div className="table-shell tall">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('account_type')}>
                        <span>账号类型</span>
                        {renderSortIcon('account_type')}
                      </button>
                    </th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('fraud_account')}>
                        <span>账号号码</span>
                        {renderSortIcon('fraud_account')}
                      </button>
                    </th>
                    <th>备注</th>
                    <th>纠纷类型</th>
                    <th>
                      <button className="sort-header" onClick={() => toggleSort('source_group_name')}>
                        <span>名单来源</span>
                        {renderSortIcon('source_group_name')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.id ?? `${row.fraud_account}-${row.source_group_name}`}>
                      <td>{row.account_type}</td>
                      <td>{row.fraud_account}</td>
                      <td>{row.remark || '-'}</td>
                      <td>{row.fraud_type}</td>
                      <td>
                        <div className="source-cell">
                          {row.icon ? <img src={row.icon} alt={row.source_group_name} className="source-icon" /> : null}
                          <span>{row.source_group_name}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {isAuthenticated && myReports.data?.length ? (
          <Panel title={`我的举报记录 ${reportCount}`}>
            <div className="table-shell">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>目标账号</th>
                    <th>账号类型</th>
                    <th>状态</th>
                    <th>审核组</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {myReports.data.map((item) => (
                    <tr key={item.id}>
                      <td>{item.fraud_account}</td>
                      <td>{item.account_type}</td>
                      <td>{item.report_status}</td>
                      <td>{item.approver_group || '-'}</td>
                      <td>{item.create_time || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

        ) : null}

      <Panel className="fraud-notice-panel">
        <div className="fraud-notice-copy">
          <p>本功能旨在整合各大交易群中的纠纷与诈骗实施者</p>
          <p>该名单由各大交易群管理直接维护，如有错误，请联系名单中出现的交易群管理</p>
          <p>欢迎各大交易群联系本人 QQ:2235102484 一起整合名单，我会开放管理账户由群管理直接控制名单</p>
        </div>
        <div className="fraud-notice-groups">
          <p className="fraud-notice-title">以下为当前的合作交易群</p>
          <div className="fraud-notice-group-list">
            <span>吉商委员会--927154656</span>
            <span>EVE交易群--微信</span>
            <span>奶爸商业联盟--636501916</span>
            <span>墨意商业--569553200</span>
          </div>
        </div>
      </Panel>
      </div>

      <AnimatePresence>{toastMessage ? <FloatingToast message={toastMessage} /> : null}</AnimatePresence>
      <AnimatePresence>{showReport ? <ReportModal open={showReport} onClose={() => setShowReport(false)} /> : null}</AnimatePresence>
    </>
  )
}
