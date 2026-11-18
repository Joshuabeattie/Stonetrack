// Loading, error and empty states. Errors say what happened and what to do next.
import type { ReactNode } from 'react'
import type { ApiError } from '../api'
import { Icon } from './Icon'

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-bar" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </div>
  )
}

export function ErrorNotice({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const requestId = (error as ApiError).requestId
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" />
      <div>
        <p>{error.message}</p>
        {requestId && <p className="notice-meta">Request id {requestId}</p>}
      </div>
      {onRetry && (
        <button type="button" className="button button-quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}
