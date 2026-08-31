\set ON_ERROR_STOP on
begin;

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000012')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, owner_user_id)
values (
  '00000000-0000-4000-8000-000000000021',
  'Project Cards Verification',
  'project-cards-verification',
  '00000000-0000-4000-8000-000000000011'
)
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, user_id, role, created_by)
values (
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000012',
  'viewer',
  '00000000-0000-4000-8000-000000000011'
)
on conflict (organization_id, user_id) do nothing;

insert into public.organization_product_entitlements (
  organization_id, product_key, status, portal_enabled, source
)
values (
  '00000000-0000-4000-8000-000000000021',
  'project_cards',
  'active',
  true,
  'manual'
)
on conflict (organization_id, product_key) do update
set status = 'active', portal_enabled = true;

insert into public.organization_product_member_access (
  organization_id, product_key, user_id, role, status, granted_by
)
values (
  '00000000-0000-4000-8000-000000000021',
  'project_cards',
  '00000000-0000-4000-8000-000000000012',
  'viewer',
  'active',
  '00000000-0000-4000-8000-000000000011'
)
on conflict (organization_id, product_key, user_id) do update
set role = 'viewer', status = 'active';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);

insert into public.project_card_projects (
  id, organization_id, slug, name, description, status, access_level, created_by_user_id
)
values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000021',
  'verification-fire-assignment',
  'Verification Fire Assignment',
  'Local migration test',
  'live',
  'public',
  '00000000-0000-4000-8000-000000000011'
);

insert into public.project_card_resources (
  project_id, resource_type, title, detail, sort_order, content, created_by_user_id
)
values (
  '00000000-0000-4000-8000-000000000031',
  'radio',
  'Radio Channels',
  'Verification resource',
  1,
  '{"channels":[{"label":"Command","frequency":"168.1000"}]}'::jsonb,
  '00000000-0000-4000-8000-000000000011'
);

do $$
declare created_card jsonb;
begin
  created_card := public.create_project_card(
    '00000000-0000-4000-8000-000000000021',
    'Engine 312',
    '00000000-0000-4000-8000-000000000031'
  );
  if created_card->>'token' !~ '^[0-9a-f]{32}$' then
    raise exception 'Card token was not generated correctly.';
  end if;
  if public.resolve_project_card(created_card->>'token')->>'destination_slug'
    <> 'verification-fire-assignment' then
    raise exception 'Active card did not resolve to its project.';
  end if;
  if public.get_project_card_page('verification-fire-assignment')->'resources'->0->>'title'
    <> 'Radio Channels' then
    raise exception 'Public project page did not return its visible resource.';
  end if;

  update public.project_card_devices
  set status = 'retired'
  where id = (created_card->>'id')::uuid;

  begin
    update public.project_card_devices
    set status = 'active'
    where id = (created_card->>'id')::uuid;
    raise exception 'Retired card identity was incorrectly reusable.';
  exception
    when insufficient_privilege then null;
  end;

  if public.resolve_project_card(created_card->>'token') is not null then
    raise exception 'Retired card still resolved.';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);

do $$
begin
  begin
    insert into public.project_card_projects (
      organization_id, slug, name, created_by_user_id
    ) values (
      '00000000-0000-4000-8000-000000000021',
      'viewer-must-not-create',
      'Viewer Must Not Create',
      '00000000-0000-4000-8000-000000000012'
    );
    raise exception 'Viewer incorrectly created a project.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.project_card_device_events
    where organization_id = '00000000-0000-4000-8000-000000000021'
      and event_type = 'created'
  ) or not exists (
    select 1 from public.project_card_device_events
    where organization_id = '00000000-0000-4000-8000-000000000021'
      and event_type = 'retired'
  ) then
    raise exception 'Card lifecycle audit events were not recorded.';
  end if;
end;
$$;

rollback;
