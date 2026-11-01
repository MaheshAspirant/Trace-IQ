import { useCallback, useEffect, useRef, useState } from 'react'
import { get } from './api'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useApi<T = any>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(path))
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const requestId = useRef(0)

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (!path) {
      setData(null)
      setLoading(false)
      return
    }
    const id = ++requestId.current
    let alive = true
    setLoading(true)
    setError(null)
    get<T>(path)
      .then((payload) => {
        if (alive && id === requestId.current) setData(payload)
      })
      .catch((err: Error) => {
        if (alive && id === requestId.current) setError(err.message)
      })
      .finally(() => {
        if (alive && id === requestId.current) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [path, nonce])

  return { data, loading, error, reload }
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
