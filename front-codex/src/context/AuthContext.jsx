import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { clearStoredAuth, hasActiveSession, notifyAuthChanged } from '../services/fetchWithAuth'
import { getUserInfo } from '../services/getJWTUserInfo'

export const AuthContext = createContext({
  isAuthenticated: false,
  userInfo: null,
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasActiveSession())
  const [userInfo, setUserInfo] = useState(() => getUserInfo())

  useEffect(() => {
    const syncAuth = () => {
      setIsAuthenticated(hasActiveSession())
      setUserInfo(getUserInfo())
    }
    window.addEventListener('auth:changed', syncAuth)
    window.addEventListener('storage', syncAuth)
    syncAuth()
    return () => {
      window.removeEventListener('auth:changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
    }
  }, [])

  const login = useCallback(() => {
    setIsAuthenticated(true)
    setUserInfo(getUserInfo())
    notifyAuthChanged()
  }, [])

  const logout = useCallback(() => {
    clearStoredAuth()
    setIsAuthenticated(false)
    setUserInfo(null)
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated,
      userInfo,
      login,
      logout,
    }),
    [isAuthenticated, userInfo, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
