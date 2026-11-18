import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ROLES, ROLE_LABELS, type Role } from '../../../shared/catalog'
import type { UserRecord } from '../../../shared/types'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { ErrorNotice, Loading } from '../components/Feedback'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

export function UsersPage() {
  useDocumentTitle('Users')
  const toast = useToast()
  const navigate = useNavigate()
  const { user: me, meta, forget } = useAuth()
  const users = useApi<UserRecord[]>('/users')
  const [adding, setAdding] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function setActive(user: UserRecord, active: boolean) {
    setError(null)
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { active } })
      toast(active ? `${user.displayName} can sign in again` : `${user.displayName} deactivated and signed out`)
      users.reload()
    } catch (err) {
      setError(err as ApiError)
    }
  }

  async function resetDemo() {
    setError(null)
    try {
      await api('/admin/reset-demo', { method: 'POST' })
      forget() // resetting signs everyone out
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err as ApiError)
      setConfirmReset(false)
    }
  }

  return (
    <>
      <PageHeader title="Users" sub="Admins manage everything, factory managers run jobs and stock, kiosks only move jobs along.">
        <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Add user
        </button>
      </PageHeader>
      {error && <ErrorNotice error={error} />}
      {users.error && <ErrorNotice error={users.error} onRetry={users.reload} />}
      {!users.data && users.loading && <Loading />}
      {users.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Username</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">{u.displayName}</td>
                  <td data-label="Username" className="code">
                    {u.username}
                  </td>
                  <td data-label="Role">{ROLE_LABELS[u.role]}</td>
                  <td data-label="Status">{u.active ? 'Active' : 'Deactivated'}</td>
                  <td data-label="Added">{formatDateTime(u.createdAt)}</td>
                  <td>
                    {u.id !== me?.id && (
                      <button type="button" className="link-button" onClick={() => void setActive(u, !u.active)}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta?.demoMode && (
        <section className="section danger-zone" aria-labelledby="reset-heading">
          <h2 id="reset-heading" className="section-title">
            Demo data
          </h2>
          <p>Put every job, slab and user back to the original demo data. Everyone is signed out, including you.</p>
          <button type="button" className="button button-danger" onClick={() => setConfirmReset(true)}>
            Reset demo data
          </button>
        </section>
      )}

      <Modal open={adding} title="Add user" onClose={() => setAdding(false)}>
        <AddUserForm
          onDone={(u) => {
            setAdding(false)
            toast(`${u.displayName} added as ${ROLE_LABELS[u.role].toLowerCase()}`)
            users.reload()
          }}
        />
      </Modal>
      <Modal open={confirmReset} title="Reset the demo data?" onClose={() => setConfirmReset(false)}>
        <p>This replaces all data with the demo set and signs everyone out. It can't be undone.</p>
        <div className="form-actions">
          <button type="button" className="button button-danger" onClick={() => void resetDemo()}>
            Reset demo data
          </button>
          <button type="button" className="button button-quiet" onClick={() => setConfirmReset(false)}>
            Keep current data
          </button>
        </div>
      </Modal>
    </>
  )
}

function AddUserForm({ onDone }: { onDone: (user: UserRecord) => void }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('manager')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await api<UserRecord>('/users', { method: 'POST', body: { username, displayName, role, password } }))
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  const fieldErrors = error?.fieldErrors?.() ?? {}
  return (
    <form onSubmit={submit} className="form-grid">
      <Field label="Name" error={fieldErrors.displayName}>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Username" error={fieldErrors.username} hint="Letters, numbers, dot, dash or underscore">
        <input value={username} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="Role" error={fieldErrors.role}>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Password" error={fieldErrors.password} hint="At least 8 characters">
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && !Object.keys(fieldErrors).length && <ErrorNotice error={error} />}
      <div className="form-actions span-2">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Adding' : 'Add user'}
        </button>
      </div>
    </form>
  )
}
