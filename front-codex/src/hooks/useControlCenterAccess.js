import { useContext, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from '../context/AuthContext'
import { announceControlDenial, getControlCenterAccess } from '../services/apiControlCenter'
import { denyControlAccess } from '../utils/controlAccessState'

export { privateControlKey } from '../utils/controlAccessState'
export default function useControlCenterAccess() {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  const identity = isAuthenticated && userInfo?.userId != null ? String(userInfo.userId) : null
  const client = useQueryClient(), key = ['control-access', identity]
  useEffect(() => {
    if (identity === null) return undefined
    const deny = event => {
      if (String(event.detail?.identity) !== identity) return
      denyControlAccess(client, identity)
    }
    window.addEventListener('control-center:denied', deny)
    return () => window.removeEventListener('control-center:denied', deny)
  }, [identity, client])
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (client.getQueryData(key)?.denied) return client.getQueryData(key)
      const data = await getControlCenterAccess({ signal })
      const previous = client.getQueryData(key)
      if (previous?.denied) return previous
      if (previous && ((previous.can_view_hotspot_changes && !data.can_view_hotspot_changes)
        || (previous.can_manage && !data.can_manage))) {
        announceControlDenial(identity)
        return { can_manage: false, can_view_hotspot_changes: false, denied: true }
      }
      return data
    },
    enabled: identity !== null,
    staleTime: 25_000, gcTime: 0, retry: false,
    refetchInterval: queryState => queryState.state.data?.denied ? false : 30_000,
    refetchIntervalInBackground: false,
  })
  // Never keep a stale allow after a failed capability refresh.
  const allowed = identity !== null && !query.isError && query.data && !query.data.denied
  return { identity, canManage: Boolean(allowed && query.data.can_manage),
    canViewChanges: Boolean(allowed && query.data.can_view_hotspot_changes), loading: identity !== null && query.isPending }
}
