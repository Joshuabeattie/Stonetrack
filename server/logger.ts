// A tiny logger: readable lines in development, one JSON object per line in
// production (easy to filter in Replit's deployment logs), silent in tests.
import { inspect } from 'node:util'
import { config, type LogLevel } from './config'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

type Meta = Record<string, unknown>

function serialise(meta: Meta | undefined): Meta | undefined {
  if (!meta) return undefined
  const out: Meta = {}
  for (const [key, value] of Object.entries(meta)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  }
  return out
}

function write(level: Exclude<LogLevel, 'silent'>, message: string, meta?: Meta) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[config.logLevel]) return
  const stream = level === 'error' || level === 'warn' ? console.error : console.log
  if (config.logFormat === 'json') {
    stream(JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...serialise(meta) }))
  } else {
    const time = new Date().toTimeString().slice(0, 8)
    const extra = meta ? ' ' + inspect(serialise(meta), { depth: 4, breakLength: 120, colors: false }) : ''
    stream(`${time} ${level.toUpperCase().padEnd(5)} ${message}${extra}`)
  }
}

export const logger = {
  debug: (message: string, meta?: Meta) => write('debug', message, meta),
  info: (message: string, meta?: Meta) => write('info', message, meta),
  warn: (message: string, meta?: Meta) => write('warn', message, meta),
  error: (message: string, meta?: Meta) => write('error', message, meta),
}
