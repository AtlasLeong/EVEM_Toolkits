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
    const deny = () => {
      current = false
      controller.abort()
      setAccess({ identity, allowed: false })
    }
    window.addEventListener('tactical-usage:denied', deny)
    getTacticalUsageAccess({ signal: controller.signal }).then(
      result => { if (current) setAccess({ identity, allowed: result.can_view_usage === true }) },
      () => { if (current) setAccess({ identity, allowed: false }) },
    )
    return () => {
      current = false
      controller.abort()
      window.removeEventListener('tactical-usage:denied', deny)
    }
  }, [identity])

  // Do not wait for an effect to hide the old account's navigation.
  return identity != null && access?.identity === identity && access.allowed === true
}
