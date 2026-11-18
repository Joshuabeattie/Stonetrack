// The production stages every job moves through, in order.
// "dispatched" is the finished state: the job has left the factory.

export const STAGES = ['slab_allocation', 'cutting', 'finishing', 'quality_check', 'dispatch', 'dispatched'] as const
export type Stage = (typeof STAGES)[number]

// The five stages where work happens (everything except the finished state).
export const WORK_STAGES = ['slab_allocation', 'cutting', 'finishing', 'quality_check', 'dispatch'] as const
export type WorkStage = (typeof WORK_STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  slab_allocation: 'Slab allocation',
  cutting: 'Cutting',
  finishing: 'Finishing',
  quality_check: 'Quality check',
  dispatch: 'Dispatch',
  dispatched: 'Dispatched',
}

// A remake (a piece has to be cut again) sends the job back to this stage.
export const REMAKE_RETURN_STAGE: Stage = 'cutting'

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage)
}

/** The stage after `stage`, or null when the job is already dispatched. */
export function nextStage(stage: Stage): Stage | null {
  const i = stageIndex(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

/** Remakes only make sense once stone has been cut, and before it has left the factory. */
export function canFlagRemake(stage: Stage): boolean {
  return stage === 'cutting' || stage === 'finishing' || stage === 'quality_check' || stage === 'dispatch'
}

/** What the button that completes each stage says (the kiosk shows the next stage underneath). */
export const ADVANCE_ACTIONS: Record<WorkStage, string> = {
  slab_allocation: 'Slabs ready',
  cutting: 'Cutting done',
  finishing: 'Finishing done',
  quality_check: 'QC passed',
  dispatch: 'Mark dispatched',
}

/** Plain-language description of each stage, for the client tracking page. */
export const STAGE_DESCRIPTIONS: Record<Stage, string> = {
  slab_allocation: 'Your stone slabs are being picked from the yard.',
  cutting: 'Your pieces are being cut to size on the saw.',
  finishing: 'Edges are being profiled and polished, and cutouts made.',
  quality_check: 'Every piece is checked against your drawing.',
  dispatch: 'Your benchtops are wrapped and waiting for the truck.',
  dispatched: 'Your benchtops have left the factory.',
}
