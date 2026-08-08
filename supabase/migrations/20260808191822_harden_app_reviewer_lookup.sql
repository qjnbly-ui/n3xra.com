create index platform_app_reviewers_invited_by_idx
on public.platform_app_reviewers (invited_by_user_id)
where invited_by_user_id is not null;

create policy "platform_app_reviewers_select_own"
on public.platform_app_reviewers
for select
to authenticated
using (user_id = (select auth.uid()));

grant select (user_id, email, status, created_at, updated_at)
on public.platform_app_reviewers
to authenticated;

create or replace function public.is_platform_reviewer()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_app_reviewers
    where user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function public.is_platform_reviewer() from public, anon;
grant execute on function public.is_platform_reviewer() to authenticated;
