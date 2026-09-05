-- Organization-only applications are deliberately separate from the public catalog.
create table public.organization_private_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  app_path text not null check (app_path ~ '^/[^/]' and app_path !~ '[[:space:]\\?#%]' and app_path not like '%..%'),
  status text not null default 'draft' check (status in ('draft','active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, app_path)
);
alter table public.organization_private_products enable row level security;
revoke all on public.organization_private_products from public, anon, authenticated;
grant select, insert, update on public.organization_private_products to authenticated;
grant all on public.organization_private_products to service_role;
create policy organization_private_products_admin on public.organization_private_products
  for all to authenticated using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));
create policy organization_private_products_members on public.organization_private_products
  for select to authenticated using (
    status = 'active' and exists (
      select 1 from public.organizations o where o.id = organization_id
      and o.account_status in ('active','trialing','past_due') and (
        o.owner_user_id = (select auth.uid()) or exists (
          select 1 from public.organization_memberships m
          where m.organization_id = o.id and m.user_id = (select auth.uid())
        )
      )
    )
  );
create trigger organization_private_products_updated_at before update
  on public.organization_private_products for each row execute function public.set_updated_at();
-- Future application tables and APIs must use this check, in addition to their
-- organization_id filters. A launcher link is not a data authorization boundary.
create function public.can_access_organization_private_product(input_product_id uuid, input_organization_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_private_products p
    where p.id = input_product_id and p.organization_id = input_organization_id and p.status = 'active'
  );
$$;
revoke all on function public.can_access_organization_private_product(uuid,uuid) from public,anon;
grant execute on function public.can_access_organization_private_product(uuid,uuid) to authenticated;
comment on table public.organization_private_products is 'Private organization-owned apps. Never include in the public product catalog. Application data requires separate RLS using can_access_organization_private_product.';
