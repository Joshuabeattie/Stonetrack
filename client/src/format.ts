// Formatting for dates, times and measurements, in Australian English and the
// factory's time zone (whatever the viewer's own computer is set to).
import { diffDays, todayInZone, type IsoDate } from '../../shared/dates'

let timeZone = 'Australia/Melbourne'
export function setTimeZone(tz: string) {
  timeZone = tz
}
export function factoryToday(): IsoDate {
  return todayInZone(timeZone)
}

// Calendar dates ('2026-11-20') are formatted in UTC so they never shift a day.
const dayMonthParts = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDate = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

function parts(formatter: Intl.DateTimeFormat, date: Date) {
  const p = formatter.formatToParts(date)
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? ''
  return { weekday: get('weekday'), day: get('day'), month: get('month') }
}

/** "Fri 20 Nov" */
export function formatDate(date: IsoDate): string {
  const p = parts(dayMonthParts, new Date(`${date}T00:00:00Z`))
  return `${p.weekday} ${p.day} ${p.month}`
}

/** "20 Nov" */
export function formatDayMonth(date: IsoDate): string {
  const p = parts(dayMonthParts, new Date(`${date}T00:00:00Z`))
  return `${p.day} ${p.month}`
}

export function formatLongDate(date: IsoDate): string {
  return longDate.format(new Date(`${date}T00:00:00Z`))
}

/** A moment in time ('2026-11-18T03:35:00Z') shown in factory time: "Wed 18 Nov, 2:35 pm". */
export function formatDateTime(instant: string): string {
  const p = parts(new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone }), new Date(instant))
  return `${p.weekday} ${p.day} ${p.month}, ${formatTime(instant)}`
}

export function formatTime(instant: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
    .format(new Date(instant))
    .replace(/\s?(am|pm)$/i, (m) => m.trim().toLowerCase())
}

/** "just now", "25 min ago", "3 h ago", "2 days ago" */
export function formatAgo(instant: string): string {
  const minutes = Math.round((Date.now() - new Date(instant).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export type DueTone = 'overdue' | 'soon' | 'later'

/** How a due date reads relative to today: "Due today", "Due in 3 days", "2 days overdue". */
export function dueStatus(dueDate: IsoDate, done = false): { text: string; tone: DueTone } {
  const days = diffDays(factoryToday(), dueDate)
  if (done) return { text: `Due ${formatDate(dueDate)}`, tone: 'later' }
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, tone: 'overdue' }
  if (days === 0) return { text: 'Due today', tone: 'soon' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' }
  return { text: `Due in ${days} days`, tone: days <= 3 ? 'soon' : 'later' }
}

const number = new Intl.NumberFormat('en-AU')
export const fmtMm = (mm: number) => `${number.format(mm)} mm`
export const fmtSize = (lengthMm: number, widthMm: number) => `${number.format(lengthMm)} × ${number.format(widthMm)}`
export const fmtM2 = (m2: number) => `${m2.toFixed(2)} m²`
export const fmtHours = (h: number) => `${h.toFixed(1)} h`
export const fmtPct = (pct: number | null) => (pct === null ? 'n/a' : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`)
export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`
