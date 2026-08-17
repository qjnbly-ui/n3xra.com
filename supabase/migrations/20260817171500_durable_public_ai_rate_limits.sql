create table if not exists private.public_ai_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash),
  constraint public_ai_rate_limits_scope_check check (scope ~ '^[a-z0-9_-]{2,40}$'),
  constraint public_ai_rate_limits_key_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint public_ai_rate_limits_request_count_check check (request_count >= 0)
);

create index if not exists public_ai_rate_limits_updated_at_idx
  on private.public_ai_rate_limits (updated_at);

revoke all on private.public_ai_rate_limits from public, anon, authenticated;

create or replace function public.consume_public_ai_rate_limit(
  input_scope text,
  input_key_hash text,
  input_limit integer,
  input_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_count integer;
  now_at timestamptz := clock_timestamp();
begin
  if input_scope !~ '^[a-z0-9_-]{2,40}$'
    or input_key_hash !~ '^[a-f0-9]{64}$'
    or input_limit < 1 or input_limit > 100
    or input_window_seconds < 60 or input_window_seconds > 86400 then
    raise exception 'Invalid public AI rate limit input';
  end if;

  insert into private.public_ai_rate_limits as limits (
    scope, key_hash, window_started_at, request_count, updated_at
  ) values (
    input_scope, input_key_hash, now_at, 1, now_at
  )
  on conflict (scope, key_hash) do update
  set
    window_started_at = case
      when limits.window_started_at <= now_at - make_interval(secs => input_window_seconds) then now_at
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now_at - make_interval(secs => input_window_seconds) then 1
      else limits.request_count + 1
    end,
    updated_at = now_at
  returning request_count into current_count;

  return current_count <= input_limit;
end;
$$;

revoke all on function public.consume_public_ai_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_ai_rate_limit(text, text, integer, integer) to service_role;
