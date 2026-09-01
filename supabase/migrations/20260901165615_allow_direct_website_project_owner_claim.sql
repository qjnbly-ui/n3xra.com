-- Direct website builds may begin before a client account exists. Permit the
-- first confirmed client owner to claim that otherwise-unowned project while
-- preserving every other immutable project identity field.
create or replace function private.protect_website_project_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    new.client_user_id is distinct from old.client_user_id
    and not (
      old.client_user_id is null
      and new.client_user_id is not null
      and old.source = 'existing_website'
      and public.is_platform_admin()
    )
  )
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.source is distinct from old.source
    or new.request_id is distinct from old.request_id
    or new.proposal_id is distinct from old.proposal_id
  then
    raise exception 'Website project ownership is read-only after creation.';
  end if;

  if new.status = 'launched' and old.status <> 'launched' and new.launched_at is null then
    new.launched_at := now();
  end if;

  if new.status = 'completed' and old.status <> 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif old.status = 'completed' and new.status <> 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_project_identity() from public;
