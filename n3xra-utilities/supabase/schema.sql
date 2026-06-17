create extension if not exists pgcrypto;

create table if not exists public.utilities_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'bootstrap',
  bootstrap_owner_name text,
  bootstrap_owner_email text,
  handoff_status text not null default 'n3xra_owned',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utilities_tenants_status_check
    check (status in ('bootstrap', 'implementation', 'active', 'paused', 'archived')),
  constraint utilities_tenants_handoff_status_check
    check (handoff_status in ('n3xra_owned', 'handoff_ready', 'utility_owned'))
);

create table if not exists public.utilities_supabase_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.utilities_tenants(id) on delete cascade,
  environment text not null default 'production',
  project_ref text,
  project_url text,
  auth_issuer text,
  connection_status text not null default 'not_configured',
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, environment),
  constraint utilities_supabase_projects_environment_check
    check (environment in ('development', 'staging', 'production')),
  constraint utilities_supabase_projects_connection_status_check
    check (connection_status in ('not_configured', 'pending', 'verified', 'error', 'disabled'))
);

create table if not exists public.utilities_operator_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.utilities_tenants(id) on delete cascade,
  external_supabase_project_ref text,
  external_user_id uuid not null,
  operator_email text,
  operator_name text,
  role text not null default 'operator',
  status text not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_user_id),
  constraint utilities_operator_links_role_check
    check (role in ('owner', 'admin', 'operator', 'support')),
  constraint utilities_operator_links_status_check
    check (status in ('active', 'suspended', 'removed'))
);

create table if not exists public.utilities_master_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.utilities_tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  created_by_operator_link_id uuid references public.utilities_operator_links(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.utilities_support_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.utilities_tenants(id) on delete cascade,
  opened_by_operator_link_id uuid references public.utilities_operator_links(id) on delete set null,
  title text not null,
  request_type text not null default 'implementation',
  priority text not null default 'normal',
  status text not null default 'open',
  details text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utilities_support_requests_type_check
    check (request_type in ('implementation', 'backend', 'settings', 'account', 'support')),
  constraint utilities_support_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint utilities_support_requests_status_check
    check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed'))
);

create table if not exists public.utilities_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.utilities_tenants(id) on delete set null,
  operator_link_id uuid references public.utilities_operator_links(id) on delete set null,
  actor_type text not null default 'n3xra',
  event_type text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint utilities_audit_events_actor_type_check
    check (actor_type in ('n3xra', 'utility_operator', 'system'))
);

alter table public.utilities_tenants enable row level security;
alter table public.utilities_supabase_projects enable row level security;
alter table public.utilities_operator_links enable row level security;
alter table public.utilities_master_settings enable row level security;
alter table public.utilities_support_requests enable row level security;
alter table public.utilities_audit_events enable row level security;

create index if not exists utilities_supabase_projects_tenant_id_idx
  on public.utilities_supabase_projects (tenant_id);

create index if not exists utilities_operator_links_tenant_id_idx
  on public.utilities_operator_links (tenant_id);

create index if not exists utilities_master_settings_tenant_id_effective_at_idx
  on public.utilities_master_settings (tenant_id, effective_at desc);

create index if not exists utilities_support_requests_tenant_id_status_idx
  on public.utilities_support_requests (tenant_id, status);

create index if not exists utilities_audit_events_tenant_id_created_at_idx
  on public.utilities_audit_events (tenant_id, created_at desc);

-- Policies are intentionally deferred until the server-mediated tenant
-- verification model is finalized. Do not expose service-role keys to clients.
