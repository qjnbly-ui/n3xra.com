-- Client-created Communications broadcasts and per-recipient delivery claims.
-- Provider credentials and message bodies remain in trusted server code.

create table public.communications_broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  idempotency_key uuid not null,
  payload_hash text not null,
  topic_id uuid references public.communications_topics (id) on delete set null,
  channels text[] not null,
  subject text,
  body_preview text not null,
  status text not null default 'preparing',
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key),
  constraint communications_broadcasts_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint communications_broadcasts_channels_check check (
    cardinality(channels) between 1 and 2
    and channels <@ array['sms', 'email']::text[]
  ),
  constraint communications_broadcasts_subject_check check (subject is null or length(subject) between 1 and 300),
  constraint communications_broadcasts_preview_check check (length(body_preview) between 1 and 500),
  constraint communications_broadcasts_status_check check (status in ('preparing', 'sending', 'completed', 'partial', 'failed')),
  constraint communications_broadcasts_counts_check check (
    recipient_count >= 0 and sent_count >= 0 and failed_count >= 0
    and sent_count + failed_count <= recipient_count
  )
);

create table public.communications_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.communications_broadcasts (id) on delete cascade,
  subscriber_id uuid references public.communications_subscribers (id) on delete set null,
  channel text not null,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  unique (broadcast_id, subscriber_id, channel),
  constraint communications_broadcast_recipients_channel_check check (channel in ('sms', 'email')),
  constraint communications_broadcast_recipients_status_check check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint communications_broadcast_recipients_error_check check (error_message is null or length(error_message) <= 1000)
);

create index communications_broadcasts_workspace_created_idx
  on public.communications_broadcasts (workspace_id, created_at desc);
create index communications_broadcast_recipients_delivery_idx
  on public.communications_broadcast_recipients (broadcast_id, status, created_at);

alter table public.communications_broadcasts enable row level security;
alter table public.communications_broadcast_recipients enable row level security;

revoke all on table public.communications_broadcasts from public, anon, authenticated;
revoke all on table public.communications_broadcast_recipients from public, anon, authenticated;
grant all on table public.communications_broadcasts to service_role;
grant all on table public.communications_broadcast_recipients to service_role;

comment on table public.communications_broadcasts is
  'Server-only client broadcast state, authorization actor, audience scope, and aggregate delivery outcome.';
comment on table public.communications_broadcast_recipients is
  'Server-only idempotent per-subscriber delivery claims for client Communications broadcasts.';
