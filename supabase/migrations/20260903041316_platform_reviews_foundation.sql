create table public.platform_review_subjects (
  subject_key text primary key,
  name text not null,
  description text not null default '',
  personal_reviews_enabled boolean not null default false,
  organization_reviews_enabled boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_review_subjects_key_check
    check (subject_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint platform_review_subjects_name_check
    check (length(trim(name)) between 2 and 120),
  constraint platform_review_subjects_description_check
    check (length(description) <= 600),
  constraint platform_review_subjects_sort_order_check
    check (sort_order between 0 and 10000),
  constraint platform_review_subjects_scope_check
    check (personal_reviews_enabled or organization_reviews_enabled)
);

comment on table public.platform_review_subjects is
  'Products and services available to the separate N3XRA-wide reviews system. Records is intentionally excluded because it retains its existing product-specific review implementation.';

create table public.platform_reviews (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  subject_key text not null references public.platform_review_subjects (subject_key) on update cascade on delete restrict,
  author_user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete cascade,
  rating smallint not null,
  review_text text not null,
  reviewer_name_snapshot text not null,
  organization_name_snapshot text,
  status text not null default 'pending',
  is_featured boolean not null default false,
  moderation_note text,
  moderated_by_user_id uuid references auth.users (id) on delete set null,
  moderated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_reviews_scope_check
    check (scope in ('personal', 'organization')),
  constraint platform_reviews_shape_check
    check (
      (scope = 'personal' and organization_id is null and organization_name_snapshot is null)
      or
      (scope = 'organization' and organization_id is not null and organization_name_snapshot is not null)
    ),
  constraint platform_reviews_rating_check
    check (rating between 1 and 5),
  constraint platform_reviews_text_check
    check (length(trim(review_text)) between 10 and 4000),
  constraint platform_reviews_reviewer_name_check
    check (length(trim(reviewer_name_snapshot)) between 1 and 180),
  constraint platform_reviews_organization_name_check
    check (organization_name_snapshot is null or length(trim(organization_name_snapshot)) between 1 and 180),
  constraint platform_reviews_status_check
    check (status in ('pending', 'changes_requested', 'published', 'hidden', 'rejected')),
  constraint platform_reviews_moderation_note_check
    check (moderation_note is null or length(moderation_note) <= 2000),
  constraint platform_reviews_moderation_state_check
    check (
      (status = 'published' and published_at is not null and moderated_at is not null)
      or
      (status <> 'published' and published_at is null)
    ),
  constraint platform_reviews_featured_state_check
    check (not is_featured or status = 'published')
);

comment on table public.platform_reviews is
  'N3XRA-wide personal and official organization reviews. This table is intentionally separate from public.reviews, which remains owned by Records and legacy product-specific review flows.';

create unique index platform_reviews_personal_subject_uidx
on public.platform_reviews (author_user_id, subject_key)
where scope = 'personal' and author_user_id is not null;

create unique index platform_reviews_organization_subject_uidx
on public.platform_reviews (organization_id, subject_key)
where scope = 'organization' and organization_id is not null;

create index platform_reviews_status_created_idx
on public.platform_reviews (status, created_at desc);

create index platform_reviews_author_created_idx
on public.platform_reviews (author_user_id, created_at desc)
where author_user_id is not null;

create index platform_reviews_organization_created_idx
on public.platform_reviews (organization_id, created_at desc)
where organization_id is not null;

create trigger platform_review_subjects_set_updated_at
before update on public.platform_review_subjects
for each row execute function public.set_updated_at();

create trigger platform_reviews_set_updated_at
before update on public.platform_reviews
for each row execute function public.set_updated_at();

create or replace function private.prepare_platform_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := coalesce(public.is_platform_admin(), false);
  resolved_reviewer_name text;
  resolved_organization_name text;
begin
  if actor_id is null then
    raise exception 'Authentication is required to manage a platform review.';
  end if;

  if tg_op = 'UPDATE' and not actor_is_admin then
    if new.id is distinct from old.id
      or new.scope is distinct from old.scope
      or new.subject_key is distinct from old.subject_key
      or new.author_user_id is distinct from old.author_user_id
      or new.organization_id is distinct from old.organization_id then
      raise exception 'The review identity cannot be changed. Create a different review instead.';
    end if;
  end if;

  if not actor_is_admin then
    if tg_op = 'INSERT' then
      new.author_user_id := actor_id;
    elsif new.author_user_id is distinct from actor_id and new.scope = 'personal' then
      raise exception 'A personal review can only be edited by its author.';
    end if;

    select nullif(trim(coalesce(profile.full_name, profile.email, '')), '')
      into resolved_reviewer_name
    from public.profiles as profile
    where profile.id = new.author_user_id;

    new.reviewer_name_snapshot := coalesce(resolved_reviewer_name, 'N3XRA customer');

    if new.scope = 'organization' then
      select nullif(trim(organization.name), '')
        into resolved_organization_name
      from public.organizations as organization
      where organization.id = new.organization_id;

      if resolved_organization_name is null then
        raise exception 'Choose an organization you are allowed to manage.';
      end if;
      new.organization_name_snapshot := resolved_organization_name;
    else
      new.organization_id := null;
      new.organization_name_snapshot := null;
    end if;

    new.status := 'pending';
    new.is_featured := false;
    new.moderation_note := null;
    new.moderated_by_user_id := null;
    new.moderated_at := null;
    new.published_at := null;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.moderated_by_user_id := actor_id;
    new.moderated_at := now();
    new.published_at := case when new.status = 'published' then now() else null end;
    if new.status <> 'published' then
      new.is_featured := false;
    end if;
  elsif tg_op = 'INSERT' then
    new.moderated_by_user_id := actor_id;
    new.moderated_at := case when new.status = 'pending' then null else now() end;
    new.published_at := case when new.status = 'published' then now() else null end;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_platform_review() from public, anon, authenticated;

create trigger platform_reviews_prepare_submission
before insert or update on public.platform_reviews
for each row execute function private.prepare_platform_review();

alter table public.platform_review_subjects enable row level security;
alter table public.platform_reviews enable row level security;

revoke all on public.platform_review_subjects from anon, authenticated;
revoke all on public.platform_reviews from anon, authenticated;
grant select on public.platform_review_subjects to authenticated;
grant select, insert, update, delete on public.platform_reviews to authenticated;
grant all on public.platform_review_subjects to service_role;
grant all on public.platform_reviews to service_role;

create policy "platform_review_subjects_select"
on public.platform_review_subjects
for select
to authenticated
using (is_active or (select public.is_platform_admin()));

create policy "platform_review_subjects_admin_insert"
on public.platform_review_subjects
for insert
to authenticated
with check ((select public.is_platform_admin()));

create policy "platform_review_subjects_admin_update"
on public.platform_review_subjects
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "platform_review_subjects_admin_delete"
on public.platform_review_subjects
for delete
to authenticated
using ((select public.is_platform_admin()));

create policy "platform_reviews_select"
on public.platform_reviews
for select
to authenticated
using (
  (select public.is_platform_admin())
  or author_user_id = (select auth.uid())
  or (
    scope = 'organization'
    and organization_id is not null
    and public.can_view_organization(organization_id)
  )
);

create policy "platform_reviews_insert"
on public.platform_reviews
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  or (
    status = 'pending'
    and author_user_id = (select auth.uid())
    and (
      (
        scope = 'personal'
        and organization_id is null
        and exists (
          select 1
          from public.platform_review_subjects as subject
          where subject.subject_key = platform_reviews.subject_key
            and subject.is_active
            and subject.personal_reviews_enabled
        )
      )
      or
      (
        scope = 'organization'
        and organization_id is not null
        and public.can_manage_org_settings(organization_id)
        and exists (
          select 1
          from public.platform_review_subjects as subject
          where subject.subject_key = platform_reviews.subject_key
            and subject.is_active
            and subject.organization_reviews_enabled
        )
      )
    )
  )
);

create policy "platform_reviews_update"
on public.platform_reviews
for update
to authenticated
using (
  (select public.is_platform_admin())
  or (scope = 'personal' and author_user_id = (select auth.uid()))
  or (scope = 'organization' and organization_id is not null and public.can_manage_org_settings(organization_id))
)
with check (
  (select public.is_platform_admin())
  or (
    status = 'pending'
    and (
      (scope = 'personal' and author_user_id = (select auth.uid()) and organization_id is null)
      or
      (scope = 'organization' and organization_id is not null and public.can_manage_org_settings(organization_id))
    )
  )
);

create policy "platform_reviews_delete"
on public.platform_reviews
for delete
to authenticated
using (
  (select public.is_platform_admin())
  or (scope = 'personal' and author_user_id = (select auth.uid()))
  or (scope = 'organization' and organization_id is not null and public.can_manage_org_settings(organization_id))
);

create or replace function public.list_published_platform_reviews(
  input_subject_key text default null,
  input_limit integer default 24
)
returns table (
  id uuid,
  scope text,
  subject_key text,
  subject_name text,
  rating smallint,
  review_text text,
  reviewer_name text,
  organization_name text,
  is_featured boolean,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    review.id,
    review.scope,
    review.subject_key,
    subject.name,
    review.rating,
    review.review_text,
    review.reviewer_name_snapshot,
    review.organization_name_snapshot,
    review.is_featured,
    review.published_at
  from public.platform_reviews as review
  join public.platform_review_subjects as subject on subject.subject_key = review.subject_key
  where review.status = 'published'
    and review.published_at is not null
    and subject.is_active
    and (input_subject_key is null or review.subject_key = input_subject_key)
  order by review.is_featured desc, review.published_at desc, review.id
  limit least(greatest(coalesce(input_limit, 24), 1), 100);
$$;

revoke all on function public.list_published_platform_reviews(text, integer) from public;
grant execute on function public.list_published_platform_reviews(text, integer) to anon, authenticated;

insert into public.platform_review_subjects (
  subject_key,
  name,
  description,
  personal_reviews_enabled,
  organization_reviews_enabled,
  sort_order
)
values
  ('n3xra', 'N3XRA overall', 'Share your overall experience working with N3XRA.', true, true, 10),
  ('websites', 'N3XRA Websites', 'Review your website project or ongoing website service.', true, true, 20),
  ('communications', 'N3XRA Communications', 'Review the communications tools used by your organization.', false, true, 30),
  ('contact_cards', 'N3XRA Contact Cards', 'Review your digital or physical N3XRA Contact Card.', true, true, 40),
  ('project_cards', 'N3XRA Project Cards', 'Review connected project pages and physical project cards.', false, true, 50),
  ('files_assets', 'N3XRA Files & Assets', 'Review your organization’s shared file and asset workspace.', false, true, 60),
  ('ai_music', 'N3XRA AI Music', 'Review your personal AI Music experience.', true, false, 70);
