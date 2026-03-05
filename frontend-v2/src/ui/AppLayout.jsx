import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import {
  Shield, Globe, ShoppingBag, Map, Settings, LogIn, LogOut, Zap
} from 'lucide-react'

const NAV_ITEMS = [
  { to: 'fraudlist',   label: '诈骗名单', icon: Shield },
  { to: 'planetary',   label: '行星资源', icon: Globe },
  { to: 'bazaar',      label: '泛星集市', icon: ShoppingBag },
  { to: 'starmap',     label: '战术地图', icon: Map },
]

function NavBar() {
  const { isAuthenticated, logout } = useContext(AuthContext)
  const navigate = useNavigate()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14">
      {/* 背景层：毛玻璃 */}
      <div className="absolute inset-0 bg-[#080808]/80 backdrop-blur-2xl border-b border-white/[0.06]" />

      <div className="relative h-full max-w-[1400px] mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center shadow-lg">
            <Zap size={14} className="text-black" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-gradient-gold">
            EVEM Toolkits
          </span>
        </NavLink>

        {/* Nav Items */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'text-gold-400'
                    : 'text-white/50 hover:text-white/85 hover:bg-white/[0.05]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-lg glass-gold"
                      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                    />
                  )}
                  <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} className="relative z-10" />
                  <span className="relative z-10">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <>
              <NavLink
                to="usersetting"
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-all duration-200 ${
                    isActive ? 'text-gold-400 glass-gold' : 'text-white/50 hover:text-white/85 hover:bg-white/[0.05]'
                  }`
                }
              >
                <Settings size={14} strokeWidth={1.8} />
                <span className="font-medium">设置</span>
              </NavLink>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all duration-200"
              >
                <LogOut size={14} strokeWidth={1.8} />
                <span>退出</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="btn-gold px-4 py-1.5 rounded-lg text-[13px] flex items-center gap-1.5"
            >
              <LogIn size={13} strokeWidth={2.2} />
              登录
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

// 页面切换动画
const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
}

function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      {/* 顶栏占位 */}
      <div className="h-14 flex-shrink-0" />
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

export default AppLayout
