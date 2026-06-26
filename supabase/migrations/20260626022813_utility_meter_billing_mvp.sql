create table if not exists public.utility_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  external_customer_id text not null,
  display_name text,
  email text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_customer_id),
  constraint utility_customers_external_id_check check (length(trim(external_customer_id)) > 0),
  constraint utility_customers_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_service_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  customer_id uuid references public.utility_customers (id) on delete set null,
  account_number text not null,
  service_address text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, account_number),
  constraint utility_service_accounts_account_number_check check (length(trim(account_number)) > 0),
  constraint utility_service_accounts_status_check check (status in ('active', 'inactive', 'closed')),
  constraint utility_service_accounts_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_meters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  service_account_id uuid references public.utility_service_accounts (id) on delete set null,
  meter_number text not null,
  meter_type text not null default 'water',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, meter_number),
  constraint utility_meters_meter_number_check check (length(trim(meter_number)) > 0),
  constraint utility_meters_status_check check (status in ('active', 'inactive', 'removed')),
  constraint utility_meters_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_import_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  name text not null,
  import_type text not null default 'meter_readings',
  column_mapping jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, import_type, name),
  constraint utility_import_templates_name_check check (length(trim(name)) > 0),
  constraint utility_import_templates_type_check check (import_type in ('meter_readings')),
  constraint utility_import_templates_mapping_object_check check (jsonb_typeof(column_mapping) = 'object'),
  constraint utility_import_templates_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_meter_reading_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  template_id uuid references public.utility_import_templates (id) on delete set null,
  file_name text,
  billing_period text not null,
  status text not null default 'processed',
  headers jsonb not null default '[]'::jsonb,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  error_count integer not null default 0,
  raw_preview jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_meter_reading_imports_period_check check (billing_period ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint utility_meter_reading_imports_status_check check (status in ('processed', 'partial', 'failed')),
  constraint utility_meter_reading_imports_headers_array_check check (jsonb_typeof(headers) = 'array'),
  constraint utility_meter_reading_imports_preview_array_check check (jsonb_typeof(raw_preview) = 'array'),
  constraint utility_meter_reading_imports_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_meter_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  import_id uuid references public.utility_meter_reading_imports (id) on delete set null,
  customer_id uuid references public.utility_customers (id) on delete set null,
  service_account_id uuid references public.utility_service_accounts (id) on delete set null,
  meter_id uuid references public.utility_meters (id) on delete set null,
  billing_period text not null,
  reading_date date,
  current_reading numeric(14, 2) not null,
  previous_reading numeric(14, 2),
  usage_gallons numeric(14, 2),
  source_row_number integer,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, meter_id, billing_period),
  constraint utility_meter_readings_period_check check (billing_period ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint utility_meter_readings_current_check check (current_reading >= 0),
  constraint utility_meter_readings_previous_check check (previous_reading is null or previous_reading >= 0),
  constraint utility_meter_readings_usage_check check (usage_gallons is null or usage_gallons >= 0),
  constraint utility_meter_readings_raw_row_object_check check (jsonb_typeof(raw_row) = 'object')
);

create table if not exists public.utility_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  import_id uuid references public.utility_meter_reading_imports (id) on delete set null,
  billing_period text not null,
  status text not null default 'draft',
  included_gallons numeric(14, 2) not null default 10000,
  overage_rate numeric(14, 4) not null default 0,
  item_count integer not null default 0,
  billable_count integer not null default 0,
  total_overage_gallons numeric(14, 2) not null default 0,
  total_overage_amount numeric(14, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_billing_runs_period_check check (billing_period ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint utility_billing_runs_status_check check (status in ('draft', 'approved', 'exported', 'void')),
  constraint utility_billing_runs_included_check check (included_gallons >= 0),
  constraint utility_billing_runs_rate_check check (overage_rate >= 0),
  constraint utility_billing_runs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_billing_run_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  billing_run_id uuid not null references public.utility_billing_runs (id) on delete cascade,
  reading_id uuid references public.utility_meter_readings (id) on delete set null,
  customer_id uuid references public.utility_customers (id) on delete set null,
  service_account_id uuid references public.utility_service_accounts (id) on delete set null,
  meter_id uuid references public.utility_meters (id) on delete set null,
  account_number text,
  customer_name text,
  service_address text,
  meter_number text,
  current_reading numeric(14, 2) not null,
  previous_reading numeric(14, 2),
  usage_gallons numeric(14, 2) not null default 0,
  included_gallons numeric(14, 2) not null default 10000,
  overage_gallons numeric(14, 2) not null default 0,
  overage_rate numeric(14, 4) not null default 0,
  overage_amount numeric(14, 2) not null default 0,
  status text not null default 'pending',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_billing_run_items_status_check check (status in ('pending', 'approved', 'flagged', 'skipped')),
  constraint utility_billing_run_items_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_billing_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  billing_run_id uuid not null references public.utility_billing_runs (id) on delete cascade,
  export_type text not null default 'quickbooks_csv',
  file_name text,
  row_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint utility_billing_exports_type_check check (export_type in ('quickbooks_csv', 'generic_csv')),
  constraint utility_billing_exports_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists utility_customers_organization_idx on public.utility_customers (organization_id);
create index if not exists utility_service_accounts_organization_idx on public.utility_service_accounts (organization_id);
create index if not exists utility_meters_organization_idx on public.utility_meters (organization_id);
create index if not exists utility_import_templates_organization_idx on public.utility_import_templates (organization_id);
create index if not exists utility_meter_reading_imports_organization_idx on public.utility_meter_reading_imports (organization_id, created_at desc);
create index if not exists utility_meter_readings_organization_period_idx on public.utility_meter_readings (organization_id, billing_period);
create index if not exists utility_billing_runs_organization_period_idx on public.utility_billing_runs (organization_id, billing_period desc, created_at desc);
create index if not exists utility_billing_run_items_run_status_idx on public.utility_billing_run_items (billing_run_id, status);
create index if not exists utility_billing_exports_run_idx on public.utility_billing_exports (billing_run_id, created_at desc);

drop trigger if exists set_utility_customers_updated_at on public.utility_customers;
create trigger set_utility_customers_updated_at
before update on public.utility_customers
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_service_accounts_updated_at on public.utility_service_accounts;
create trigger set_utility_service_accounts_updated_at
before update on public.utility_service_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_meters_updated_at on public.utility_meters;
create trigger set_utility_meters_updated_at
before update on public.utility_meters
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_import_templates_updated_at on public.utility_import_templates;
create trigger set_utility_import_templates_updated_at
before update on public.utility_import_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_meter_reading_imports_updated_at on public.utility_meter_reading_imports;
create trigger set_utility_meter_reading_imports_updated_at
before update on public.utility_meter_reading_imports
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_meter_readings_updated_at on public.utility_meter_readings;
create trigger set_utility_meter_readings_updated_at
before update on public.utility_meter_readings
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_billing_runs_updated_at on public.utility_billing_runs;
create trigger set_utility_billing_runs_updated_at
before update on public.utility_billing_runs
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_billing_run_items_updated_at on public.utility_billing_run_items;
create trigger set_utility_billing_run_items_updated_at
before update on public.utility_billing_run_items
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
values (
  'meter_billing',
  'Meter billing',
  'Upload meter reading CSV files, calculate allowance overages, review billing runs, and export approved charges.',
  'finance',
  'enabled',
  45,
  false,
  '{"available": true, "dashboard_card": true, "dashboard_route": "/utilities/workspace/meter-billing/"}'::jsonb
)
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
  'meter_billing',
  'enabled',
  '{}'::jsonb
from public.utility_organizations uo
on conflict (organization_id, module_key) do update
set
  state = 'enabled',
  updated_at = now();

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
values (
  'customers',
  'Customer accounts',
  'Customer search, account profiles, service addresses, meters, readings, and account history.',
  'customers',
  'enabled',
  20,
  true,
  '{"available": true, "dashboard_card": true, "dashboard_route": "/utilities/workspace/customers/"}'::jsonb
)
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
  'customers',
  'enabled',
  '{}'::jsonb
from public.utility_organizations uo
on conflict (organization_id, module_key) do update
set
  state = 'enabled',
  updated_at = now();

alter table public.utility_customers enable row level security;
alter table public.utility_service_accounts enable row level security;
alter table public.utility_meters enable row level security;
alter table public.utility_import_templates enable row level security;
alter table public.utility_meter_reading_imports enable row level security;
alter table public.utility_meter_readings enable row level security;
alter table public.utility_billing_runs enable row level security;
alter table public.utility_billing_run_items enable row level security;
alter table public.utility_billing_exports enable row level security;

grant select, insert, update, delete on public.utility_customers to authenticated;
grant select, insert, update, delete on public.utility_service_accounts to authenticated;
grant select, insert, update, delete on public.utility_meters to authenticated;
grant select, insert, update, delete on public.utility_import_templates to authenticated;
grant select, insert, update, delete on public.utility_meter_reading_imports to authenticated;
grant select, insert, update, delete on public.utility_meter_readings to authenticated;
grant select, insert, update, delete on public.utility_billing_runs to authenticated;
grant select, insert, update, delete on public.utility_billing_run_items to authenticated;
grant select, insert, update, delete on public.utility_billing_exports to authenticated;

grant select, insert, update, delete on public.utility_customers to service_role;
grant select, insert, update, delete on public.utility_service_accounts to service_role;
grant select, insert, update, delete on public.utility_meters to service_role;
grant select, insert, update, delete on public.utility_import_templates to service_role;
grant select, insert, update, delete on public.utility_meter_reading_imports to service_role;
grant select, insert, update, delete on public.utility_meter_readings to service_role;
grant select, insert, update, delete on public.utility_billing_runs to service_role;
grant select, insert, update, delete on public.utility_billing_run_items to service_role;
grant select, insert, update, delete on public.utility_billing_exports to service_role;

drop policy if exists "utility_customers_select_policy" on public.utility_customers;
create policy "utility_customers_select_policy" on public.utility_customers for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_customers_insert_policy" on public.utility_customers;
create policy "utility_customers_insert_policy" on public.utility_customers for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_customers_update_policy" on public.utility_customers;
create policy "utility_customers_update_policy" on public.utility_customers for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_customers_delete_policy" on public.utility_customers;
create policy "utility_customers_delete_policy" on public.utility_customers for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_service_accounts_select_policy" on public.utility_service_accounts;
create policy "utility_service_accounts_select_policy" on public.utility_service_accounts for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_service_accounts_insert_policy" on public.utility_service_accounts;
create policy "utility_service_accounts_insert_policy" on public.utility_service_accounts for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_service_accounts_update_policy" on public.utility_service_accounts;
create policy "utility_service_accounts_update_policy" on public.utility_service_accounts for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_service_accounts_delete_policy" on public.utility_service_accounts;
create policy "utility_service_accounts_delete_policy" on public.utility_service_accounts for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_meters_select_policy" on public.utility_meters;
create policy "utility_meters_select_policy" on public.utility_meters for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_meters_insert_policy" on public.utility_meters;
create policy "utility_meters_insert_policy" on public.utility_meters for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meters_update_policy" on public.utility_meters;
create policy "utility_meters_update_policy" on public.utility_meters for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meters_delete_policy" on public.utility_meters;
create policy "utility_meters_delete_policy" on public.utility_meters for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_import_templates_select_policy" on public.utility_import_templates;
create policy "utility_import_templates_select_policy" on public.utility_import_templates for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_import_templates_insert_policy" on public.utility_import_templates;
create policy "utility_import_templates_insert_policy" on public.utility_import_templates for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_import_templates_update_policy" on public.utility_import_templates;
create policy "utility_import_templates_update_policy" on public.utility_import_templates for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_import_templates_delete_policy" on public.utility_import_templates;
create policy "utility_import_templates_delete_policy" on public.utility_import_templates for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_meter_reading_imports_select_policy" on public.utility_meter_reading_imports;
create policy "utility_meter_reading_imports_select_policy" on public.utility_meter_reading_imports for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_meter_reading_imports_insert_policy" on public.utility_meter_reading_imports;
create policy "utility_meter_reading_imports_insert_policy" on public.utility_meter_reading_imports for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meter_reading_imports_update_policy" on public.utility_meter_reading_imports;
create policy "utility_meter_reading_imports_update_policy" on public.utility_meter_reading_imports for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meter_reading_imports_delete_policy" on public.utility_meter_reading_imports;
create policy "utility_meter_reading_imports_delete_policy" on public.utility_meter_reading_imports for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_meter_readings_select_policy" on public.utility_meter_readings;
create policy "utility_meter_readings_select_policy" on public.utility_meter_readings for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_meter_readings_insert_policy" on public.utility_meter_readings;
create policy "utility_meter_readings_insert_policy" on public.utility_meter_readings for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meter_readings_update_policy" on public.utility_meter_readings;
create policy "utility_meter_readings_update_policy" on public.utility_meter_readings for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_meter_readings_delete_policy" on public.utility_meter_readings;
create policy "utility_meter_readings_delete_policy" on public.utility_meter_readings for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_billing_runs_select_policy" on public.utility_billing_runs;
create policy "utility_billing_runs_select_policy" on public.utility_billing_runs for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_billing_runs_insert_policy" on public.utility_billing_runs;
create policy "utility_billing_runs_insert_policy" on public.utility_billing_runs for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_runs_update_policy" on public.utility_billing_runs;
create policy "utility_billing_runs_update_policy" on public.utility_billing_runs for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_runs_delete_policy" on public.utility_billing_runs;
create policy "utility_billing_runs_delete_policy" on public.utility_billing_runs for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_billing_run_items_select_policy" on public.utility_billing_run_items;
create policy "utility_billing_run_items_select_policy" on public.utility_billing_run_items for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_billing_run_items_insert_policy" on public.utility_billing_run_items;
create policy "utility_billing_run_items_insert_policy" on public.utility_billing_run_items for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_run_items_update_policy" on public.utility_billing_run_items;
create policy "utility_billing_run_items_update_policy" on public.utility_billing_run_items for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_run_items_delete_policy" on public.utility_billing_run_items;
create policy "utility_billing_run_items_delete_policy" on public.utility_billing_run_items for delete to authenticated using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_billing_exports_select_policy" on public.utility_billing_exports;
create policy "utility_billing_exports_select_policy" on public.utility_billing_exports for select to authenticated using (public.can_view_utility_organization(organization_id));
drop policy if exists "utility_billing_exports_insert_policy" on public.utility_billing_exports;
create policy "utility_billing_exports_insert_policy" on public.utility_billing_exports for insert to authenticated with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_exports_update_policy" on public.utility_billing_exports;
create policy "utility_billing_exports_update_policy" on public.utility_billing_exports for update to authenticated using (public.can_manage_utility_organization(organization_id)) with check (public.can_manage_utility_organization(organization_id));
drop policy if exists "utility_billing_exports_delete_policy" on public.utility_billing_exports;
create policy "utility_billing_exports_delete_policy" on public.utility_billing_exports for delete to authenticated using (public.can_manage_utility_organization(organization_id));
