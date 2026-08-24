create extension if not exists pg_net with schema extensions;

alter table public.admin_notifications
  add column if not exists email_delivery_status text not null default 'pending',
  add column if not exists email_delivery_attempts integer not null default 0,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_provider_id text,
  add column if not exists email_delivery_error text,
  add column if not exists email_webhook_request_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_notifications_email_delivery_status_check'
      and conrelid = 'public.admin_notifications'::regclass
  ) then
    alter table public.admin_notifications
      add constraint admin_notifications_email_delivery_status_check
      check (email_delivery_status in ('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_notifications_email_delivery_attempts_check'
      and conrelid = 'public.admin_notifications'::regclass
  ) then
    alter table public.admin_notifications
      add constraint admin_notifications_email_delivery_attempts_check
      check (email_delivery_attempts between 0 and 3);
  end if;
end $$;

create index if not exists admin_notifications_email_delivery_idx
  on public.admin_notifications (email_delivery_status, created_at)
  where email_delivery_status in ('pending', 'queued', 'sending', 'failed', 'unconfigured');

create or replace function private.queue_admin_notification_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  webhook_url text;
  webhook_token text;
  request_id bigint;
begin
  select decrypted_secret into webhook_url
  from vault.decrypted_secrets
  where name = 'admin_notification_email_webhook_url'
  limit 1;

  select decrypted_secret into webhook_token
  from vault.decrypted_secrets
  where name = 'admin_notification_email_webhook_token'
  limit 1;

  if coalesce(webhook_url, '') = '' or coalesce(webhook_token, '') = '' then
    update public.admin_notifications
    set email_delivery_status = 'unconfigured',
        email_delivery_error = 'Notification email webhook is not configured.'
    where id = new.id;
    return new;
  end if;

  select net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-n3xra-webhook-token', webhook_token
    ),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 10000
  ) into request_id;

  update public.admin_notifications
  set email_delivery_status = 'queued',
      email_delivery_error = null,
      email_webhook_request_id = request_id
  where id = new.id;

  return new;
exception
  when others then
    update public.admin_notifications
    set email_delivery_status = 'failed',
        email_delivery_error = left(sqlerrm, 2000)
    where id = new.id;
    return new;
end;
$$;

revoke all on function private.queue_admin_notification_email() from public, anon, authenticated;

drop trigger if exists queue_admin_notification_email on public.admin_notifications;
create trigger queue_admin_notification_email
after insert on public.admin_notifications
for each row execute function private.queue_admin_notification_email();

create or replace function public.claim_admin_notification_email(input_notification_id uuid)
returns setof public.admin_notifications
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.admin_notifications
  set email_delivery_status = 'sending',
      email_delivery_attempts = email_delivery_attempts + 1,
      email_delivery_error = null
  where id = input_notification_id
    and email_delivery_status in ('pending', 'queued', 'failed', 'unconfigured')
    and email_delivery_attempts < 3
  returning *;
$$;

revoke all on function public.claim_admin_notification_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_admin_notification_email(uuid) to service_role;
