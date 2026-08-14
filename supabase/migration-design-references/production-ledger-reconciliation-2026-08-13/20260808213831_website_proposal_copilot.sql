create table public.website_proposal_ai_runs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.website_proposals (id) on delete restrict,
  base_version_id uuid not null references public.website_proposal_versions (id) on delete restrict,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  base_proposal_updated_at timestamptz not null,
  base_version_updated_at timestamptz not null,
  base_revision_token text not null,
  instruction text not null,
  source_manifest jsonb not null default '[]'::jsonb,
  model text not null,
  change_set jsonb not null default '{"summary":"","operations":[]}'::jsonb,
  review_result jsonb,
  applied_version_id uuid references public.website_proposal_versions (id) on delete restrict,
  affected_sections text[] not null default '{}'::text[],
  suggestion_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  status text not null default 'generating',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  applied_at timestamptz,
  constraint website_proposal_ai_runs_instruction_check
    check (char_length(btrim(instruction)) between 1 and 6000),
  constraint website_proposal_ai_runs_manifest_check
    check (jsonb_typeof(source_manifest) = 'array'),
  constraint website_proposal_ai_runs_change_set_check
    check (jsonb_typeof(change_set) = 'object' and jsonb_typeof(change_set -> 'operations') = 'array'),
  constraint website_proposal_ai_runs_review_check
    check (review_result is null or jsonb_typeof(review_result) = 'object'),
  constraint website_proposal_ai_runs_counts_check
    check (suggestion_count >= 0 and accepted_count >= 0 and rejected_count >= 0),
  constraint website_proposal_ai_runs_status_check
    check (status in ('generating', 'ready', 'applied', 'failed')),
  constraint website_proposal_ai_runs_completion_check
    check (
      (status = 'generating' and completed_at is null and applied_at is null)
      or (status in ('ready', 'failed') and completed_at is not null and applied_at is null)
      or (status = 'applied' and completed_at is not null and applied_at is not null and applied_version_id is not null)
    )
);

create index website_proposal_ai_runs_proposal_created_idx
on public.website_proposal_ai_runs (proposal_id, created_at desc);

create index website_proposal_ai_runs_status_created_idx
on public.website_proposal_ai_runs (status, created_at desc);

create or replace function private.website_proposal_revision_token(
  target_proposal_id uuid,
  target_version_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  proposal_value jsonb;
  version_value jsonb;
  line_item_values jsonb;
begin
  select jsonb_build_object(
    'id', proposal.id,
    'title', proposal.title,
    'status', proposal.status,
    'current_version_id', proposal.current_version_id,
    'sent_at', proposal.sent_at,
    'decided_at', proposal.decided_at
  )
  into proposal_value
  from public.website_proposals proposal
  where proposal.id = target_proposal_id;

  select to_jsonb(version)
  into version_value
  from public.website_proposal_versions version
  where version.id = target_version_id
    and version.proposal_id = target_proposal_id;

  if proposal_value is null or version_value is null then
    raise exception 'The proposal baseline no longer exists.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order, item.created_at, item.id), '[]'::jsonb)
  into line_item_values
  from public.website_proposal_line_items item
  where item.version_id = target_version_id;

  return encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'proposal', proposal_value,
          'version', version_value,
          'line_items', line_item_values
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$$;

revoke all on function private.website_proposal_revision_token(uuid, uuid) from public;

create or replace function private.prepare_website_proposal_ai_run()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  proposal_row public.website_proposals%rowtype;
  version_row public.website_proposal_versions%rowtype;
begin
  select * into proposal_row
  from public.website_proposals
  where id = new.proposal_id;

  select * into version_row
  from public.website_proposal_versions
  where id = new.base_version_id
    and proposal_id = new.proposal_id;

  if proposal_row.id is null or version_row.id is null then
    raise exception 'The proposal baseline is invalid.';
  end if;

  new.base_proposal_updated_at := proposal_row.updated_at;
  new.base_version_updated_at := version_row.updated_at;
  new.base_revision_token := private.website_proposal_revision_token(new.proposal_id, new.base_version_id);
  return new;
end;
$$;

revoke all on function private.prepare_website_proposal_ai_run() from public;

create trigger website_proposal_ai_runs_prepare
before insert on public.website_proposal_ai_runs
for each row execute function private.prepare_website_proposal_ai_run();

create or replace function private.protect_website_proposal_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Proposal AI runs cannot be deleted.';
  end if;

  if new.id is distinct from old.id
    or new.proposal_id is distinct from old.proposal_id
    or new.base_version_id is distinct from old.base_version_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.base_proposal_updated_at is distinct from old.base_proposal_updated_at
    or new.base_version_updated_at is distinct from old.base_version_updated_at
    or new.base_revision_token is distinct from old.base_revision_token
    or new.instruction is distinct from old.instruction
    or new.source_manifest is distinct from old.source_manifest
    or new.model is distinct from old.model
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Proposal AI run inputs and baseline are immutable.';
  end if;

  if old.status <> 'generating' and new.change_set is distinct from old.change_set then
    raise exception 'A completed Proposal AI change set is immutable.';
  end if;

  if old.status = 'failed' then
    raise exception 'A failed Proposal AI run cannot be changed.';
  end if;

  if old.status = 'applied' then
    raise exception 'An applied Proposal AI run cannot be changed.';
  end if;

  if old.status = 'ready' and new.status <> 'applied' then
    raise exception 'A ready Proposal AI run can only be applied.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_proposal_ai_run() from public;

create trigger website_proposal_ai_runs_protect
before update or delete on public.website_proposal_ai_runs
for each row execute function private.protect_website_proposal_ai_run();

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
    deposit_cents, recurring_cents, recurring_interval, payment_schedule,
    revision_policy, terms, valid_until, created_by_user_id
  ) values (
    source_version.proposal_id, next_number, 'draft', source_version.introduction,
    source_version.project_objective, source_version.scope_summary,
    source_version.deliverables, source_version.exclusions, source_version.timeline,
    source_version.estimated_start_date, source_version.estimated_completion_date,
    source_version.subtotal_cents, source_version.discount_cents,
    source_version.total_cents, source_version.deposit_cents,
    source_version.recurring_cents, source_version.recurring_interval,
    source_version.payment_schedule, source_version.revision_policy,
    source_version.terms, source_version.valid_until, actor_user_id
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

create or replace function public.create_website_proposal_draft_revision(target_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Website proposal administration access is required.';
  end if;

  return private.copy_website_proposal_version_to_draft(target_version_id, auth.uid());
end;
$$;

revoke all on function public.create_website_proposal_draft_revision(uuid) from public;
revoke all on function public.create_website_proposal_draft_revision(uuid) from anon;
grant execute on function public.create_website_proposal_draft_revision(uuid) to authenticated;

create or replace function private.website_proposal_ai_operation_is_protected(operation_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when operation_value #>> '{target,kind}' = 'line_item' then true
    when operation_value #>> '{target,kind}' = 'version'
      and operation_value ->> 'field' in (
        'timeline', 'estimated_start_date', 'estimated_completion_date', 'valid_until',
        'discount_cents', 'deposit_cents', 'payment_schedule', 'revision_policy',
        'terms', 'recurring_cents', 'recurring_interval'
      ) then true
    else false
  end;
$$;

revoke all on function private.website_proposal_ai_operation_is_protected(jsonb) from public;

create or replace function public.apply_website_proposal_ai_run(
  target_run_id uuid,
  accepted_operation_ids text[],
  rejected_operation_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  run_row public.website_proposal_ai_runs%rowtype;
  base_version public.website_proposal_versions%rowtype;
  target_version_id uuid;
  revision_result jsonb;
  item_map jsonb := '{}'::jsonb;
  operation_value jsonb;
  operation_id text;
  operation_kind text;
  operation_type text;
  operation_field text;
  source_item_id uuid;
  target_item_id uuid;
  proposed_value jsonb;
  all_operation_ids text[];
  accepted_ids text[] := coalesce(accepted_operation_ids, '{}'::text[]);
  rejected_ids text[] := coalesce(rejected_operation_ids, '{}'::text[]);
  accepted_total integer;
  rejected_total integer;
  one_time_total integer;
  recurring_total integer;
  recurring_interval_count integer;
  recurring_interval_value text;
  current_deposit integer;
  pending_discount integer;
  pending_deposit integer;
  pending_start_date date;
  pending_completion_date date;
  pending_valid_until date;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Website proposal administration access is required.';
  end if;

  select * into run_row
  from public.website_proposal_ai_runs
  where id = target_run_id
  for update;

  if run_row.id is null then raise exception 'This Proposal AI run no longer exists.'; end if;
  if run_row.status <> 'ready' or run_row.applied_version_id is not null then
    raise exception 'This Proposal AI run cannot be applied again.';
  end if;

  perform 1 from public.website_proposals where id = run_row.proposal_id for update;
  select * into base_version from public.website_proposal_versions
  where id = run_row.base_version_id and proposal_id = run_row.proposal_id
  for update;

  perform 1 from public.website_proposal_line_items
  where version_id = run_row.base_version_id
  order by id
  for update;

  if private.website_proposal_revision_token(run_row.proposal_id, run_row.base_version_id)
    <> run_row.base_revision_token
  then
    raise exception 'This proposal changed after the suggestions were generated. Generate a new run.';
  end if;

  select coalesce(array_agg(value ->> 'id' order by value ->> 'id'), '{}'::text[])
  into all_operation_ids
  from jsonb_array_elements(run_row.change_set -> 'operations') value;

  if cardinality(all_operation_ids) <> cardinality(array(select distinct unnest(all_operation_ids)))
    or cardinality(accepted_ids) <> cardinality(array(select distinct unnest(accepted_ids)))
    or cardinality(rejected_ids) <> cardinality(array(select distinct unnest(rejected_ids)))
    or accepted_ids && rejected_ids
    or not (accepted_ids <@ all_operation_ids and rejected_ids <@ all_operation_ids)
    or not (all_operation_ids <@ (accepted_ids || rejected_ids))
  then
    raise exception 'Every suggestion must be accepted or rejected exactly once.';
  end if;

  accepted_total := cardinality(accepted_ids);
  rejected_total := cardinality(rejected_ids);
  if accepted_total = 0 then
    update public.website_proposal_ai_runs
    set status = 'applied',
        review_result = jsonb_build_object(
          'accepted_operation_ids', to_jsonb(accepted_ids),
          'rejected_operation_ids', to_jsonb(rejected_ids),
          'reviewed_by_user_id', auth.uid(),
          'reviewed_at', now()
        ),
        applied_version_id = run_row.base_version_id,
        accepted_count = 0,
        rejected_count = rejected_total,
        applied_at = now()
    where id = run_row.id;

    return jsonb_build_object(
      'proposal_id', run_row.proposal_id,
      'version_id', run_row.base_version_id,
      'version_number', base_version.version_number,
      'accepted_count', 0,
      'rejected_count', rejected_total
    );
  end if;

  if base_version.status = 'draft' then
    target_version_id := base_version.id;
  else
    revision_result := private.copy_website_proposal_version_to_draft(base_version.id, auth.uid());
    target_version_id := (revision_result ->> 'version_id')::uuid;
    item_map := revision_result -> 'line_item_map';
  end if;

  select discount_cents, deposit_cents, estimated_start_date, estimated_completion_date, valid_until
  into pending_discount, pending_deposit, pending_start_date, pending_completion_date, pending_valid_until
  from public.website_proposal_versions
  where id = target_version_id;

  for operation_value in
    select value from jsonb_array_elements(run_row.change_set -> 'operations') value
  loop
    operation_id := operation_value ->> 'id';
    if not (operation_id = any(accepted_ids)) then continue; end if;

    operation_kind := operation_value #>> '{target,kind}';
    operation_type := operation_value ->> 'operation';
    operation_field := operation_value ->> 'field';
    proposed_value := operation_value -> 'proposed';

    if private.website_proposal_ai_operation_is_protected(operation_value)
      and coalesce((operation_value #>> '{server_validation,supported}')::boolean, false) is not true
    then
      raise exception 'Accepted protected suggestion % does not have valid source evidence.', operation_id;
    end if;

    if operation_kind = 'proposal' then
      if operation_type <> 'replace' or operation_field <> 'title'
        or operation_value #>> '{target,id}' <> run_row.proposal_id::text
      then raise exception 'Suggestion % targets an unsupported proposal field.', operation_id; end if;
      update public.website_proposals set title = proposed_value #>> '{}'
      where id = run_row.proposal_id;

    elsif operation_kind = 'version' then
      if operation_type <> 'replace'
        or operation_value #>> '{target,id}' <> run_row.base_version_id::text
      then raise exception 'Suggestion % has an invalid version target.', operation_id; end if;

      case operation_field
        when 'introduction' then update public.website_proposal_versions set introduction = nullif(proposed_value #>> '{}', '') where id = target_version_id;
        when 'project_objective' then update public.website_proposal_versions set project_objective = proposed_value #>> '{}' where id = target_version_id;
        when 'scope_summary' then update public.website_proposal_versions set scope_summary = proposed_value #>> '{}' where id = target_version_id;
        when 'deliverables' then update public.website_proposal_versions set deliverables = array(select jsonb_array_elements_text(proposed_value)) where id = target_version_id;
        when 'exclusions' then update public.website_proposal_versions set exclusions = array(select jsonb_array_elements_text(proposed_value)) where id = target_version_id;
        when 'timeline' then update public.website_proposal_versions set timeline = proposed_value #>> '{}' where id = target_version_id;
        when 'estimated_start_date' then pending_start_date := nullif(proposed_value #>> '{}', '')::date;
        when 'estimated_completion_date' then pending_completion_date := nullif(proposed_value #>> '{}', '')::date;
        when 'valid_until' then pending_valid_until := nullif(proposed_value #>> '{}', '')::date;
        when 'discount_cents' then pending_discount := (proposed_value #>> '{}')::integer;
        when 'deposit_cents' then pending_deposit := (proposed_value #>> '{}')::integer;
        when 'payment_schedule' then update public.website_proposal_versions set payment_schedule = nullif(proposed_value #>> '{}', '') where id = target_version_id;
        when 'revision_policy' then update public.website_proposal_versions set revision_policy = nullif(proposed_value #>> '{}', '') where id = target_version_id;
        when 'terms' then update public.website_proposal_versions set terms = proposed_value #>> '{}' where id = target_version_id;
        else raise exception 'Suggestion % targets an unsupported version field.', operation_id;
      end case;

    elsif operation_kind = 'line_item' then
      if operation_field <> 'item' and operation_type in ('add', 'remove') then
        raise exception 'Suggestion % has an invalid line-item operation.', operation_id;
      end if;

      if operation_type = 'add' then
        insert into public.website_proposal_line_items (
          version_id, category, name, description, billing_type, quantity,
          unit_amount_cents, recurring_interval, sort_order
        ) values (
          target_version_id,
          proposed_value ->> 'category', proposed_value ->> 'name',
          nullif(proposed_value ->> 'description', ''), proposed_value ->> 'billing_type',
          (proposed_value ->> 'quantity')::numeric,
          (proposed_value ->> 'unit_amount_cents')::integer,
          nullif(proposed_value ->> 'recurring_interval', ''),
          coalesce((proposed_value ->> 'sort_order')::integer, 100)
        );
      else
        source_item_id := nullif(operation_value #>> '{target,id}', '')::uuid;
        target_item_id := case when target_version_id = run_row.base_version_id then source_item_id
          else nullif(item_map ->> source_item_id::text, '')::uuid end;
        if target_item_id is null then raise exception 'Suggestion % references a missing line item.', operation_id; end if;

        if operation_type = 'remove' then
          delete from public.website_proposal_line_items where id = target_item_id and version_id = target_version_id;
          if not found then raise exception 'Suggestion % references a missing line item.', operation_id; end if;
        elsif operation_type = 'replace' and operation_field = 'item' then
          update public.website_proposal_line_items
          set category = proposed_value ->> 'category',
              name = proposed_value ->> 'name',
              description = nullif(proposed_value ->> 'description', ''),
              billing_type = proposed_value ->> 'billing_type',
              quantity = (proposed_value ->> 'quantity')::numeric,
              unit_amount_cents = (proposed_value ->> 'unit_amount_cents')::integer,
              recurring_interval = nullif(proposed_value ->> 'recurring_interval', ''),
              sort_order = (proposed_value ->> 'sort_order')::integer
          where id = target_item_id and version_id = target_version_id;
          if not found then raise exception 'Suggestion % references a missing line item.', operation_id; end if;
        elsif operation_type = 'replace' then
          case operation_field
            when 'category' then update public.website_proposal_line_items set category = proposed_value #>> '{}' where id = target_item_id and version_id = target_version_id;
            when 'name' then update public.website_proposal_line_items set name = proposed_value #>> '{}' where id = target_item_id and version_id = target_version_id;
            when 'description' then update public.website_proposal_line_items set description = nullif(proposed_value #>> '{}', '') where id = target_item_id and version_id = target_version_id;
            when 'billing_type' then update public.website_proposal_line_items set billing_type = proposed_value #>> '{}' where id = target_item_id and version_id = target_version_id;
            when 'quantity' then update public.website_proposal_line_items set quantity = (proposed_value #>> '{}')::numeric where id = target_item_id and version_id = target_version_id;
            when 'unit_amount_cents' then update public.website_proposal_line_items set unit_amount_cents = (proposed_value #>> '{}')::integer where id = target_item_id and version_id = target_version_id;
            when 'recurring_interval' then update public.website_proposal_line_items set recurring_interval = nullif(proposed_value #>> '{}', '') where id = target_item_id and version_id = target_version_id;
            when 'sort_order' then update public.website_proposal_line_items set sort_order = (proposed_value #>> '{}')::integer where id = target_item_id and version_id = target_version_id;
            else raise exception 'Suggestion % targets an unsupported line-item field.', operation_id;
          end case;
          if not found then raise exception 'Suggestion % references a missing line item.', operation_id; end if;
        else
          raise exception 'Suggestion % uses an unsupported line-item operation.', operation_id;
        end if;
      end if;
    else
      raise exception 'Suggestion % uses an unsupported target.', operation_id;
    end if;
  end loop;

  if not exists (select 1 from public.website_proposal_line_items where version_id = target_version_id) then
    raise exception 'A proposal must retain at least one line item.';
  end if;

  select coalesce(sum(round(quantity * unit_amount_cents)) filter (where billing_type = 'one_time'), 0)::integer,
    count(distinct recurring_interval) filter (where billing_type = 'recurring'),
    min(recurring_interval) filter (where billing_type = 'recurring')
  into one_time_total, recurring_interval_count, recurring_interval_value
  from public.website_proposal_line_items where version_id = target_version_id;

  if recurring_interval_count = 1 then
    select coalesce(sum(round(quantity * unit_amount_cents)), 0)::integer into recurring_total
    from public.website_proposal_line_items
    where version_id = target_version_id and billing_type = 'recurring';
  else
    recurring_total := 0;
    recurring_interval_value := null;
  end if;

  current_deposit := pending_deposit;
  if pending_discount < 0 or pending_deposit < 0 then
    raise exception 'The resulting discount and deposit must be non-negative.';
  end if;
  if pending_completion_date is not null and pending_start_date is not null and pending_completion_date < pending_start_date then
    raise exception 'The resulting completion date is before the start date.';
  end if;
  if current_deposit > greatest(one_time_total - pending_discount, 0) then
    raise exception 'The resulting deposit exceeds the recalculated proposal total.';
  end if;

  update public.website_proposal_versions
  set subtotal_cents = one_time_total,
      discount_cents = pending_discount,
      total_cents = greatest(one_time_total - pending_discount, 0),
      deposit_cents = pending_deposit,
      recurring_cents = recurring_total,
      recurring_interval = recurring_interval_value,
      estimated_start_date = pending_start_date,
      estimated_completion_date = pending_completion_date,
      valid_until = pending_valid_until
  where id = target_version_id;

  update public.website_service_requests request
  set status = 'proposal_drafting'
  from public.website_proposals proposal
  where proposal.id = run_row.proposal_id and request.id = proposal.request_id;

  update public.website_proposal_ai_runs
  set status = 'applied',
      review_result = jsonb_build_object(
        'accepted_operation_ids', to_jsonb(accepted_ids),
        'rejected_operation_ids', to_jsonb(rejected_ids),
        'reviewed_by_user_id', auth.uid(),
        'reviewed_at', now()
      ),
      applied_version_id = target_version_id,
      accepted_count = accepted_total,
      rejected_count = rejected_total,
      applied_at = now()
  where id = run_row.id;

  return jsonb_build_object(
    'proposal_id', run_row.proposal_id,
    'version_id', target_version_id,
    'version_number', (select version_number from public.website_proposal_versions where id = target_version_id),
    'accepted_count', accepted_total,
    'rejected_count', rejected_total
  );
end;
$$;

revoke all on function public.apply_website_proposal_ai_run(uuid, text[], text[]) from public;
revoke all on function public.apply_website_proposal_ai_run(uuid, text[], text[]) from anon;
grant execute on function public.apply_website_proposal_ai_run(uuid, text[], text[]) to authenticated;

alter table public.website_proposal_ai_runs enable row level security;

revoke all on public.website_proposal_ai_runs from public;
revoke all on public.website_proposal_ai_runs from anon;
revoke all on public.website_proposal_ai_runs from authenticated;
grant all on public.website_proposal_ai_runs to service_role;
