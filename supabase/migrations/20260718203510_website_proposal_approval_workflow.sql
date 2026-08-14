alter table public.website_service_requests
drop constraint if exists website_service_requests_status_check;

alter table public.website_service_requests
add constraint website_service_requests_status_check
check (
  status in (
    'draft',
    'submitted',
    'reviewing',
    'needs_info',
    'qualified',
    'proposal_drafting',
    'proposal_sent',
    'proposal_changes_requested',
    'proposal_approved',
    'proposal_declined',
    'declined',
    'converted',
    'archived'
  )
);

create table public.website_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.website_service_requests (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'draft',
  current_version_id uuid,
  sent_at timestamptz,
  decided_at timestamptz,
  created_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_proposals_status_check
    check (status in ('draft', 'sent', 'changes_requested', 'approved', 'declined', 'expired', 'withdrawn')),
  constraint website_proposals_title_check
    check (char_length(btrim(title)) between 1 and 160)
);

create table public.website_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.website_proposals (id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft',
  introduction text,
  project_objective text not null,
  scope_summary text not null,
  deliverables text[] not null default '{}'::text[],
  exclusions text[] not null default '{}'::text[],
  timeline text not null,
  estimated_start_date date,
  estimated_completion_date date,
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  deposit_cents integer not null default 0,
  recurring_cents integer not null default 0,
  recurring_interval text,
  payment_schedule text,
  revision_policy text,
  terms text not null,
  valid_until date,
  sent_at timestamptz,
  created_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_proposal_versions_number_unique unique (proposal_id, version_number),
  constraint website_proposal_versions_status_check
    check (status in ('draft', 'sent', 'superseded', 'withdrawn')),
  constraint website_proposal_versions_amounts_check
    check (
      subtotal_cents >= 0
      and discount_cents >= 0
      and total_cents >= 0
      and deposit_cents >= 0
      and deposit_cents <= total_cents
      and recurring_cents >= 0
    ),
  constraint website_proposal_versions_total_check
    check (total_cents = greatest(subtotal_cents - discount_cents, 0)),
  constraint website_proposal_versions_recurring_check
    check (
      (recurring_cents = 0 and recurring_interval is null)
      or (recurring_cents > 0 and recurring_interval in ('monthly', 'quarterly', 'yearly'))
    ),
  constraint website_proposal_versions_dates_check
    check (
      estimated_start_date is null
      or estimated_completion_date is null
      or estimated_completion_date >= estimated_start_date
    )
);

alter table public.website_proposals
add constraint website_proposals_current_version_fkey
foreign key (current_version_id)
references public.website_proposal_versions (id)
on delete set null;

create table public.website_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.website_proposals (id) on delete cascade,
  version_id uuid not null unique references public.website_proposal_versions (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  decision text not null,
  client_name text not null,
  client_message text,
  acknowledgment text not null,
  created_at timestamptz not null default now(),
  constraint website_proposal_decisions_decision_check
    check (decision in ('approved', 'changes_requested', 'declined')),
  constraint website_proposal_decisions_name_check
    check (char_length(btrim(client_name)) between 2 and 160),
  constraint website_proposal_decisions_acknowledgment_check
    check (char_length(btrim(acknowledgment)) between 10 and 500)
);

create index website_proposals_client_created_idx
on public.website_proposals (client_user_id, created_at desc);

create index website_proposals_status_created_idx
on public.website_proposals (status, created_at desc);

create index website_proposal_versions_proposal_created_idx
on public.website_proposal_versions (proposal_id, version_number desc);

create index website_proposal_decisions_user_created_idx
on public.website_proposal_decisions (user_id, created_at desc);

drop trigger if exists website_proposals_set_updated_at on public.website_proposals;
create trigger website_proposals_set_updated_at
before update on public.website_proposals
for each row execute function public.set_updated_at();

drop trigger if exists website_proposal_versions_set_updated_at on public.website_proposal_versions;
create trigger website_proposal_versions_set_updated_at
before update on public.website_proposal_versions
for each row execute function public.set_updated_at();

create schema if not exists private;

create or replace function private.apply_website_proposal_decision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  proposal_row public.website_proposals%rowtype;
  version_row public.website_proposal_versions%rowtype;
  request_status text;
begin
  select *
  into proposal_row
  from public.website_proposals
  where id = new.proposal_id
  for update;

  select *
  into version_row
  from public.website_proposal_versions
  where id = new.version_id
    and proposal_id = new.proposal_id;

  if proposal_row.id is null
    or proposal_row.client_user_id <> (select auth.uid())
    or new.user_id <> (select auth.uid())
    or proposal_row.status <> 'sent'
    or proposal_row.current_version_id <> new.version_id
    or version_row.status <> 'sent'
    or (version_row.valid_until is not null and version_row.valid_until < current_date)
  then
    raise exception 'This proposal version is not available for a decision.';
  end if;

  update public.website_proposals
  set
    status = new.decision,
    decided_at = now()
  where id = new.proposal_id;

  request_status := case new.decision
    when 'approved' then 'proposal_approved'
    when 'changes_requested' then 'proposal_changes_requested'
    else 'proposal_declined'
  end;

  update public.website_service_requests
  set status = request_status
  where id = proposal_row.request_id;

  return new;
end;
$$;

revoke all on function private.apply_website_proposal_decision() from public;

create or replace function private.protect_sent_website_proposal_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' then
    if new.status not in ('superseded', 'withdrawn')
      or (
        to_jsonb(new) - array['status', 'updated_at']::text[]
        <> to_jsonb(old) - array['status', 'updated_at']::text[]
      )
    then
      raise exception 'Sent proposal versions are read-only. Create a new version instead.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_sent_website_proposal_version() from public;

drop trigger if exists website_proposal_versions_protect_sent on public.website_proposal_versions;
create trigger website_proposal_versions_protect_sent
before update on public.website_proposal_versions
for each row execute function private.protect_sent_website_proposal_version();

drop trigger if exists website_proposal_decisions_apply on public.website_proposal_decisions;
create trigger website_proposal_decisions_apply
before insert on public.website_proposal_decisions
for each row execute function private.apply_website_proposal_decision();

alter table public.website_proposals enable row level security;
alter table public.website_proposal_versions enable row level security;
alter table public.website_proposal_decisions enable row level security;

revoke all on public.website_proposals from anon;
revoke all on public.website_proposal_versions from anon;
revoke all on public.website_proposal_decisions from anon;

grant select, insert, update on public.website_proposals to authenticated;
grant select, insert, update on public.website_proposal_versions to authenticated;
grant select, insert on public.website_proposal_decisions to authenticated;

grant all on public.website_proposals to service_role;
grant all on public.website_proposal_versions to service_role;
grant all on public.website_proposal_decisions to service_role;

create policy "website_proposals_select"
on public.website_proposals
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (
    client_user_id = (select auth.uid())
    or (select public.is_platform_admin())
  )
);

create policy "website_proposals_admin_insert"
on public.website_proposals
for insert
to authenticated
with check ((select public.is_platform_admin()));

create policy "website_proposals_admin_update"
on public.website_proposals
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "website_proposal_versions_select"
on public.website_proposal_versions
for select
to authenticated
using (
  (select public.is_platform_admin())
  or (
    status <> 'draft'
    and exists (
      select 1
      from public.website_proposals proposal
      where proposal.id = proposal_id
        and proposal.client_user_id = (select auth.uid())
    )
  )
);

create policy "website_proposal_versions_admin_insert"
on public.website_proposal_versions
for insert
to authenticated
with check ((select public.is_platform_admin()));

create policy "website_proposal_versions_admin_update"
on public.website_proposal_versions
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "website_proposal_decisions_select"
on public.website_proposal_decisions
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "website_proposal_decisions_client_insert"
on public.website_proposal_decisions
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.website_proposals proposal
    join public.website_proposal_versions version
      on version.id = version_id
      and version.proposal_id = proposal.id
    where proposal.id = proposal_id
      and proposal.client_user_id = (select auth.uid())
      and proposal.status = 'sent'
      and proposal.current_version_id = version_id
      and version.status = 'sent'
      and (version.valid_until is null or version.valid_until >= current_date)
  )
);;
