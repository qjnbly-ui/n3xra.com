create table if not exists public.founding_partner_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  organization text,
  website text,
  audience_source text not null,
  interested_products jsonb not null default '[]'::jsonb,
  referral_plan text not null,
  payout_country text,
  consent boolean not null default false,
  status text not null default 'submitted',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founding_partner_applications_email_check check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint founding_partner_applications_products_array_check check (jsonb_typeof(interested_products) = 'array'),
  constraint founding_partner_applications_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint founding_partner_applications_status_check
    check (status in ('submitted', 'reviewing', 'approved', 'rejected', 'waitlisted'))
);

create index if not exists founding_partner_applications_email_idx
on public.founding_partner_applications (lower(email));

create index if not exists founding_partner_applications_status_created_idx
on public.founding_partner_applications (status, created_at desc);

drop trigger if exists set_founding_partner_applications_updated_at on public.founding_partner_applications;
create trigger set_founding_partner_applications_updated_at
before update on public.founding_partner_applications
for each row execute function public.set_updated_at();

alter table public.founding_partner_applications enable row level security;

grant select, update, delete on public.founding_partner_applications to authenticated;
grant insert, select, update, delete on public.founding_partner_applications to service_role;

drop policy if exists "founding_partner_applications_select_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_select_policy"
on public.founding_partner_applications
for select
using (public.is_platform_admin());

drop policy if exists "founding_partner_applications_insert_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_insert_policy"
on public.founding_partner_applications
for insert
with check (public.is_platform_admin());

drop policy if exists "founding_partner_applications_update_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_update_policy"
on public.founding_partner_applications
for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "founding_partner_applications_delete_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_delete_policy"
on public.founding_partner_applications
for delete
using (public.is_platform_admin());
