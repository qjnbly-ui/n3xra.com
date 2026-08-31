create table public.organization_product_member_access (
  organization_id uuid not null,
  product_key text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  status text not null default 'active',
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, product_key, user_id),
  foreign key (organization_id, product_key)
    references public.organization_product_entitlements (organization_id, product_key)
    on delete cascade,
  constraint organization_product_member_access_role_check
    check (role in ('account_admin', 'editor', 'viewer')),
  constraint organization_product_member_access_status_check
    check (status in ('active', 'revoked'))
);

create index organization_product_member_access_user_active_idx
  on public.organization_product_member_access (user_id, organization_id, product_key)
  where status = 'active';

drop trigger if exists organization_product_member_access_set_updated_at
  on public.organization_product_member_access;
create trigger organization_product_member_access_set_updated_at
before update on public.organization_product_member_access
for each row execute function public.set_updated_at();

alter table public.organization_product_member_access enable row level security;
revoke all on public.organization_product_member_access from anon, authenticated;
grant select on public.organization_product_member_access to authenticated;
grant all on public.organization_product_member_access to service_role;

create policy "organization_product_member_access_select"
on public.organization_product_member_access
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.can_manage_members(organization_id))
  or (select public.is_platform_admin())
);

alter table public.organization_invites
  add column if not exists product_access jsonb;

alter table public.organization_invites
  drop constraint if exists organization_invites_product_access_check;
alter table public.organization_invites
  add constraint organization_invites_product_access_check
  check (product_access is null or jsonb_typeof(product_access) = 'object');

insert into public.organization_product_member_access (
  organization_id,
  product_key,
  user_id,
  role,
  status,
  granted_by
)
select
  entitlement.organization_id,
  entitlement.product_key,
  membership.user_id,
  membership.role,
  'active',
  organization.owner_user_id
from public.organization_product_entitlements entitlement
join public.organization_memberships membership
  on membership.organization_id = entitlement.organization_id
join public.organizations organization
  on organization.id = entitlement.organization_id
where entitlement.portal_enabled
  and entitlement.status in ('trialing', 'active', 'past_due')
on conflict (organization_id, product_key, user_id) do nothing;

insert into public.organization_product_member_access (
  organization_id,
  product_key,
  user_id,
  role,
  status,
  granted_by
)
select
  entitlement.organization_id,
  entitlement.product_key,
  organization.owner_user_id,
  'account_admin',
  'active',
  organization.owner_user_id
from public.organization_product_entitlements entitlement
join public.organizations organization
  on organization.id = entitlement.organization_id
where entitlement.portal_enabled
  and entitlement.status in ('trialing', 'active', 'past_due')
on conflict (organization_id, product_key, user_id) do update
set role = 'account_admin', status = 'active', updated_at = now();

create or replace function private.ensure_product_owner_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare target_owner_user_id uuid;
begin
  if not new.portal_enabled or new.status not in ('trialing', 'active', 'past_due') then
    return new;
  end if;

  select organization.owner_user_id
  into target_owner_user_id
  from public.organizations organization
  where organization.id = new.organization_id;

  if target_owner_user_id is not null then
    insert into public.organization_product_member_access (
      organization_id, product_key, user_id, role, status, granted_by
    ) values (
      new.organization_id, new.product_key, target_owner_user_id,
      'account_admin', 'active', target_owner_user_id
    )
    on conflict (organization_id, product_key, user_id) do update
    set role = 'account_admin', status = 'active', updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function private.ensure_product_owner_access() from public, anon, authenticated;

drop trigger if exists organization_product_entitlements_ensure_owner_access
  on public.organization_product_entitlements;
create trigger organization_product_entitlements_ensure_owner_access
after insert or update of portal_enabled, status
on public.organization_product_entitlements
for each row execute function private.ensure_product_owner_access();

create or replace function public.organization_product_role(
  target_organization_id uuid,
  target_product_key text
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select access.role
  from public.organization_product_member_access access
  where access.organization_id = target_organization_id
    and access.product_key = target_product_key
    and access.user_id = (select auth.uid())
    and access.status = 'active'
  limit 1;
$$;

revoke all on function public.organization_product_role(uuid, text) from public, anon;
grant execute on function public.organization_product_role(uuid, text) to authenticated;

create or replace function public.is_records_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_product_role(target_organization_id, 'records') is not null;
$$;

create or replace function public.can_manage_records_support(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_product_role(target_organization_id, 'records') = 'account_admin';
$$;

create or replace function public.can_change_records_content(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_product_role(target_organization_id, 'records') in ('account_admin', 'editor')
    or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

create or replace function public.can_change_records_templates(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_product_role(target_organization_id, 'records') = 'account_admin'
    or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

create or replace function public.can_change_records_recordings(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.organization_product_role(target_organization_id, 'records') in ('account_admin', 'editor')
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.subscription_tier = 'organization'
    )
  ) or public.has_records_support_scope(target_organization_id, 'change_content');
$$;

revoke all on function public.is_records_organization_member(uuid) from public, anon;
revoke all on function public.can_manage_records_support(uuid) from public, anon;
revoke all on function public.can_change_records_content(uuid) from public, anon;
revoke all on function public.can_change_records_templates(uuid) from public, anon;
revoke all on function public.can_change_records_recordings(uuid) from public, anon;
grant execute on function public.is_records_organization_member(uuid) to authenticated;
grant execute on function public.can_manage_records_support(uuid) to authenticated;
grant execute on function public.can_change_records_content(uuid) to authenticated;
grant execute on function public.can_change_records_templates(uuid) to authenticated;
grant execute on function public.can_change_records_recordings(uuid) to authenticated;

create or replace function public.client_portal_organization_access_snapshot(input_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare organization_record public.organizations%rowtype;
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
    'organization', jsonb_build_object('id', organization_record.id, 'name', organization_record.name),
    'products', coalesce((
      select jsonb_agg(product order by sort_order, name)
      from (
        select
          jsonb_build_object(
            'access_key', entitlement.product_key,
            'product_key', entitlement.product_key,
            'name', product.name,
            'status', entitlement.status,
            'workspace_name', organization_record.name,
            'manage_path', product.portal_path
          ) product,
          product.sort_order,
          product.name
        from public.organization_product_entitlements entitlement
        join public.n3xra_product_catalog product
          on product.product_key = entitlement.product_key
        where entitlement.organization_id = input_organization_id
          and entitlement.portal_enabled
          and entitlement.status in ('trialing', 'active', 'past_due')
          and product.status = 'active'
        union all
        select
          jsonb_build_object(
            'access_key', 'website:' || website.id::text,
            'product_key', 'website',
            'name', 'Website Management',
            'status', website.status,
            'workspace_name', website.name,
            'manage_path', '/client-portal/'
          ),
          10,
          website.name
        from public.client_websites website
        where website.organization_id = input_organization_id
      ) products
    ), '[]'::jsonb),
    'member_access', coalesce((
      select jsonb_object_agg(membership.user_id::text, coalesce(member_roles.roles, '{}'::jsonb))
      from public.organization_memberships membership
      left join lateral (
        select jsonb_object_agg(access_row.access_key, access_row.role) roles
        from (
          select access.product_key access_key, access.role
          from public.organization_product_member_access access
          where access.organization_id = membership.organization_id
            and access.user_id = membership.user_id
            and access.status = 'active'
          union all
          select
            'website:' || website.id::text,
            case website_member.role when 'owner' then 'account_admin' else website_member.role end
          from public.client_websites website
          join public.website_members website_member
            on website_member.website_id = website.id
          where website.organization_id = membership.organization_id
            and website_member.user_id = membership.user_id
            and website_member.status = 'active'
        ) access_row
      ) member_roles on true
      where membership.organization_id = input_organization_id
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.client_portal_organization_access_snapshot(uuid) from public, anon;
grant execute on function public.client_portal_organization_access_snapshot(uuid) to authenticated;

revoke all on function public.client_portal_create_team_invite(uuid, text, text, text) from public, anon, authenticated;
drop function if exists public.client_portal_create_team_invite(uuid, text, text, text);

create function public.client_portal_create_team_invite(
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
  invite_record public.organization_invites%rowtype;
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Only an account administrator can invite team members.';
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
  if exists (
    select 1
    from public.organization_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.organization_id = input_organization_id
      and lower(trim(coalesce(profile.email, ''))) = normalized_email
  ) then
    raise exception 'That person already has access to this organization.';
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
      revoked_at, revoked_by, product_access
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
      null,
      input_product_access
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
        revoked_by = null,
        product_access = input_product_access
    where id = invite_record.id
    returning * into invite_record;
  end if;

  return jsonb_build_object(
    'id', invite_record.id,
    'code', invite_record.code,
    'recipient_email', invite_record.recipient_email,
    'recipient_name', invite_record.recipient_name,
    'role', invite_record.role,
    'product_access', invite_record.product_access,
    'expires_at', invite_record.expires_at
  );
end;
$$;

revoke all on function public.client_portal_create_team_invite(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.client_portal_create_team_invite(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.client_portal_update_product_member_access(
  input_membership_id uuid,
  input_access_key text,
  input_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
  target_owner_user_id uuid;
  target_website_id uuid;
  mapped_website_role text;
begin
  select * into membership_record
  from public.organization_memberships
  where id = input_membership_id
  for update;

  if membership_record.id is null or not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Team member not found.';
  end if;
  select organization.owner_user_id into target_owner_user_id
  from public.organizations organization
  where organization.id = membership_record.organization_id;
  if membership_record.user_id = target_owner_user_id then
    raise exception 'The account owner product access cannot be changed.';
  end if;
  if membership_record.user_id = auth.uid() then
    raise exception 'You cannot change your own product access.';
  end if;
  if input_role is not null and input_role not in ('account_admin', 'editor', 'viewer') then
    raise exception 'Choose a valid product role.';
  end if;

  if input_access_key like 'website:%' then
    if substring(input_access_key from 9) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Website access is invalid.';
    end if;
    target_website_id := substring(input_access_key from 9)::uuid;
    if not exists (
      select 1 from public.client_websites website
      where website.id = target_website_id
        and website.organization_id = membership_record.organization_id
    ) then
      raise exception 'Website access is invalid.';
    end if;

    if input_role is null then
      update public.website_members
      set status = 'revoked', updated_at = now()
      where website_id = target_website_id
        and user_id = membership_record.user_id;
    else
      mapped_website_role := case input_role
        when 'account_admin' then 'owner'
        when 'editor' then 'editor'
        else 'viewer'
      end;
      insert into public.website_members (
        website_id, user_id, role, status, invited_by_user_id
      ) values (
        target_website_id, membership_record.user_id, mapped_website_role, 'active', auth.uid()
      )
      on conflict (website_id, user_id) do update
      set role = excluded.role, status = 'active', updated_at = now();
    end if;
    return;
  end if;

  if not exists (
    select 1
    from public.organization_product_entitlements entitlement
    where entitlement.organization_id = membership_record.organization_id
      and entitlement.product_key = input_access_key
      and entitlement.portal_enabled
      and entitlement.status in ('trialing', 'active', 'past_due')
  ) then
    raise exception 'Product access is invalid.';
  end if;

  insert into public.organization_product_member_access (
    organization_id, product_key, user_id, role, status, granted_by
  ) values (
    membership_record.organization_id,
    input_access_key,
    membership_record.user_id,
    coalesce(input_role, 'viewer'),
    case when input_role is null then 'revoked' else 'active' end,
    auth.uid()
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      granted_by = excluded.granted_by,
      updated_at = now();
end;
$$;

revoke all on function public.client_portal_update_product_member_access(uuid, text, text) from public, anon;
grant execute on function public.client_portal_update_product_member_access(uuid, text, text) to authenticated;

create or replace function public.client_portal_update_team_member(input_membership_id uuid, input_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
  owner_user_id uuid;
begin
  select * into membership_record
  from public.organization_memberships
  where id = input_membership_id
  for update;
  if membership_record.id is null or not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Team member not found.';
  end if;
  if input_role not in ('account_admin', 'editor', 'viewer') then
    raise exception 'Choose a valid organization role.';
  end if;
  select organization.owner_user_id into owner_user_id
  from public.organizations organization
  where id = membership_record.organization_id;
  if membership_record.user_id = owner_user_id then
    raise exception 'The account owner role cannot be changed.';
  end if;
  if membership_record.user_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;

  update public.organization_memberships
  set role = input_role, updated_at = now()
  where id = input_membership_id;
end;
$$;

revoke all on function public.client_portal_update_team_member(uuid, text) from public, anon;
grant execute on function public.client_portal_update_team_member(uuid, text) to authenticated;

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
    select 1 from public.organization_memberships
    where organization_id = invite_record.organization_id
      and user_id = current_user_id
  ) then
    select count(*), max(organization.user_limit)
    into next_member_count, target_user_limit
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = invite_record.organization_id
    where membership.organization_id = invite_record.organization_id;
    if coalesce(next_member_count, 0) >= coalesce(target_user_limit, 0) then
      raise exception 'This account has reached its user limit.';
    end if;
    insert into public.organization_memberships (
      organization_id, user_id, role, created_by
    ) values (
      invite_record.organization_id, current_user_id, invite_record.role, invite_record.created_by
    );
  end if;

  if invite_record.product_access is null then
    insert into public.organization_product_member_access (
      organization_id, product_key, user_id, role, status, granted_by
    )
    select
      entitlement.organization_id,
      entitlement.product_key,
      current_user_id,
      invite_record.role,
      'active',
      invite_record.created_by
    from public.organization_product_entitlements entitlement
    where entitlement.organization_id = invite_record.organization_id
      and entitlement.portal_enabled
      and entitlement.status in ('trialing', 'active', 'past_due')
    on conflict (organization_id, product_key, user_id) do update
    set role = excluded.role, status = 'active', updated_at = now();

    mapped_website_role := case invite_record.role
      when 'account_admin' then 'owner'
      when 'editor' then 'editor'
      else 'viewer'
    end;
    insert into public.website_members (
      website_id, user_id, role, status, invited_by_user_id
    )
    select website.id, current_user_id, mapped_website_role, 'active', invite_record.created_by
    from public.client_websites website
    where website.organization_id = invite_record.organization_id
    on conflict (website_id, user_id) do update
    set role = excluded.role, status = 'active', updated_at = now();
  else
    insert into public.organization_product_member_access (
      organization_id, product_key, user_id, role, status, granted_by
    )
    select
      invite_record.organization_id,
      selection.key,
      current_user_id,
      selection.value,
      'active',
      invite_record.created_by
    from jsonb_each_text(invite_record.product_access) selection
    join public.organization_product_entitlements entitlement
      on entitlement.organization_id = invite_record.organization_id
     and entitlement.product_key = selection.key
     and entitlement.portal_enabled
     and entitlement.status in ('trialing', 'active', 'past_due')
    where selection.key not like 'website:%'
    on conflict (organization_id, product_key, user_id) do update
    set role = excluded.role, status = 'active', updated_at = now();

    insert into public.website_members (
      website_id, user_id, role, status, invited_by_user_id
    )
    select
      website.id,
      current_user_id,
      case selection.value
        when 'account_admin' then 'owner'
        when 'editor' then 'editor'
        else 'viewer'
      end,
      'active',
      invite_record.created_by
    from jsonb_each_text(invite_record.product_access) selection
    join public.client_websites website
      on website.organization_id = invite_record.organization_id
     and 'website:' || website.id::text = selection.key
    on conflict (website_id, user_id) do update
    set role = excluded.role, status = 'active', updated_at = now();
  end if;

  if invite_record.redeemed_uses < invite_record.max_uses then
    update public.organization_invites
    set redeemed_uses = redeemed_uses + 1
    where id = invite_record.id;
  end if;
  update public.organization_contacts
  set linked_user_id = current_user_id
  where organization_id = invite_record.organization_id
    and current_user_email <> ''
    and lower(trim(email)) = current_user_email
    and linked_user_id is distinct from current_user_id;

  return jsonb_build_object('ok', true, 'organization_id', invite_record.organization_id);
end;
$$;

revoke execute on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
;
