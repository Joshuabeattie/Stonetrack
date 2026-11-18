// Wrangler imports .sql files as plain text (see "rules" in wrangler.jsonc).
declare module '*.sql' {
  const sql: string
  export default sql
}
