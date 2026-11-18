import { describe, expect, it } from 'vitest'
import {
  addWorkingDays,
  dateInZone,
  isIsoDate,
  isWorkingDay,
  onOrAfterWorkingDay,
  workingDaysBetween,
  zonedTimeToUtc,
} from '../shared/dates'

describe('date helpers', () => {
  it('validates calendar dates', () => {
    expect(isIsoDate('2026-11-18')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('18/11/2026')).toBe(false)
  })

  it('skips weekends when adding working days', () => {
    expect(isWorkingDay('2026-11-21')).toBe(false) // Saturday
    expect(addWorkingDays('2026-11-20', 1)).toBe('2026-11-23') // Fri + 1 = Mon
    expect(addWorkingDays('2026-11-23', -1)).toBe('2026-11-20') // Mon - 1 = Fri
    expect(onOrAfterWorkingDay('2026-11-22')).toBe('2026-11-23') // Sun → Mon
  })

  it('counts working days in both directions', () => {
    expect(workingDaysBetween('2026-11-16', '2026-11-18')).toBe(2) // Mon → Wed
    expect(workingDaysBetween('2026-11-18', '2026-11-16')).toBe(-2) // Wed → Mon
    expect(workingDaysBetween('2026-11-20', '2026-11-23')).toBe(1) // Fri → Mon
    expect(workingDaysBetween('2026-11-23', '2026-11-20')).toBe(-1)
    expect(workingDaysBetween('2026-11-18', '2026-11-18')).toBe(0)
  })

  it('converts Melbourne wall-clock time to UTC across daylight saving', () => {
    // November is daylight saving (UTC+11); July is standard time (UTC+10).
    expect(zonedTimeToUtc('2026-11-18', '07:30', 'Australia/Melbourne').toISOString()).toBe('2026-11-17T20:30:00.000Z')
    expect(zonedTimeToUtc('2026-07-01', '07:30', 'Australia/Melbourne').toISOString()).toBe('2026-06-30T21:30:00.000Z')
  })

  it('finds the calendar date of an instant in the factory time zone', () => {
    // 20:30 UTC on the 17th is already the morning of the 18th in Melbourne.
    expect(dateInZone(new Date('2026-11-17T20:30:00Z'), 'Australia/Melbourne')).toBe('2026-11-18')
  })
})
