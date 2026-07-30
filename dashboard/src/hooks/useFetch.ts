import { useState, useEffect, useCallback, useRef } from 'react'

interface State<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useFetch<T>(
  fetcher: () => Promise<T>,
  intervalMs = 30_000,
): State<T> & { refetch: () => void; lastUpdated: Date | null } {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null })
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(() => {
    fetcherRef.current()
      .then((data) => {
        setState({ data, loading: false, error: null })
        setLastUpdated(new Date())
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setState((s) => ({ ...s, loading: false, error: msg }))
      })
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { ...state, refetch: load, lastUpdated }
}
