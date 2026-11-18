// Input validation rules, written once with zod and used in two places:
// the API validates every request body with them, and the React forms reuse
// them to show errors before anything is sent.
import { z } from 'zod'
import {
  EDGE_PROFILES,
  EDGE_SIDES,
  PRIORITIES,
  REMAKE_REASONS,
  ROLES,
  SLAB_STATUSES,
} from './catalog'
import { isIsoDate } from './dates'
import { STAGES } from './stages'

// Forms send '' for an empty optional field. Treat that as "not provided".
const emptyToUndefined = (v: unknown) => {
  if (typeof v !== 'string') return v
  const trimmed = v.trim()
  return trimmed === '' ? undefined : trimmed
}
// For updates: '' means "clear this field" (null), a missing field means "leave it alone".
const emptyToNull = (v: unknown) => {
  if (typeof v !== 'string') return v
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().max(max).optional())
const clearableText = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable().optional())
const optionalEmail = z.preprocess(emptyToUndefined, z.email('Enter a valid email address').max(200).optional())

export const isoDate = z.string().refine(isIsoDate, 'Use a real date in YYYY-MM-DD format')
export const idParam = z.coerce.number().int().positive()

export const pieceInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the piece a name').max(60),
  lengthMm: z.coerce.number().int().min(100, 'At least 100 mm').max(4000, 'At most 4000 mm'),
  widthMm: z.coerce.number().int().min(50, 'At least 50 mm').max(2000, 'At most 2000 mm'),
  quantity: z.coerce.number().int().min(1).max(20),
  edgeProfile: z.enum(EDGE_PROFILES),
  polishedEdges: z
    .array(z.enum(EDGE_SIDES))
    .max(4)
    .refine((sides) => new Set(sides).size === sides.length, 'Each edge can only be listed once')
    .default([]),
  cutouts: z.coerce.number().int().min(0).max(6).default(0),
})
export type PieceInput = z.infer<typeof pieceInputSchema>

/** Job intake (the "New job" form and POST /api/jobs). */
export const jobInputSchema = z.object({
  clientName: z.string().trim().min(2, 'Enter the client name').max(120),
  clientEmail: optionalEmail,
  clientPhone: optionalText(40),
  siteAddress: optionalText(200),
  drawingRef: z.string().trim().min(1, 'Enter the drawing reference').max(60),
  materialId: z.coerce.number().int().positive('Choose a stone'),
  dueDate: isoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  notes: optionalText(1000),
  pieces: z.array(pieceInputSchema).min(1, 'Add at least one piece').max(30),
})
export type JobInput = z.infer<typeof jobInputSchema>

/** A new order sent by another system to POST /api/webhooks/orders. */
export const webhookOrderSchema = z.object({
  externalRef: z.string().trim().min(1).max(80),
  client: z.object({
    name: z.string().trim().min(2).max(120),
    email: optionalEmail,
    phone: optionalText(40),
  }),
  siteAddress: optionalText(200),
  drawingRef: z.string().trim().min(1).max(60),
  materialCode: z.string().trim().min(1).max(20),
  dueDate: isoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  notes: optionalText(1000),
  pieces: z.array(pieceInputSchema).min(1).max(30),
})
export type WebhookOrder = z.infer<typeof webhookOrderSchema>

export const jobUpdateSchema = z
  .object({
    dueDate: isoDate.optional(),
    priority: z.enum(PRIORITIES).optional(),
    notes: clearableText(1000),
    siteAddress: clearableText(200),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')
export type JobUpdate = z.infer<typeof jobUpdateSchema>

/**
 * Complete the current stage. `expectedStage` is the stage the caller thinks the job is in:
 * if two kiosks tap at once, the second one gets a clear "already moved" error instead of
 * skipping a stage.
 */
export const advanceStageSchema = z.object({
  expectedStage: z.enum(STAGES),
  operatorId: z.coerce.number().int().positive().optional(),
  labourHours: z.coerce.number().min(0).max(80).optional(),
  note: optionalText(500),
})
export type AdvanceStageInput = z.infer<typeof advanceStageSchema>

export const remakeSchema = z.object({
  expectedStage: z.enum(STAGES),
  reason: z.enum(REMAKE_REASONS),
  pieceId: z.coerce.number().int().positive().optional(),
  operatorId: z.coerce.number().int().positive().optional(),
  note: optionalText(500),
})
export type RemakeInput = z.infer<typeof remakeSchema>

export const receiveSlabsSchema = z.object({
  materialId: z.coerce.number().int().positive('Choose a stone'),
  quantity: z.coerce.number().int().min(1).max(20),
  rackLocation: optionalText(12),
})

export const allocateSlabsSchema = z.object({
  // Leave out to let StoneTrack pick slabs automatically (oldest stock first).
  slabIds: z.array(z.coerce.number().int().positive()).min(1).max(10).optional(),
})

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username').max(60),
  password: z.string().min(1, 'Enter your password').max(200),
})

export const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, '3–30 characters: letters, numbers, dot, dash or underscore'),
  displayName: z.string().trim().min(1).max(60),
  role: z.enum(ROLES),
  password: z.string().min(8, 'At least 8 characters').max(200),
})

export const userUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    password: z.string().min(8, 'At least 8 characters').max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')

export const machineUpdateSchema = z.object({
  hoursPerDay: z.coerce.number().min(0).max(24),
})

export const jobListQuerySchema = z.object({
  status: z.enum(['active', 'dispatched', 'all']).default('active'),
  stage: z.enum(STAGES).optional(),
  q: optionalText(60),
  due: z.enum(['overdue', 'this_week']).optional(),
})

export const slabListQuerySchema = z.object({
  status: z.enum(SLAB_STATUSES).optional(),
  materialId: z.coerce.number().int().positive().optional(),
})

export const kpiQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

export const capacityQuerySchema = z.object({
  days: z.coerce.number().int().min(5).max(30).default(10),
})
