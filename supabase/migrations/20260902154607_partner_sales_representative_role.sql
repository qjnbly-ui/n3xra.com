create table if not exists public.platform_sales_representatives (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  granted_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_sales_representatives_email_idx
on public.platform_sales_representatives (lower(email));

alter table public.platform_sales_representatives enable row level security;

drop policy if exists "platform_sales_representatives_owner_select" on public.platform_sales_representatives;
create policy "platform_sales_representatives_owner_select"
on public.platform_sales_representatives
for select
to authenticated
using ((select public.is_platform_owner()));

revoke all on table public.platform_sales_representatives from public, anon, authenticated;
grant select on table public.platform_sales_representatives to authenticated;
grant all on table public.platform_sales_representatives to service_role;

create or replace function private.can_manage_sales_leads()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select public.is_platform_admin()), false)
    or exists (
      select 1
      from public.platform_sales_representatives representative
      where representative.user_id = (select auth.uid())
        and representative.status = 'active'
    );
$$;

revoke all on function private.can_manage_sales_leads() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_manage_sales_leads() to authenticated;

drop policy if exists "prospect_contacts_admin_select" on public.prospect_contacts;
create policy "prospect_contacts_sales_staff_select"
on public.prospect_contacts for select to authenticated
using ((select private.can_manage_sales_leads()));

drop policy if exists "prospect_contacts_admin_insert" on public.prospect_contacts;
create policy "prospect_contacts_sales_staff_insert"
on public.prospect_contacts for insert to authenticated
with check (
  (select private.can_manage_sales_leads())
  and created_by_user_id = (select auth.uid())
  and updated_by_user_id = (select auth.uid())
);

drop policy if exists "prospect_contacts_admin_update" on public.prospect_contacts;
create policy "prospect_contacts_sales_staff_update"
on public.prospect_contacts for update to authenticated
using ((select private.can_manage_sales_leads()))
with check (
  (select private.can_manage_sales_leads())
  and updated_by_user_id = (select auth.uid())
);

-- Deletion remains a platform-administrator responsibility. Sales staff can
-- preserve or mark a lead not interested without destroying the shared record.
drop policy if exists "prospect_contacts_admin_delete" on public.prospect_contacts;
create policy "prospect_contacts_admin_delete"
on public.prospect_contacts for delete to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "prospect_consent_events_admin_select" on public.prospect_consent_events;
create policy "prospect_consent_events_sales_staff_select"
on public.prospect_consent_events for select to authenticated
using ((select private.can_manage_sales_leads()));

drop policy if exists "prospect_business_cards_admin_select" on storage.objects;
create policy "prospect_business_cards_sales_staff_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select private.can_manage_sales_leads())
);

drop policy if exists "prospect_business_cards_admin_insert" on storage.objects;
create policy "prospect_business_cards_sales_staff_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'prospect-business-cards'
  and (select private.can_manage_sales_leads())
);

drop policy if exists "prospect_business_cards_admin_update" on storage.objects;
create policy "prospect_business_cards_sales_staff_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select private.can_manage_sales_leads())
)
with check (
  bucket_id = 'prospect-business-cards'
  and (select private.can_manage_sales_leads())
);

-- Business-card deletion remains limited to platform administrators.
drop policy if exists "prospect_business_cards_admin_delete" on storage.objects;
create policy "prospect_business_cards_admin_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
);

comment on table public.platform_sales_representatives is
  'Least-privilege N3XRA staff access for the shared Sales Leads workspace. Partner referrals and commissions remain governed by the partner program.';

comment on function private.can_manage_sales_leads() is
  'Returns true for active platform administrators and active Partner / Sales Representatives.';
