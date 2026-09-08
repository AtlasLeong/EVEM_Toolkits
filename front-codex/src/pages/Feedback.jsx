import { useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CheckCircle2, FileText, LockKeyhole, MessageSquare, Paperclip, Send, X } from 'lucide-react'
import { AuthContext } from '../context/AuthContext'
import { EmptyState, LoadingBar, PageHeader, Panel } from '../components/ui/Primitives'
import { FEEDBACK_MODULES, FEEDBACK_STATUSES, FEEDBACK_TYPES, listFeedback, getFeedback, createFeedback, updateFeedback, commentFeedback, uploadFeedbackFile, downloadFeedbackFile } from '../services/apiFeedback'

const formatDate = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const options = values => Object.entries(values).map(([value, label]) => <option key={value} value={value}>{label}</option>)
const emptyForm = { type: 'feature', module: 'other', title: '', description: '', contact: '' }

function Status({ value }) {
  return <span className={`feedback-status is-${value}`}>{FEEDBACK_STATUSES[value] || value}</span>
}

function RequestError({ error, retry }) {
  if (!error) return null
  return <div className="feedback-error" role="alert"><span>{error.message || error}</span>{retry && <button className="ghost-btn" type="button" onClick={retry}>重新加载</button>}</div>
}

// Retries of unchanged content reuse the same server-side idempotency key.
function useRequestId() {
  const last = useRef(null)
  const idFor = payload => {
    const signature = JSON.stringify(payload)
    if (last.current?.signature !== signature) last.current = { signature, id: crypto.randomUUID() }
    return last.current.id
  }
  return { idFor, reset: () => { last.current = null } }
}

export default function FeedbackPage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  const userKey = userInfo?.userId || userInfo?.userName || 'session'
  return <>
    <PageHeader title="需求与反馈" subtitle="把使用中的想法与问题告诉我们，每一条反馈都可以在这里跟进。" action={<span className="feedback-privacy"><LockKeyhole size={15} />仅你与管理员可见</span>} />
    {isAuthenticated ? <FeedbackWorkspace key={userKey} userKey={userKey} /> : <Panel className="feedback-guest"><MessageSquare size={34} /><h2>让工具更贴近你的使用习惯</h2><p>登录后提交功能建议、报告问题，附上截图或文件，并查看处理进展。</p><Link className="primary-btn" to="/login">登录后提交反馈<ArrowUpRight size={17} /></Link></Panel>}
  </>
}

function FeedbackWorkspace({ userKey }) {
  const client = useQueryClient()
  const [scope, setScope] = useState('mine')
  const [filters, setFilters] = useState({ type: '', module: '', status: '' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const prefix = ['feedback', userKey]
  const listing = useQuery({ queryKey: [...prefix, 'list', scope, filters, page], queryFn: () => listFeedback({ scope, ...filters, page }), retry: 1, staleTime: 0, gcTime: 0 })
  const capability = useQuery({ queryKey: [...prefix, 'capability'], queryFn: () => listFeedback({ scope: 'mine', page: 1 }), retry: 1, staleTime: 60000, gcTime: 0 })
  const canManage = capability.data?.can_manage === true
  useEffect(() => () => { client.removeQueries({ queryKey: prefix }) }, [client, userKey])
  const refresh = () => client.invalidateQueries({ queryKey: prefix })
  const changeScope = next => { setScope(next); setSelected(null); setPage(1); setFilters({ type: '', module: '', status: '' }) }
  return <>
    <div className="feedback-tabs tab-row">
      <button type="button" className={`tab-btn ${scope === 'mine' ? 'active' : ''}`} onClick={() => changeScope('mine')}>我的反馈</button>
      {canManage && <button type="button" className={`tab-btn ${scope === 'all' ? 'active' : ''}`} onClick={() => changeScope('all')}>全部反馈</button>}
      <span className="feedback-tabs-note">有进展时，回复会显示在反馈详情中</span>
    </div>
    <div className={`feedback-workspace ${scope === 'all' ? 'is-management' : ''}`}>
      {scope === 'mine' && <NewFeedback onCreated={ticket => { setSelected(ticket.id); refresh() }} />}
      <div className="feedback-main">
        {selected ? <FeedbackDetail key={selected} id={selected} prefix={prefix} canManage={canManage} onBack={() => setSelected(null)} refresh={refresh} /> : <Panel title={scope === 'all' ? '反馈收件箱' : '反馈记录'} subtitle={listing.data ? `共 ${listing.data.count} 条 · 最近更新优先` : '查看提交记录与处理进度'}>
          <div className="feedback-filters">
            <select className="text-input" aria-label="筛选状态" value={filters.status} onChange={e => { setFilters({ ...filters, status: e.target.value }); setPage(1) }}><option value="">全部状态</option>{options(FEEDBACK_STATUSES)}</select>
            <select className="text-input" aria-label="筛选类型" value={filters.type} onChange={e => { setFilters({ ...filters, type: e.target.value }); setPage(1) }}><option value="">全部类型</option>{options(FEEDBACK_TYPES)}</select>
            <select className="text-input" aria-label="筛选功能" value={filters.module} onChange={e => { setFilters({ ...filters, module: e.target.value }); setPage(1) }}><option value="">全部功能</option>{options(FEEDBACK_MODULES)}</select>
          </div>
          {listing.isPending ? <LoadingBar /> : listing.isError ? <RequestError error={listing.error} retry={() => listing.refetch()} /> : <>
            {!listing.data.results.length ? <EmptyState title="暂无匹配的反馈" desc="提交一条反馈，或调整筛选条件查看其他记录。" /> : <div className="feedback-list">{listing.data.results.map(ticket => <button className="feedback-ticket" type="button" key={ticket.id} onClick={() => setSelected(ticket.id)}>
              <div className="feedback-ticket-top"><span>#{ticket.id} · {FEEDBACK_TYPES[ticket.type]} · {FEEDBACK_MODULES[ticket.module]}</span><Status value={ticket.status} /></div>
              <h3>{ticket.title}</h3><p>{ticket.description}</p>
              <div className="feedback-ticket-meta"><span>{scope === 'all' ? `${ticket.author_name} · ` : ''}{formatDate(ticket.updated_at)}</span><span><MessageSquare size={14} />{ticket.reply_count} 条回复<ArrowUpRight size={16} /></span></div>
            </button>)}</div>}
            {listing.data.count > 20 && <div className="feedback-pagination"><button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.ceil(listing.data.count / 20)} 页</span><button type="button" className="ghost-btn" disabled={page * 20 >= listing.data.count} onClick={() => setPage(page + 1)}>下一页</button></div>}
          </>}
        </Panel>}
      </div>
    </div>
  </>
}

function NewFeedback({ onCreated }) {
  const [form, setForm] = useState(emptyForm)
  const requestId = useRequestId()
  const lock = useRef(false)
  const mutation = useMutation({ mutationFn: createFeedback, onSuccess: ticket => { requestId.reset(); setForm(emptyForm); onCreated(ticket) } })
  const change = e => setForm(current => ({ ...current, [e.target.name]: e.target.value }))
  const submit = async e => {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
    try { await mutation.mutateAsync({ ...payload, request_id: requestId.idFor(payload) }) } catch { /* mutation error is rendered without clearing the form */ } finally { lock.current = false }
  }
  return <Panel className="feedback-compose" title="提交一条反馈" subtitle="一个清晰的描述，能帮助我们更快定位问题。">
    <form onSubmit={submit} className="feedback-form">
      <div className="feedback-two-fields"><label>反馈类型<select className="text-input" name="type" value={form.type} onChange={change}>{options(FEEDBACK_TYPES)}</select></label><label>所属功能<select className="text-input" name="module" value={form.module} onChange={change}>{options(FEEDBACK_MODULES)}</select></label></div>
      <label>反馈标题<input className="text-input" name="title" value={form.title} onChange={change} required maxLength={120} placeholder="用一句话概括你的想法或问题" /></label>
      <label>详细描述<textarea className="text-input" name="description" value={form.description} onChange={change} required maxLength={5000} rows={6} placeholder={'希望实现什么？遇到了什么问题？\n如报告问题，请说明操作步骤、预期结果和实际结果。'} /></label>
      <label>联系方式（选填）<input className="text-input" name="contact" value={form.contact} onChange={change} maxLength={200} placeholder="邮箱或 QQ，方便需要时进一步沟通" /></label>
      <p className="feedback-helper"><Paperclip size={15} />提交后可在详情中添加图片或文件。</p>
      <p className="feedback-helper">请勿填写密码、验证码或其他敏感信息。每个账号每天最多提交 20 条。</p>
      <RequestError error={mutation.error} />
      <button className="primary-btn feedback-submit" type="submit" disabled={mutation.isPending || !form.title.trim() || !form.description.trim()}><Send size={17} />{mutation.isPending ? '正在提交…' : '提交反馈'}</button>
    </form>
  </Panel>
}

function FeedbackDetail({ id, prefix, canManage, onBack, refresh }) {
  const detail = useQuery({ queryKey: [...prefix, 'detail', id], queryFn: () => getFeedback(id), retry: 1, staleTime: 0, gcTime: 0 })
  return <Panel className="feedback-detail" action={<button className="ghost-btn" type="button" onClick={onBack}><ArrowLeft size={16} />返回列表</button>}>
    {detail.isPending ? <LoadingBar /> : detail.isError ? <RequestError error={detail.error} retry={() => detail.refetch()} /> : <>
      <div className="feedback-detail-meta"><span>#{id} · {FEEDBACK_TYPES[detail.data.type]} · {FEEDBACK_MODULES[detail.data.module]}</span><Status value={detail.data.status} /></div>
      <h2 className="feedback-detail-title">{detail.data.title}</h2>
      <p className="feedback-helper">{detail.data.author_name} · {formatDate(detail.data.created_at)}</p>
      <p className="feedback-body">{detail.data.description}</p>
      {detail.data.contact && <p className="feedback-contact">联系方式：{detail.data.contact}</p>}
      <Attachments ticket={detail.data} refresh={refresh} />
      {canManage && <ManageStatus ticket={detail.data} refresh={refresh} />}
      <div className="feedback-conversation"><h3>沟通记录 <span>{detail.data.comments.length}</span></h3>
        {!detail.data.comments.length && <p className="feedback-helper">暂时没有回复。你可以继续补充说明。</p>}
        {detail.data.comments.map(comment => <article className={`feedback-comment ${comment.is_staff ? 'is-staff' : ''}`} key={comment.id}><div><strong>{comment.is_staff ? '管理员' : comment.author_name}</strong><time>{formatDate(comment.created_at)}</time></div><p className="feedback-body">{comment.body}</p></article>)}
      </div>
      <Reply ticket={detail.data} canManage={canManage} refresh={refresh} />
    </>}
  </Panel>
}

function ManageStatus({ ticket, refresh }) {
  const [status, setStatus] = useState(ticket.status)
  const mutation = useMutation({ mutationFn: () => updateFeedback(ticket.id, status), onSuccess: refresh })
  useEffect(() => setStatus(ticket.status), [ticket.status])
  return <div className="feedback-management"><label>处理状态<select className="text-input" aria-label="处理状态" value={status} onChange={e => { setStatus(e.target.value); mutation.reset() }}>{options(FEEDBACK_STATUSES)}</select></label><button type="button" className="ghost-btn" disabled={mutation.isPending || status === ticket.status} onClick={() => mutation.mutate()}>保存状态</button><RequestError error={mutation.error} />{mutation.isSuccess && <span role="status" className="feedback-success"><CheckCircle2 size={14} />状态已更新</span>}</div>
}

function Reply({ ticket, canManage, refresh }) {
  const [body, setBody] = useState('')
  const requestId = useRequestId()
  const lock = useRef(false)
  const mutation = useMutation({ mutationFn: payload => commentFeedback(ticket.id, payload), onSuccess: () => { requestId.reset(); setBody(''); refresh() } })
  const full = ticket.comments.length >= 100
  return <form className="feedback-form feedback-reply" onSubmit={async e => {
    e.preventDefault()
    if (lock.current || full) return
    lock.current = true
    const payload = { body: body.trim() }
    try { await mutation.mutateAsync({ ...payload, request_id: requestId.idFor(payload) }) } catch { /* keep reply for retry */ } finally { lock.current = false }
  }}><label>{canManage ? '回复内容' : '补充说明'}<textarea className="text-input" rows={3} value={body} onChange={e => setBody(e.target.value)} maxLength={3000} required disabled={full} placeholder={full ? '已达到单条反馈的沟通上限，请新建反馈并注明原编号。' : '补充细节，或说明最新进展…'} /></label><RequestError error={mutation.error} /><div className="right-actions"><button className="primary-btn" disabled={mutation.isPending || !body.trim() || full}><Send size={16} />{mutation.isPending ? '发送中…' : canManage ? '发送回复' : '发送补充'}</button></div></form>
}

function Attachments({ ticket, refresh }) {
  const [pending, setPending] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [downloading, setDownloading] = useState(null)
  const files = ticket.attachments || []
  const pick = e => {
    setError('')
    const chosen = [...e.target.files]
    e.target.value = ''
    if (chosen.some(file => !/\.(png|jpe?g|webp|pdf|txt|log)$/i.test(file.name))) { setError('不支持此文件格式，请选择图片、PDF 或 TXT／LOG 文件。'); return }
    if (chosen.some(file => file.size === 0 || file.size > 10 * 1024 * 1024)) { setError('附件不能为空，且单文件不能超过 10 MB。'); return }
    if (chosen.length + pending.length + files.length > 20) { setError('每条反馈最多 20 个附件。'); return }
    if ([...chosen, ...pending.map(item => item.file), ...files].reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) { setError('每条反馈附件合计不能超过 50 MB。'); return }
    setPending(current => [...current, ...chosen.map(file => ({ file, id: crypto.randomUUID() }))])
  }
  const upload = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      for (const item of pending) {
        await uploadFeedbackFile(ticket.id, item.file, item.id)
        setPending(current => current.filter(file => file.id !== item.id))
        await refresh()
      }
    } catch (err) { setError(`上传未完成：${err.message}。已成功的附件已保存，剩余文件可以重试。`) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="feedback-attachments" aria-label="反馈附件"><h3><Paperclip size={17} />图片与文件 <span>{files.length} / 20</span></h3>
    <p className="feedback-helper">支持 PNG / JPG / WebP、PDF、TXT / LOG，单文件 10 MB，总计 50 MB。仅本人和管理员可下载，请先遮盖截图中的敏感信息。</p>
    <div className="feedback-file-list">{files.map(file => <button type="button" className="feedback-file" key={file.id} aria-label={`下载 ${file.name}`} disabled={downloading !== null} onClick={async () => {
      setDownloading(file.id); setError('')
      try { await downloadFeedbackFile(ticket.id, file) } catch (err) { setError(err.message) } finally { setDownloading(null) }
    }}><FileText size={16} /><span>{file.name}</span><small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></button>)}</div>
    <label className="feedback-file-picker">选择附件<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log" disabled={busy || files.length >= 20} onChange={pick} /></label>
    {pending.map(item => <div className="feedback-pending-file" key={item.id}><span>{item.file.name}</span><button className="ghost-btn" type="button" aria-label={`移除 ${item.file.name}`} disabled={busy} onClick={() => setPending(current => current.filter(file => file.id !== item.id))}><X size={14} /></button></div>)}
    <RequestError error={error} />
    {!!pending.length && <button type="button" className="ghost-btn" disabled={busy} onClick={upload}><Paperclip size={16} />{busy ? '正在上传…' : '上传附件'}</button>}
  </section>
}
