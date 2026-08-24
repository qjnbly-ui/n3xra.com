create or replace function public.claim_website_change_run(
  input_request_id uuid,
  input_actor_user_id uuid,
  input_callback_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.platform_support_requests%rowtype;
  website_record public.client_websites%rowtype;
  existing_record public.website_change_runs%rowtype;
  attempt_count integer;
  monthly_count integer;
  created_run public.website_change_runs%rowtype;
  branch text;
  repository_name text;
begin
  if input_actor_user_id is null or input_callback_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid change-run claim.';
  end if;

  select * into request_record
  from public.platform_support_requests
  where id = input_request_id
  for update;

  if request_record.id is null or request_record.intake_mode <> 'ai_assisted' or request_record.website_id is null then
    raise exception 'AI-assisted website request not found.';
  end if;

  if not exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = input_actor_user_id
      and administrator.status = 'active'
  ) then
    raise exception 'Only an active N3XRA platform administrator can start an AI preview.';
  end if;

  select * into website_record
  from public.client_websites
  where id = request_record.website_id;

  select coalesce(
    website_record.repository_full_name,
    (
      select repository.full_name
      from public.website_repositories repository
      where repository.website_id = request_record.website_id
        and repository.provider = 'github'
        and repository.access_status <> 'transferred'
      order by repository.updated_at desc, repository.created_at desc
      limit 1
    )
  ) into repository_name;

  if repository_name is null or website_record.status = 'archived' then
    raise exception 'Connect an available GitHub repository before starting an AI preview.';
  end if;

  select * into existing_record
  from public.website_change_runs
  where request_id = input_request_id
    and state in ('queued','coding','preview_ready','client_ready','merge_queued')
  order by created_at desc
  limit 1;

  if existing_record.id is not null then
    return to_jsonb(existing_record) || jsonb_build_object('acquired', false);
  end if;

  select count(*) into attempt_count
  from public.website_change_runs
  where request_id = input_request_id;

  if attempt_count >= 3 then
    raise exception 'This request has reached its three-preview safety limit.';
  end if;

  select count(*) into monthly_count
  from public.website_change_runs
  where website_id = request_record.website_id
    and created_at >= date_trunc('month', now());

  if monthly_count >= 10 then
    raise exception 'This website has reached its monthly preview safety limit.';
  end if;

  if exists (
    select 1
    from public.website_change_runs
    where request_id = input_request_id
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Please wait ten minutes before starting another preview.';
  end if;

  branch := 'n3xra/change-' || replace(left(input_request_id::text, 8), '-', '') || '-r' || (attempt_count + 1)::text;

  insert into public.website_change_runs (
    request_id,
    website_id,
    requested_by_user_id,
    attempt_number,
    state,
    branch_name,
    callback_token_hash,
    callback_expires_at
  ) values (
    input_request_id,
    request_record.website_id,
    input_actor_user_id,
    attempt_count + 1,
    'queued',
    branch,
    input_callback_token_hash,
    now() + interval '30 minutes'
  ) returning * into created_run;

  update public.platform_support_requests
  set automation_status = 'queued', updated_at = now()
  where id = input_request_id;

  return to_jsonb(created_run) || jsonb_build_object(
    'acquired', true,
    'repository_full_name', repository_name
  );
end;
$$;

revoke all on function public.claim_website_change_run(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_website_change_run(uuid,uuid,text) to service_role;

comment on function public.claim_website_change_run(uuid,uuid,text) is
'Allows only an active platform administrator to authorize a quota-limited AI preview and resolves either the automation repository field or an existing connected GitHub repository record.';
