set lock_timeout = '5s';

alter table public.website_subscriptions
  add column if not exists subscription_type text not null default 'service';

alter table public.website_subscriptions
  drop constraint if exists website_subscriptions_project_id_key,
  drop constraint if exists website_subscriptions_snapshot_id_key;

alter table public.website_subscriptions
  drop constraint if exists website_subscriptions_subscription_type_check;

alter table public.website_subscriptions
  add constraint website_subscriptions_subscription_type_check
  check (subscription_type in ('service', 'domain'));

create unique index if not exists website_subscriptions_project_type_key
  on public.website_subscriptions (project_id, subscription_type);

create unique index if not exists website_subscriptions_snapshot_type_key
  on public.website_subscriptions (snapshot_id, subscription_type);
