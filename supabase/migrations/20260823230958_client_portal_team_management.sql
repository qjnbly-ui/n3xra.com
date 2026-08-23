alter table public.organization_invites
  add column if not exists last_sent_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users (id) on delete set null;

create index if not exists organization_invites_team_status_idx
  on public.organization_invites (organization_id, created_at desc)
  where recipient_email is not null;

create or replace function public.client_portal_team_snapshot(input_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  organization_record public.organizations%rowtype;
begin
  if auth.uid() is null or not public.can_view_organization(input_organization_id) then
    raise exception 'You do not have access to this organization.';
  end if;

  select * into organization_record
  from public.organizations
  where id = input_organization_id;

  if organization_record.id is null then
    raise exception 'Organization not found.';
  end if;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization_record.id,
      'name', organization_record.name,
      'owner_user_id', organization_record.owner_user_id
    ),
    'can_manage', public.can_manage_members(input_organization_id),
    'current_user_id', auth.uid(),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.id,
        'user_id', membership.user_id,
        'role', membership.role,
        'created_at', membership.created_at,
        'full_name', coalesce(nullif(trim(profile.full_name), ''), split_part(coalesce(profile.email, ''), '@', 1)),
        'email', profile.email,
        'is_owner', membership.user_id = organization_record.owner_user_id
      ) order by (membership.user_id = organization_record.owner_user_id) desc, membership.created_at)
      from public.organization_memberships membership
      left join public.profiles profile on profile.id = membership.user_id
      where membership.organization_id = input_organization_id
    ), '[]'::jsonb),
    'invites', case when public.can_manage_members(input_organization_id) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invite.id,
        'code', invite.code,
        'recipient_email', invite.recipient_email,
        'recipient_name', invite.recipient_name,
        'role', invite.role,
        'created_at', invite.created_at,
        'expires_at', invite.expires_at,
        'last_sent_at', invite.last_sent_at,
        'revoked_at', invite.revoked_at,
        'is_disabled', invite.is_disabled,
        'redeemed_uses', invite.redeemed_uses,
        'max_uses', invite.max_uses
      ) order by invite.created_at desc)
      from public.organization_invites invite
      where invite.organization_id = input_organization_id
        and invite.recipient_email is not null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.client_portal_create_team_invite(
  input_organization_id uuid,
  input_recipient_email text,
  input_recipient_name text default null,
  input_role text default 'viewer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(input_recipient_email, '')));
  normalized_name text := nullif(trim(coalesce(input_recipient_name, '')), '');
  invite_record public.organization_invites%rowtype;
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Only an account administrator can invite team members.';
  end if;
  if input_role not in ('account_admin', 'editor', 'viewer') then
    raise exception 'Choose a valid team role.';
  end if;
  if normalized_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if exists (
    select 1 from public.organization_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.organization_id = input_organization_id
      and lower(trim(coalesce(profile.email, ''))) = normalized_email
  ) then
    raise exception 'That person already has access to this account.';
  end if;

  select * into invite_record
  from public.organization_invites
  where organization_id = input_organization_id
    and lower(trim(recipient_email)) = normalized_email
    and redeemed_uses < max_uses
  order by created_at desc
  limit 1
  for update;

  if invite_record.id is null then
    insert into public.organization_invites (
      organization_id, code, role, max_uses, redeemed_uses, expires_at,
      is_disabled, created_by, recipient_email, recipient_name, last_sent_at,
      revoked_at, revoked_by
    ) values (
      input_organization_id,
      upper(encode(extensions.gen_random_bytes(8), 'hex')),
      input_role,
      1,
      0,
      now() + interval '7 days',
      false,
      auth.uid(),
      normalized_email,
      normalized_name,
      now(),
      null,
      null
    ) returning * into invite_record;
  else
    update public.organization_invites
    set code = upper(encode(extensions.gen_random_bytes(8), 'hex')),
        role = input_role,
        recipient_name = normalized_name,
        expires_at = now() + interval '7 days',
        is_disabled = false,
        last_sent_at = now(),
        revoked_at = null,
        revoked_by = null
    where id = invite_record.id
    returning * into invite_record;
  end if;

  return jsonb_build_object(
    'id', invite_record.id,
    'code', invite_record.code,
    'recipient_email', invite_record.recipient_email,
    'recipient_name', invite_record.recipient_name,
    'role', invite_record.role,
    'expires_at', invite_record.expires_at
  );
end;
$$;

create or replace function public.client_portal_resend_team_invite(input_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare invite_record public.organization_invites%rowtype;
begin
  select * into invite_record from public.organization_invites where id = input_invite_id for update;
  if invite_record.id is null or not public.can_manage_members(invite_record.organization_id) then
    raise exception 'Invitation not found.';
  end if;
  if invite_record.recipient_email is null or invite_record.redeemed_uses >= invite_record.max_uses then
    raise exception 'This invitation can no longer be sent.';
  end if;

  update public.organization_invites
  set code = upper(encode(extensions.gen_random_bytes(8), 'hex')),
      expires_at = now() + interval '7 days',
      is_disabled = false,
      last_sent_at = now(),
      revoked_at = null,
      revoked_by = null
  where id = input_invite_id
  returning * into invite_record;

  return jsonb_build_object(
    'id', invite_record.id,
    'code', invite_record.code,
    'recipient_email', invite_record.recipient_email,
    'recipient_name', invite_record.recipient_name,
    'role', invite_record.role,
    'expires_at', invite_record.expires_at
  );
end;
$$;

create or replace function public.client_portal_revoke_team_invite(input_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id from public.organization_invites where id = input_invite_id;
  if target_organization_id is null or not public.can_manage_members(target_organization_id) then
    raise exception 'Invitation not found.';
  end if;
  update public.organization_invites
  set is_disabled = true, revoked_at = now(), revoked_by = auth.uid()
  where id = input_invite_id and redeemed_uses < max_uses;
end;
$$;

create or replace function public.client_portal_update_team_member(input_membership_id uuid, input_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
  owner_user_id uuid;
  website_role text;
begin
  select * into membership_record from public.organization_memberships where id = input_membership_id for update;
  if membership_record.id is null or not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Team member not found.';
  end if;
  if input_role not in ('account_admin', 'editor', 'viewer') then raise exception 'Choose a valid team role.'; end if;
  select organization.owner_user_id into owner_user_id from public.organizations organization where id = membership_record.organization_id;
  if membership_record.user_id = owner_user_id then raise exception 'The account owner role cannot be changed.'; end if;
  if membership_record.user_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;

  update public.organization_memberships set role = input_role, updated_at = now() where id = input_membership_id;
  website_role := case input_role when 'account_admin' then 'owner' when 'editor' then 'editor' else 'viewer' end;
  insert into public.website_members (website_id, user_id, role, status, invited_by_user_id)
  select website.id, membership_record.user_id, website_role, 'active', auth.uid()
  from public.client_websites website
  where website.organization_id = membership_record.organization_id
  on conflict (website_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now();
end;
$$;

create or replace function public.client_portal_remove_team_member(input_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
  owner_user_id uuid;
begin
  select * into membership_record from public.organization_memberships where id = input_membership_id for update;
  if membership_record.id is null or not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Team member not found.';
  end if;
  select organization.owner_user_id into owner_user_id from public.organizations organization where id = membership_record.organization_id;
  if membership_record.user_id = owner_user_id then raise exception 'The account owner cannot be removed.'; end if;
  if membership_record.user_id = auth.uid() then raise exception 'You cannot remove your own access.'; end if;

  update public.website_members member
  set status = 'revoked', updated_at = now()
  from public.client_websites website
  where member.website_id = website.id
    and website.organization_id = membership_record.organization_id
    and member.user_id = membership_record.user_id;
  delete from public.organization_memberships where id = input_membership_id;
end;
$$;

create or replace function public.redeem_invite_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  invite_record public.organization_invites%rowtype;
  next_member_count integer;
  target_user_limit integer;
  mapped_website_role text;
begin
  if current_user_id is null then raise exception 'Authentication required.'; end if;
  select lower(trim(coalesce(profile.email, auth.jwt() ->> 'email', ''))) into current_user_email
  from (select 1) seed left join public.profiles profile on profile.id = current_user_id;

  select * into invite_record from public.organization_invites
  where lower(code) = lower(trim(input_code)) order by created_at desc limit 1 for update;
  if invite_record.id is null then raise exception 'Invite code is invalid.'; end if;
  if invite_record.recipient_email is not null
    and lower(trim(invite_record.recipient_email)) <> current_user_email then
    raise exception 'This invitation was sent to a different email address.';
  end if;
  if invite_record.is_disabled = true
    or (invite_record.expires_at is not null and invite_record.expires_at <= now())
    or invite_record.redeemed_uses >= invite_record.max_uses then
    raise exception 'Invite code is invalid or expired.';
  end if;

  if not exists (select 1 from public.organization_memberships where organization_id = invite_record.organization_id and user_id = current_user_id) then
    select count(*), max(organization.user_limit) into next_member_count, target_user_limit
    from public.organization_memberships membership
    join public.organizations organization on organization.id = invite_record.organization_id
    where membership.organization_id = invite_record.organization_id;
    if coalesce(next_member_count, 0) >= coalesce(target_user_limit, 0) then raise exception 'This account has reached its user limit.'; end if;
    insert into public.organization_memberships (organization_id, user_id, role, created_by)
    values (invite_record.organization_id, current_user_id, invite_record.role, invite_record.created_by);
  end if;

  mapped_website_role := case invite_record.role when 'account_admin' then 'owner' when 'editor' then 'editor' else 'viewer' end;
  insert into public.website_members (website_id, user_id, role, status, invited_by_user_id)
  select website.id, current_user_id, mapped_website_role, 'active', invite_record.created_by
  from public.client_websites website where website.organization_id = invite_record.organization_id
  on conflict (website_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now();

  if invite_record.redeemed_uses < invite_record.max_uses then
    update public.organization_invites set redeemed_uses = redeemed_uses + 1 where id = invite_record.id;
  end if;
  update public.organization_contacts set linked_user_id = current_user_id
  where organization_id = invite_record.organization_id and current_user_email <> ''
    and lower(trim(email)) = current_user_email and linked_user_id is distinct from current_user_id;
  return jsonb_build_object('ok', true, 'organization_id', invite_record.organization_id);
end;
$$;

revoke all on function public.client_portal_team_snapshot(uuid) from public, anon;
revoke all on function public.client_portal_create_team_invite(uuid, text, text, text) from public, anon;
revoke all on function public.client_portal_resend_team_invite(uuid) from public, anon;
revoke all on function public.client_portal_revoke_team_invite(uuid) from public, anon;
revoke all on function public.client_portal_update_team_member(uuid, text) from public, anon;
revoke all on function public.client_portal_remove_team_member(uuid) from public, anon;
grant execute on function public.client_portal_team_snapshot(uuid) to authenticated;
grant execute on function public.client_portal_create_team_invite(uuid, text, text, text) to authenticated;
grant execute on function public.client_portal_resend_team_invite(uuid) to authenticated;
grant execute on function public.client_portal_revoke_team_invite(uuid) to authenticated;
grant execute on function public.client_portal_update_team_member(uuid, text) to authenticated;
grant execute on function public.client_portal_remove_team_member(uuid) to authenticated;
revoke execute on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
