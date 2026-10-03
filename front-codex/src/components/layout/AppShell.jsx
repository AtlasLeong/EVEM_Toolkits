import { motion, useReducedMotion } from 'framer-motion'
import { Shield, Globe, Compass, Crosshair, LogOut, Settings, User, Users, MessageSquare, ChevronsLeft, ChevronsRight, LogIn, Menu, X, ChartNoAxesCombined, Factory, Swords } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import useTacticalUsageAccess from '../../hooks/useTacticalUsageAccess'
import useKillboardAccess from '../../hooks/useKillboardAccess'
import { pageTransitionKey } from '../../utils/routeTransition.js'
import { loginReturnPath } from '../../utils/loginDestination'

const navGroups = [
  { id: 'industry', label: '市场与工业', items: [
    { to: '/market', label: '市场价格', icon: ChartNoAxesCombined },
    { to: '/manufacturing', label: '制造估价', icon: Factory },
    { to: '/planetary', label: '行星资源', icon: Globe },
  ] },
  { id: 'operations', label: '星际行动', items: [
    { to: '/killboard', label: '击毁情报', icon: Swords },
    { to: '/killboard/admin', label: '击毁采集后台', icon: Swords },
    { to: '/starmap', label: '星系导航', icon: Compass },
    { to: '/tactical', label: '战术板', icon: Crosshair },
    { to: '/tactical/usage', label: '战术板概况', icon: ChartNoAxesCombined },
  ] },
  { id: 'community', label: '社区情报', items: [
    { to: '/fraudlist', label: '防诈名单', icon: Shield },
    { to: '/corporations', label: '军团大厅', icon: Users },
    { to: '/starsea', label: '星海见闻', icon: Compass },
    { to: '/feedback', label: '需求与反馈', icon: MessageSquare },
  ] },
]

const routeOrder = ['/fraudlist', '/planetary', '/market', '/manufacturing', '/killboard', '/starmap', '/tactical', '/corporations', '/starsea', '/feedback', '/usersetting', '/fraudadmin', '/licenseadmin', '/infocenter']

function routeIndex(pathname) {
  const idx = routeOrder.findIndex((path) => pathname.startsWith(path))
  return idx === -1 ? routeOrder.length : idx
}

function DesktopOnlyMask() {
  return (
    <div className="desktop-only-mask">
      <h1>EVEMToolkit</h1>
      <p>为了完整查看表格和星图，请使用电脑或更宽的浏览器窗口。</p>
    </div>
  )
}

function DensityControl({ density, onChange }) {
  return (
    <div className="shell-density-control" role="group" aria-label="显示密度">
      <span className="shell-density-label">显示密度</span>
      <div className="shell-density-options">
        <button type="button" aria-pressed={density === 'compact'} onClick={() => onChange('compact')}>紧凑</button>
        <button type="button" aria-pressed={density === 'comfortable'} onClick={() => onChange('comfortable')}>舒适</button>
      </div>
    </div>
  )
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, userInfo, logout } = useContext(AuthContext)
  const usageAccess = useTacticalUsageAccess()
  const killboardAccess = useKillboardAccess()
  const canViewUsage = usageAccess.allowed
  const exactNavigationMatch = to => to === '/tactical' || (to === '/killboard' && /^\/killboard\/admin(?:\/|$)/.test(location.pathname))
  const availableNavGroups = navGroups.map(group => ({ ...group, items: group.items.filter(item => {
    if (item.to.startsWith('/killboard')) return killboardAccess.allowed
    if (item.to === '/tactical/usage') return canViewUsage
    return true
  }) }))
  const reduceMotion = useReducedMotion()
  const displayName = userInfo?.userName?.trim() || '已登录用户'
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('evem-sidebar-collapsed') === 'true' } catch { return false }
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('evem-content-density') === 'comfortable' ? 'comfortable' : 'compact' } catch { return 'compact' }
  })
  const mobileToggleRef = useRef(null)
  const mobileNavRef = useRef(null)
  const mainRef = useRef(null)
  const mobileNavOpenRef = useRef(false)
  mobileNavOpenRef.current = mobileNavOpen
  const openLogin = () => navigate('/login', { state: { from: loginReturnPath(location) } })

  useEffect(() => {
    try { localStorage.setItem('evem-sidebar-collapsed', String(collapsed)) } catch { /* Navigation remains usable when storage is unavailable. */ }
  }, [collapsed])

  useEffect(() => {
    try { localStorage.setItem('evem-content-density', density) } catch { /* Keep the control usable without persistent storage. */ }
  }, [density])

  useEffect(() => {
    if (!mobileNavOpenRef.current) return
    setMobileNavOpen(false)
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!mobileNavOpen) return undefined
    const closeOnEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setMobileNavOpen(false)
      mobileToggleRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1180px)')
    const isMobileControl = element => mobileNavRef.current?.contains(element) || element === mobileToggleRef.current
    let lastFocusedMobile = isMobileControl(document.activeElement) ? document.activeElement : null
    const rememberMobileFocus = event => {
      lastFocusedMobile = isMobileControl(event.target) ? event.target : null
    }
    const forgetVisibleBlur = event => {
      if (!isMobileControl(event.target)) return
      // A hidden control may blur before the breakpoint notification arrives.
      // An intentional blur or a move to another control clears its origin.
      if (event.relatedTarget || event.target.getClientRects().length) lastFocusedMobile = null
    }
    const closeOnDesktop = event => {
      if (!event.matches) return
      const active = document.activeElement
      const focused = active === document.body ? lastFocusedMobile : active
      const focusedMobileNavigation = focused?.isConnected && isMobileControl(focused)
      setMobileNavOpen(false)
      if (focusedMobileNavigation) mainRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', rememberMobileFocus)
    document.addEventListener('focusout', forgetVisibleBlur)
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      document.removeEventListener('focusin', rememberMobileFocus)
      document.removeEventListener('focusout', forgetVisibleBlur)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [])

  const prevPathRef = useRef(location.pathname)
  const prevIndexRef = useRef(routeIndex(location.pathname))
  const directionRef = useRef(1)
  const hasPathChanged = prevPathRef.current !== location.pathname
  const transitionKey = pageTransitionKey(location.pathname)

  if (hasPathChanged) {
    const current = routeIndex(location.pathname)
    const prev = prevIndexRef.current
    directionRef.current = current >= prev ? 1 : -1
  }

  useEffect(() => {
    prevPathRef.current = location.pathname
    prevIndexRef.current = routeIndex(location.pathname)
  }, [location.pathname])

  return (
    <>
      <a className="shell-skip-link" href="#main-content" onClick={event => {
        event.preventDefault()
        setMobileNavOpen(false)
        mainRef.current?.focus()
      }}>跳到主要内容</a>
      <DesktopOnlyMask />
      <header className="mobile-shell-header">
        <Link className="mobile-brand" to="/" aria-label="EVEMToolkit 首页">
          <span className="brand-mark"><img src="/evem-compass-solid.png" alt="" className="mobile-brand-icon" /></span>
          <span className="mobile-brand-name">EVEM</span>
        </Link>
        <button
          ref={mobileToggleRef}
          className="mobile-menu-toggle"
          type="button"
          aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileNavOpen(value => !value)}
        >
          {mobileNavOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </header>
      <nav ref={mobileNavRef} id="mobile-navigation" className={`mobile-nav${mobileNavOpen ? ' is-open' : ''}`} aria-label="移动主导航" aria-hidden={!mobileNavOpen}>
        <div className="mobile-nav-links">
          {availableNavGroups.map(group => (
            <div className="mobile-nav-group" key={group.id} role="group" aria-labelledby={`mobile-nav-group-${group.id}`}>
              <p id={`mobile-nav-group-${group.id}`} className="mobile-nav-group-label">{group.label}</p>
              <div className="mobile-nav-group-links">
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={exactNavigationMatch(item.to)} aria-label={item.label} className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
              </div>
            </div>
          ))}
        </div>
        <DensityControl density={density} onChange={setDensity} />
        <div className="mobile-nav-actions">
          {isAuthenticated ? (
            <>
              <span className="mobile-nav-user"><User size={15} aria-hidden="true" />{displayName}</span>
              <button className="ghost-btn top-action-btn" type="button" onClick={() => navigate('/usersetting')}><Settings size={15} />设置</button>
              <button className="ghost-btn top-action-btn top-action-logout" type="button" onClick={logout}><LogOut size={15} />退出</button>
            </>
          ) : (
            <button className="primary-btn mobile-login-btn" type="button" onClick={openLogin}><LogIn size={17} />登录 / 注册</button>
          )}
        </div>
      </nav>
      <div className={`app-shell${collapsed ? ' is-sidebar-collapsed' : ''}`} data-density={density}>
        <aside className="shell-sidebar" aria-label="工具导航">
          <div className="sidebar-brand-row">
          <Link className="brand" to="/" aria-label="EVEMToolkit 首页">
            <span className="brand-mark"><img src="/evem-compass-solid.png" alt="" className="brand-icon" /></span>
            <span className="brand-name">EVEM</span>
          </Link>
          <button className="sidebar-toggle" type="button" aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开导航' : '收起导航'} aria-expanded={!collapsed} aria-controls="primary-navigation" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
          </div>
          <nav id="primary-navigation" className="nav-row" aria-label="主导航">
            {availableNavGroups.map(group => (
              <div className="nav-group" key={group.id} role="group" aria-labelledby={`nav-group-${group.id}`}>
                <p id={`nav-group-${group.id}`} className="nav-group-label">{group.label}</p>
                <div className="nav-group-links">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={exactNavigationMatch(item.to)}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="nav-icon-wrap">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              )
            })}
                </div>
              </div>
            ))}
          </nav>
          <div className="top-actions">
            <DensityControl density={density} onChange={setDensity} />
            {isAuthenticated ? (
              <>
                <div className="top-user-card" title={displayName}>
                  <span className="top-user-avatar" aria-hidden="true">
                    <User size={15} />
                  </span>
                  <span className="top-user-name">{displayName}</span>
                </div>
                <button className="ghost-btn top-action-btn top-action-settings" aria-label="设置" title={collapsed ? '设置' : undefined} onClick={() => navigate('/usersetting')}>
                  <Settings size={14} />
                  <span>设置</span>
                </button>
                <button className="ghost-btn top-action-btn top-action-logout" aria-label="退出" title={collapsed ? '退出' : undefined} onClick={logout}>
                  <LogOut size={14} />
                  <span>退出</span>
                </button>
              </>
            ) : (
              <button className="primary-btn login-btn" aria-label="登录 \ 注册" title={collapsed ? '登录 / 注册' : undefined} onClick={openLogin}>
                <LogIn size={18} /><span>登录 \ 注册</span>
              </button>
            )}
          </div>
        </aside>

        <main ref={mainRef} id="main-content" className="shell-main" tabIndex={-1}>
          <div className="page-stage">
            <motion.div
              key={transitionKey}
              initial={
                reduceMotion || !hasPathChanged
                  ? false
                  : { opacity: 0.992, x: directionRef.current > 0 ? 24 : -24 }
              }
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="page-wrapper"
            >
              <Outlet context={usageAccess} />
            </motion.div>
          </div>
        </main>
      </div>
    </>
  )
}
