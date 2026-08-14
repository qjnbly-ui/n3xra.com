alter table public.website_proposals
add column if not exists email_sent_at timestamptz,
add column if not exists email_recipient text,
add column if not exists email_message_id text;

create table public.website_proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.website_proposal_versions (id) on delete cascade,
  category text not null default 'other',
  name text not null,
  description text,
  billing_type text not null,
  quantity numeric(10, 2) not null default 1,
  unit_amount_cents integer not null default 0,
  recurring_interval text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint website_proposal_line_items_category_check
    check (category in ('website_build', 'domain', 'hosting', 'maintenance', 'email', 'ssl_cdn', 'content', 'ecommerce', 'integration', 'other')),
  constraint website_proposal_line_items_name_check
    check (char_length(btrim(name)) between 1 and 160),
  constraint website_proposal_line_items_billing_type_check
    check (billing_type in ('one_time', 'recurring')),
  constraint website_proposal_line_items_amount_check
    check (quantity > 0 and unit_amount_cents >= 0),
  constraint website_proposal_line_items_interval_check
    check (
      (billing_type = 'one_time' and recurring_interval is null)
      or (billing_type = 'recurring' and recurring_interval in ('monthly', 'quarterly', 'yearly'))
    )
);

create index website_proposal_line_items_version_sort_idx
on public.website_proposal_line_items (version_id, sort_order, created_at);

create or replace function private.protect_website_proposal_line_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_version_id uuid;
  parent_status text;
begin
  parent_version_id := case when tg_op = 'DELETE' then old.version_id else new.version_id end;

  select status
  into parent_status
  from public.website_proposal_versions
  where id = parent_version_id;

  if parent_status is distinct from 'draft' then
    raise exception 'Sent proposal line items are read-only. Create a new proposal version instead.';
  end if;

  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'Proposal line items cannot be moved between versions.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.protect_website_proposal_line_item() from public;

create trigger website_proposal_line_items_protect_sent
before update or delete on public.website_proposal_line_items
for each row execute function private.protect_website_proposal_line_item();

alter table public.website_proposal_line_items enable row level security;

revoke all on public.website_proposal_line_items from anon;
grant select, insert, update, delete on public.website_proposal_line_items to authenticated;
grant all on public.website_proposal_line_items to service_role;

create policy "website_proposal_line_items_select"
on public.website_proposal_line_items
for select
to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.website_proposal_versions version
    join public.website_proposals proposal on proposal.id = version.proposal_id
    where version.id = version_id
      and version.status <> 'draft'
      and proposal.client_user_id = (select auth.uid())
  )
);

create policy "website_proposal_line_items_admin_insert"
on public.website_proposal_line_items
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and exists (
    select 1
    from public.website_proposal_versions version
    where version.id = version_id
      and version.status = 'draft'
  )
);

create policy "website_proposal_line_items_admin_update"
on public.website_proposal_line_items
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "website_proposal_line_items_admin_delete"
on public.website_proposal_line_items
for delete
to authenticated
using ((select public.is_platform_admin()));
