create or replace function private.validate_website_proposal_project()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and old.project_id is not null
    and new.project_id is distinct from old.project_id
    and not (
      new.project_id is null
      and not exists (
        select 1
        from public.website_projects project
        where project.id = old.project_id
      )
    )
  then
    raise exception 'A proposal project link is read-only after creation.';
  end if;

  if new.project_id is not null
    and not exists (
      select 1
      from public.website_projects project
      where project.id = new.project_id
        and project.client_user_id = new.client_user_id
    )
  then
    raise exception 'The proposal and project must belong to the same client account.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_website_proposal_project() from public;;
