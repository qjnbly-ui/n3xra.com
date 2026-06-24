create table if not exists public.utility_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  legal_name text,
  status text not null default 'onboarding',
  launch_status text not null default 'draft',
  utility_types jsonb not null default '[]'::jsonb,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  support_email text,
  support_phone text,
  emergency_phone text,
  website text,
  stripe_customer_id text,
  stripe_connected_account_id text,
  stripe_connect_status text not null default 'not_started',
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_organizations_name_check check (length(trim(name)) > 0),
  constraint utility_organizations_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  constraint utility_organizations_status_check
    check (status in ('onboarding', 'implementation', 'active', 'paused', 'archived')),
  constraint utility_organizations_launch_status_check
    check (launch_status in ('draft', 'setup', 'review', 'ready', 'live', 'disabled')),
  constraint utility_organizations_stripe_connect_status_check
    check (stripe_connect_status in ('not_started', 'created', 'pending', 'needs_information', 'enabled', 'restricted', 'disabled')),
  constraint utility_organizations_utility_types_array_check check (jsonb_typeof(utility_types) = 'array'),
  constraint utility_organizations_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint utility_organizations_primary_email_check
    check (primary_contact_email is null or primary_contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint utility_organizations_support_email_check
    check (support_email is null or support_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);

create table if not exists public.utility_organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  domain text not null,
  domain_type text not null default 'n3xra_subdomain',
  verification_status text not null default 'not_configured',
  is_primary boolean not null default false,
  dns_target text,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_organization_domains_domain_check check (domain ~* '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  constraint utility_organization_domains_type_check check (domain_type in ('n3xra_subdomain', 'custom')),
  constraint utility_organization_domains_verification_status_check
    check (verification_status in ('not_configured', 'pending', 'verified', 'error', 'disabled')),
  constraint utility_organization_domains_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_organization_branding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.utility_organizations (id) on delete cascade,
  portal_display_name text,
  logo_storage_path text,
  favicon_storage_path text,
  primary_color text,
  secondary_color text,
  accent_color text,
  email_from_name text,
  email_reply_to text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_organization_branding_primary_color_check
    check (primary_color is null or primary_color ~* '^#[0-9a-f]{6}$'),
  constraint utility_organization_branding_secondary_color_check
    check (secondary_color is null or secondary_color ~* '^#[0-9a-f]{6}$'),
  constraint utility_organization_branding_accent_color_check
    check (accent_color is null or accent_color ~* '^#[0-9a-f]{6}$'),
  constraint utility_organization_branding_reply_to_check
    check (email_reply_to is null or email_reply_to ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint utility_organization_branding_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.utility_organizations (id) on delete cascade,
  modules jsonb not null default '{}'::jsonb,
  service_types jsonb not null default '[]'::jsonb,
  payment_preferences jsonb not null default '{}'::jsonb,
  notification_settings jsonb not null default '{}'::jsonb,
  launch_checklist jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_organization_settings_modules_object_check check (jsonb_typeof(modules) = 'object'),
  constraint utility_organization_settings_service_types_array_check check (jsonb_typeof(service_types) = 'array'),
  constraint utility_organization_settings_payment_preferences_object_check check (jsonb_typeof(payment_preferences) = 'object'),
  constraint utility_organization_settings_notification_settings_object_check check (jsonb_typeof(notification_settings) = 'object'),
  constraint utility_organization_settings_launch_checklist_object_check check (jsonb_typeof(launch_checklist) = 'object'),
  constraint utility_organization_settings_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  name text not null,
  display_name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id),
  constraint utility_roles_name_check check (name ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint utility_roles_display_name_check check (length(trim(display_name)) > 0),
  constraint utility_roles_permissions_object_check check (jsonb_typeof(permissions) = 'object')
);

create table if not exists public.utility_organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null,
  status text not null default 'active',
  invited_by_user_id uuid references auth.users (id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint utility_organization_members_role_same_organization_fk
    foreign key (organization_id, role_id) references public.utility_roles (organization_id, id) on delete restrict,
  constraint utility_organization_members_status_check check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint utility_organization_members_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  status text not null default 'started',
  contact_name text,
  contact_email text,
  current_step text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint utility_onboarding_sessions_status_check
    check (status in ('started', 'in_progress', 'submitted', 'reviewing', 'completed', 'paused', 'canceled')),
  constraint utility_onboarding_sessions_contact_email_check
    check (contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint utility_onboarding_sessions_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.utility_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  onboarding_session_id uuid not null references public.utility_onboarding_sessions (id) on delete cascade,
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  step_key text not null,
  status text not null default 'not_started',
  required boolean not null default true,
  completed_by_user_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_session_id, step_key),
  constraint utility_onboarding_steps_session_same_organization_fk
    foreign key (organization_id, onboarding_session_id) references public.utility_onboarding_sessions (organization_id, id) on delete cascade,
  constraint utility_onboarding_steps_key_check check (step_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint utility_onboarding_steps_status_check
    check (status in ('not_started', 'in_progress', 'completed', 'skipped', 'blocked')),
  constraint utility_onboarding_steps_data_object_check check (jsonb_typeof(data) = 'object')
);

create table if not exists public.utility_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.utility_organizations (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null default 'system',
  event_type text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint utility_audit_events_actor_type_check check (actor_type in ('platform_admin', 'utility_member', 'system')),
  constraint utility_audit_events_event_type_check check (length(trim(event_type)) > 0),
  constraint utility_audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists utility_organizations_slug_idx
on public.utility_organizations (slug);

create index if not exists utility_organizations_status_idx
on public.utility_organizations (status, launch_status);

create unique index if not exists utility_organization_domains_domain_lower_idx
on public.utility_organization_domains (lower(domain));

create unique index if not exists utility_organization_domains_primary_idx
on public.utility_organization_domains (organization_id)
where is_primary;

create index if not exists utility_organization_domains_organization_id_idx
on public.utility_organization_domains (organization_id);

create index if not exists utility_organization_members_user_id_idx
on public.utility_organization_members (user_id);

create index if not exists utility_organization_members_organization_id_idx
on public.utility_organization_members (organization_id);

create index if not exists utility_roles_organization_id_idx
on public.utility_roles (organization_id);

create index if not exists utility_onboarding_sessions_organization_status_idx
on public.utility_onboarding_sessions (organization_id, status);

create index if not exists utility_onboarding_steps_organization_status_idx
on public.utility_onboarding_steps (organization_id, status);

create index if not exists utility_audit_events_organization_created_idx
on public.utility_audit_events (organization_id, created_at desc);

drop trigger if exists set_utility_organizations_updated_at on public.utility_organizations;
create trigger set_utility_organizations_updated_at
before update on public.utility_organizations
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_organization_domains_updated_at on public.utility_organization_domains;
create trigger set_utility_organization_domains_updated_at
before update on public.utility_organization_domains
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_organization_branding_updated_at on public.utility_organization_branding;
create trigger set_utility_organization_branding_updated_at
before update on public.utility_organization_branding
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_organization_settings_updated_at on public.utility_organization_settings;
create trigger set_utility_organization_settings_updated_at
before update on public.utility_organization_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_roles_updated_at on public.utility_roles;
create trigger set_utility_roles_updated_at
before update on public.utility_roles
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_organization_members_updated_at on public.utility_organization_members;
create trigger set_utility_organization_members_updated_at
before update on public.utility_organization_members
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_onboarding_sessions_updated_at on public.utility_onboarding_sessions;
create trigger set_utility_onboarding_sessions_updated_at
before update on public.utility_onboarding_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_utility_onboarding_steps_updated_at on public.utility_onboarding_steps;
create trigger set_utility_onboarding_steps_updated_at
before update on public.utility_onboarding_steps
for each row execute function public.set_updated_at();

create or replace function public.utility_member_role(target_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ur.name
  from public.utility_organization_members uom
  join public.utility_roles ur on ur.id = uom.role_id
  where uom.organization_id = target_organization_id
    and uom.user_id = auth.uid()
    and uom.status = 'active'
  limit 1;
$$;

create or replace function public.can_view_utility_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.utility_organization_members uom
      where uom.organization_id = target_organization_id
        and uom.user_id = auth.uid()
        and uom.status = 'active'
    );
$$;

create or replace function public.can_manage_utility_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or coalesce(public.utility_member_role(target_organization_id), '') in ('owner', 'admin');
$$;

alter table public.utility_organizations enable row level security;
alter table public.utility_organization_domains enable row level security;
alter table public.utility_organization_branding enable row level security;
alter table public.utility_organization_settings enable row level security;
alter table public.utility_roles enable row level security;
alter table public.utility_organization_members enable row level security;
alter table public.utility_onboarding_sessions enable row level security;
alter table public.utility_onboarding_steps enable row level security;
alter table public.utility_audit_events enable row level security;

grant select, insert, update, delete on public.utility_organizations to authenticated;
grant select, insert, update, delete on public.utility_organization_domains to authenticated;
grant select, insert, update, delete on public.utility_organization_branding to authenticated;
grant select, insert, update, delete on public.utility_organization_settings to authenticated;
grant select, insert, update, delete on public.utility_roles to authenticated;
grant select, insert, update, delete on public.utility_organization_members to authenticated;
grant select, insert, update, delete on public.utility_onboarding_sessions to authenticated;
grant select, insert, update, delete on public.utility_onboarding_steps to authenticated;
grant select, insert, delete on public.utility_audit_events to authenticated;

grant select, insert, update, delete on public.utility_organizations to service_role;
grant select, insert, update, delete on public.utility_organization_domains to service_role;
grant select, insert, update, delete on public.utility_organization_branding to service_role;
grant select, insert, update, delete on public.utility_organization_settings to service_role;
grant select, insert, update, delete on public.utility_roles to service_role;
grant select, insert, update, delete on public.utility_organization_members to service_role;
grant select, insert, update, delete on public.utility_onboarding_sessions to service_role;
grant select, insert, update, delete on public.utility_onboarding_steps to service_role;
grant select, insert, delete on public.utility_audit_events to service_role;

drop policy if exists "utility_organizations_select_policy" on public.utility_organizations;
create policy "utility_organizations_select_policy"
on public.utility_organizations
for select
to authenticated
using (public.can_view_utility_organization(id));

drop policy if exists "utility_organizations_insert_policy" on public.utility_organizations;
create policy "utility_organizations_insert_policy"
on public.utility_organizations
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "utility_organizations_update_policy" on public.utility_organizations;
create policy "utility_organizations_update_policy"
on public.utility_organizations
for update
to authenticated
using (public.can_manage_utility_organization(id))
with check (public.can_manage_utility_organization(id));

drop policy if exists "utility_organizations_delete_policy" on public.utility_organizations;
create policy "utility_organizations_delete_policy"
on public.utility_organizations
for delete
to authenticated
using (public.is_platform_admin());

drop policy if exists "utility_organization_domains_select_policy" on public.utility_organization_domains;
create policy "utility_organization_domains_select_policy"
on public.utility_organization_domains
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_organization_domains_insert_policy" on public.utility_organization_domains;
create policy "utility_organization_domains_insert_policy"
on public.utility_organization_domains
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_domains_update_policy" on public.utility_organization_domains;
create policy "utility_organization_domains_update_policy"
on public.utility_organization_domains
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_domains_delete_policy" on public.utility_organization_domains;
create policy "utility_organization_domains_delete_policy"
on public.utility_organization_domains
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_branding_select_policy" on public.utility_organization_branding;
create policy "utility_organization_branding_select_policy"
on public.utility_organization_branding
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_organization_branding_insert_policy" on public.utility_organization_branding;
create policy "utility_organization_branding_insert_policy"
on public.utility_organization_branding
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_branding_update_policy" on public.utility_organization_branding;
create policy "utility_organization_branding_update_policy"
on public.utility_organization_branding
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_branding_delete_policy" on public.utility_organization_branding;
create policy "utility_organization_branding_delete_policy"
on public.utility_organization_branding
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_settings_select_policy" on public.utility_organization_settings;
create policy "utility_organization_settings_select_policy"
on public.utility_organization_settings
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_organization_settings_insert_policy" on public.utility_organization_settings;
create policy "utility_organization_settings_insert_policy"
on public.utility_organization_settings
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_settings_update_policy" on public.utility_organization_settings;
create policy "utility_organization_settings_update_policy"
on public.utility_organization_settings
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_settings_delete_policy" on public.utility_organization_settings;
create policy "utility_organization_settings_delete_policy"
on public.utility_organization_settings
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_roles_select_policy" on public.utility_roles;
create policy "utility_roles_select_policy"
on public.utility_roles
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_roles_insert_policy" on public.utility_roles;
create policy "utility_roles_insert_policy"
on public.utility_roles
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_roles_update_policy" on public.utility_roles;
create policy "utility_roles_update_policy"
on public.utility_roles
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_roles_delete_policy" on public.utility_roles;
create policy "utility_roles_delete_policy"
on public.utility_roles
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_members_select_policy" on public.utility_organization_members;
create policy "utility_organization_members_select_policy"
on public.utility_organization_members
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_organization_members_insert_policy" on public.utility_organization_members;
create policy "utility_organization_members_insert_policy"
on public.utility_organization_members
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_members_update_policy" on public.utility_organization_members;
create policy "utility_organization_members_update_policy"
on public.utility_organization_members
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_members_delete_policy" on public.utility_organization_members;
create policy "utility_organization_members_delete_policy"
on public.utility_organization_members
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_onboarding_sessions_select_policy" on public.utility_onboarding_sessions;
create policy "utility_onboarding_sessions_select_policy"
on public.utility_onboarding_sessions
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_onboarding_sessions_insert_policy" on public.utility_onboarding_sessions;
create policy "utility_onboarding_sessions_insert_policy"
on public.utility_onboarding_sessions
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_onboarding_sessions_update_policy" on public.utility_onboarding_sessions;
create policy "utility_onboarding_sessions_update_policy"
on public.utility_onboarding_sessions
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_onboarding_sessions_delete_policy" on public.utility_onboarding_sessions;
create policy "utility_onboarding_sessions_delete_policy"
on public.utility_onboarding_sessions
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_onboarding_steps_select_policy" on public.utility_onboarding_steps;
create policy "utility_onboarding_steps_select_policy"
on public.utility_onboarding_steps
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_onboarding_steps_insert_policy" on public.utility_onboarding_steps;
create policy "utility_onboarding_steps_insert_policy"
on public.utility_onboarding_steps
for insert
to authenticated
with check (
  public.can_manage_utility_organization(organization_id)
  and exists (
    select 1
    from public.utility_onboarding_sessions uos
    where uos.id = onboarding_session_id
      and uos.organization_id = utility_onboarding_steps.organization_id
  )
);

drop policy if exists "utility_onboarding_steps_update_policy" on public.utility_onboarding_steps;
create policy "utility_onboarding_steps_update_policy"
on public.utility_onboarding_steps
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (
  public.can_manage_utility_organization(organization_id)
  and exists (
    select 1
    from public.utility_onboarding_sessions uos
    where uos.id = onboarding_session_id
      and uos.organization_id = utility_onboarding_steps.organization_id
  )
);

drop policy if exists "utility_onboarding_steps_delete_policy" on public.utility_onboarding_steps;
create policy "utility_onboarding_steps_delete_policy"
on public.utility_onboarding_steps
for delete
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_audit_events_select_policy" on public.utility_audit_events;
create policy "utility_audit_events_select_policy"
on public.utility_audit_events
for select
to authenticated
using (public.can_view_utility_organization(organization_id));

drop policy if exists "utility_audit_events_insert_policy" on public.utility_audit_events;
create policy "utility_audit_events_insert_policy"
on public.utility_audit_events
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_audit_events_delete_policy" on public.utility_audit_events;
create policy "utility_audit_events_delete_policy"
on public.utility_audit_events
for delete
to authenticated
using (public.is_platform_admin());
