import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'

interface ApiState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
}

/**
 * Loads `path` from the API and re-loads when it changes or when you call reload().
 * While re-loading, the previous data stays on screen (pages dim it slightly) so the
 * layout doesn't jump. Pass null to skip loading.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: path !== null })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        const error = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', err.message)
        setState((s) => ({ data: s.data, error, loading: false }))
      })
    return () => controller.abort()
  }, [path, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { ...state, reload }
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | StoneTrack` : 'StoneTrack'
  }, [title])
}

/** Re-runs `callback` every `ms` while the tab is visible (used by the kiosk to stay in sync). */
export function useInterval(callback: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') callback()
    }, ms)
    return () => window.clearInterval(id)
  }, [callback, ms])
}
