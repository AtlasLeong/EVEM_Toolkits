import { Fragment, createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clearStoredAuth, hasActiveSession, notifyAuthChanged } from '../services/fetchWithAuth'
import { getUserInfo } from '../services/getJWTUserInfo'

export const AuthContext = createContext({
  isAuthenticated: false,
  userInfo: null,
  login: () => {},
  logout: () => {},
})

function tokenUserId(token) {
  try {
    const payload = token?.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!payload) return null
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    const id = claims.user_id ?? claims.userId
    return id == null ? null : String(id)
  } catch {
    return null
  }
}

function readAuthSnapshot() {
  const accessUserId = tokenUserId(localStorage.getItem('access_token'))
  const refreshUserId = tokenUserId(localStorage.getItem('refresh_token'))
  // A cross-tab replacement can arrive one token at a time. Do not expose the
  // previous user's cached data while the active token names a different user.
  const mismatchedPair = accessUserId != null && refreshUserId != null && accessUserId !== refreshUserId
  const isAuthenticated = hasActiveSession() && !mismatchedPair
  const userInfo = isAuthenticated ? getUserInfo() : null
  // A user id survives normal access/refresh rotation, including access-only
  // sessions. Unidentified legacy sessions must not share another session's
  // private cache merely because both tokens omit their user id.
  const identity = !isAuthenticated ? 'guest' : userInfo?.userId != null
    ? `user:${String(userInfo.userId)}`
    : `session:${localStorage.getItem('refresh_token') || localStorage.getItem('access_token')}`
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
