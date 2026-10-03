export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Panel({ title, subtitle, children, action, className = '' }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ title, desc }) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title">{title}</p>
      {desc ? <p className="empty-desc">{desc}</p> : null}
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

export function LoadingBar({ label = '正在加载数据' }) {
  return (
    <div className="loading-bar" role="status" aria-live="polite">
      <span aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

