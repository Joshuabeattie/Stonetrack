// Fixed lists used across the app (database CHECK constraints, validation and the UI).
// Keep these in sync with server/db/migrations/001_initial_schema.sql.

export const ROLES = ['admin', 'manager', 'kiosk'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Factory manager',
  kiosk: 'Factory kiosk',
}

// No engineered stone: it has been banned in Australia since 1 July 2024.
// Natural stone, porcelain and resin-free sintered stone are still permitted.
export const MATERIAL_TYPES = ['granite', 'marble', 'quartzite', 'porcelain', 'sintered', 'limestone'] as const
export type MaterialType = (typeof MATERIAL_TYPES)[number]

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  granite: 'Granite',
  marble: 'Marble',
  quartzite: 'Quartzite',
  porcelain: 'Porcelain',
  sintered: 'Sintered stone',
  limestone: 'Limestone',
}

export const FINISHES = ['polished', 'honed', 'leathered', 'matt'] as const
export type Finish = (typeof FINISHES)[number]

export const EDGE_PROFILES = ['pencil_round', 'arris', 'bullnose', 'ogee', 'mitred_apron'] as const
export type EdgeProfile = (typeof EDGE_PROFILES)[number]

export const EDGE_PROFILE_LABELS: Record<EdgeProfile, string> = {
  pencil_round: 'Pencil round',
  arris: 'Arris (eased)',
  bullnose: 'Bullnose',
  ogee: 'Ogee',
  mitred_apron: 'Mitred apron',
}

// Which sides of a piece get a polished, profiled edge.
// Front/back run along the piece's length; left/right run along its width.
export const EDGE_SIDES = ['front', 'back', 'left', 'right'] as const
export type EdgeSide = (typeof EDGE_SIDES)[number]

export const PRIORITIES = ['normal', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const SLAB_STATUSES = ['available', 'allocated', 'consumed'] as const
export type SlabStatus = (typeof SLAB_STATUSES)[number]

export const OPERATOR_TEAMS = ['yard', 'saw', 'cnc', 'finishing', 'qc', 'dispatch'] as const
export type OperatorTeam = (typeof OPERATOR_TEAMS)[number]

export const WORK_CENTRES = ['saw', 'cnc'] as const
export type WorkCentre = (typeof WORK_CENTRES)[number]

export const REMAKE_REASONS = [
  'chipped_edge',
  'cracked_piece',
  'measurement_error',
  'wrong_cutout',
  'edge_profile_wrong',
  'polish_defect',
  'vein_mismatch',
  'handling_damage',
] as const
export type RemakeReason = (typeof REMAKE_REASONS)[number]

export const REMAKE_REASON_LABELS: Record<RemakeReason, string> = {
  chipped_edge: 'Chipped edge',
  cracked_piece: 'Cracked piece',
  measurement_error: 'Measurement error',
  wrong_cutout: 'Cutout in wrong place',
  edge_profile_wrong: 'Wrong edge profile',
  polish_defect: 'Polish defect',
  vein_mismatch: 'Vein / colour mismatch',
  handling_damage: 'Damaged in handling',
}
