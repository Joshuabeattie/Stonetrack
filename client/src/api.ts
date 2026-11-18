// One function for every call to the API. It adds the sign-in token, turns JSON
// error responses into ApiError objects, and signs the user out on a 401.
import type { ApiErrorBody } from '../../shared/types'

const TOKEN_KEY = 'stonetrack.token'

// localStorage can throw (private browsing, some embedded views), so every access is guarded.
// If it isn't available the user stays signed in until the page reloads.
let memoryToken: string | null = null

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string | null) {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable: keep the in-memory copy
  }
}

export interface FieldIssue {
  path: string
  message: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: FieldIssue[] = [],
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field errors keyed by path, e.g. { "pieces.0.lengthMm": "At most 4000 mm" }. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const d of this.details) out[d.path] ??= d.message
    return out
  }
}

let handleUnauthorized: () => void = () => {}
export function onUnauthorized(handler: () => void) {
  handleUnauthorized = handler
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach StoneTrack. Check your connection, then try again.")
  }

  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const body = data as ApiErrorBody | null
    if (res.status === 401 && token) handleUnauthorized()
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `The server answered ${res.status}. Try again.`,
      body?.error?.details ?? [],
      body?.error?.requestId,
    )
  }
  return data as T
}
