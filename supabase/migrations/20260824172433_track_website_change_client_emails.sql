alter table public.website_change_runs
  add column if not exists preview_email_sent_at timestamptz,
  add column if not exists published_email_sent_at timestamptz,
  add column if not exists client_email_delivery_error text;

comment on column public.website_change_runs.preview_email_sent_at is
  'When the requester was emailed that the private preview was ready.';

comment on column public.website_change_runs.published_email_sent_at is
  'When the requester was emailed that the approved website change was published.';

comment on column public.website_change_runs.client_email_delivery_error is
  'Most recent non-fatal requester email delivery error for this change run.';

grant select (
  preview_email_sent_at,
  published_email_sent_at,
  client_email_delivery_error
) on public.website_change_runs to authenticated;
