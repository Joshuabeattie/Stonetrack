# StoneTrack walkthrough

This document explains how StoneTrack works, in plain language, so you can explain any part of it and debug it yourself. It covers the architecture, the data model, the main algorithms, security, configuration, the front end, the tests, every main file, the staging site on Cloudflare, and how to debug common problems. It ends with likely interview questions.

## 1. The big picture

StoneTrack runs a small stone benchtop factory. Three kinds of people use it:

- **The office (factory manager, admin)** takes orders, watches the floor, manages slab stock and checks the capacity plan and KPIs.
- **The floor (a tablet kiosk)** marks each stage done and flags remakes.
- **Clients** open a link to see how their order is going.

A job (an order) moves through five working stages and then ends up dispatched:

```
Slab allocation → Cutting → Finishing → Quality check → Dispatch → Dispatched
        ↑                                         │
        └────────── a remake sends it back to Cutting ──┘
```

Everything else is built on the job's history: every stage change is a row with a timestamp, the worker, and the labour hours booked. The KPIs and the client page are calculated from that history.

## 2. Architecture

One repository, three parts, all TypeScript:

```
client/   React app (runs in the browser)
server/   Express API (runs on Node.js)
shared/   Code both sides import: stages, validation rules, the cutting list, API types
```

### How the pieces talk

```
Development (npm run dev)                        Production (npm start)

Browser                                          Browser
  │  http://…:5000                                 │  https://your-app.replit.app
  ▼                                                ▼
Vite dev server :5000 ── /api/* ──► Express :3001   Express :5000 ── serves /api/* and the built React files
  (hot reload of React)                 │                              │
                                        ▼                              ▼
                                    PostgreSQL                     PostgreSQL
```

- In development two processes run (`concurrently` starts both). Vite serves the React code with hot reload and forwards every `/api` request to Express (`vite.config.ts`, `server.proxy`).
- In production there is one process. `npm run build` turns the React app into static files (`dist/client`) and bundles the server into `dist/server/index.js` with esbuild. Express serves the API and the static files on one port, and sends `index.html` for any other URL so React Router can handle pages like `/jobs/12`.

### Why `shared/` matters

The intake form and the server must agree exactly on what a valid job is and what its cutting list looks like. So both import the same code:

- `shared/schemas.ts`: the validation rules (zod). The server checks every request with them; the form uses them to show errors before sending.
- `shared/cuttingList.ts`: the cutting list generator. The form shows a live preview with it; the server uses it for slab allocation, the kiosk's default hours, capacity planning and KPIs.
- `shared/types.ts`: the shape of every API response, so the compiler catches a renamed field on either side.

### One request, end to end

What happens when a worker taps **Cutting done** on the kiosk:

1. `client/src/components/StageActions.tsx` (`AdvanceForm`) calls `api('/jobs/31/advance', { method: 'POST', body: { expectedStage: 'cutting', operatorId: 2, labourHours: 1.5 } })`.
2. `client/src/api.ts` adds `Authorization: Bearer <token>` and sends it.
3. In development, Vite forwards it to Express. In production it goes straight to Express.
4. `server/app.ts` runs the shared middleware: `requestContext` gives the request an id and logs it when it finishes, `helmet` adds security headers, `express.json()` reads the body.
5. `server/routes/index.ts` runs `authenticate` (`server/auth/middleware.ts`), which hashes the token and looks it up in the `sessions` table (`server/auth/sessions.ts`). If it's valid, `req.user` is set.
6. `server/routes/jobs.ts` matches `POST /:id/advance`. `requireRole('admin', 'manager', 'kiosk')` checks the role. `parse()` validates the id and the body with zod.
7. `advanceJob()` in `server/services/stages.ts` does the work inside one database transaction:
   - `SELECT … FOR UPDATE` locks the job row, so a second kiosk tapping at the same moment waits.
   - If the job is no longer in `expectedStage`, it stops with `409 STAGE_CHANGED`.
   - It works out the next stage (`shared/stages.ts`) and the standard hours (`shared/cuttingList.ts`).
   - Leaving Cutting marks the job's slabs as consumed. Leaving Slab allocation tops up slabs automatically.
   - It updates `jobs.current_stage` and inserts a `stage_events` row. Then it commits.
8. The JSON response goes back, the kiosk shows "J-1031 moved to Finishing" and refreshes its list.
9. If anything throws, `errorHandler` (`server/http/middleware.ts`) turns it into `{ "error": { "code", "message", "requestId" } }` with the right status, and the kiosk shows the message.

## 3. The data model

All tables are created by `server/db/migrations/001_initial_schema.sql`, which is commented line by line.

```
users ──< sessions
clients ──< jobs >── materials ──< slabs
             │                      │
             │  (a slab's job_id is set while it's allocated or after it's cut)
             ├──< job_pieces
             ├──< stage_events >── operators
             │        └── piece_id (which piece a remake was for)
             └──< webhook_events
machines          (daily hours for capacity planning)
schema_migrations (which migration files have run)
```

| Table | What it holds | Worth knowing |
| --- | --- | --- |
| `users` | People who sign in, with a role | Passwords are stored as scrypt hashes |
| `sessions` | One row per signed-in browser or tablet | Stores a SHA-256 hash of the token, never the token |
| `clients` | Builders, kitchen companies, homeowners | Matched by name, ignoring capitalisation |
| `materials` | Stone types: code, colour, thickness, standard slab size, reorder level | No engineered stone: banned in Australia since 1 July 2024 |
| `operators` | Factory workers the kiosk credits work to | Their count sets labour capacity |
| `machines` | Saw and CNC machines with hours per day | Grouped into work centres: `saw` (Cutting) and `cnc` (Finishing) |
| `jobs` | One order: client, stone, due date, current stage, share token | `job_number` is generated from the id (`J-1001`); `external_ref` makes webhook retries safe |
| `job_pieces` | The pieces to make, with quantity, edge profile, polished sides, cutouts | The cutting list is calculated from these rows |
| `slabs` | Every physical slab: available, allocated or consumed | A CHECK rule says available slabs have no job, and the others always have one |
| `stage_events` | The job history: created, advanced, remake | The source of truth for lead time, labour hours and remake KPIs |
| `webhook_events` | A log of every webhook call, accepted or not | Shown on the Integrations page |

Design choices to be ready to explain:

- **Constraints in the database, not only in code.** CHECK constraints on every fixed list (roles, stages, statuses), foreign keys, unique keys and rules like "a dispatched job always has `dispatched_at`". Even a buggy script can't store nonsense.
- **`current_stage` is stored on the job and also derivable from history.** It's a deliberate cache for fast filtering. Both are always written in the same transaction, and a test checks they agree.
- **Derived data isn't stored.** The cutting list, slab count and standard hours are recalculated from the pieces whenever needed. Nothing goes stale. The cost is a little CPU, and if the standard times changed, old jobs' estimates would change too. A real system would snapshot estimates when a job is created.
- **Dates and times.** Due dates are `date` columns and travel as `'YYYY-MM-DD'` strings, because a JavaScript `Date` at midnight can shift a day between time zones (`server/db/pool.ts` tells node-postgres not to convert them). Moments in time are `timestamptz`. "Today", due-date checks and KPI weeks use the factory's time zone (`FACTORY_TIMEZONE`, default `Australia/Melbourne`), not the server's (Replit runs in UTC).
- **snake_case in SQL, camelCase in JSON.** `server/db/mappers.ts` converts in one place.

## 4. The algorithms

### Cutting list and slab layout (`shared/cuttingList.ts`)

1. **Expand pieces into parts.** A piece with quantity 2 becomes two parts, labelled `P1-1` and `P1-2`.
2. **Measure each part.** Area, polished edge length (front and back edges run along the length, left and right along the width) and cutouts.
3. **Lay the parts out on slabs** with a "shelf" method (first-fit decreasing height):
   - Trim 20 mm of rough edge off every side of the slab, and leave 5 mm between parts for the saw blade.
   - Sort parts tallest first.
   - Put each part on the first row (shelf) of the first slab that has room. If no row fits, start a new row below; if the slab is full, start a new slab.
   - Granite, porcelain and sintered stone may be turned 90° to fit better. Marble, quartzite and limestone aren't turned, because the vein should run the same way on every piece.
   - A part bigger than one slab is reported as "oversize", and intake rejects it with a message to split it with a join.
4. **Yield and waste.** Yield = part area ÷ total slab area.
5. **Standard hours** per stage, from `STANDARD_TIMES`: saw minutes per metre of cut, CNC minutes per metre of polished edge (multiplied by the edge profile), minutes per cutout, all scaled by stone hardness and thickness. The numbers are illustrative and kept in one place to tune.

It's not an optimal nesting algorithm (real nesting software does better), but it's fast, predictable and easy to explain. Its unit tests check that parts never overlap and always sit inside the usable area.

### Slab allocation (`server/services/slabs.ts`)

When a job leaves Slab allocation, `allocateShortfall()` makes sure it holds as many slabs as its cutting list needs. It picks available slabs of the right stone, oldest first (FIFO), using `SELECT … FOR UPDATE SKIP LOCKED` so two jobs allocated at the same moment can't take the same slab. If there aren't enough, the whole stage change fails with `409 INSUFFICIENT_STOCK` and nothing changes. Leaving Cutting marks the job's allocated slabs as consumed. A manager can also allocate specific slabs (for example an extra one for a remake) or return an uncut slab to stock.

### Capacity planner (`server/services/capacityPlanner.ts`)

"Finite-capacity forward scheduling, earliest due date first." It's a pure function (no database), so it has its own unit tests.

1. Each job still in the factory has a list of remaining stage tasks, each needing saw hours, CNC hours and labour hours (from the standard times). The current stage counts as not started.
2. Capacity per working day: saw and CNC hours are the sum of the active machines' daily hours. Labour is active operators × 7.6 h (a standard Australian day).
3. For each working day (Monday to Friday) from today: go through the jobs in due-date order (urgent first on the same date). Each job works on its next task until it's done or a resource it needs runs out for the day. A task can be split across days.
4. A job moves at most one stage per day: stone is moved, sealed and checked between stages, so its next stage starts the next day.
5. The day its last task finishes is the projected finish. Finishing after the due date, or already overdue, means **late**. Finishing with one working day or less to spare means **at risk**.

Simplifications to mention: no public holidays, no partly finished stages, labour is one shared pool, and the order is a simple rule rather than an optimiser.

### KPIs (`server/services/kpis.ts`)

All calculated from the data, for jobs dispatched in the chosen period (7, 30 or 90 days):

| KPI | Formula |
| --- | --- |
| Throughput | Jobs dispatched (and their m²), plus jobs per week for the last 8 weeks |
| Average lead time | Average of `dispatched_at − created_at`, in days (median shown too, because one slow job skews an average) |
| On time | Jobs dispatched on or before their due date (factory time) ÷ jobs dispatched |
| Remake rate | Jobs with at least one remake ÷ jobs dispatched; remakes by reason over the same period |
| Slab waste | 1 − piece area ÷ area of the slabs those jobs used. Offcuts count as waste because the demo doesn't track reusing offcuts |
| Labour productivity | m² dispatched ÷ labour hours booked on those jobs; efficiency = standard hours ÷ booked hours |
| Work in progress | Jobs in each stage right now |

## 5. Security and robustness

**Passwords.** `server/auth/passwords.ts` uses scrypt (built into Node) with a random salt per password, and compares hashes in constant time. A wrong username takes as long to reject as a wrong password (`checkLogin` in `server/services/users.ts`), so response timing doesn't reveal which usernames exist.

**Sessions.** Login creates 32 random bytes as a token. The browser keeps the token; the database keeps only its SHA-256 hash, so a database leak doesn't hand out live sessions. Office sessions last 12 hours and kiosk sessions 30 days (tablets stay signed in). Logging out deletes the row. Deactivating a user, changing their role or changing their password deletes all their sessions.

**Why a Bearer header rather than a cookie?** Replit's preview shows the app inside an iframe on another site, where browsers don't send normal (`SameSite=Lax`) cookies. A header works everywhere. The trade-off: the token lives in `localStorage`, so cross-site scripting (XSS) is the main risk. It's reduced by React escaping all output and by a strict Content-Security-Policy that only allows scripts from the app itself. On its own domain, a production system would more likely use an `httpOnly` cookie and CSRF protection.

**Roles.** `requireRole()` returns 401 when nobody is signed in and 403 when the role isn't allowed. Routers mounted at the API root guard each route separately. A router-wide guard there would also catch unknown URLs and turn 404s into 401s. A test caught exactly that bug, and the regression test is still there.

**Validation.** Every body, query and id goes through a zod schema (`server/http/validate.ts`). Problems come back as `422` with a list of `{ path, message }`, such as `pieces.0.lengthMm`. The form uses these paths to highlight the right field.

**Consistent errors.** Every error, from a missing route to a crash, has the same JSON shape and includes a `requestId` that's also in the `X-Request-Id` header and in the server log line. Database constraint errors become 409 or 422 instead of 500. Crashes return a generic message. In development only, they also include the real cause.

**Concurrency.** Stage changes lock the job row (`FOR UPDATE`) and require `expectedStage`, so two simultaneous taps can't skip a stage: one succeeds and the other gets a clear 409. Slab picking uses `SKIP LOCKED`. Multi-step changes run in a transaction, so a failure leaves nothing half-done. Tests cover all of this, including two truly simultaneous requests.

**Webhook.** The sender signs `timestamp + "." + raw body` with HMAC-SHA256 and the shared `WEBHOOK_SECRET`. The server recomputes the signature over the exact bytes received (that's why this route reads the raw body before the JSON parser) and compares in constant time. Requests older than 5 minutes are refused, so a captured request can't be replayed later. `externalRef` is unique, so a retry returns the existing job with `200` instead of creating a duplicate, and a race between two identical deliveries is handled too. Every call is logged in `webhook_events`.

**Client portal.** The share token is 18 random bytes (24 characters), so the link itself is the key. The page returns progress only: no notes, address, people, prices or ids. Managers can replace the link, which disables the old one immediately.

**Other protections.** Security headers via helmet (CSP, `nosniff`, and others). Rate limits on login (10 a minute per IP), the webhook and the public page. `trust proxy` is set so rate limits see the real client IP behind Replit's proxy (on the Cloudflare staging site the address comes from Cloudflare's `CF-Connecting-IP` header instead; see section 11). JSON bodies are capped in size.

## 6. Configuration and environments

`server/config.ts` reads environment variables once at startup, validates them with zod, and picks one of three profiles:

| | Development | Test | Production |
| --- | --- | --- | --- |
| Started by | `npm run dev` | `npm test` | `npm start` / Replit publishing |
| Port | API on 3001, 127.0.0.1 only | none (Supertest) | `PORT` or 5000, on 0.0.0.0 |
| Serves the React build | no (Vite does) | no | yes |
| Runs migrations on start | no: warns if any are pending | no: global test setup does | yes |
| Seeds an empty database | no | no | yes, in demo mode |
| Logs | readable lines | silent | JSON lines |
| `WEBHOOK_SECRET` | default provided | fixed test value | required, at least 16 characters |
| Database SSL | off (Replit's development database has none) | off | on (Replit's production database requires it) |

`NODE_ENV` chooses the profile. If it's missing but Replit's `REPLIT_DEPLOYMENT=1` is present, production is assumed. Bad values stop the server at startup with a clear message.

The Cloudflare staging site (section 11) uses the production profile with `DEPLOY_TARGET=cloudflare`, set in `wrangler.jsonc`. That changes two things: Express doesn't serve the React build (Cloudflare does), and rate limits read the visitor's address from Cloudflare's header.

## 7. Migrations and seed data

**Migrations** (`server/db/migrate.ts`). Plain SQL files in `server/db/migrations`, run in filename order. The `schema_migrations` table records which have run. Each file runs in its own transaction, which first takes a PostgreSQL advisory lock, so two server instances starting together can't both run it: the second waits, then sees the file is already recorded and skips it. The lock is transaction-level (`pg_advisory_xact_lock`), so COMMIT or ROLLBACK releases it; section 11 explains why that matters behind a connection pooler. When nothing is pending, which is every start after the first, the runner makes one query and takes no lock. To change the schema, add `002_something.sql`. Never edit a file that has already run somewhere.

The SQL uses `IF NOT EXISTS` everywhere, which matters on Replit. When you publish, Replit copies the table structure (but not the `schema_migrations` rows) from the development database to the production database. When the production server then starts, the runner sees the file as "not yet applied" and runs it again, which is harmless because every statement skips what already exists. I tested both orders: an empty database, and one that already had the structure.

**Seed** (`server/db/seed.ts`). Deletes everything and inserts the demo data in one transaction. It's deterministic: a fixed random seed means the same 40 jobs every time. It's also relative to today: dates count back from today in the factory time zone, so the demo always looks current. It generates:

- 23 dispatched jobs over the last 8 weeks (some with remakes, some dispatched late), so the KPIs have data;
- 17 jobs on the floor right now, chosen so the capacity plan shows a few late and at-risk jobs;
- one stone with no stock and a job waiting for it, to show the "Not enough stock" path;
- consistent history (only working days and working hours, labour around the standard times), slabs that match each job's cutting list, and a few webhook deliveries.

The same seed function powers `npm run db:seed`, "Reset demo data" (admin), the empty-database seed in production and the nightly reset on staging. The empty-database seed goes through `seedIfEmpty()`, which takes its own transaction-level lock and checks again, so two instances starting at once can't both seed.

## 8. The front end

- **Routing** (`client/src/App.tsx`): office pages share `Layout` (navigation rail). The kiosk, the docket and the client page are full-screen. `RequireRole` sends signed-out users to `/login` and wrong roles to their own home page.
- **Sign-in state** (`client/src/auth.tsx`): a React context holding the user. On load it calls `/api/auth/me` to restore the session. Any 401 from the API signs the user out.
- **Data loading** (`client/src/hooks.ts`): `useApi(path)` returns `{ data, error, loading, reload }`. While reloading, the old data stays on screen, dimmed, so nothing jumps.
- **API calls** (`client/src/api.ts`): one `api()` function adds the token and turns error JSON into `ApiError` objects, which carry field errors and the request id.
- **Formatting** (`client/src/format.ts`): dates, times and numbers in Australian English and the factory's time zone.

**Design.** The stone is the colour system. `StoneSwatch.tsx` generates a texture from the stone's code: veins for marble, speckles for granite, mottling for limestone. The same stone always looks the same, so a kiosk tile matches the slab on the rack. The cutting layout (`SlabLayout.tsx`) draws each slab in its stone and clips the parts out of it, so the veining runs through them as it would on a real slab, with offcut hatched. Everything else is deliberately quiet: basalt-coloured text on a pale stone background, and safety yellow only for things that need attention. The typeface is Barlow, which comes from road-sign lettering and reads well at a distance.

**Accessibility.** Keyboard focus is always visible. Dialogs use the native `<dialog>` element, which traps focus and handles Escape. Every form field has a label, and errors are linked to their field and announced. Status is never colour alone (late, at risk and on track each have an icon and a word). Charts can switch to a table. Toasts are announced to screen readers. Reduced-motion settings are respected. Kiosk targets are at least 56 px.

## 9. Tests

`npm test` runs 106 tests with Vitest and Supertest:

| File | Covers |
| --- | --- |
| `tests/auth.test.ts` | Login, sessions, token hashing, roles, error format, security headers, unknown routes |
| `tests/jobs.test.ts` | Intake, every validation rule, client matching, search, edits |
| `tests/stages.test.ts` | Advancing through every stage, automatic slabs, stale stage (409), two simultaneous taps, stock shortage with rollback, remakes, kiosk list |
| `tests/slabs.test.ts` | Stock levels, receiving, automatic and manual allocation, releasing |
| `tests/planning.test.ts` | Capacity plan from the database, and every KPI calculated from known data |
| `tests/public.test.ts` | Client portal content, nothing internal leaks, replacing the link |
| `tests/webhooks.test.ts` | Signatures, tampering, replay, idempotency, validation, the delivery log |
| `tests/admin.test.ts` | User management, machine hours, demo reset |
| `tests/migrate.test.ts` | Migrating a brand-new database, a second start doing nothing, three instances migrating at once, a failing migration rolled back, two instances seeding at once, request-scoped pools |
| `tests/cloudflare.test.ts` | Every migration is bundled into the Worker; the static files' security headers match helmet's |
| `tests/capacityPlanner.test.ts`, `tests/cuttingList.test.ts`, `tests/dates.test.ts` | The pure functions |

**How the tests get a database.** They use the real PostgreSQL in `DATABASE_URL` (or `TEST_DATABASE_URL`), but in a separate schema, `stonetrack_test`. `tests/testDb.ts` adds `options=-c search_path=stonetrack_test` to the connection URL, so `SELECT * FROM jobs` reads `stonetrack_test.jobs`, never your demo data in `public.jobs`. `tests/globalSetup.ts` recreates the schema, checks the connection really landed in it (and refuses to continue if not), and runs the migrations. Each test starts from a small known data set (`resetDatabase()` in `tests/helpers.ts`), and its table names are schema-qualified as a second safety net.

**Checking the tests can fail.** A test that never fails proves nothing, so I broke three protections on purpose and confirmed the right tests went red: removing the row lock (the simultaneous-taps test failed), accepting any webhook signature (three signature tests failed), and adding notes to the client page (the "never exposes internal details" test failed). Then I restored the code. For the Cloudflare work I broke five more things the same way: leaving a migration out of the Worker bundle, changing one copied security header, removing the seed lock, removing the migration lock, and making `getPool()` ignore the request's pool. Each one turned a test red.

Run one file or one test: `npx vitest run tests/stages.test.ts -t "simultaneous"`.

## 10. File-by-file guide

### Root

| File | Purpose |
| --- | --- |
| `.replit` | Replit settings: modules (Node 20, PostgreSQL client), the Run command, publishing build and run commands, port 5000 mapped to 80 |
| `package.json` | Scripts and dependencies |
| `vite.config.ts` | React app root (`client/`), dev port 5000, `/api` proxy to 3001, Replit hosts allowed, build output `dist/client` |
| `vitest.config.ts` | Test setup: global setup, environment file, one test file at a time |
| `tsconfig.json`, `client/tsconfig.json` | TypeScript settings for the server side and the browser side |
| `.env.example` | Every environment variable, with defaults |
| `wrangler.jsonc` | The Cloudflare staging site: Worker entry point, static files and page routing, the Hyperdrive binding, variables, the nightly cron |

### `cloudflare/` (staging only)

| File | Purpose |
| --- | --- |
| `worker.ts` | The Worker: a pool per request, database preparation on an instance's first request, Express via `handleAsNodeRequest`, the nightly reset |
| `migrations.ts` | The migration files, bundled into the Worker as text |
| `_headers` | Security and cache headers for the static files Cloudflare serves (a copy of helmet's) |
| `sql.d.ts`, `tsconfig.json` | Types for `.sql` imports and for the Workers runtime |

### `shared/`

| File | Purpose |
| --- | --- |
| `stages.ts` | The stage list, labels, `nextStage()`, when remakes are allowed, button and client-page wording |
| `catalog.ts` | Fixed lists: roles, stone types, finishes, edge profiles, remake reasons, operator teams |
| `schemas.ts` | Every validation rule (zod), used by the API and the forms |
| `cuttingList.ts` | Parts, slab layout, yield and standard hours |
| `dates.ts` | Date-only arithmetic, working days, time zone conversion |
| `types.ts` | The JSON shape of every API response |

### `server/`

| File | Purpose |
| --- | --- |
| `index.ts` | Starts everything: prepares the database (migrate and seed in production, warnings in development), listens, shuts down cleanly on SIGTERM |
| `app.ts` | Builds the Express app: middleware order, the raw-body webhook route, the API, the React build and the SPA fallback |
| `config.ts` | Environment profiles and validation |
| `logger.ts` | Readable or JSON logs |
| `routes/index.ts` | The whole API surface in one list |
| `routes/*.ts` | Thin HTTP layer: guard, validate, call a service, send JSON |
| `services/jobs.ts` | Intake (shared by the form and the webhook), lists, detail, edits, share links, the client portal data |
| `services/stages.ts` | Advancing stages, remakes, the kiosk list |
| `services/slabs.ts` | Stock levels, receiving, allocation, releasing |
| `services/capacityPlanner.ts` | The pure planning function |
| `services/capacity.ts` | Loads machines, operators and jobs, then runs the planner |
| `services/kpis.ts` | KPI queries and formulas |
| `services/webhooks.ts` | Signature checks, idempotency, delivery log, example order |
| `services/users.ts` | Login check and user admin |
| `services/reference.ts` | Stone types, operators, machines, client names |
| `auth/passwords.ts`, `auth/sessions.ts`, `auth/middleware.ts` | Hashing, sessions, `authenticate` and `requireRole` |
| `http/errors.ts` | `HttpError` and helpers like `notFound()` and `conflict()` |
| `http/middleware.ts` | Request ids and logging, the final error handler |
| `http/validate.ts` | `parse(schema, data)`: validate or throw 422 |
| `http/rateLimits.ts` | Login, webhook and public page limits, counted per visitor address |
| `db/pool.ts` | Connection pool, `query()`, `withTransaction()`, SSL choice, type parsing, and request-scoped pools for Cloudflare (`runWithPool`) |
| `db/migrate.ts` | The migration runner (files read from disk, or passed in as text by the Worker) |
| `db/migrations/001_initial_schema.sql` | The schema |
| `db/seed.ts` | Demo data, and `seedIfEmpty()` for first starts |
| `db/mappers.ts` | Shared SQL snippets and row-to-JSON conversion |
| `db/insert.ts` | Multi-row inserts for the seed and pieces |
| `cli/migrate.ts`, `cli/seed.ts` | The `npm run db:*` commands |

### `client/src/`

| File | Purpose |
| --- | --- |
| `main.tsx`, `App.tsx` | Entry point and routes |
| `api.ts`, `auth.tsx`, `hooks.ts`, `format.ts` | API calls, sign-in state, data loading, formatting |
| `components/Layout.tsx` | Navigation rail and page header |
| `components/StoneSwatch.tsx` | Generated stone textures |
| `components/SlabLayout.tsx` | The to-scale cutting layout |
| `components/StageActions.tsx` | The "stage done" and "flag a remake" forms (kiosk and job page) |
| `components/Charts.tsx` | Column chart and bar list with tooltips and a table view |
| `components/Badges.tsx` | Stage rail, status, due date, priority |
| `components/Modal.tsx`, `Toast.tsx`, `Field.tsx`, `Feedback.tsx`, `Icon.tsx` | Dialogs, confirmations, form fields, loading and error states, icons |
| `pages/LoginPage.tsx` | Sign-in and demo accounts |
| `pages/DashboardPage.tsx` | KPIs, the line right now, at-risk alert |
| `pages/JobsPage.tsx` | Job list with filters kept in the URL |
| `pages/NewJobPage.tsx` | Intake with the live cutting list |
| `pages/JobDetailPage.tsx` | Everything about one job |
| `pages/KioskPage.tsx` | The factory tablet screen |
| `pages/SlabsPage.tsx` | Stock and slabs |
| `pages/CapacityPage.tsx` | The plan, and machine hours for admins |
| `pages/DocketPage.tsx` | Printable docket with a QR code |
| `pages/TrackPage.tsx` | The client's page |
| `pages/IntegrationsPage.tsx`, `pages/UsersPage.tsx` | Admin screens |
| `styles/*.css` | Design tokens and styles for the app, kiosk, docket and client page |

## 11. The staging site on Cloudflare

The brief asked for Replit, and that set-up is unchanged. The staging site is a second way to run the same code, on Cloudflare Workers, so there's a public link that redeploys itself from GitHub.

```
Browser
  │  https://stonetrack.<subdomain>.workers.dev
  ▼
Cloudflare ── the React build (dist/client): served directly, with the headers in cloudflare/_headers
  │
  └─ /api/* ──► Worker: cloudflare/worker.ts ──► the same Express app (server/app.ts)
                                                    │  node-postgres, one small pool per request
                                                    ▼
                                                Hyperdrive (Cloudflare's connection pool, near the database)
                                                    │
                                                    ▼
                                                PostgreSQL on Neon (Sydney)
```

**What a Worker is.** Not a server that runs all the time. Cloudflare starts an instance of the code when a request arrives, may keep it for later requests, and may run many instances at once in different places. It runs in Cloudflare's own JavaScript runtime (workerd), not Node.js, but with Node.js compatibility on (`nodejs_compat` in `wrangler.jsonc`) the Node APIs that Express and pg need are there.

**How Express runs inside it.** `cloudflare/worker.ts` creates the Express app once per instance and calls `listen(8080)`. Nothing opens a real port: the number is just a name. For each request, `handleAsNodeRequest(8080, request)` (from `cloudflare:node`) turns the Workers `Request` into a Node request for Express, and Express's reply back into a `Response`. The routes, middleware, validation and services are exactly the ones Replit runs.

**Static files.** `wrangler.jsonc` points Cloudflare at `dist/client`. Cloudflare serves those files itself, and only `/api/*` runs the Worker (`run_worker_first`). Other unknown paths, like `/jobs/12`, get `index.html` (`not_found_handling: single-page-application`), so React Router handles them, as Express's fallback does on Replit. Helmet never sees these responses, so `cloudflare/_headers` repeats its security headers and adds a one-year cache for the hashed files in `/assets`. `tests/cloudflare.test.ts` fails if the copy drifts from what helmet sends.

**Database connections: a pool per request.** A Worker can't open a database connection in one request and use it in the next (Cloudflare refuses with "Cannot perform I/O on behalf of a different request"). So for each request the Worker creates a small pool (`createRequestPool`, at most 5 connections, because a request may have 6 open), runs the whole request inside `runWithPool(pool, …)`, and closes the pool once the response is on its way (`ctx.waitUntil(pool.end())`). That's cheap because the connections go to Hyperdrive, which keeps the real connections to Neon open next to the database.

The services never know any of this happens. They call `getPool()` as always, and `getPool()` in `server/db/pool.ts` checks an `AsyncLocalStorage` first. That's a Node.js feature that carries a value through every `await` that follows from a call. Inside `runWithPool` it returns the request's pool. On Replit and in the tests nothing sets one, so it returns the shared pool.

**No start-up step.** A Worker has no "server starting" moment, so the first request each instance handles runs `prepareDatabase()`. It applies new migrations (bundled into the Worker as text by `cloudflare/migrations.ts`, because a Worker can't read the project folder) and, if the database has no users, loads the demo data. Then the instance remembers it's done. When everything is already in place, that costs two quick queries. Many instances can start at once, so both steps take locks. I sent 15 simultaneous first requests to an empty database: the tables were created once, the demo data was loaded once, and all 15 requests succeeded.

**Why the locks are transaction-level.** Hyperdrive pools connections in transaction mode: a connection to the real database is yours until your transaction ends, and then it may go to someone else. A session-level advisory lock (`pg_advisory_lock`) would stay on that connection after we finished and block everyone else. So the migration runner and the seed take `pg_advisory_xact_lock` inside a transaction, and PostgreSQL releases it at COMMIT or ROLLBACK. The runner's first version used a session-level lock. It worked against a local database; reading Hyperdrive's documentation showed it would have broken on staging.

**Nightly reset.** The demo data counts back from today, so after a few days its dates would look stale, and visitors move jobs around. A cron trigger in `wrangler.jsonc` runs the Worker's `scheduled()` handler at 16:00 UTC (3am Melbourne summer time), which reloads the demo data in one transaction.

**Rate limits.** The counts live in each instance's memory, so on Cloudflare a limit applies per instance rather than across the whole site: looser, but still enough to stop a script hammering the login. The visitor's address comes from Cloudflare's `CF-Connecting-IP` header (`config.clientIpHeader`), which Cloudflare sets and overwrites if a visitor sends their own. Each limiter is created on its first request rather than when the file loads, because the limiter's memory store starts a timer and Workers don't allow timers outside a request.

**CPU limits.** Workers count CPU time, not time spent waiting for the database. The free plan allows 10 ms of CPU per request. Checking a password with scrypt takes about 40 ms and building the demo data about 250 ms, so staging needs the Workers Paid plan (30 seconds per request by default). Ordinary API requests use a few milliseconds.

**Configuration.** `wrangler.jsonc` sets the variables: `NODE_ENV=production`, `DEPLOY_TARGET=cloudflare`, `DEMO_MODE=true`, and a deliberately public `WEBHOOK_SECRET` (the README explains why). The Hyperdrive binding hands the Worker its connection string, so there's no `DATABASE_URL`.

**Deploying.** Workers Builds watches the GitHub repository. On each push to `main` it installs the dependencies, runs `npm run build:cf` (the React build plus `_headers`) and `npx wrangler deploy`. Wrangler bundles `cloudflare/worker.ts` and everything it imports with esbuild and uploads it with the static files.

**Debugging staging.** The Worker's logs (the same JSON lines as Replit's) are in the Cloudflare dashboard under the Worker, or stream them with `npx wrangler tail`. `/api/health` checks the database. To reproduce a problem in the real runtime, `npm run cf:dev` runs the Worker in workerd on your computer against your local PostgreSQL.

## 12. Debugging guide

**Start with the request id.** Every response has an `X-Request-Id` header, every error body has `requestId`, and every log line has it too. Copy it from the error (or the browser's Network tab) and search the logs: the Shell in development, **Publishing → Logs** in production, or the Worker's logs on Cloudflare (or `npx wrangler tail`). In production and on staging each line is JSON.

**Look at the data.** The `postgresql-16` module puts `psql` in the Replit Shell:

```bash
psql "$DATABASE_URL"
```

```sql
-- One job's history
SELECT e.created_at, e.event_type, e.from_stage, e.to_stage, e.labour_hours, e.remake_reason, o.name
  FROM stage_events e LEFT JOIN operators o ON o.id = e.operator_id
 WHERE e.job_id = (SELECT id FROM jobs WHERE job_number = 'J-1028') ORDER BY e.created_at;

-- Stock per stone
SELECT m.code, s.status, count(*) FROM slabs s JOIN materials m ON m.id = s.material_id GROUP BY 1, 2 ORDER BY 1, 2;

-- Any job whose stage disagrees with its history? (should return no rows)
SELECT j.job_number FROM jobs j
 WHERE j.current_stage <> (SELECT to_stage FROM stage_events WHERE job_id = j.id ORDER BY id DESC LIMIT 1);
```

**Common problems:**

| You see | Where to look |
| --- | --- |
| `409 STAGE_CHANGED` | Someone moved the job since the screen loaded. Expected: refresh. `assertExpectedStage` in `services/stages.ts` |
| `409 INSUFFICIENT_STOCK` | Not enough available slabs of that stone. `allocateShortfall` in `services/slabs.ts`; receive stock on the Slabs page |
| `422` on intake | The `details` list says which field; rules in `shared/schemas.ts`, slab-size check in `cuttingListOrThrow` |
| `401` from the webhook | The `message` says why: missing header, old timestamp or wrong signature. Check both sides use the same secret and sign the exact bytes sent |
| `403` | Signed in with a role that can't do this; see the role lists in `routes/*.ts` |
| Server warns "migration(s) pending" | `npm run db:setup` |
| `DATABASE_URL is not set` | The app has no database: Tools, then Database |
| Vite "Blocked request. This host is not allowed" | Add your domain to `allowedHosts` in `vite.config.ts` |
| A page shows an old value | Each page reloads its data after a change; the kiosk also refreshes every 30 seconds |
| The KPIs look wrong | Recalculate by hand with the formulas in section 4; `tests/planning.test.ts` shows a worked example |
| Staging API answers `503 DATABASE_UNAVAILABLE` | The Worker can't reach Neon through Hyperdrive. Check the Hyperdrive configuration's connection string (pooling off) and the Worker's logs. On Neon's free plan the database sleeps when idle and wakes on the next query; it stays asleep only if the month's free compute is used up |
| Staging shows "Worker exceeded resource limits" (error 1102) | The account is on the free Workers plan, which allows 10 ms of CPU per request; signing in needs about 40 ms. Switch to Workers Paid |
| Staging shows an old value right after a change | Hyperdrive's query cache is on. Turn caching off in the Hyperdrive configuration |

**Debugging a test.** Run it alone (`npx vitest run tests/stages.test.ts -t "remake"`), add `LOG_LEVEL=debug` to see server logs, and remember each test starts from the small data set in `tests/helpers.ts`, not the demo data.

## 13. Interview questions you might get

**Why raw SQL instead of an ORM?** The queries are visible and easy to explain, and features like `FOR UPDATE`, `SKIP LOCKED`, `FILTER`, `LATERAL` joins and generated columns are first-class. Every query uses `$1` placeholders, never string building, so there's no SQL injection. With a bigger team I'd consider a query builder or ORM for type-safe queries and generated migrations.

**How do you stop two people moving the same job?** A row lock plus an expected stage. Explained in section 5, and tested with two simultaneous requests.

**What happens if the webhook sender retries?** It gets the same job back with `200`, because `external_ref` is unique. Even two identical deliveries arriving at the same moment produce one job: the second hits the unique constraint and is treated as a duplicate.

**How would it scale?** Sessions and data are already in PostgreSQL, so several server instances can run side by side (Autoscale does this), and migrations are guarded by an advisory lock. Next steps would be a shared store for rate limits (they're in memory per instance now), caching or snapshotting cutting lists, moving KPI queries to a read replica or pre-aggregated tables, and background jobs for slow work.

**Why is staging on Cloudflare when the brief says Replit?** The Replit set-up is unchanged and documented. Staging is an extra: a link that's always up and redeploys on every push, on the hosting I use for my other projects. It also shows the code isn't tied to one host: the Cloudflare-specific code is one entry file, one config file and a headers file.

**What had to change for Express to run on Workers?** Five things, each small: database connections can't outlive a request (a pool per request, found through `AsyncLocalStorage`), there's no start-up hook (prepare the database on an instance's first request, with locks), there's no project folder at runtime (migrations bundled as text), timers aren't allowed outside a request (rate limiters created on first use), and Cloudflare serves the static files (so the security headers are copied into `_headers`).

**Why transaction-level advisory locks?** Hyperdrive pools connections in transaction mode, so after a transaction ends the same database connection can go to someone else. A session-level lock would stay with that connection and block everyone. `pg_advisory_xact_lock` is released by COMMIT or ROLLBACK, so it can't leak. My first version used a session-level lock; it passed locally, and reading Hyperdrive's documentation caught it before it reached staging.

**Why a separate test schema?** Replit gives each app one development database. A schema keeps test data apart without needing permission to create databases, and the setup refuses to run if the schema isn't active.

**What's simplified, and what would you build next?**

- Offcut (remnant) tracking: return big offcuts to stock as smaller slabs, which would also make the waste KPI fairer.
- Better nesting, and slabs of different sizes.
- Scanning slab and job barcodes at the kiosk.
- Uploading drawings and templates (object storage).
- SMS or email to clients when their job changes stage.
- Installer scheduling, quoting and pricing.
- Public holidays and partly finished stages in the planner.
- An offline-capable kiosk (PWA) for patchy factory Wi-Fi.

**Anything specific to the Australian industry?** No engineered stone in the catalogue, because it has been banned in Australia since 1 July 2024. Natural stone, porcelain and resin-free sintered stone are still allowed, and processing them is subject to crystalline silica controls. Dates, times and the working day (7.6 hours) follow Australian conventions.
