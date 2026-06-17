create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) in ('quentin@n3xra.com', 'quentin@quentinnichols.com')
    or exists (
      select 1
      from public.platform_admins
      where user_id = auth.uid()
    );
$$;

insert into public.platform_admins (user_id, email)
select id, email
from auth.users
where lower(coalesce(email, '')) in ('quentin@n3xra.com', 'quentin@quentinnichols.com')
on conflict (user_id) do update
set email = excluded.email;
