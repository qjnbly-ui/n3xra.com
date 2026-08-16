-- Retired products do not have tenant/workspace UUIDs. Their enrollment key is
-- the Auth user ID, so remove their product-owned rows in one trusted
-- transaction without deleting the shared N3XRA identity.
create or replace function public.admin_remove_retired_product_enrollment(
  input_product text,
  input_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_product text := lower(trim(coalesce(input_product, '')));
  request_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  target_music public.music_profiles%rowtype;
  target_virals public.virals_profiles%rowtype;
  creator_application_ids uuid[] := '{}'::uuid[];
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  if input_user_id is null then
    raise exception 'A user is required.';
  end if;

  if normalized_product = 'ai_music' then
    select * into target_music
    from public.music_profiles
    where user_id = input_user_id
    for update;

    if target_music.user_id is null then
      raise exception 'This AI Music Generator enrollment no longer exists.';
    end if;

    if target_music.stripe_subscription_id is not null
      or target_music.plan in ('creator', 'studio')
    then
      if target_music.account_status not in ('canceled', 'suspended') then
        raise exception 'Cancel the active AI Music Generator subscription before deleting its data.';
      end if;
    end if;

    delete from public.reviews
    where app = 'ai_music'
      and (user_id = input_user_id or review_target_id = input_user_id);
    delete from public.music_generations where user_id = input_user_id;
    delete from public.music_profiles where user_id = input_user_id;

    return jsonb_build_object(
      'ok', true,
      'product', normalized_product,
      'mode', 'product_data',
      'workspace_id', input_user_id
    );
  end if;

  if normalized_product = 'virals' then
    select * into target_virals
    from public.virals_profiles
    where user_id = input_user_id
    for update;

    if target_virals.user_id is null then
      raise exception 'This N3XRA Virals enrollment no longer exists.';
    end if;

    if target_virals.stripe_subscription_id is not null
      or target_virals.plan in ('starter', 'creator', 'pro', 'agency')
    then
      if target_virals.account_status not in ('canceled', 'suspended') then
        raise exception 'Cancel the active N3XRA Virals subscription before deleting its data.';
      end if;
    end if;

    select coalesce(array_agg(application.id), '{}'::uuid[])
    into creator_application_ids
    from public.virals_creator_applications application
    where application.user_id = input_user_id;

    if cardinality(creator_application_ids) > 0 then
      delete from public.virals_commission_ledger
      where creator_application_id = any(creator_application_ids);
      delete from public.virals_referrals
      where creator_application_id = any(creator_application_ids);
    end if;

    delete from public.virals_referrals where referred_user_id = input_user_id;
    delete from public.virals_creator_applications where user_id = input_user_id;
    delete from public.virals_profiles where user_id = input_user_id;

    return jsonb_build_object(
      'ok', true,
      'product', normalized_product,
      'mode', 'product_data',
      'workspace_id', input_user_id
    );
  end if;

  raise exception 'Unsupported retired product enrollment: %', normalized_product;
end;
$$;

revoke all on function public.admin_remove_retired_product_enrollment(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_retired_product_enrollment(text, uuid) to service_role;

comment on function public.admin_remove_retired_product_enrollment(text, uuid) is
'Permanently removes one AI Music Generator or N3XRA Virals enrollment and its product-owned data without deleting the shared Auth account. Service-role only.';

-- Supabase Auth refuses to delete a user who still owns Storage objects. Give
-- the trusted Edge Function a complete server-side inventory so it can remove
-- those bytes before asking Auth to remove the identity.
create or replace function public.admin_user_storage_objects(input_user_id uuid)
returns table(bucket text, path text)
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  request_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  return query
  select object.bucket_id::text, object.name::text
  from storage.objects object
  where object.owner_id::text = input_user_id::text;
end;
$$;

revoke all on function public.admin_user_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_storage_objects(uuid) to service_role;

comment on function public.admin_user_storage_objects(uuid) is
'Returns every Storage object owned by one Auth user for trusted account-deletion cleanup. Service-role only.';
;
