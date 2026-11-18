-- 001_initial_schema.sql
-- The whole StoneTrack data model.
--
-- Every statement uses IF NOT EXISTS so the file can safely run against a database
-- that already has these tables. That matters on Replit: when you publish, Replit
-- copies table structure from the development database to the production database,
-- and the production server then runs this migration on start.
--
-- Conventions: snake_case names, serial ids, timestamptz for moments in time,
-- date for calendar dates (due dates), CHECK constraints for fixed lists.

-- People who sign in: admins, factory managers and kiosk tablets.
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'manager', 'kiosk')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per signed-in browser or tablet. We store a SHA-256 hash of the token,
-- never the token itself, so a database leak doesn't hand out live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- Builders, kitchen companies and homeowners who order benchtops.
CREATE TABLE IF NOT EXISTS clients (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  email       text,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Stone types the factory stocks: material, colour, thickness and standard slab size.
CREATE TABLE IF NOT EXISTS materials (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  material_type   text NOT NULL CHECK (material_type IN ('granite', 'marble', 'quartzite', 'porcelain', 'sintered', 'limestone')),
  finish          text NOT NULL CHECK (finish IN ('polished', 'honed', 'leathered', 'matt')),
  thickness_mm    integer NOT NULL CHECK (thickness_mm BETWEEN 6 AND 60),
  slab_length_mm  integer NOT NULL CHECK (slab_length_mm > 0),
  slab_width_mm   integer NOT NULL CHECK (slab_width_mm > 0),
  reorder_level   integer NOT NULL DEFAULT 2 CHECK (reorder_level >= 0),
  swatch_hex      text NOT NULL DEFAULT '#9a958c',
  active          boolean NOT NULL DEFAULT true
);

-- Factory floor workers. The kiosk asks "who did this?" when a stage is completed.
CREATE TABLE IF NOT EXISTS operators (
  id      serial PRIMARY KEY,
  name    text NOT NULL,
  team    text NOT NULL CHECK (team IN ('yard', 'saw', 'cnc', 'finishing', 'qc', 'dispatch')),
  active  boolean NOT NULL DEFAULT true
);

-- Machines and their daily hours, used by capacity planning.
-- work_centre groups them: 'saw' does Cutting, 'cnc' does Finishing.
CREATE TABLE IF NOT EXISTS machines (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  work_centre    text NOT NULL CHECK (work_centre IN ('saw', 'cnc')),
  hours_per_day  numeric(4,1) NOT NULL CHECK (hours_per_day BETWEEN 0 AND 24),
  active         boolean NOT NULL DEFAULT true
);

-- A job is one order: one client, one stone, a set of pieces and a due date.
-- job_number is generated from the id (J-1001, J-1002 …) so it can never be duplicated.
-- current_stage is also derivable from stage_events; it is kept on the job for fast filtering.
CREATE TABLE IF NOT EXISTS jobs (
  id                serial PRIMARY KEY,
  job_number        text GENERATED ALWAYS AS ('J-' || (id + 1000)::text) STORED,
  client_id         integer NOT NULL REFERENCES clients(id),
  material_id       integer NOT NULL REFERENCES materials(id),
  site_address      text,
  drawing_ref       text NOT NULL,
  due_date          date NOT NULL,
  priority          text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  notes             text,
  current_stage     text NOT NULL DEFAULT 'slab_allocation'
                    CHECK (current_stage IN ('slab_allocation', 'cutting', 'finishing', 'quality_check', 'dispatch', 'dispatched')),
  stage_updated_at  timestamptz NOT NULL DEFAULT now(),
  share_token       text NOT NULL UNIQUE,
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'seed', 'webhook')),
  external_ref      text UNIQUE, -- the sender's order number for webhook orders (makes retries safe)
  created_by        integer REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  dispatched_at     timestamptz,
  CONSTRAINT jobs_dispatched_at_matches_stage CHECK ((current_stage = 'dispatched') = (dispatched_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_number_idx ON jobs (job_number);
CREATE INDEX IF NOT EXISTS jobs_current_stage_idx ON jobs (current_stage);
CREATE INDEX IF NOT EXISTS jobs_due_date_idx ON jobs (due_date);
CREATE INDEX IF NOT EXISTS jobs_dispatched_at_idx ON jobs (dispatched_at);

-- The pieces to make for a job (each can have a quantity). The cutting list is
-- calculated from these rows; it is not stored.
CREATE TABLE IF NOT EXISTS job_pieces (
  id              serial PRIMARY KEY,
  job_id          integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  piece_no        integer NOT NULL CHECK (piece_no > 0),
  name            text NOT NULL,
  length_mm       integer NOT NULL CHECK (length_mm > 0),
  width_mm        integer NOT NULL CHECK (width_mm > 0),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  edge_profile    text NOT NULL CHECK (edge_profile IN ('pencil_round', 'arris', 'bullnose', 'ogee', 'mitred_apron')),
  polished_edges  text[] NOT NULL DEFAULT '{}',
  cutouts         integer NOT NULL DEFAULT 0 CHECK (cutouts >= 0),
  CONSTRAINT job_pieces_job_piece_no_key UNIQUE (job_id, piece_no)
);

-- Every physical slab in the yard. A slab is available, allocated to a job, or consumed (cut).
-- code is generated from the id (SL-0001 …).
CREATE TABLE IF NOT EXISTS slabs (
  id             serial PRIMARY KEY,
  code           text GENERATED ALWAYS AS ('SL-' || lpad(id::text, 4, '0')) STORED,
  material_id    integer NOT NULL REFERENCES materials(id),
  length_mm      integer NOT NULL CHECK (length_mm > 0),
  width_mm       integer NOT NULL CHECK (width_mm > 0),
  status         text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'allocated', 'consumed')),
  rack_location  text,
  job_id         integer REFERENCES jobs(id),
  received_at    timestamptz NOT NULL DEFAULT now(),
  allocated_at   timestamptz,
  consumed_at    timestamptz,
  -- An available slab belongs to no job; an allocated or consumed slab always belongs to one.
  CONSTRAINT slabs_job_matches_status CHECK ((status = 'available') = (job_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS slabs_code_idx ON slabs (code);
CREATE INDEX IF NOT EXISTS slabs_material_status_idx ON slabs (material_id, status);
CREATE INDEX IF NOT EXISTS slabs_job_id_idx ON slabs (job_id);

-- The timestamped history of every job: created, each stage completed, each remake.
-- This table is the source of truth for lead times, labour hours and remake rates.
CREATE TABLE IF NOT EXISTS stage_events (
  id             serial PRIMARY KEY,
  job_id         integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN ('created', 'advanced', 'remake')),
  from_stage     text CHECK (from_stage IN ('slab_allocation', 'cutting', 'finishing', 'quality_check', 'dispatch', 'dispatched')),
  to_stage       text NOT NULL CHECK (to_stage IN ('slab_allocation', 'cutting', 'finishing', 'quality_check', 'dispatch', 'dispatched')),
  labour_hours   numeric(6,2) CHECK (labour_hours >= 0), -- hours booked for the stage just completed
  remake_reason  text CHECK (remake_reason IN ('chipped_edge', 'cracked_piece', 'measurement_error', 'wrong_cutout',
                                               'edge_profile_wrong', 'polish_defect', 'vein_mismatch', 'handling_damage')),
  piece_id       integer REFERENCES job_pieces(id) ON DELETE SET NULL,
  note           text,
  operator_id    integer REFERENCES operators(id) ON DELETE SET NULL,
  user_id        integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stage_events_remake_has_reason CHECK ((event_type = 'remake') = (remake_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS stage_events_job_id_idx ON stage_events (job_id, created_at);
CREATE INDEX IF NOT EXISTS stage_events_created_at_idx ON stage_events (created_at);

-- A log of every call to the order webhook, accepted or not. Useful when debugging an integration.
CREATE TABLE IF NOT EXISTS webhook_events (
  id            serial PRIMARY KEY,
  received_at   timestamptz NOT NULL DEFAULT now(),
  external_ref  text,
  status        text NOT NULL CHECK (status IN ('created', 'duplicate', 'rejected')),
  http_status   integer NOT NULL,
  job_id        integer REFERENCES jobs(id) ON DELETE SET NULL,
  error         text
);
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events (received_at DESC);
