// Who is signed in, shared with every component through React context.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { Role } from '../../shared/catalog'
import type { AuthUser, LoginResponse, Meta } from '../../shared/types'
import { api, getToken, onUnauthorized, setToken } from './api'
import { setTimeZone } from './format'

interface AuthContextValue {
  user: AuthUser | null
  status: 'loading' | 'signed-in' | 'signed-out'
  meta: Meta | null
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  /** Forget the session locally (used after "reset demo data", which signs everyone out). */
  forget: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')
  const [meta, setMeta] = useState<Meta | null>(null)

  const forget = useCallback(() => {
    setToken(null)
    setUser(null)
    setStatus('signed-out')
  }, [])

  useEffect(() => {
    onUnauthorized(forget) // any 401 from the API (expired session) signs out
    api<Meta>('/meta')
      .then((m) => {
        setMeta(m)
        setTimeZone(m.timezone)
      })
      .catch(() => undefined)

    if (!getToken()) {
      setStatus('signed-out')
      return
    }
    api<{ user: AuthUser }>('/auth/me')
      .then(({ user }) => {
        setUser(user)
        setStatus('signed-in')
      })
      .catch(() => forget())
  }, [forget])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } })
    setToken(res.token)
    setUser(res.user)
    setStatus('signed-in')
    return res.user
  }, [])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    forget()
  }, [forget])

  const value = useMemo(() => ({ user, status, meta, login, logout, forget }), [user, status, meta, login, logout, forget])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Where each role lands after signing in. */
export function homeFor(role: Role): string {
  return role === 'kiosk' ? '/kiosk' : '/dashboard'
}

/** Route guard: sends signed-out users to /login and wrong roles to their own home page. */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <div className="page-loading" aria-busy="true" />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}
