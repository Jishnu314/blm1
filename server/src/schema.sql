-- Local demo register. SQLite file on this machine, not the production database.

pragma foreign_keys = ON;

create table if not exists reports (
  id           text primary key,
  name         text not null,
  name_key     text not null,
  agent_id     text not null default '',
  month        text not null,
  renewal      integer not null default 0,
  submitted_at text not null,
  edited_at    text,
  edited_in    text not null default '',
  deleted_at   text
);

create index if not exists reports_month_idx on reports (month);
create index if not exists reports_name_key_idx on reports (name_key);

create table if not exists deposits (
  id        integer primary key autoincrement,
  report_id text not null references reports (id) on delete cascade,
  kind      text not null check (kind in ('rd', 'fd')),
  amount    integer not null default 0,
  scheme    text not null default '',
  position  integer not null default 0
);

create index if not exists deposits_report_id_idx on deposits (report_id);

create table if not exists settings (
  key        text primary key,
  value      text not null default '',
  updated_at text not null
);

create table if not exists customer_ledger (
  id         integer primary key check (id = 1),
  customers  text not null default '[]',
  updated_at text not null
);

create table if not exists admin_account (
  id            integer primary key check (id = 1),
  password_hash text not null,
  updated_at    text not null
);

create table if not exists admin_sessions (
  token_hash   text primary key,
  created_at   text not null,
  expires_at   text not null,
  last_seen_at text not null
);

create index if not exists admin_sessions_expires_at_idx on admin_sessions (expires_at);

create table if not exists images (
  id         integer primary key autoincrement,
  name       text not null,
  mime       text not null,
  bytes      integer not null,
  width      integer,
  height     integer,
  data       blob not null,
  created_at text not null
);

create table if not exists mirror_queue (
  id          integer primary key autoincrement,
  kind        text not null check (kind in ('report', 'delete', 'settings', 'image')),
  ref         text not null default '',
  payload     text not null default '',
  attempts    integer not null default 0,
  last_error  text not null default '',
  next_try_at text not null,
  created_at  text not null
);

create index if not exists mirror_queue_next_try_at_idx on mirror_queue (next_try_at);
