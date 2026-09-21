import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useContext, useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import SiteFooter from './components/layout/SiteFooter'
import { AuthContext } from './context/AuthContext'
import LoginPage from './pages/Login'
import InfoCenterPage from './pages/InfoCenter'
import FraudListPage from './pages/FraudList'
import PlanetaryPage from './pages/Planetary'
import TacticalBoardPage from './pages/TacticalBoard'
import SettingPage from './pages/Setting'
import FraudAdminLoginPage from './pages/FraudAdminLogin'
import FraudAdminPage from './pages/FraudAdmin'
import LicenseAdminPage from './pages/LicenseAdmin'
import FeedbackPage from './pages/Feedback'

const CorporationsPage = lazy(() => import('./pages/Corporations'))
const TacticalCollaborationPage = lazy(() => import('./pages/TacticalCollaboration'))
const CorporationDetailPage = lazy(() => import('./pages/Corporations').then(module => ({ default: module.CorporationDetailPage })))
const CorporationManagePage = lazy(() => import('./pages/CorporationManage'))
const CorporationReviewPage = lazy(() => import('./pages/CorporationReview'))
const corporationRoute = page => <Suspense fallback={<div className="loading-bar" aria-label="加载军团页面"><span /></div>}>{page}</Suspense>

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pathname])

  return null
}

function RequireAuth({ children }) {
  const { isAuthenticated } = useContext(AuthContext)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <div className="site-frame">
      <ScrollToTop />
      <div className="site-content">
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate replace to="/fraudlist" />} />
            <Route path="/infocenter" element={<InfoCenterPage />} />
            <Route path="/fraudlist" element={<FraudListPage />} />
            <Route path="/planetary" element={<PlanetaryPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route path="/corporations" element={corporationRoute(<CorporationsPage />)} />
            <Route path="/corporations/manage" element={corporationRoute(<CorporationManagePage />)} />
            <Route path="/corporations/review" element={corporationRoute(<CorporationReviewPage />)} />
            <Route path="/corporations/:id" element={corporationRoute(<CorporationDetailPage />)} />
            <Route path="/bazaar" element={<Navigate replace to="/starmap" />} />
            <Route path="/starmap" element={<TacticalBoardPage />} />
            <Route path="/tactical" element={<Suspense fallback={<div className="loading-bar" aria-label="加载战术板"><span /></div>}><TacticalCollaborationPage /></Suspense>} />
            <Route
              path="/usersetting"
              element={
                <RequireAuth>
                  <SettingPage />
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
                  <FraudAdminPage />
                </RequireAuth>
              }
            />
            <Route
              path="/licenseadmin"
              element={
                <RequireAuth>
                  <LicenseAdminPage />
                </RequireAuth>
              }
            />
          </Route>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/fraudlogin" element={<FraudAdminLoginPage />} />
          <Route path="*" element={<Navigate replace to="/fraudlist" />} />
        </Routes>
      </div>
      <SiteFooter />
    </div>
  )
}
