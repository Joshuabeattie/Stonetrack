import type pg from 'pg'
import type { Db } from './pool'

/**
 * Inserts many rows with one statement per batch:
 *   INSERT INTO table (a, b) VALUES ($1, $2), ($3, $4) …
 * Table and column names come from our own code, never from user input; all values
 * are sent as parameters. Batches keep us under PostgreSQL's 65,535-parameter limit.
 */
export async function insertRows<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  table: string,
  columns: string[],
  rows: unknown[][],
  returning?: string,
): Promise<T[]> {
  const out: T[] = []
  const batchSize = Math.max(1, Math.floor(60_000 / columns.length))
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}${returning ? ` RETURNING ${returning}` : ''}`
    const result = await db.query<T>(sql, params)
    out.push(...result.rows)
  }
  return out
}
