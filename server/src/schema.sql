-- The register, as tables.
--
-- Every statement here is `IF NOT EXISTS`, so this file is run on every boot and
-- running it again changes nothing. That is the whole migration story: there is one
-- schema, it only ever gains things, and nobody has to remember to run a command
-- after a deploy.
--
-- Money is `bigint` because a rupee figure is a whole number and a float would
-- eventually print 29999.999999. `pg` hands a bigint back as a STRING, so every
-- read of one of these columns goes through Number() in the service layer —
-- `total + "5000"` is `"05000"`, and that bug has already happened once here.

create table if not exists reports (
  id           text primary key,
  name         text not null,
  -- The name folded to lower case, so "ramesh" and "Ramesh" group together
  -- without every query having to remember to fold it.
  name_key     text not null,
  -- Always "2026-08". Never the words: a month that travels as "August 2026"
  -- comes back from a spreadsheet as a date, and then prints as one.
  month        text not null,
  renewal      bigint not null default 0,
  submitted_at timestamptz not null default now(),
  edited_at    timestamptz,
  -- "", "web" or "sheet". "sheet" only ever arrives with an import.
  edited_in    text not null default '',
  -- Set, not removed: a delete is undoable and the row stays as history.
  deleted_at   timestamptz
);

create index if not exists reports_month_idx on reports (month);
create index if not exists reports_name_key_idx on reports (name_key);

-- RD and FD rows, in one table with a `kind`, because they are the same shape and
-- everything that reads one reads the other the same way.
create table if not exists deposits (
  id        bigserial primary key,
  report_id text not null references reports (id) on delete cascade,
  kind      text not null check (kind in ('rd', 'fd')),
  amount    bigint not null default 0,
  scheme    text not null default '',
  -- The order the agent typed them in, kept so a corrected report reads the same
  -- way it was entered.
  position  int not null default 0
);

create index if not exists deposits_report_id_idx on deposits (report_id);

-- One row per setting, value always text, cast on the way out.
--
-- A key/value tab rather than a column per setting, for the same reason the
-- Settings tab in the sheet is two columns: a new setting is a new row, not a
-- migration, and a key nobody knows about is ignored rather than fatal.
create table if not exists settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- One admin, so one row, and the check makes that structural rather than hoped for.
create table if not exists admin_account (
  id            int primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

-- Sessions hold sha256(token), never the token. A copy of this table is not a
-- pile of working cookies.
create table if not exists admin_sessions (
  token_hash   text primary key,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index if not exists admin_sessions_expires_at_idx on admin_sessions (expires_at);

-- Posters live in Postgres, not on disk, because Render wipes the filesystem on
-- every deploy and a poster written to disk would vanish the next time you push.
create table if not exists images (
  id         bigserial primary key,
  name       text not null,
  mime       text not null,
  bytes      int not null,
  width      int,
  height     int,
  data       bytea not null,
  created_at timestamptz not null default now()
);

-- What the Google Sheet still owes us.
--
-- Nothing an agent typed depends on Google being awake: a write finishes here, a
-- row lands in this queue in the same transaction, and a flusher drains it later.
--
-- A report and an image carry only a `ref` and are read fresh from their own table
-- at flush time, which is what makes a retry send the newest version rather than
-- the version that failed. Settings carry their whole set in `payload` instead:
-- they are one global object, and the queue drains in id order, so the last body
-- sent is the last one that was saved.
create table if not exists mirror_queue (
  id          bigserial primary key,
  kind        text not null check (kind in ('report', 'delete', 'settings', 'image')),
  ref         text not null default '',
  payload     text not null default '',
  attempts    int not null default 0,
  last_error  text not null default '',
  next_try_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists mirror_queue_next_try_at_idx on mirror_queue (next_try_at);
