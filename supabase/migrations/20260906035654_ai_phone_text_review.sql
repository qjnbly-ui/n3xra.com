-- Text already used by the verified owner phone-building pilot; no audio or provider requests.
create table public.ai_phone_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  website_id uuid not null references public.client_websites(id) on delete cascade,
  call_id text not null check (call_id ~ '^CA[0-9a-fA-F]{32}$'),
  configured_model text not null,
  rules_version text not null,
  instruction_version uuid,
  created_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  status text not null default 'open' check (status in ('open','closed','incomplete')),
  dropped_events integer not null default 0 check (dropped_events >= 0),
  review_note text not null default '' check (length(review_note) <= 3000),
  applied_instruction text,
  applied_effect text,
  applied_at timestamptz
);
create index ai_phone_conversations_owner_recent on public.ai_phone_conversations(user_id,created_at desc);
create index ai_phone_conversations_website on public.ai_phone_conversations(website_id);
create index ai_phone_conversations_expiry on public.ai_phone_conversations(expires_at);
create index website_build_events_phone_call on public.website_build_events(actor_user_id,(metadata->>'callId'),id)
  where event_type='user_message' and metadata->>'callId' is not null;
create table public.ai_phone_events (
  id uuid primary key,
  conversation_id uuid not null references public.ai_phone_conversations(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  kind text not null check (kind in ('caller','caller_ignored','nex_sent','interrupt','notice')),
  text text not null check (length(text) <= 8000),
  created_at timestamptz not null,
  unique(conversation_id,sequence)
);
create table public.ai_phone_instructions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  instruction text not null default '' check (length(instruction) <= 1500),
  expected_effect text not null default '' check (length(expected_effect) <= 1000),
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
-- No browser role may read or mutate these tables directly, including other admins.
-- The server authenticates an active platform owner and scopes every request to that owner.
alter table public.ai_phone_conversations enable row level security;
alter table public.ai_phone_events enable row level security;
alter table public.ai_phone_instructions enable row level security;
revoke all on public.ai_phone_conversations, public.ai_phone_events, public.ai_phone_instructions from public, anon, authenticated;
grant select, insert, update, delete on public.ai_phone_conversations, public.ai_phone_events, public.ai_phone_instructions to service_role;

create function public.apply_ai_phone_instruction(p_user_id uuid, p_conversation_id uuid,
  p_expected_version uuid, p_instruction text, p_effect text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare current_version uuid; result jsonb;
begin
  -- Lock the owner row to serialize initial creation and concurrent approvals.
  perform 1 from public.platform_admins where user_id=p_user_id and role='owner' and status='active' for update;
  if not found then raise exception 'Owner required'; end if;
  perform 1 from public.ai_phone_conversations where id=p_conversation_id and user_id=p_user_id and expires_at>now() for update;
  if not found then raise exception 'Conversation unavailable'; end if;
  select version into current_version from public.ai_phone_instructions where user_id=p_user_id;
  if current_version is distinct from p_expected_version then return null; end if;
  if length(trim(p_effect))=0 then raise exception 'Expected effect required'; end if;
  insert into public.ai_phone_instructions(user_id,instruction,expected_effect)
    values(p_user_id,p_instruction,p_effect)
    on conflict(user_id) do update set instruction=excluded.instruction, expected_effect=excluded.expected_effect,
      version=gen_random_uuid(), updated_at=now();
  update public.ai_phone_conversations set applied_instruction=p_instruction, applied_effect=p_effect, applied_at=now()
    where id=p_conversation_id;
  select to_jsonb(i) into result from public.ai_phone_instructions i where user_id=p_user_id;
  return result;
end;
$$;
revoke all on function public.apply_ai_phone_instruction(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.apply_ai_phone_instruction(uuid,uuid,uuid,text,text) to service_role;
