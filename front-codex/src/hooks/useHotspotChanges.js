import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import useControlCenterAccess, { privateControlKey } from './useControlCenterAccess'
import { getHotspotChanges } from '../services/apiControlCenter'

export default function useHotspotChanges(visible) {
  const access = useControlCenterAccess()
  const [mode, setMode] = useState('total')
  const [interval, setInterval] = useState(null)
  const [before, setBefore] = useState(null)
  const [history, setHistory] = useState({ intervals: [], nextBefore: null })
  const enabled = access.canViewChanges && visible && mode === 'changes'
  const query = useQuery({
    queryKey: [...privateControlKey(access.identity), 'changes', interval],
    queryFn: ({ signal }) => getHotspotChanges({ interval, signal }),
    enabled, staleTime: 25_000, gcTime: 0, retry: false,
    refetchInterval: enabled ? 30_000 : false, refetchIntervalInBackground: false,
  })
  const older = useQuery({
    queryKey: [...privateControlKey(access.identity), 'history', before],
    queryFn: ({ signal }) => getHotspotChanges({ before, limit: 100, signal }),
    enabled: enabled && before !== null, staleTime: Infinity, gcTime: 0, retry: false,
  })
  useEffect(() => {
    if (!access.canViewChanges) { setMode('total'); setInterval(null); setBefore(null); setHistory({ intervals: [], nextBefore: null }); return }
    if (!query.data) return
    setHistory(previous => ({
      intervals: [...new Map([...previous.intervals, ...query.data.intervals].map(item => [item.id, item])).values()]
        .sort((a, b) => b.end_at_ms - a.end_at_ms).slice(0, 5000),
      nextBefore: previous.intervals.length ? previous.nextBefore : query.data.next_before,
    }))
  }, [access.canViewChanges, query.data])
  useEffect(() => {
    if (!access.canViewChanges || !older.data) return
    setHistory(previous => ({
      intervals: [...new Map([...previous.intervals, ...older.data.intervals].map(item => [item.id, item])).values()]
        .sort((a, b) => b.end_at_ms - a.end_at_ms).slice(0, 5000),
      nextBefore: older.data.next_before,
    }))
  }, [access.canViewChanges, older.data])
  return useMemo(() => ({
    allowed: access.canViewChanges, mode: access.canViewChanges ? mode : 'total',
    data: access.canViewChanges && !query.isError ? query.data : null,
    loading: query.isPending, error: query.isError || older.isError,
    interval, intervals: access.canViewChanges ? history.intervals : [],
    nextBefore: access.canViewChanges ? history.nextBefore : null,
    historyLoading: older.isFetching, onModeChange: setMode, onSelectInterval: setInterval,
    onLoadOlder: () => setBefore(history.nextBefore),
  }), [access.canViewChanges, mode, query.data, query.isPending, query.isError, older.isError, older.isFetching, interval, history])
}
