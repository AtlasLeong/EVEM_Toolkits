import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useContext, useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { AuthContext } from './context/AuthContext'
import LoginPage from './pages/Login'
import InfoCenterPage from './pages/InfoCenter'
import FraudListPage from './pages/FraudList'
import PlanetaryPage from './pages/Planetary'
import TacticalBoardPage from './pages/TacticalBoard'
import SettingPage from './pages/Setting'
import FraudAdminLoginPage from './pages/FraudAdminLogin'
import FraudAdminPage from './pages/FraudAdmin'

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
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate replace to="/fraudlist" />} />
          <Route path="/infocenter" element={<InfoCenterPage />} />
          <Route path="/fraudlist" element={<FraudListPage />} />
          <Route path="/planetary" element={<PlanetaryPage />} />
          <Route path="/bazaar" element={<Navigate replace to="/starmap" />} />
          <Route path="/starmap" element={<TacticalBoardPage />} />
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
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/fraudlogin" element={<FraudAdminLoginPage />} />
        <Route path="*" element={<Navigate replace to="/fraudlist" />} />
      </Routes>
    </>
  )
}
