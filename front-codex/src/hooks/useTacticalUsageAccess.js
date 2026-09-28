import { useContext, useEffect, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import { getTacticalUsageAccess } from '../services/apiTacticalUsage'

// Navigation is a convenience only; the overview API authorizes every request.
export default function useTacticalUsageAccess() {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  const identity = isAuthenticated ? userInfo?.userId : null
  const [access, setAccess] = useState(null)

  useEffect(() => {
    if (identity == null) { setAccess(null); return undefined }
    const controller = new AbortController()
    let current = true
    const deny = event => {
      if (event.detail?.identity !== identity) return
      current = false
      controller.abort()
      setAccess({ identity, allowed: false, denied: true })
    }
    window.addEventListener('tactical-usage:denied', deny)
    getTacticalUsageAccess({ signal: controller.signal }).then(
      result => {
        if (!current) return
        if (result.can_view_usage === false) {
          window.dispatchEvent(new CustomEvent('tactical-usage:denied', { detail: { identity } }))
        } else setAccess({ identity, allowed: result.can_view_usage === true })
      },
      () => { if (current) setAccess({ identity, allowed: false }) },
    )
    return () => {
      current = false
      controller.abort()
      window.removeEventListener('tactical-usage:denied', deny)
    }
  }, [identity])

  // Do not wait for an effect to hide the old account's navigation.
  const matches = identity != null && access?.identity === identity
  return { identity, allowed: matches && access.allowed === true, denied: matches && access.denied === true }
}
