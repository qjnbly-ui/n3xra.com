-- Owner-only background repair jobs. The trusted worker enforces ownership.
create table public.ai_repair_workspaces (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.ai_conversation_repairs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid references public.ai_phone_conversations(id) on delete set null,
 workspace_id uuid not null references public.ai_repair_workspaces(id),
 repository text not null default 'qjnbly-ui/n3xra.com' check(repository = 'qjnbly-ui/n3xra.com'),
 model text not null check(model in ('gpt-5.6-sol','gpt-6-astra')),
 state text not null default 'queued' check(state in ('queued','analyzing','testing','publishing','verifying','completed','stopped','failed')),
 attempt integer not null default 0 check(attempt between 0 and 3),
 tokens bigint not null default 0 check(tokens >= 0),
 created_at timestamptz not null default now(),
 deadline timestamptz not null default (now() + interval '30 minutes'),
 finished_at timestamptz,
 branch text not null,
 base_commit text,
 published_commit text,
 thread_id text,
 report jsonb not null default '{}',
 updates jsonb not null default '[]',
 expires_at timestamptz not null default (now() + interval '30 days')
);
create unique index ai_repairs_one_active_repo on public.ai_conversation_repairs(repository) where state in ('queued','analyzing','testing','publishing','verifying');
create index ai_repairs_owner_created on public.ai_conversation_repairs(user_id,created_at desc);
create index ai_repairs_conversation on public.ai_conversation_repairs(conversation_id,created_at desc);
alter table public.ai_repair_workspaces enable row level security;
alter table public.ai_conversation_repairs enable row level security;
revoke all on public.ai_repair_workspaces, public.ai_conversation_repairs from public,anon,authenticated;
grant select,insert,update,delete on public.ai_repair_workspaces,public.ai_conversation_repairs to service_role;
