import { useContext, useEffect, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import { getKillboardAccess } from '../services/apiKillboard'

// Navigation is only a convenience; Killboard API permissions remain server-side.
export default function useKillboardAccess() {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  const identity = isAuthenticated ? userInfo?.userId : null
  const [access, setAccess] = useState(null)

  useEffect(() => {
    if (identity == null) {
      setAccess(null)
      return undefined
    }
    const controller = new AbortController()
    let current = true
    getKillboardAccess({ signal: controller.signal }).then(
      result => {
        if (current) setAccess({ identity, allowed: result.can_view_killboard === true })
      },
      () => {
        if (current) setAccess({ identity, allowed: false })
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [identity])

  const matches = identity != null && access?.identity === identity
  return {
    identity,
    loading: matches ? false : identity != null,
    allowed: matches && access.allowed === true,
  }
}
