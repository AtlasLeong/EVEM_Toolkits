import { Link, useLocation } from 'react-router-dom'
import { PUBLIC_READ_ACCESS_ENABLED } from '../../utils/viewerAccess'
import '../../styles/industryJourney.css'

export default function IndustryJourney() {
  const { pathname, hash } = useLocation()
  if (pathname !== '/market' && pathname !== '/manufacturing') return null
  const purchasing = pathname === '/manufacturing' && hash === '#manufacturing-purchase-list'
  const steps = [
    { to: '/market', label: '查市场价格', active: pathname === '/market' },
    { to: '/manufacturing', label: '估制造成本', active: pathname === '/manufacturing' && !purchasing },
    { to: '/manufacturing#manufacturing-purchase-list', label: '带走采购清单', active: purchasing },
  ]

  return <nav className="industry-journey" aria-label="市场到采购流程">
    <ol>
      {steps.map((step, index) => <li key={step.to}>
        <Link to={step.to} aria-current={step.active ? 'step' : undefined}>
          <span className="industry-step-number" aria-hidden="true">{index + 1}</span>
          <span>{step.label}</span>
        </Link>
      </li>)}
    </ol>
    <Link className="industry-access-link" to="/infocenter">{PUBLIC_READ_ACCESS_ENABLED ? '公开工具' : '登录可用'} · 使用与权限</Link>
  </nav>
}
