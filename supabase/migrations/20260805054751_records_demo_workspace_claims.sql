create table if not exists public.records_demo_workspace_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code_hash text not null unique,
  code_last_four text not null,
  recipient_email text,
  status text not null default 'pending',
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint records_demo_workspace_claims_status_check
    check (status in ('pending', 'claimed', 'revoked', 'expired')),
  constraint records_demo_workspace_claims_email_check
    check (
      recipient_email is null
      or recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    ),
  constraint records_demo_workspace_claims_code_last_four_check
    check (length(code_last_four) = 4)
);

create index if not exists records_demo_workspace_claims_status_created_idx
  on public.records_demo_workspace_claims (status, created_at desc);

alter table public.records_demo_workspace_claims enable row level security;

revoke all on table public.records_demo_workspace_claims from anon, authenticated;
grant all on table public.records_demo_workspace_claims to service_role;

create schema if not exists private;

create or replace function private.claim_records_demo_workspace(
  input_code_hash text,
  input_claimant_user_id uuid,
  input_claimant_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_record public.records_demo_workspace_claims%rowtype;
  organization_record public.organizations%rowtype;
  normalized_email text := lower(trim(coalesce(input_claimant_email, '')));
begin
  if input_claimant_user_id is null or nullif(trim(input_code_hash), '') is null then
    raise exception 'A valid claim code and account are required.';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = input_claimant_user_id
      and lower(trim(coalesce(email, ''))) = normalized_email
  ) then
    raise exception 'The signed-in account could not be verified.';
  end if;

  select *
  into claim_record
  from public.records_demo_workspace_claims
  where code_hash = trim(input_code_hash)
  for update;

  if claim_record.id is not null
    and claim_record.status = 'claimed'
    and claim_record.claimed_by_user_id = input_claimant_user_id then
    return jsonb_build_object(
      'ok', true,
      'already_claimed', true,
      'organization_id', claim_record.organization_id
    );
  end if;

  if claim_record.id is null or claim_record.status <> 'pending' then
    raise exception 'This demo claim code is invalid or has already been used.';
  end if;

  if claim_record.expires_at is not null and claim_record.expires_at <= now() then
    update public.records_demo_workspace_claims
    set status = 'expired', updated_at = now()
    where id = claim_record.id;
    return jsonb_build_object(
      'ok', false,
      'error', 'This demo claim code has expired.'
    );
  end if;

  if claim_record.recipient_email is not null
    and lower(trim(claim_record.recipient_email)) <> normalized_email then
    raise exception 'This demo workspace was prepared for a different email address.';
  end if;

  select *
  into organization_record
  from public.organizations
  where id = claim_record.organization_id
  for update;

  if organization_record.id is null
    or organization_record.owner_user_id <> claim_record.created_by_user_id then
    raise exception 'This demo workspace is no longer available to claim.';
  end if;

  delete from public.organization_memberships
  where organization_id = claim_record.organization_id
    and user_id = claim_record.created_by_user_id
    and user_id <> input_claimant_user_id;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    claim_record.organization_id,
    input_claimant_user_id,
    'account_admin',
    claim_record.created_by_user_id
  )
  on conflict (organization_id, user_id) do update
    set role = 'account_admin',
        updated_at = now();

  update public.organizations
  set owner_user_id = input_claimant_user_id,
      updated_at = now()
  where id = claim_record.organization_id;

  update public.records_demo_workspace_claims
  set status = 'claimed',
      claimed_by_user_id = input_claimant_user_id,
      claimed_at = now(),
      updated_at = now()
  where id = claim_record.id;

  return jsonb_build_object(
    'ok', true,
    'organization_id', claim_record.organization_id,
    'organization_name', organization_record.name
  );
end;
$$;

revoke all on function private.claim_records_demo_workspace(text, uuid, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.claim_records_demo_workspace(text, uuid, text) to service_role;

create or replace function public.claim_records_demo_workspace(
  input_code_hash text,
  input_claimant_user_id uuid,
  input_claimant_email text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_records_demo_workspace(
    input_code_hash,
    input_claimant_user_id,
    input_claimant_email
  );
$$;

revoke all on function public.claim_records_demo_workspace(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_records_demo_workspace(text, uuid, text) to service_role;;
