-- This helper is not part of the app's public API. Revoke the default PUBLIC
-- execute grant and any direct grants to API roles, for every overload, without
-- changing the function body or any trigger that may call it internally.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'rls_auto_enable'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      routine.signature
    );
  end loop;
end
$$;
