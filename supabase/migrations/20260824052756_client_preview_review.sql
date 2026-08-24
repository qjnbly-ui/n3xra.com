create table public.website_change_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.platform_support_requests (id) on delete cascade,
  website_id uuid not null references public.client_websites (id) on delete cascade,
  requested_by_user_id uuid not null references auth.users (id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 3),
  state text not null default 'queued' check (state in ('queued','coding','preview_ready','client_ready','changes_requested','merge_queued','merged','failed')),
  branch_name text not null check (branch_name ~ '^n3xra/change-[a-z0-9-]{8,80}$'),
  head_sha text check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$'),
  preview_url text check (preview_url is null or preview_url ~ '^https://[^/[:space:]]+[.]vercel[.]app/?$'),
  callback_token_hash text not null check (callback_token_hash ~ '^[0-9a-f]{64}$'),
  callback_expires_at timestamptz not null,
  client_review_note text check (client_review_note is null or char_length(btrim(client_review_note)) between 1 and 2000),
  error_message text check (error_message is null or char_length(btrim(error_message)) between 1 and 2000),
  approved_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  preview_ready_at timestamptz, client_reviewed_at timestamptz, approved_at timestamptz, merged_at timestamptz,
  unique (request_id, attempt_number), unique (request_id, branch_name)
);
create unique index website_change_runs_one_active_idx on public.website_change_runs (request_id) where state in ('queued','coding','preview_ready','client_ready','merge_queued');
create index website_change_runs_website_month_idx on public.website_change_runs (website_id, created_at desc);
create index website_change_runs_request_created_idx on public.website_change_runs (request_id, created_at desc);
alter table public.website_change_runs enable row level security;
revoke all on public.website_change_runs from public, anon, authenticated;
grant select (id,request_id,website_id,attempt_number,state,branch_name,head_sha,preview_url,client_review_note,error_message,created_at,updated_at,preview_ready_at,client_reviewed_at,approved_at,merged_at) on public.website_change_runs to authenticated;
grant all on public.website_change_runs to service_role;
create policy website_change_runs_client_select on public.website_change_runs for select to authenticated using (exists (select 1 from public.platform_support_requests request where request.id = request_id and request.client_visible = true and (request.requester_user_id = (select auth.uid()) or public.can_view_client_website(request.website_id))));

create or replace function public.claim_website_change_run(input_request_id uuid,input_actor_user_id uuid,input_callback_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request_record public.platform_support_requests%rowtype; website_record public.client_websites%rowtype; existing_record public.website_change_runs%rowtype; attempt_count integer; monthly_count integer; created_run public.website_change_runs%rowtype; branch text;
begin
  if input_actor_user_id is null or input_callback_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid change-run claim.'; end if;
  select * into request_record from public.platform_support_requests where id = input_request_id for update;
  if request_record.id is null or request_record.intake_mode <> 'ai_assisted' or request_record.website_id is null then raise exception 'AI-assisted website request not found.'; end if;
  if request_record.requester_user_id <> input_actor_user_id and not public.can_view_client_website(request_record.website_id) then raise exception 'This request is not available to this account.'; end if;
  select * into website_record from public.client_websites where id = request_record.website_id;
  if website_record.repository_full_name is null or website_record.status = 'archived' then raise exception 'This website is not ready for automated changes.'; end if;
  select * into existing_record from public.website_change_runs where request_id = input_request_id and state in ('queued','coding','preview_ready','client_ready','merge_queued') order by created_at desc limit 1;
  if existing_record.id is not null then return to_jsonb(existing_record) || jsonb_build_object('acquired', false); end if;
  select count(*) into attempt_count from public.website_change_runs where request_id = input_request_id;
  if attempt_count >= 3 then raise exception 'This request has reached its three-preview safety limit.'; end if;
  select count(*) into monthly_count from public.website_change_runs where website_id = request_record.website_id and created_at >= date_trunc('month', now());
  if monthly_count >= 10 then raise exception 'This website has reached its monthly preview safety limit.'; end if;
  if exists (select 1 from public.website_change_runs where request_id = input_request_id and created_at > now() - interval '10 minutes') then raise exception 'Please wait ten minutes before starting another preview.'; end if;
  branch := 'n3xra/change-' || replace(left(input_request_id::text, 8), '-', '') || '-r' || (attempt_count + 1)::text;
  insert into public.website_change_runs (request_id,website_id,requested_by_user_id,attempt_number,state,branch_name,callback_token_hash,callback_expires_at) values (input_request_id,request_record.website_id,input_actor_user_id,attempt_count + 1,'queued',branch,input_callback_token_hash,now() + interval '30 minutes') returning * into created_run;
  update public.platform_support_requests set automation_status = 'queued', updated_at = now() where id = input_request_id;
  return to_jsonb(created_run) || jsonb_build_object('acquired', true, 'repository_full_name', website_record.repository_full_name);
end; $$;
revoke all on function public.claim_website_change_run(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_website_change_run(uuid,uuid,text) to service_role;
comment on table public.website_change_runs is 'Quota-limited Codex branch and Vercel preview runs. Only a platform administrator may merge a reviewed branch to main.';
