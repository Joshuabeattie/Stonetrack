// Errors that carry an HTTP status. Services throw these; the error handler in
// middleware.ts turns them into JSON like:
//   { "error": { "code": "CONFLICT", "message": "…", "requestId": "…" } }

export interface FieldIssue {
  path: string // e.g. "pieces.0.lengthMm"
  message: string
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldIssue[],
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string) => new HttpError(400, 'BAD_REQUEST', message)
export const unauthenticated = (message = 'Please sign in to continue') => new HttpError(401, 'UNAUTHENTICATED', message)
export const forbidden = (message = "Your role doesn't have access to this") => new HttpError(403, 'FORBIDDEN', message)
export const notFound = (what = 'Record') => new HttpError(404, 'NOT_FOUND', `${what} not found`)
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message)
export const validationError = (details: FieldIssue[], message = 'Some fields need attention') =>
  new HttpError(422, 'VALIDATION_ERROR', message, details)
