import { motion, useReducedMotion } from 'framer-motion'
import { Shield, Globe, Compass, LogOut, Settings, User, MessageSquare, ChevronsLeft, ChevronsRight, LogIn } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const navItems = [
  { to: '/planetary', label: '行星资源', icon: Globe },
  { to: '/starmap', label: '星系导航', icon: Compass },
  { to: '/fraudlist', label: '防诈名单', icon: Shield },
  { to: '/feedback', label: '需求与反馈', icon: MessageSquare },
]

const routeOrder = ['/fraudlist', '/planetary', '/starmap', '/feedback', '/usersetting', '/fraudadmin', '/licenseadmin', '/infocenter']

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

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, userInfo, logout } = useContext(AuthContext)
  const reduceMotion = useReducedMotion()
  const displayName = userInfo?.userName?.trim() || '已登录用户'
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('evem-sidebar-collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('evem-sidebar-collapsed', String(collapsed)) } catch { /* Navigation remains usable when storage is unavailable. */ }
  }, [collapsed])

  const prevPathRef = useRef(location.pathname)
  const prevIndexRef = useRef(routeIndex(location.pathname))
  const directionRef = useRef(1)
  const hasPathChanged = prevPathRef.current !== location.pathname

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
      <DesktopOnlyMask />
      <div className={`app-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}>
        <aside className="shell-sidebar" aria-label="工具导航">
          <div className="sidebar-brand-row">
          <Link className="brand" to="/" aria-label="EVEMToolkit 首页">
            <img src="/guristas-avatar-white.png" alt="" className="brand-icon" />
            <span className="brand-name">EVEMToolkit</span>
          </Link>
          <button className="sidebar-toggle" type="button" aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开导航' : '收起导航'} aria-expanded={!collapsed} aria-controls="primary-navigation" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
          </div>
          <nav id="primary-navigation" className="nav-row" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
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
          </nav>
          <div className="top-actions">
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
              <button className="primary-btn login-btn" aria-label="登录 \ 注册" title={collapsed ? '登录 / 注册' : undefined} onClick={() => navigate('/login')}>
                <LogIn size={18} /><span>登录 \ 注册</span>
              </button>
            )}
          </div>
        </aside>

        <main className="shell-main">
          <div className="page-stage">
            <motion.div
              key={location.pathname}
              initial={
                reduceMotion || !hasPathChanged
                  ? false
                  : { opacity: 0.992, x: directionRef.current > 0 ? 24 : -24 }
              }
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="page-wrapper"
            >
              <Outlet />
            </motion.div>
          </div>
        </main>
      </div>
    </>
  )
}
