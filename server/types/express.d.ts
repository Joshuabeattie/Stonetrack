// Adds our own fields to Express's Request type.
import type { AuthUser } from '../../shared/types'

declare global {
  namespace Express {
    interface Request {
      /** Unique per request; sent back in the X-Request-Id header and in error responses. */
      requestId: string
      /** Set by the authenticate middleware when a valid session token was sent. */
      user?: AuthUser
      sessionToken?: string
    }
  }
}

export {}
