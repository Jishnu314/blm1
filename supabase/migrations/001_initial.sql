-- Main register schema for Supabase. Run once in Dashboard → SQL Editor.
create table if not exists public.reports (
  id text primary key,
  name text not null,
  name_key text not null,
  month text not null,
  renewal bigint not null default 0,
  submitted_at timestamptz not null default now(),
  edited_at timestamptz,
  edited_in text not null default '',
  deleted_at timestamptz
);
create index if not exists reports_month_idx on public.reports(month);
create index if not exists reports_name_key_idx on public.reports(name_key);

create table if not exists public.deposits (
  id bigserial primary key,
  report_id text not null references public.reports(id) on delete cascade,
  kind text not null check (kind in ('rd', 'fd')),
  amount bigint not null default 0,
  scheme text not null default '',
  position int not null default 0
);
create index if not exists deposits_report_id_idx on public.deposits(report_id);

create table if not exists public.settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

-- The customer ledger is a single shared JSON document. The existing UI edits
-- rows locally; the API syncs its complete current list after each change.
create table if not exists public.customer_ledger (
  id int primary key default 1 check (id = 1),
  customers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_account (
  id int primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists admin_sessions_expires_at_idx on public.admin_sessions(expires_at);

create table if not exists public.api_rate_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  hits int not null default 0
);

-- Separate name from the old Express images(bytea) table so upgrades do not clash.
create table if not exists public.stored_images (
  id bigserial primary key,
  object_key text not null unique,
  name text not null,
  mime text not null,
  bytes int not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists public.mirror_queue (
  id bigserial primary key,
  kind text not null check (kind in ('report', 'delete', 'settings', 'image')),
  ref text not null default '',
  payload text not null default '',
  attempts int not null default 0,
  last_error text not null default '',
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists mirror_queue_next_try_at_idx on public.mirror_queue(next_try_at);

-- The Edge Function uses the service role key; browser clients receive no table access.
alter table public.reports enable row level security;
alter table public.deposits enable row level security;
alter table public.settings enable row level security;
alter table public.customer_ledger enable row level security;
alter table public.admin_account enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.stored_images enable row level security;
alter table public.mirror_queue enable row level security;
revoke all on public.reports, public.deposits, public.settings, public.customer_ledger, public.admin_account,
  public.admin_sessions, public.api_rate_limits, public.stored_images, public.mirror_queue
  from anon, authenticated;
grant all on public.reports, public.deposits, public.settings, public.customer_ledger, public.admin_account,
  public.admin_sessions, public.api_rate_limits, public.stored_images, public.mirror_queue
  to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('register-images', 'register-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152;

create or replace function public.api_create_report(p jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare added_id text;
begin
  insert into reports(id, name, name_key, month, renewal, submitted_at)
  values (p->>'id', p->>'name', lower(p->>'name'), p->>'month',
          coalesce((p->>'renewal')::bigint, 0), coalesce((p->>'submittedAt')::timestamptz, now()))
  on conflict(id) do nothing returning id into added_id;
  if added_id is null then return false; end if;
  insert into deposits(report_id, kind, amount, scheme, position)
  select added_id, 'rd', coalesce((x->>'amount')::bigint, 0), coalesce(x->>'scheme',''), n-1
  from jsonb_array_elements(coalesce(p->'rd','[]'::jsonb)) with ordinality as t(x,n);
  insert into deposits(report_id, kind, amount, scheme, position)
  select added_id, 'fd', coalesce((x->>'amount')::bigint, 0), coalesce(x->>'scheme',''), n-1
  from jsonb_array_elements(coalesce(p->'fd','[]'::jsonb)) with ordinality as t(x,n);
  return true;
end $$;

create or replace function public.api_replace_report(p_id text, p jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update reports set name=p->>'name', name_key=lower(p->>'name'), month=p->>'month',
    renewal=coalesce((p->>'renewal')::bigint,0), edited_at=now(), edited_in='web'
  where id=p_id and deleted_at is null;
  if not found then return false; end if;
  delete from deposits where report_id=p_id;
  insert into deposits(report_id,kind,amount,scheme,position)
  select p_id,'rd',coalesce((x->>'amount')::bigint,0),coalesce(x->>'scheme',''),n-1
  from jsonb_array_elements(coalesce(p->'rd','[]'::jsonb)) with ordinality as t(x,n);
  insert into deposits(report_id,kind,amount,scheme,position)
  select p_id,'fd',coalesce((x->>'amount')::bigint,0),coalesce(x->>'scheme',''),n-1
  from jsonb_array_elements(coalesce(p->'fd','[]'::jsonb)) with ordinality as t(x,n);
  return true;
end $$;

create or replace function public.api_delete_report(p_id text)
returns text language plpgsql security definer set search_path = public as $$
declare old_deleted timestamptz;
begin
  select deleted_at into old_deleted from reports where id=p_id for update;
  if not found then return 'missing'; end if;
  if old_deleted is not null then return 'gone'; end if;
  update reports set deleted_at=now() where id=p_id;
  return 'done';
end $$;

create or replace function public.api_restore_report(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update reports set deleted_at=null where id=p_id;
  return found;
end $$;

create or replace function public.api_write_settings(patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item record;
begin
  for item in select key, value from jsonb_each(patch) loop
    insert into settings(key,value) values(item.key, coalesce(item.value #>> '{}',''))
    on conflict(key) do update set value=excluded.value, updated_at=now();
  end loop;
end $$;

create or replace function public.api_rate_limit(p_bucket text, p_limit int, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare allowed boolean;
begin
  insert into api_rate_limits(bucket,window_started_at,hits) values(p_bucket,now(),1)
  on conflict(bucket) do update set
    hits=case when api_rate_limits.window_started_at + make_interval(secs=>p_seconds) <= now()
              then 1 else api_rate_limits.hits+1 end,
    window_started_at=case when api_rate_limits.window_started_at + make_interval(secs=>p_seconds) <= now()
                           then now() else api_rate_limits.window_started_at end;
  select hits <= p_limit into allowed from api_rate_limits where bucket=p_bucket;
  return allowed;
end $$;

revoke all on function public.api_create_report(jsonb), public.api_replace_report(text,jsonb),
  public.api_delete_report(text), public.api_restore_report(text),
  public.api_write_settings(jsonb), public.api_rate_limit(text,int,int)
  from public, anon, authenticated;
grant execute on function public.api_create_report(jsonb), public.api_replace_report(text,jsonb),
  public.api_delete_report(text), public.api_restore_report(text),
  public.api_write_settings(jsonb), public.api_rate_limit(text,int,int) to service_role;
