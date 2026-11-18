// Checks that keep the Cloudflare staging build in step with the rest of the app.
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { migrationsDir } from '../server/db/migrate'
import { api } from './helpers'

describe('Cloudflare staging build', () => {
  it('bundles every migration file into the Worker, in order', async () => {
    const onDisk = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort()
    const source = readFileSync('cloudflare/migrations.ts', 'utf8')
    const imported = [...source.matchAll(/from '\.\.\/server\/db\/migrations\/([^']+\.sql)'/g)].map((m) => m[1])
    const named = [...source.matchAll(/name: '([^']+\.sql)'/g)].map((m) => m[1])
    expect(imported).toEqual(onDisk)
    expect(named).toEqual(onDisk)
  })

  // Cloudflare serves the React build itself, so Express's security headers (helmet)
  // never touch those responses. cloudflare/_headers repeats them; this keeps the copy exact.
  it('serves the same security headers for static files as Express sends', async () => {
    const res = await api().get('/api/meta')
    const firstRule = readFileSync('cloudflare/_headers', 'utf8').split(/\n\s*\n/)[0]
    const [path, ...lines] = firstRule.trim().split('\n')
    expect(path).toBe('/*')
    const copied = Object.fromEntries(lines.map((line) => line.trim().split(/: (.*)/s).slice(0, 2)))
    const fromHelmet = [
      'content-security-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
      'origin-agent-cluster',
      'referrer-policy',
      'strict-transport-security',
      'x-content-type-options',
      'x-dns-prefetch-control',
      'x-download-options',
      'x-frame-options',
      'x-permitted-cross-domain-policies',
      'x-xss-protection',
    ]
    expect(Object.keys(copied).map((k) => k.toLowerCase()).sort()).toEqual([...fromHelmet].sort())
    for (const [name, value] of Object.entries(copied)) expect(res.headers[name.toLowerCase()], name).toBe(value)
  })
})
