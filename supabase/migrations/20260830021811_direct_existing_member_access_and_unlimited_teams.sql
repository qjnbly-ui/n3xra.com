alter table public.organizations
  alter column user_limit set default 0;

comment on column public.organizations.user_limit is
  'Optional organization member cap. Zero means unlimited.';

update public.organizations
set user_limit = 0,
    updated_at = now()
where user_limit = 1;

create or replace function public.client_portal_apply_member_access(
  input_organization_id uuid,
  input_user_id uuid,
  input_role text,
  input_product_access jsonb,
  input_granted_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_id uuid;
  mapped_website_role text;
  member_email text;
begin
  insert into public.organization_memberships (
    organization_id, user_id, role, created_by
  ) values (
    input_organization_id, input_user_id, input_role, input_granted_by
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role, updated_at = now()
  returning id into membership_id;

  if input_product_access is null then
    insert into public.organization_product_member_access (
      organization_id, product_key, user_id, role, status, granted_by
    )
    select
      entitlement.organization_id,
      entitlement.product_key,
      input_user_id,
      input_role,
      'active',
      input_granted_by
    from public.organization_product_entitlements entitlement
    where entitlement.organization_id = input_organization_id
      and entitlement.portal_enabled
      and entitlement.status in ('trialing', 'active', 'past_due')
    on conflict (organization_id, product_key, user_id) do update
    set role = excluded.role,
        status = 'active',
        granted_by = excluded.granted_by,
        updated_at = now();

    mapped_website_role := case input_role
      when 'account_admin' then 'owner'
      when 'editor' then 'editor'
      else 'viewer'
    end;
    insert into public.website_members (
      website_id, user_id, role, status, invited_by_user_id
    )
    select website.id, input_user_id, mapped_website_role, 'active', input_granted_by
    from public.client_websites website
    where website.organization_id = input_organization_id
    on conflict (website_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        invited_by_user_id = excluded.invited_by_user_id,
        updated_at = now();
  else
    insert into public.organization_product_member_access (
      organization_id, product_key, user_id, role, status, granted_by
    )
    select
      input_organization_id,
      selection.key,
      input_user_id,
      selection.value,
      'active',
      input_granted_by
    from jsonb_each_text(input_product_access) selection
    join public.organization_product_entitlements entitlement
      on entitlement.organization_id = input_organization_id
     and entitlement.product_key = selection.key
     and entitlement.portal_enabled
     and entitlement.status in ('trialing', 'active', 'past_due')
    where selection.key not like 'website:%'
    on conflict (organization_id, product_key, user_id) do update
    set role = excluded.role,
        status = 'active',
        granted_by = excluded.granted_by,
        updated_at = now();

    insert into public.website_members (
      website_id, user_id, role, status, invited_by_user_id
    )
    select
      website.id,
      input_user_id,
      case selection.value
        when 'account_admin' then 'owner'
        when 'editor' then 'editor'
        else 'viewer'
      end,
      'active',
      input_granted_by
    from jsonb_each_text(input_product_access) selection
    join public.client_websites website
      on website.organization_id = input_organization_id
     and 'website:' || website.id::text = selection.key
    on conflict (website_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        invited_by_user_id = excluded.invited_by_user_id,
        updated_at = now();
  end if;

  select lower(trim(coalesce(profile.email, auth_user.email, '')))
  into member_email
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  where auth_user.id = input_user_id;

  update public.organization_contacts
  set linked_user_id = input_user_id
  where organization_id = input_organization_id
    and member_email <> ''
    and lower(trim(email)) = member_email
    and linked_user_id is distinct from input_user_id;

  return membership_id;
end;
$$;

revoke all on function public.client_portal_apply_member_access(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;

create or replace function public.client_portal_add_or_invite_team_member(
  input_organization_id uuid,
  input_recipient_email text,
  input_recipient_name text default null,
  input_role text default 'viewer',
  input_product_access jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(input_recipient_email, '')));
  normalized_name text := nullif(trim(coalesce(input_recipient_name, '')), '');
  existing_user_id uuid;
  existing_membership_id uuid;
  membership_id uuid;
  current_member_count integer;
  target_user_limit integer;
  invite_result jsonb;
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Only an account administrator can add team members.';
  end if;
  if input_role not in ('account_admin', 'editor', 'viewer') then
    raise exception 'Choose a valid organization role.';
  end if;
  if normalized_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if input_product_access is not null and jsonb_typeof(input_product_access) <> 'object' then
    raise exception 'Product access must be an object.';
  end if;
  if input_product_access is not null and exists (
    select 1
    from jsonb_each_text(input_product_access) selection
    where selection.value not in ('account_admin', 'editor', 'viewer')
      or not (
        exists (
          select 1
          from public.organization_product_entitlements entitlement
          where entitlement.organization_id = input_organization_id
            and entitlement.product_key = selection.key
            and entitlement.portal_enabled
            and entitlement.status in ('trialing', 'active', 'past_due')
        )
        or exists (
          select 1
          from public.client_websites website
          where website.organization_id = input_organization_id
            and 'website:' || website.id::text = selection.key
        )
      )
  ) then
    raise exception 'Choose valid access for connected products.';
  end if;

  select auth_user.id
  into existing_user_id
  from auth.users auth_user
  where lower(trim(coalesce(auth_user.email, ''))) = normalized_email
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
  order by auth_user.created_at
  limit 1;

  if existing_user_id is null then
    select public.client_portal_create_team_invite(
      input_organization_id,
      normalized_email,
      normalized_name,
      input_role,
      input_product_access
    ) into invite_result;
    return invite_result || jsonb_build_object('mode', 'invited');
  end if;

  select membership.id
  into existing_membership_id
  from public.organization_memberships membership
  where membership.organization_id = input_organization_id
    and membership.user_id = existing_user_id;

  if existing_membership_id is not null then
    return jsonb_build_object(
      'mode', 'already_member',
      'membership_id', existing_membership_id,
      'user_id', existing_user_id,
      'recipient_email', normalized_email
    );
  end if;

  select organization.user_limit,
         (select count(*) from public.organization_memberships membership
          where membership.organization_id = organization.id)
  into target_user_limit, current_member_count
  from public.organizations organization
  where organization.id = input_organization_id
  for update;

  if target_user_limit is null then
    raise exception 'Organization not found.';
  end if;
  if target_user_limit > 0 and current_member_count >= target_user_limit then
    raise exception 'This organization has reached its team limit.';
  end if;

  membership_id := public.client_portal_apply_member_access(
    input_organization_id,
    existing_user_id,
    input_role,
    input_product_access,
    auth.uid()
  );

  update public.organization_invites
  set redeemed_uses = max_uses,
      is_disabled = true,
      revoked_at = coalesce(revoked_at, now()),
      revoked_by = coalesce(revoked_by, auth.uid())
  where organization_id = input_organization_id
    and lower(trim(recipient_email)) = normalized_email
    and redeemed_uses < max_uses;

  return jsonb_build_object(
    'mode', 'added',
    'membership_id', membership_id,
    'user_id', existing_user_id,
    'recipient_email', normalized_email,
    'recipient_name', normalized_name
  );
end;
$$;

revoke all on function public.client_portal_add_or_invite_team_member(uuid, text, text, text, jsonb)
  from public, anon;
grant execute on function public.client_portal_add_or_invite_team_member(uuid, text, text, text, jsonb)
  to authenticated;

create or replace function public.client_portal_update_team_limit(
  input_organization_id uuid,
  input_user_limit integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_limit integer := greatest(coalesce(input_user_limit, 0), 0);
  current_member_count integer;
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Only an account administrator can change the team limit.';
  end if;

  select count(*) into current_member_count
  from public.organization_memberships membership
  where membership.organization_id = input_organization_id;

  if normalized_limit > 0 and normalized_limit < current_member_count then
    raise exception 'The team limit cannot be lower than the current team size.';
  end if;

  update public.organizations
  set user_limit = normalized_limit,
      updated_at = now()
  where id = input_organization_id;

  if not found then raise exception 'Organization not found.'; end if;

  return jsonb_build_object(
    'user_limit', normalized_limit,
    'is_unlimited', normalized_limit = 0,
    'member_count', current_member_count
  );
end;
$$;

revoke all on function public.client_portal_update_team_limit(uuid, integer)
  from public, anon;
grant execute on function public.client_portal_update_team_limit(uuid, integer)
  to authenticated;

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

  if organization_record.id is null then raise exception 'Organization not found.'; end if;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization_record.id,
      'name', organization_record.name,
      'owner_user_id', organization_record.owner_user_id,
      'user_limit', organization_record.user_limit
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

revoke all on function public.client_portal_team_snapshot(uuid) from public, anon;
grant execute on function public.client_portal_team_snapshot(uuid) to authenticated;

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
  current_member_count integer;
  target_user_limit integer;
begin
  if current_user_id is null then raise exception 'Authentication required.'; end if;

  select lower(trim(coalesce(profile.email, auth.jwt() ->> 'email', '')))
  into current_user_email
  from (select 1) seed
  left join public.profiles profile on profile.id = current_user_id;

  select * into invite_record
  from public.organization_invites
  where lower(code) = lower(trim(input_code))
  order by created_at desc
  limit 1
  for update;

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

  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = invite_record.organization_id
      and membership.user_id = current_user_id
  ) then
    select organization.user_limit,
           (select count(*) from public.organization_memberships membership
            where membership.organization_id = organization.id)
    into target_user_limit, current_member_count
    from public.organizations organization
    where organization.id = invite_record.organization_id
    for update;

    if target_user_limit > 0 and current_member_count >= target_user_limit then
      raise exception 'This organization has reached its team limit.';
    end if;
  end if;

  perform public.client_portal_apply_member_access(
    invite_record.organization_id,
    current_user_id,
    invite_record.role,
    invite_record.product_access,
    invite_record.created_by
  );

  update public.organization_invites
  set redeemed_uses = least(redeemed_uses + 1, max_uses)
  where id = invite_record.id;

  return jsonb_build_object('ok', true, 'organization_id', invite_record.organization_id);
end;
$$;

revoke all on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

do $$
declare
  pending_record record;
  current_member_count integer;
  target_user_limit integer;
begin
  for pending_record in
    select distinct on (invite.organization_id, lower(trim(invite.recipient_email)))
      invite.*,
      auth_user.id as confirmed_user_id
    from public.organization_invites invite
    join auth.users auth_user
      on lower(trim(auth_user.email)) = lower(trim(invite.recipient_email))
     and auth_user.email_confirmed_at is not null
     and auth_user.deleted_at is null
    where invite.recipient_email is not null
      and invite.redeemed_uses < invite.max_uses
      and not invite.is_disabled
      and invite.revoked_at is null
      and (invite.expires_at is null or invite.expires_at > now())
    order by invite.organization_id, lower(trim(invite.recipient_email)), invite.created_at desc
  loop
    if exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = pending_record.organization_id
        and membership.user_id = pending_record.confirmed_user_id
    ) then
      update public.organization_invites
      set redeemed_uses = max_uses, is_disabled = true
      where id = pending_record.id;
      continue;
    end if;

    select organization.user_limit,
           (select count(*) from public.organization_memberships membership
            where membership.organization_id = organization.id)
    into target_user_limit, current_member_count
    from public.organizations organization
    where organization.id = pending_record.organization_id;

    if coalesce(target_user_limit, 0) > 0 and current_member_count >= target_user_limit then
      continue;
    end if;

    perform public.client_portal_apply_member_access(
      pending_record.organization_id,
      pending_record.confirmed_user_id,
      pending_record.role,
      pending_record.product_access,
      pending_record.created_by
    );

    update public.organization_invites
    set redeemed_uses = max_uses, is_disabled = true
    where id = pending_record.id;
  end loop;
end;
$$;
