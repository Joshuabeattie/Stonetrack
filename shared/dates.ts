// Calendar dates are passed around as 'YYYY-MM-DD' strings. A plain string can't be
// shifted by time zones the way a JavaScript Date can, which matters because the
// server runs in UTC while the factory works on Melbourne time.

export type IsoDate = string

const DAY_MS = 86_400_000

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function toUtcMs(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS)
}

/** Whole calendar days from a to b (negative if b is earlier). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMs(date)).getUTCDay()
}

/** The factory works Monday to Friday. (Public holidays are out of scope for the demo.) */
export function isWorkingDay(date: IsoDate): boolean {
  const d = dayOfWeek(date)
  return d !== 0 && d !== 6
}

/** `date` itself if it's a working day, otherwise the next working day. */
export function onOrAfterWorkingDay(date: IsoDate): IsoDate {
  let d = date
  while (!isWorkingDay(d)) d = addDays(d, 1)
  return d
}

export function addWorkingDays(date: IsoDate, count: number): IsoDate {
  let d = date
  const step = count >= 0 ? 1 : -1
  let remaining = Math.abs(count)
  while (remaining > 0) {
    d = addDays(d, step)
    if (isWorkingDay(d)) remaining--
  }
  return d
}

/**
 * Signed number of working days from `from` to `to`.
 * Positive when `to` is later: Mon → Wed = 2, Wed → Mon = -2, same day = 0.
 */
export function workingDaysBetween(from: IsoDate, to: IsoDate): number {
  if (from === to) return 0
  const forward = to > from
  let d = from
  let count = 0
  while (d !== to) {
    d = addDays(d, forward ? 1 : -1)
    if (isWorkingDay(forward ? d : addDays(d, 1))) count++
  }
  return forward ? count : -count
}

/** The calendar date of an instant in a given time zone, e.g. Melbourne. */
export function dateInZone(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function todayInZone(timeZone: string): IsoDate {
  return dateInZone(new Date(), timeZone)
}

/** Minutes the zone is ahead of UTC at a given instant (Melbourne: +600 or +660 in daylight saving). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((wallClockAsUtc - instant.getTime()) / 60_000)
}

/** Converts a wall-clock time in a zone (e.g. 7:30 am Melbourne) to the real instant. */
export function zonedTimeToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const wallClockAsUtc = new Date(`${date}T${time}:00Z`)
  const firstGuess = zoneOffsetMinutes(wallClockAsUtc, timeZone)
  let result = new Date(wallClockAsUtc.getTime() - firstGuess * 60_000)
  // Second pass handles times that sit near a daylight-saving change.
  const secondGuess = zoneOffsetMinutes(result, timeZone)
  if (secondGuess !== firstGuess) result = new Date(wallClockAsUtc.getTime() - secondGuess * 60_000)
  return result
}
