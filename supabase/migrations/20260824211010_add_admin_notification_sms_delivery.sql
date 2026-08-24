alter table public.admin_notifications
  add column if not exists sms_delivery_status text not null default 'pending',
  add column if not exists sms_delivery_attempts integer not null default 0,
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_provider_id text,
  add column if not exists sms_delivery_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_notifications_sms_delivery_status_check'
      and conrelid = 'public.admin_notifications'::regclass
  ) then
    alter table public.admin_notifications
      add constraint admin_notifications_sms_delivery_status_check
      check (sms_delivery_status in ('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_notifications_sms_delivery_attempts_check'
      and conrelid = 'public.admin_notifications'::regclass
  ) then
    alter table public.admin_notifications
      add constraint admin_notifications_sms_delivery_attempts_check
      check (sms_delivery_attempts between 0 and 3);
  end if;
end $$;

create index if not exists admin_notifications_sms_delivery_idx
  on public.admin_notifications (sms_delivery_status, created_at)
  where sms_delivery_status in ('pending', 'queued', 'sending', 'failed', 'unconfigured');

drop trigger if exists queue_admin_notification_email on public.admin_notifications;
drop trigger if exists queue_admin_notification_delivery on public.admin_notifications;

create or replace function private.queue_admin_notification_delivery()
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
        email_delivery_error = 'Notification delivery webhook is not configured.',
        sms_delivery_status = 'unconfigured',
        sms_delivery_error = 'Notification delivery webhook is not configured.'
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
      email_webhook_request_id = request_id,
      sms_delivery_status = 'queued',
      sms_delivery_error = null
  where id = new.id;

  return new;
exception
  when others then
    update public.admin_notifications
    set email_delivery_status = 'failed',
        email_delivery_error = left(sqlerrm, 2000),
        sms_delivery_status = 'failed',
        sms_delivery_error = left(sqlerrm, 2000)
    where id = new.id;
    return new;
end;
$$;

revoke all on function private.queue_admin_notification_delivery() from public, anon, authenticated;

create trigger queue_admin_notification_delivery
after insert on public.admin_notifications
for each row execute function private.queue_admin_notification_delivery();

create or replace function public.claim_admin_notification_delivery(input_notification_id uuid)
returns setof public.admin_notifications
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.admin_notifications
  set email_delivery_status = case
        when email_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and email_delivery_attempts < 3 then 'sending'
        else email_delivery_status
      end,
      email_delivery_attempts = case
        when email_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and email_delivery_attempts < 3 then email_delivery_attempts + 1
        else email_delivery_attempts
      end,
      email_delivery_error = case
        when email_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and email_delivery_attempts < 3 then null
        else email_delivery_error
      end,
      sms_delivery_status = case
        when sms_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and sms_delivery_attempts < 3 then 'sending'
        else sms_delivery_status
      end,
      sms_delivery_attempts = case
        when sms_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and sms_delivery_attempts < 3 then sms_delivery_attempts + 1
        else sms_delivery_attempts
      end,
      sms_delivery_error = case
        when sms_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and sms_delivery_attempts < 3 then null
        else sms_delivery_error
      end
  where id = input_notification_id
    and (
      (email_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and email_delivery_attempts < 3)
      or (sms_delivery_status in ('pending', 'queued', 'failed', 'unconfigured') and sms_delivery_attempts < 3)
    )
  returning *;
$$;

revoke all on function public.claim_admin_notification_delivery(uuid) from public, anon, authenticated;
grant execute on function public.claim_admin_notification_delivery(uuid) to service_role;

drop function if exists private.queue_admin_notification_email();
