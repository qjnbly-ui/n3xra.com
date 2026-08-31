create table public.partner_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  partner_application_id uuid not null,
  stage text not null,
  recipient_email text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'prepared',
  provider text not null default 'resend',
  provider_message_id text,
  idempotency_key uuid not null unique,
  error_message text,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_email_stage_check check (stage in ('approval', 'contract_ready', 'portal_ready', 'follow_up')),
  constraint partner_email_recipient_check check (recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint partner_email_subject_check check (length(trim(subject)) between 1 and 240),
  constraint partner_email_body_check check (length(trim(body_text)) between 1 and 20000),
  constraint partner_email_status_check check (status in ('prepared', 'sent', 'failed')),
  constraint partner_email_provider_check check (provider = 'resend'),
  constraint partner_email_sent_state_check check (
    (status = 'sent' and sent_at is not null and provider_message_id is not null)
    or status <> 'sent'
  )
);

create index partner_email_deliveries_partner_created_idx
on public.partner_email_deliveries(partner_application_id, created_at desc);

create index partner_email_deliveries_stage_created_idx
on public.partner_email_deliveries(partner_application_id, stage, created_at desc);

create or replace function public.protect_sent_partner_email_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Partner email delivery history cannot be deleted.';
  end if;
  if old.status = 'sent' then
    raise exception 'Sent partner email delivery records are immutable.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.protect_sent_partner_email_delivery() from public, anon, authenticated;

create trigger protect_sent_partner_email_delivery
before update or delete on public.partner_email_deliveries
for each row execute function public.protect_sent_partner_email_delivery();

alter table public.partner_email_deliveries enable row level security;

revoke all on public.partner_email_deliveries from public, anon, authenticated;
revoke all on public.partner_email_deliveries from service_role;
grant select, insert, update on public.partner_email_deliveries to service_role;

comment on table public.partner_email_deliveries is
  'Audited staged partner email delivery history. Sent content survives application deletion, is immutable, and browser roles have no direct access.';
