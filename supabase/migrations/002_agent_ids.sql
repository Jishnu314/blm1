-- Stable agent identity. Existing reports remain unassigned until the form sends
-- an ID; the admin can still read their existing name-based history.
alter table public.reports
  add column if not exists agent_id text not null default '';

create or replace function public.api_create_report(p jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare added_id text;
begin
  insert into reports(id, name, name_key, agent_id, month, renewal, submitted_at)
  values (p->>'id', p->>'name', lower(regexp_replace(trim(p->>'name'), '\s+', ' ', 'g')),
          coalesce(p->>'agentId',''), p->>'month', coalesce((p->>'renewal')::bigint, 0),
          coalesce((p->>'submittedAt')::timestamptz, now()))
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
  update reports set name=p->>'name',
    name_key=lower(regexp_replace(trim(p->>'name'), '\s+', ' ', 'g')),
    agent_id=coalesce(p->>'agentId',''), month=p->>'month',
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

-- Admin UI may add IDs, but an applied ID cannot be altered or removed there.
-- A direct backend/database change remains available for exceptional corrections.
create or replace function public.api_write_settings(patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  held_text text;
  previous jsonb;
  next_ids jsonb;
  item record;
  old_list jsonb;
  new_list jsonb;
  i integer;
begin
  if patch ? 'agentIds' then
    select value into held_text from settings where key='agentIds' for update;
    if held_text is not null then
      previous := held_text::jsonb;
      next_ids := (patch->>'agentIds')::jsonb;
      for item in select key, value from jsonb_each(previous) loop
        old_list := case when jsonb_typeof(item.value)='array' then item.value else jsonb_build_array(item.value) end;
        new_list := case when jsonb_typeof(next_ids->item.key)='array' then next_ids->item.key
                         when next_ids ? item.key then jsonb_build_array(next_ids->item.key) else '[]'::jsonb end;
        if jsonb_array_length(new_list) < jsonb_array_length(old_list) then
          raise exception using errcode='23514', message='An applied agent ID cannot be changed or removed.';
        end if;
        for i in 0..jsonb_array_length(old_list)-1 loop
          if old_list->i <> new_list->i then
            raise exception using errcode='23514', message='An applied agent ID cannot be changed or removed.';
          end if;
        end loop;
      end loop;
    end if;
  end if;
  insert into settings(key,value)
  select item.key, coalesce(item.value #>> '{}','') from jsonb_each(patch) as item
  on conflict(key) do update set value=excluded.value, updated_at=now();
end $$;
