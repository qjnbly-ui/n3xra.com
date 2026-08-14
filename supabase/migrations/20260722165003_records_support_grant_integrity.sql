alter table public.records_support_grants
add constraint records_support_grants_max_duration_check
check (expires_at <= created_at + interval '24 hours');

create or replace function private.protect_records_support_grant_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.revoked_at is not null then
    raise exception 'A revoked support grant cannot be changed.';
  end if;
  if new.revoked_at is null or new.revoked_by_user_id is null then
    raise exception 'Support grants may only be updated to revoke access.';
  end if;
  if (to_jsonb(new) - 'revoked_at' - 'revoked_by_user_id')
     is distinct from
     (to_jsonb(old) - 'revoked_at' - 'revoked_by_user_id') then
    raise exception 'Grant scope, reason, and expiration are immutable.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_records_support_grant_update() from public, anon, authenticated;

drop trigger if exists protect_records_support_grant_update on public.records_support_grants;
create trigger protect_records_support_grant_update
before update on public.records_support_grants
for each row execute function private.protect_records_support_grant_update();
;
