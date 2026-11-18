import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ROLE_LABELS } from '../../../shared/catalog'
import type { ApiError } from '../api'
import { homeFor, useAuth } from '../auth'
import { ErrorNotice } from '../components/Feedback'
import { Field } from '../components/Field'
import { StoneSwatch } from '../components/StoneSwatch'
import { useDocumentTitle } from '../hooks'

const LOGIN_TEXTURE = { w: 640, h: 760 }

export function LoginPage() {
  useDocumentTitle('Sign in')
  const { user, status, login, meta } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  if (status === 'signed-in' && user) return <Navigate to={from ?? homeFor(user.role)} replace />

  async function signIn(name: string, pass: string) {
    setBusy(true)
    setError(null)
    try {
      const signedIn = await login(name, pass)
      navigate(from ?? homeFor(signedIn.role), { replace: true })
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void signIn(username, password)
  }

  return (
    <div className="login">
      <div className="login-stone">
        <StoneSwatch hex="#ebe8e2" type="marble" seed="MAR-SNG-login" className="login-stone-texture" size={LOGIN_TEXTURE} />
        <div className="login-brand">
          <p className="login-name">StoneTrack</p>
          <p className="login-tagline">Job tracking for a stone benchtop factory: intake, the shop floor, slabs, capacity and delivery.</p>
        </div>
      </div>
      <main className="login-panel">
        <h1>Sign in</h1>
        <form onSubmit={submit} className="login-form" noValidate>
          <Field label="Username">
            <input type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <ErrorNotice error={error} />}
          <button type="submit" className="button button-primary button-wide" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        {meta?.demoMode && meta.demoAccounts.length > 0 && (
          <section className="demo-accounts" aria-labelledby="demo-heading">
            <h2 id="demo-heading">Try a demo account</h2>
            <p>Each role sees a different part of the app. Every business, person and number here is invented.</p>
            <div className="demo-list">
              {meta.demoAccounts.map((account) => (
                <button key={account.username} type="button" className="demo-account" disabled={busy} onClick={() => void signIn(account.username, account.password)}>
                  <span className="demo-role">{ROLE_LABELS[account.role]}</span>
                  <span className="demo-cred">
                    {account.username} / {account.password}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
