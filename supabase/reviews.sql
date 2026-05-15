create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  review_target_type text not null,
  review_target_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  rating smallint not null,
  review_text text not null,
  reviewer_name_snapshot text,
  organization_name_snapshot text,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_app_check
    check (app in ('records', 'ai_music')),
  constraint reviews_target_type_check
    check (review_target_type in ('organization', 'profile')),
  constraint reviews_target_shape_check
    check (
      (app = 'records' and review_target_type = 'organization' and (organization_id = review_target_id or organization_id is null))
      or
      (app = 'ai_music' and review_target_type = 'profile' and organization_id is null)
    ),
  constraint reviews_rating_check
    check (rating between 1 and 5),
  constraint reviews_status_check
    check (status in ('published', 'hidden'))
);

alter table public.reviews
  drop constraint if exists reviews_target_shape_check;

alter table public.reviews
  add constraint reviews_target_shape_check
  check (
    (app = 'records' and review_target_type = 'organization' and (organization_id = review_target_id or organization_id is null))
    or
    (app = 'ai_music' and review_target_type = 'profile' and organization_id is null)
  );

create unique index if not exists reviews_target_unique_idx
on public.reviews (app, review_target_type, review_target_id);

create index if not exists reviews_app_status_created_at_idx
on public.reviews (app, status, created_at desc);

create index if not exists reviews_user_id_idx
on public.reviews (user_id);

create index if not exists reviews_organization_id_idx
on public.reviews (organization_id);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute procedure public.set_updated_at();

alter table public.reviews enable row level security;

drop policy if exists "reviews_select_policy" on public.reviews;
create policy "reviews_select_policy"
on public.reviews
for select
using (
  public.is_platform_admin()
  or (
    app = 'records'
    and organization_id is not null
    and public.can_view_organization(organization_id)
  )
  or (
    app = 'ai_music'
    and user_id = auth.uid()
  )
);

drop policy if exists "reviews_insert_policy" on public.reviews;
create policy "reviews_insert_policy"
on public.reviews
for insert
with check (
  (
    app = 'records'
    and review_target_type = 'organization'
    and organization_id = review_target_id
    and user_id = auth.uid()
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and review_target_type = 'profile'
    and review_target_id = auth.uid()
    and user_id = auth.uid()
    and organization_id is null
  )
  or public.is_platform_admin()
);

drop policy if exists "reviews_update_policy" on public.reviews;
create policy "reviews_update_policy"
on public.reviews
for update
using (
  public.is_platform_admin()
  or (
    app = 'records'
    and organization_id is not null
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and user_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or (
    app = 'records'
    and review_target_type = 'organization'
    and organization_id = review_target_id
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and review_target_type = 'profile'
    and review_target_id = auth.uid()
    and user_id = auth.uid()
    and organization_id is null
  )
);
