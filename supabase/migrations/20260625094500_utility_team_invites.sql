create table if not exists public.utility_organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.utility_organizations (id) on delete cascade,
  role_id uuid not null,
  code text not null unique,
  recipient_email text,
  recipient_name text,
  custom_message text,
  max_uses integer not null default 1,
  redeemed_uses integer not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid references auth.users (id) on delete set null,
  last_redeemed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_organization_invites_role_fk
    foreign key (organization_id, role_id)
    references public.utility_roles (organization_id, id)
    on delete restrict,
  constraint utility_organization_invites_code_check check (code ~ '^[A-Z0-9]{8,24}$'),
  constraint utility_organization_invites_recipient_email_check
    check (recipient_email is null or recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint utility_organization_invites_max_uses_check check (max_uses > 0 and max_uses <= 100),
  constraint utility_organization_invites_redeemed_uses_check check (redeemed_uses >= 0 and redeemed_uses <= max_uses),
  constraint utility_organization_invites_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists utility_organization_invites_organization_idx
on public.utility_organization_invites (organization_id, revoked_at, created_at desc);

create index if not exists utility_organization_invites_code_active_idx
on public.utility_organization_invites (code)
where revoked_at is null;

drop trigger if exists set_utility_organization_invites_updated_at on public.utility_organization_invites;
create trigger set_utility_organization_invites_updated_at
before update on public.utility_organization_invites
for each row execute function public.set_updated_at();

alter table public.utility_organization_invites enable row level security;

grant select, insert, update, delete on public.utility_organization_invites to authenticated;
grant select, insert, update, delete on public.utility_organization_invites to service_role;

drop policy if exists "utility_organization_invites_select_policy" on public.utility_organization_invites;
create policy "utility_organization_invites_select_policy"
on public.utility_organization_invites
for select
to authenticated
using (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_invites_insert_policy" on public.utility_organization_invites;
create policy "utility_organization_invites_insert_policy"
on public.utility_organization_invites
for insert
to authenticated
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_invites_update_policy" on public.utility_organization_invites;
create policy "utility_organization_invites_update_policy"
on public.utility_organization_invites
for update
to authenticated
using (public.can_manage_utility_organization(organization_id))
with check (public.can_manage_utility_organization(organization_id));

drop policy if exists "utility_organization_invites_delete_policy" on public.utility_organization_invites;
create policy "utility_organization_invites_delete_policy"
on public.utility_organization_invites
for delete
to authenticated
using (public.is_platform_admin());
