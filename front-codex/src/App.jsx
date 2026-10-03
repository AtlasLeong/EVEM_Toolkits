import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useContext, useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import SiteFooter from './components/layout/SiteFooter'
import { AuthContext } from './context/AuthContext'
import { isViewerAllowed, VIEWER_ACCESS_ENABLED } from './utils/viewerAccess'
import { resolveSiteTitle } from './utils/siteMetadata'
import { loginReturnPath } from './utils/loginDestination'
import useKillboardAccess from './hooks/useKillboardAccess'
const LoginPage = lazy(() => import('./pages/Login'))
const InfoCenterPage = lazy(() => import('./pages/InfoCenter'))
const FraudListPage = lazy(() => import('./pages/FraudList'))
const PlanetaryPage = lazy(() => import('./pages/Planetary'))
const TacticalBoardPage = lazy(() => import('./pages/TacticalBoard'))
const SettingPage = lazy(() => import('./pages/Setting'))
const FraudAdminLoginPage = lazy(() => import('./pages/FraudAdminLogin'))
const FraudAdminPage = lazy(() => import('./pages/FraudAdmin'))
const LicenseAdminPage = lazy(() => import('./pages/LicenseAdmin'))
const FeedbackPage = lazy(() => import('./pages/Feedback'))
const CorporationsModule = lazy(() => import('./pages/Corporations'))
const CorporationDetailPage = lazy(() => import('./pages/Corporations').then(module => ({ default: module.CorporationDetailPage })))
const TacticalCollaborationPage = lazy(() => import('./pages/TacticalCollaboration'))
const CorporationManagePage = lazy(() => import('./pages/CorporationManage'))
const CorporationReviewPage = lazy(() => import('./pages/CorporationReview'))
const StarseaPage = lazy(() => import('./pages/Starsea'))
const StarseaDetailPage = lazy(() => import('./pages/StarseaDetail'))
const StarseaMinePage = lazy(() => import('./pages/StarseaMine'))
const StarseaEditorPage = lazy(() => import('./pages/StarseaEditor'))
const StarseaReviewPage = lazy(() => import('./pages/StarseaReview'))
const MarketPricesPage = lazy(() => import('./pages/MarketPrices'))
const ManufacturingEstimatorPage = lazy(() => import('./pages/ManufacturingEstimator'))
const MarketAdminPage = lazy(() => import('./pages/MarketAdmin'))
const TacticalUsagePage = lazy(() => import('./pages/TacticalUsage'))
const IconVerificationPage = import.meta.env.DEV ? lazy(() => import('./pages/IconVerification')) : null
const KillboardPage = lazy(() => import('./pages/Killboard'))
const KillboardCollectorAdminPage = lazy(() => import('./pages/KillboardCollectorAdmin'))
const pageFallback = label => <div className="loading-bar" aria-label={label}><span /></div>
const starseaRoute = page => <Suspense fallback={pageFallback('加载星海见闻')}>{page}</Suspense>
const corporationRoute = page => <Suspense fallback={pageFallback('加载军团页面')}>{page}</Suspense>
const appRoute = page => <Suspense fallback={pageFallback('加载页面')}>{page}</Suspense>

function SiteMetadata() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = resolveSiteTitle(pathname)
  }, [pathname])

  return null
}

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return null
}

function RequireAuth({ children }) {
  const { isAuthenticated } = useContext(AuthContext)
  const location = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: loginReturnPath(location), reason: 'authentication' }} />
  return children
}

function RequireViewerAccess({ children }) {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  const location = useLocation()

  if (!VIEWER_ACCESS_ENABLED) return children
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: loginReturnPath(location), reason: 'viewer-access' }} />
  if (!isViewerAllowed(userInfo?.email)) {
    return <Navigate to="/access-denied" replace />
  }
  return children
}

function AccessDeniedPage() {
  const { logout } = useContext(AuthContext)
  const navigate = useNavigate()
  return (
    <main className="access-denied-page" role="alert">
      <p className="eyebrow">EVEM 工具箱</p>
      <h1>暂未开放查看权限</h1>
      <p>当前账号不在查看白名单中，请切换到已获授权的账号。</p>
      <button type="button" onClick={() => { logout(); navigate('/login', { replace: true }) }}>切换账号</button>
    </main>
  )
}

function RequireKillboardAccess({ children }) {
  const { isAuthenticated } = useContext(AuthContext)
  const location = useLocation()
  const access = useKillboardAccess()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: loginReturnPath(location), reason: 'authentication' }} />
  if (access.loading) return pageFallback('验证击毁情报权限')
  if (!access.allowed) return <Navigate to="/market" replace />
  return children
}

export default function App() {
  return (
    <div className="site-frame">
      <SiteMetadata />
      <ScrollToTop />
      <div className="site-content">
        <Routes>
          <Route element={<RequireViewerAccess><AppShell /></RequireViewerAccess>}>
            <Route index element={<Navigate replace to="/market" />} />
            <Route path="/infocenter" element={appRoute(<InfoCenterPage />)} />
            <Route path="/fraudlist" element={appRoute(<FraudListPage />)} />
            <Route path="/planetary" element={appRoute(<PlanetaryPage />)} />
            <Route path="/market" element={appRoute(<MarketPricesPage />)} />
            <Route path="/manufacturing" element={appRoute(<ManufacturingEstimatorPage />)} />
            <Route path="/market/admin" element={<RequireAuth>{appRoute(<MarketAdminPage />)}</RequireAuth>} />
            <Route path="/killboard/admin" element={<RequireKillboardAccess>{appRoute(<KillboardCollectorAdminPage />)}</RequireKillboardAccess>} />
            <Route path="/killboard/:killId?" element={<RequireKillboardAccess>{appRoute(<KillboardPage />)}</RequireKillboardAccess>} />
            <Route path="/feedback" element={appRoute(<FeedbackPage />)} />
            <Route path="/corporations" element={corporationRoute(<CorporationsModule />)} />
            <Route path="/corporations/manage" element={corporationRoute(<CorporationManagePage />)} />
            <Route path="/corporations/review" element={corporationRoute(<CorporationReviewPage />)} />
            <Route path="/corporations/:id" element={corporationRoute(<CorporationDetailPage />)} />
            <Route path="/starsea" element={starseaRoute(<StarseaPage />)} />
            <Route path="/starsea/mine" element={starseaRoute(<StarseaMinePage />)} />
            <Route path="/starsea/new" element={starseaRoute(<StarseaEditorPage />)} />
            <Route path="/starsea/review" element={starseaRoute(<StarseaReviewPage />)} />
            <Route path="/starsea/review/:revisionId" element={starseaRoute(<StarseaReviewPage />)} />
            <Route path="/starsea/:id/edit" element={starseaRoute(<StarseaEditorPage />)} />
            <Route path="/starsea/:id" element={starseaRoute(<StarseaDetailPage />)} />
            <Route path="/bazaar" element={<Navigate replace to="/starmap" />} />
            <Route path="/starmap" element={<TacticalBoardPage />} />
            <Route path="/tactical" element={appRoute(<TacticalCollaborationPage />)} />
            <Route path="/tactical/usage" element={<RequireAuth>{appRoute(<TacticalUsagePage />)}</RequireAuth>} />
            <Route
              path="/usersetting"
              element={
                <RequireAuth>
                  {appRoute(<SettingPage />)}
                </RequireAuth>
              }
            />
            <Route path="/mobileuser" element={<Navigate replace to="/fraudlist" />} />
            <Route path="/mobilelogin" element={<Navigate replace to="/login" />} />
            <Route path="/mobileCalculators" element={<Navigate replace to="/starmap" />} />
            <Route
              path="/fraudadmin"
              element={
                <RequireAuth>
                  {appRoute(<FraudAdminPage />)}
                </RequireAuth>
              }
            />
            <Route
              path="/licenseadmin"
              element={
                <RequireAuth>
                  {appRoute(<LicenseAdminPage />)}
                </RequireAuth>
              }
            />
          </Route>
          {import.meta.env.DEV && IconVerificationPage && <Route path="/dev/icon-verification" element={appRoute(<IconVerificationPage />)} />}
          <Route path="/access-denied" element={<AccessDeniedPage />} />
          <Route path="/login" element={appRoute(<LoginPage />)} />
          <Route path="/fraudlogin" element={appRoute(<FraudAdminLoginPage />)} />
          <Route path="*" element={<Navigate replace to="/market" />} />
        </Routes>
      </div>
      <SiteFooter />
    </div>
  )
}
