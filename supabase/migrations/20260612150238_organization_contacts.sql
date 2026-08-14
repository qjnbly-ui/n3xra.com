create table if not exists public.organization_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  email text not null,
  notes text,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_contacts_email_check check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint organization_contacts_full_name_check check (length(trim(full_name)) > 0),
  unique (organization_id, email)
);

create index if not exists organization_contacts_organization_id_idx on public.organization_contacts (organization_id);
create index if not exists organization_contacts_email_idx on public.organization_contacts (lower(email));

drop trigger if exists organization_contacts_set_updated_at on public.organization_contacts;
create trigger organization_contacts_set_updated_at
before update on public.organization_contacts
for each row execute procedure public.set_updated_at();

alter table public.organization_contacts enable row level security;

drop policy if exists "organization_contacts_select_policy" on public.organization_contacts;
create policy "organization_contacts_select_policy"
on public.organization_contacts
for select
using (public.can_view_organization(organization_id));

drop policy if exists "organization_contacts_insert_policy" on public.organization_contacts;
create policy "organization_contacts_insert_policy"
on public.organization_contacts
for insert
with check (
  public.can_manage_members(organization_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists "organization_contacts_update_policy" on public.organization_contacts;
create policy "organization_contacts_update_policy"
on public.organization_contacts
for update
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_contacts_delete_policy" on public.organization_contacts;
create policy "organization_contacts_delete_policy"
on public.organization_contacts
for delete
using (public.can_manage_members(organization_id));;
