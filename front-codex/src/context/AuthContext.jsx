import { Fragment, createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clearStoredAuth, notifyAuthChanged } from '../services/fetchWithAuth'
import { readValidatedSession } from '../services/validatedSession'

export const AuthContext = createContext({
  isAuthenticated: false,
  userInfo: null,
  login: () => {},
  logout: () => {},
})

function readAuthSnapshot() {
  const { isAuthenticated, userInfo, identity } = readValidatedSession()
  return { isAuthenticated, userInfo, identity }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [auth, setAuth] = useState(readAuthSnapshot)
  const identityRef = useRef(auth.identity)
  const { isAuthenticated, userInfo } = auth

  const syncAuth = useCallback(() => {
    const next = readAuthSnapshot()
    if (identityRef.current !== next.identity) {
      identityRef.current = next.identity
      queryClient.cancelQueries()
      queryClient.clear()
    }
    setAuth(next)
  }, [queryClient])

  useEffect(() => {
    window.addEventListener('auth:changed', syncAuth)
    window.addEventListener('storage', syncAuth)
    syncAuth()
    return () => {
      window.removeEventListener('auth:changed', syncAuth)
      window.removeEventListener('storage', syncAuth)
    }
  }, [syncAuth])

  const login = useCallback(() => {
    notifyAuthChanged()
    syncAuth()
  }, [syncAuth])

  const logout = useCallback(() => {
    clearStoredAuth()
    syncAuth()
  }, [syncAuth])

  const value = useMemo(
    () => ({
      isAuthenticated,
      userInfo,
      login,
      logout,
    }),
    [isAuthenticated, userInfo, login, logout],
  )

  return <AuthContext.Provider value={value}><Fragment key={auth.identity}>{children}</Fragment></AuthContext.Provider>
}
