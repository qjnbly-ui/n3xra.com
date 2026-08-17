create or replace function private.copy_website_proposal_version_to_draft(
  source_version_id uuid,
  actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  source_version public.website_proposal_versions%rowtype;
  new_version public.website_proposal_versions%rowtype;
  next_number integer;
  item_map jsonb := '{}'::jsonb;
  source_item public.website_proposal_line_items%rowtype;
  new_item_id uuid;
begin
  select * into source_version
  from public.website_proposal_versions
  where id = source_version_id;

  if source_version.id is null then
    raise exception 'This proposal version no longer exists.';
  end if;

  perform 1 from public.website_proposals
  where id = source_version.proposal_id
  for update;

  if exists (
    select 1 from public.website_proposal_versions
    where proposal_id = source_version.proposal_id
      and status = 'draft'
  ) then
    raise exception 'This proposal already has an editable draft.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_number
  from public.website_proposal_versions
  where proposal_id = source_version.proposal_id;

  insert into public.website_proposal_versions (
    proposal_id, version_number, status, introduction, project_objective,
    scope_summary, deliverables, exclusions, timeline, estimated_start_date,
    estimated_completion_date, subtotal_cents, discount_cents, total_cents,
    deposit_cents, recurring_cents, recurring_interval, recurring_start_policy,
    complimentary_months, review_notice_days, payment_schedule,
    revision_policy, terms, valid_until, created_by_user_id
  ) values (
    source_version.proposal_id, next_number, 'draft', source_version.introduction,
    source_version.project_objective, source_version.scope_summary,
    source_version.deliverables, source_version.exclusions, source_version.timeline,
    source_version.estimated_start_date, source_version.estimated_completion_date,
    source_version.subtotal_cents, source_version.discount_cents,
    source_version.total_cents, source_version.deposit_cents,
    source_version.recurring_cents, source_version.recurring_interval,
    source_version.recurring_start_policy, source_version.complimentary_months,
    source_version.review_notice_days, source_version.payment_schedule,
    source_version.revision_policy, source_version.terms,
    source_version.valid_until, actor_user_id
  ) returning * into new_version;

  for source_item in
    select * from public.website_proposal_line_items
    where version_id = source_version.id
    order by sort_order, created_at, id
  loop
    insert into public.website_proposal_line_items (
      version_id, category, name, description, billing_type, quantity,
      unit_amount_cents, recurring_interval, sort_order
    ) values (
      new_version.id, source_item.category, source_item.name,
      source_item.description, source_item.billing_type, source_item.quantity,
      source_item.unit_amount_cents, source_item.recurring_interval,
      source_item.sort_order
    ) returning id into new_item_id;
    item_map := item_map || jsonb_build_object(source_item.id::text, new_item_id);
  end loop;

  return jsonb_build_object(
    'proposal_id', new_version.proposal_id,
    'version_id', new_version.id,
    'version_number', new_version.version_number,
    'line_item_map', item_map
  );
end;
$$;

revoke all on function private.copy_website_proposal_version_to_draft(uuid, uuid) from public;
