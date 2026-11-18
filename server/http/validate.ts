import type { z } from 'zod'
import { validationError } from './errors'

/**
 * Checks `data` against a zod schema. Returns the cleaned-up value (trimmed strings,
 * numbers converted, defaults filled in) or throws a 422 listing every problem.
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw validationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    )
  }
  return result.data
}
