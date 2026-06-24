create table if not exists public.utility_portal_launch_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  step_key text not null,
  title text not null,
  description text,
  sort_order integer not null default 0,
  status text not null default 'not_started',
  required boolean not null default true,
  locked boolean not null default false,
  completed_by_user_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, step_key),
  constraint utility_portal_launch_steps_key_check check (step_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint utility_portal_launch_steps_title_check check (length(trim(title)) > 0),
  constraint utility_portal_launch_steps_sort_order_check check (sort_order >= 0),
  constraint utility_portal_launch_steps_status_check
    check (status in ('not_started', 'in_progress', 'completed', 'skipped', 'blocked')),
  constraint utility_portal_launch_steps_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists utility_portal_launch_steps_organization_status_idx
on public.utility_portal_launch_steps (organization_id, status, sort_order);

create index if not exists utility_portal_launch_steps_organization_required_idx
on public.utility_portal_launch_steps (organization_id, required, status);

drop trigger if exists set_utility_portal_launch_steps_updated_at on public.utility_portal_launch_steps;
create trigger set_utility_portal_launch_steps_updated_at
before update on public.utility_portal_launch_steps
for each row execute function public.set_updated_at();

insert into public.utility_portal_launch_steps (
  organization_id,
  step_key,
  title,
  description,
  sort_order,
  status,
  required,
  locked,
  metadata
)
select
  uo.id,
  step.step_key,
  step.title,
  step.description,
  step.sort_order,
  step.status,
  step.required,
  step.locked,
  step.metadata
from public.utility_organizations uo
cross join lateral (
  values
    ('company_profile', 'Company profile', 'Core provider details, legal name, utility types, website, and contacts.', 10, 'completed', true, false, '{}'::jsonb),
    ('branding', 'Branding', 'Logo, portal display name, colors, and customer-facing identity.', 20, 'in_progress', true, false, '{}'::jsonb),
    ('portal_url', 'Portal URL', 'Reserved N3XRA portal slug and primary portal URL.', 30, 'completed', true, false, '{}'::jsonb),
    ('admin_account', 'Admin account', 'Primary utility admin account invitation and access setup.', 40, 'not_started', true, false, '{}'::jsonb),
    ('customer_settings', 'Customer settings', 'Customer portal modules, service types, request categories, and notification defaults.', 50, 'not_started', true, false, '{}'::jsonb),
    ('payment_setup', 'Payment setup', 'External payment link or Stripe Connect readiness.', 60, 'not_started', false, false, '{}'::jsonb),
    ('dns_setup', 'DNS setup', 'Custom portal domain DNS records and verification.', 70, 'not_started', false, false, '{}'::jsonb),
    ('email_sender_setup', 'Email sender setup', 'Custom email sender DNS records and verification.', 80, 'not_started', false, false, '{}'::jsonb),
    ('ready_to_launch', 'Ready to launch', 'Final N3XRA review before the customer portal is marked live.', 90, 'blocked', true, true, '{}'::jsonb)
) as step(step_key, title, description, sort_order, status, required, locked, metadata)
on conflict (organization_id, step_key) do nothing;

alter table public.utility_portal_launch_steps enable row level security;

grant select, insert, update, delete on public.utility_portal_launch_steps to authenticated;
grant select, insert, update, delete on public.utility_portal_launch_steps to service_role;

drop policy if exists "utility_portal_launch_steps_select_policy" on public.utility_portal_launch_steps;
create policy "utility_portal_launch_steps_select_policy"
on public.utility_portal_launch_steps
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_portal_launch_steps_insert_policy" on public.utility_portal_launch_steps;
create policy "utility_portal_launch_steps_insert_policy"
on public.utility_portal_launch_steps
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_portal_launch_steps_update_policy" on public.utility_portal_launch_steps;
create policy "utility_portal_launch_steps_update_policy"
on public.utility_portal_launch_steps
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_portal_launch_steps_delete_policy" on public.utility_portal_launch_steps;
create policy "utility_portal_launch_steps_delete_policy"
on public.utility_portal_launch_steps
for delete
to authenticated
using (public.is_platform_admin());
