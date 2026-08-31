create table public.partner_terms (
  partner_application_id uuid primary key references public.founding_partner_applications(id) on delete cascade,
  status text not null default 'draft',
  commission_type text not null default 'custom',
  commission_rate_bps integer,
  commission_amount_cents integer,
  currency text not null default 'USD',
  commission_description text not null default '',
  contract_title text not null default 'N3XRA Partner Agreement',
  contract_body text not null default '',
  effective_at date,
  expires_at date,
  revision integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_terms_status_check check (status in ('draft', 'active')),
  constraint partner_terms_commission_type_check check (commission_type in ('percentage', 'fixed', 'custom')),
  constraint partner_terms_rate_check check (commission_rate_bps is null or commission_rate_bps between 0 and 10000),
  constraint partner_terms_amount_check check (commission_amount_cents is null or commission_amount_cents >= 0),
  constraint partner_terms_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint partner_terms_dates_check check (expires_at is null or effective_at is null or expires_at >= effective_at),
  constraint partner_terms_revision_check check (revision > 0),
  constraint partner_terms_type_value_check check (
    (commission_type = 'percentage' and commission_rate_bps is not null and commission_amount_cents is null)
    or (commission_type = 'fixed' and commission_amount_cents is not null and commission_rate_bps is null)
    or (commission_type = 'custom' and commission_rate_bps is null and commission_amount_cents is null)
  )
);

create table public.partner_terms_audit_log (
  id bigint generated always as identity primary key,
  partner_application_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint partner_terms_audit_action_check check (action in ('insert', 'update', 'delete')),
  constraint partner_terms_audit_before_check check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint partner_terms_audit_after_check check (after_state is null or jsonb_typeof(after_state) = 'object')
);

create index partner_terms_audit_partner_created_idx
on public.partner_terms_audit_log(partner_application_id, created_at desc);

create or replace function private.audit_partner_terms_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.partner_terms_audit_log (
    partner_application_id,
    actor_user_id,
    action,
    before_state,
    after_state
  ) values (
    coalesce(new.partner_application_id, old.partner_application_id),
    coalesce(new.updated_by, old.updated_by, new.created_by, old.created_by),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.audit_partner_terms_change() from public, anon, authenticated;

create trigger audit_partner_terms_change
after insert or update or delete on public.partner_terms
for each row execute function private.audit_partner_terms_change();

create or replace function public.partner_terms_audit_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Partner terms audit records are immutable.';
end;
$$;

revoke all on function public.partner_terms_audit_immutable() from public, anon, authenticated;

create trigger partner_terms_audit_immutable
before update or delete on public.partner_terms_audit_log
for each row execute function public.partner_terms_audit_immutable();

create trigger partner_terms_audit_immutable_truncate
before truncate on public.partner_terms_audit_log
for each statement execute function public.partner_terms_audit_immutable();

alter table public.partner_terms enable row level security;
alter table public.partner_terms_audit_log enable row level security;

revoke all on public.partner_terms, public.partner_terms_audit_log from public, anon, authenticated;
revoke all on public.partner_terms, public.partner_terms_audit_log from service_role;
grant select, insert, update, delete on public.partner_terms to service_role;
grant select, insert on public.partner_terms_audit_log to service_role;
grant usage, select on sequence public.partner_terms_audit_log_id_seq to service_role;

comment on table public.partner_terms is
  'Current administrator-managed commission terms and custom agreement for one approved N3XRA partner.';

comment on table public.partner_terms_audit_log is
  'Immutable before/after history for every partner commission or contract change.';
