create table if not exists public.utility_module_catalog (
  id uuid primary key default gen_random_uuid(),
  module_key text not null unique,
  name text not null,
  description text not null,
  category text not null default 'operations',
  default_state text not null default 'requestable',
  sort_order integer not null default 0,
  is_core boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_module_catalog_key_check check (module_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint utility_module_catalog_name_check check (length(trim(name)) > 0),
  constraint utility_module_catalog_description_check check (length(trim(description)) > 0),
  constraint utility_module_catalog_category_check check (category in ('setup', 'customers', 'finance', 'operations', 'communications', 'compliance', 'reporting')),
  constraint utility_module_catalog_default_state_check
    check (default_state in ('enabled', 'disabled', 'requestable', 'coming_soon', 'requires_n3xra_setup')),
  constraint utility_module_catalog_sort_order_check check (sort_order >= 0),
  constraint utility_module_catalog_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);
create table if not exists public.utility_organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  module_key text not null references public.utility_module_catalog (module_key) on update cascade on delete restrict,
  state text not null default 'requestable',
  requested_by_user_id uuid references auth.users (id) on delete set null,
  requested_at timestamptz,
  enabled_at timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_key),
  constraint utility_organization_modules_state_check
    check (state in ('enabled', 'disabled', 'requestable', 'coming_soon', 'requires_n3xra_setup')),
  constraint utility_organization_modules_configuration_object_check check (jsonb_typeof(configuration) = 'object'),
  constraint utility_organization_modules_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);
create index if not exists utility_module_catalog_category_sort_idx
on public.utility_module_catalog (category, sort_order);
create index if not exists utility_organization_modules_organization_state_idx
on public.utility_organization_modules (organization_id, state);
drop trigger if exists set_utility_module_catalog_updated_at on public.utility_module_catalog;
create trigger set_utility_module_catalog_updated_at
before update on public.utility_module_catalog
for each row execute function public.set_updated_at();
drop trigger if exists set_utility_organization_modules_updated_at on public.utility_organization_modules;
create trigger set_utility_organization_modules_updated_at
before update on public.utility_organization_modules
for each row execute function public.set_updated_at();
insert into public.utility_module_catalog (
  module_key,
  name,
  description,
  category,
  default_state,
  sort_order,
  is_core,
  metadata
)
values
  ('finish_onboarding', 'Finish onboarding', 'Complete setup tasks, review N3XRA launch items, and get the portal ready.', 'setup', 'enabled', 10, true, '{"temporary": true, "dashboard_route": "/utilities/workspace/onboarding"}'::jsonb),
  ('customers', 'Customer accounts', 'Customer search, profiles, service addresses, contacts, account history, and portal access.', 'customers', 'disabled', 20, true, '{"dashboard_card": true}'::jsonb),
  ('customer_support', 'Customer support', 'Request inbox, ticket assignment, status updates, internal notes, and customer communication history.', 'customers', 'disabled', 30, true, '{"dashboard_card": true}'::jsonb),
  ('billing', 'Billing', 'Invoices, balances, billing settings, exports, and account-level billing history.', 'finance', 'requestable', 40, false, '{}'::jsonb),
  ('payments', 'Payments', 'Stripe Connect payments, payouts, refunds, payment status, and payment reporting.', 'finance', 'requires_n3xra_setup', 50, false, '{"provider": "stripe_connect"}'::jsonb),
  ('rebates', 'Rebates', 'Rebate applications, approval workflows, supporting documents, and customer rebate history.', 'finance', 'requestable', 60, false, '{}'::jsonb),
  ('conservation_programs', 'Conservation programs', 'Program applications, participation records, outreach, and conservation-related customer tasks.', 'operations', 'requestable', 70, false, '{}'::jsonb),
  ('service_requests', 'Work orders', 'Form submissions, ticket review, work queues, assignment, and service request lifecycle tracking.', 'operations', 'disabled', 80, true, '{"dashboard_card": true}'::jsonb),
  ('outage_reporting', 'Outage reporting', 'Customer outage reports, outage notices, affected areas, and operational updates.', 'operations', 'requestable', 90, false, '{}'::jsonb),
  ('meter_readings', 'Meter logs', 'Meter reading submission, review, historical readings, and meter issue reporting.', 'operations', 'requestable', 100, false, '{"dashboard_card": true}'::jsonb),
  ('new_service_applications', 'New service applications', 'New customer or new service requests, required forms, reviews, and approvals.', 'operations', 'requestable', 110, false, '{}'::jsonb),
  ('disconnect_reconnect', 'Disconnect/reconnect', 'Disconnect requests, reconnect requests, workflow status, and customer-facing forms.', 'operations', 'requestable', 120, false, '{}'::jsonb),
  ('permits', 'Permits', 'Permit applications, review queues, documents, status updates, and approval workflows.', 'operations', 'requestable', 130, false, '{}'::jsonb),
  ('inspections', 'Inspections', 'Inspection requests, schedules, outcomes, documents, and customer status updates.', 'operations', 'requestable', 140, false, '{}'::jsonb),
  ('field_service_requests', 'Field service requests', 'Field work intake, assignment, status updates, internal notes, and completion records.', 'operations', 'requestable', 150, false, '{}'::jsonb),
  ('documents', 'Documents', 'Document review, collection, uploads, customer files, service agreements, notices, and records.', 'compliance', 'disabled', 160, true, '{"dashboard_card": true}'::jsonb),
  ('board_meeting_documents', 'Board meeting documents', 'Board packets, agendas, minutes, public posting, and meeting document archives.', 'compliance', 'requestable', 170, false, '{}'::jsonb),
  ('compliance_reporting', 'Compliance reporting', 'Compliance records, report preparation, exports, review status, and supporting documents.', 'compliance', 'requestable', 180, false, '{}'::jsonb),
  ('communications', 'Communications', 'Announcements, customer messaging, email notices, alerts, reminders, and publishing workflows.', 'communications', 'disabled', 190, true, '{"dashboard_card": true}'::jsonb),
  ('public_notices', 'Public notices', 'Public notices, publishing workflow, customer visibility, and notice archives.', 'communications', 'requestable', 200, false, '{}'::jsonb),
  ('emergency_alerts', 'Emergency alerts', 'Emergency alerts, urgent notices, outage messages, and critical customer communications.', 'communications', 'requires_n3xra_setup', 210, false, '{}'::jsonb),
  ('reporting_dashboard', 'Reporting dashboard', 'Basic analytics, operational metrics, module reporting, and staff-facing dashboard views.', 'reporting', 'disabled', 220, false, '{"dashboard_card": true}'::jsonb),
  ('export_csv', 'Export CSV', 'CSV exports for customers, requests, payments, documents, and operational reports.', 'reporting', 'disabled', 230, false, '{}'::jsonb),
  ('gis_maps', 'GIS Maps', 'Map-based utility operations and service-area views.', 'operations', 'coming_soon', 240, false, '{"dashboard_card": true}'::jsonb),
  ('n3xra_records', 'N3XRA Records', 'Documents, meeting records, board packets, and utility records.', 'compliance', 'coming_soon', 250, false, '{"dashboard_card": true}'::jsonb)
on conflict (module_key) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  default_state = excluded.default_state,
  sort_order = excluded.sort_order,
  is_core = excluded.is_core,
  metadata = excluded.metadata,
  updated_at = now();
insert into public.utility_organization_modules (
  organization_id,
  module_key,
  state,
  metadata
)
select
  uo.id,
  catalog.module_key,
  catalog.default_state,
  '{}'::jsonb
from public.utility_organizations uo
cross join public.utility_module_catalog catalog
on conflict (organization_id, module_key) do nothing;
update public.utility_organization_modules
set
  state = 'disabled',
  updated_at = now()
where module_key in (
  'customers',
  'customer_support',
  'service_requests',
  'documents',
  'communications',
  'reporting_dashboard',
  'export_csv'
)
  and state = 'requestable';
alter table public.utility_module_catalog enable row level security;
alter table public.utility_organization_modules enable row level security;
grant select on public.utility_module_catalog to authenticated;
grant select, insert, update, delete on public.utility_module_catalog to service_role;
grant select, insert, update, delete on public.utility_organization_modules to authenticated;
grant select, insert, update, delete on public.utility_organization_modules to service_role;
drop policy if exists "utility_module_catalog_select_policy" on public.utility_module_catalog;
create policy "utility_module_catalog_select_policy"
on public.utility_module_catalog
for select
to authenticated
using (true);
drop policy if exists "utility_module_catalog_insert_policy" on public.utility_module_catalog;
create policy "utility_module_catalog_insert_policy"
on public.utility_module_catalog
for insert
to authenticated
with check (public.is_platform_admin());
drop policy if exists "utility_module_catalog_update_policy" on public.utility_module_catalog;
create policy "utility_module_catalog_update_policy"
on public.utility_module_catalog
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
drop policy if exists "utility_module_catalog_delete_policy" on public.utility_module_catalog;
create policy "utility_module_catalog_delete_policy"
on public.utility_module_catalog
for delete
to authenticated
using (public.is_platform_admin());
drop policy if exists "utility_organization_modules_select_policy" on public.utility_organization_modules;
create policy "utility_organization_modules_select_policy"
on public.utility_organization_modules
for select
to authenticated
using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_organization_modules_insert_policy" on public.utility_organization_modules;
create policy "utility_organization_modules_insert_policy"
on public.utility_organization_modules
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_organization_modules_update_policy" on public.utility_organization_modules;
create policy "utility_organization_modules_update_policy"
on public.utility_organization_modules
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_organization_modules_delete_policy" on public.utility_organization_modules;
create policy "utility_organization_modules_delete_policy"
on public.utility_organization_modules
for delete
to authenticated
using (public.is_platform_admin());
