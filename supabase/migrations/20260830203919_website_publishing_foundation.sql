create table if not exists public.website_publishing_settings (
  website_id uuid primary key references public.client_websites (id) on delete cascade,
  page_title text not null default 'From the Greenhouse',
  page_kicker text not null default 'Stories, finds, and life on the farm',
  page_intro text,
  hero_asset_version_id uuid references public.website_asset_versions (id) on delete set null,
  client_auto_publish boolean not null default true,
  public_submissions_enabled boolean not null default false,
  public_submissions_auto_publish boolean not null default false,
  updated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_posts (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  post_type text not null default 'update',
  slug text not null,
  title text not null,
  excerpt text,
  body text not null default '',
  status text not null default 'draft',
  featured boolean not null default false,
  published_at timestamptz,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_posts_slug_unique unique (website_id, slug),
  constraint website_posts_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint website_posts_type_check check (post_type in ('update', 'new_piece', 'farm_story', 'customer_story', 'event')),
  constraint website_posts_status_check check (status in ('draft', 'published', 'archived')),
  constraint website_posts_title_check check (char_length(btrim(title)) between 1 and 180),
  constraint website_posts_excerpt_check check (excerpt is null or char_length(excerpt) <= 500),
  constraint website_posts_body_check check (char_length(body) <= 20000),
  constraint website_posts_publication_check check (
    (status = 'published' and published_at is not null)
    or (status <> 'published')
  )
);

create table if not exists public.website_post_media (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  post_id uuid not null references public.website_posts (id) on delete cascade,
  asset_id uuid not null references public.website_assets (id) on delete restrict,
  asset_version_id uuid not null references public.website_asset_versions (id) on delete restrict,
  sort_order integer not null default 0,
  alt_text text,
  caption text,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_post_media_unique_version unique (post_id, asset_version_id),
  constraint website_post_media_sort_check check (sort_order >= 0),
  constraint website_post_media_alt_check check (alt_text is null or char_length(alt_text) <= 500),
  constraint website_post_media_caption_check check (caption is null or char_length(caption) <= 1000)
);

create table if not exists public.website_story_submissions (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  submitter_name text not null,
  submitter_email text not null,
  story_title text,
  story_body text not null,
  display_name_preference text not null default 'first_name',
  permission_to_publish boolean not null default false,
  status text not null default 'pending',
  source_ip_hash text,
  upload_path text,
  upload_secret_hash text,
  asset_id uuid references public.website_assets (id) on delete set null,
  asset_version_id uuid references public.website_asset_versions (id) on delete set null,
  post_id uuid references public.website_posts (id) on delete set null,
  reviewed_by_user_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_story_submissions_status_check check (status in ('pending', 'published', 'rejected', 'withdrawn')),
  constraint website_story_submissions_display_check check (display_name_preference in ('full_name', 'first_name', 'anonymous')),
  constraint website_story_submissions_name_check check (char_length(btrim(submitter_name)) between 1 and 160),
  constraint website_story_submissions_email_check check (char_length(btrim(submitter_email)) between 3 and 320),
  constraint website_story_submissions_title_check check (story_title is null or char_length(story_title) <= 180),
  constraint website_story_submissions_body_check check (char_length(btrim(story_body)) between 1 and 5000)
);

create index if not exists website_posts_website_status_published_idx
  on public.website_posts (website_id, status, published_at desc);
create index if not exists website_posts_website_featured_idx
  on public.website_posts (website_id, featured, published_at desc);
create index if not exists website_post_media_post_sort_idx
  on public.website_post_media (post_id, sort_order, created_at);
create index if not exists website_post_media_asset_idx
  on public.website_post_media (asset_id, asset_version_id);
create index if not exists website_story_submissions_website_status_idx
  on public.website_story_submissions (website_id, status, created_at desc);

drop trigger if exists website_publishing_settings_set_updated_at on public.website_publishing_settings;
create trigger website_publishing_settings_set_updated_at
before update on public.website_publishing_settings
for each row execute function public.set_updated_at();

drop trigger if exists website_posts_set_updated_at on public.website_posts;
create trigger website_posts_set_updated_at
before update on public.website_posts
for each row execute function public.set_updated_at();

drop trigger if exists website_post_media_set_updated_at on public.website_post_media;
create trigger website_post_media_set_updated_at
before update on public.website_post_media
for each row execute function public.set_updated_at();

drop trigger if exists website_story_submissions_set_updated_at on public.website_story_submissions;
create trigger website_story_submissions_set_updated_at
before update on public.website_story_submissions
for each row execute function public.set_updated_at();

alter table public.website_publishing_settings enable row level security;
alter table public.website_posts enable row level security;
alter table public.website_post_media enable row level security;
alter table public.website_story_submissions enable row level security;

revoke all on public.website_publishing_settings from anon;
revoke all on public.website_posts from anon;
revoke all on public.website_post_media from anon;
revoke all on public.website_story_submissions from anon;

grant select, insert, update on public.website_publishing_settings to authenticated;
grant select, insert, update, delete on public.website_posts to authenticated;
grant select, insert, update, delete on public.website_post_media to authenticated;
grant select, update on public.website_story_submissions to authenticated;

grant all on public.website_publishing_settings to service_role;
grant all on public.website_posts to service_role;
grant all on public.website_post_media to service_role;
grant all on public.website_story_submissions to service_role;

drop policy if exists "website_publishing_settings_select" on public.website_publishing_settings;
create policy "website_publishing_settings_select"
on public.website_publishing_settings for select to authenticated
using (public.can_view_client_website(website_id));

drop policy if exists "website_publishing_settings_insert" on public.website_publishing_settings;
create policy "website_publishing_settings_insert"
on public.website_publishing_settings for insert to authenticated
with check (public.can_edit_client_website(website_id) and updated_by_user_id = (select auth.uid()));

drop policy if exists "website_publishing_settings_update" on public.website_publishing_settings;
create policy "website_publishing_settings_update"
on public.website_publishing_settings for update to authenticated
using (public.can_edit_client_website(website_id))
with check (public.can_edit_client_website(website_id) and updated_by_user_id = (select auth.uid()));

drop policy if exists "website_posts_select" on public.website_posts;
create policy "website_posts_select"
on public.website_posts for select to authenticated
using (public.can_view_client_website(website_id));

drop policy if exists "website_posts_insert" on public.website_posts;
create policy "website_posts_insert"
on public.website_posts for insert to authenticated
with check (
  public.can_edit_client_website(website_id)
  and created_by_user_id = (select auth.uid())
  and updated_by_user_id = (select auth.uid())
);

drop policy if exists "website_posts_update" on public.website_posts;
create policy "website_posts_update"
on public.website_posts for update to authenticated
using (public.can_edit_client_website(website_id))
with check (public.can_edit_client_website(website_id) and updated_by_user_id = (select auth.uid()));

drop policy if exists "website_posts_delete" on public.website_posts;
create policy "website_posts_delete"
on public.website_posts for delete to authenticated
using (public.can_edit_client_website(website_id));

drop policy if exists "website_post_media_select" on public.website_post_media;
create policy "website_post_media_select"
on public.website_post_media for select to authenticated
using (public.can_view_client_website(website_id));

drop policy if exists "website_post_media_insert" on public.website_post_media;
create policy "website_post_media_insert"
on public.website_post_media for insert to authenticated
with check (
  public.can_edit_client_website(website_id)
  and created_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.website_posts wp
    where wp.id = post_id and wp.website_id = website_post_media.website_id
  )
  and exists (
    select 1 from public.website_assets wa
    where wa.id = asset_id and wa.website_id = website_post_media.website_id
  )
  and exists (
    select 1 from public.website_asset_versions wav
    where wav.id = asset_version_id and wav.asset_id = website_post_media.asset_id
  )
);

drop policy if exists "website_post_media_update" on public.website_post_media;
create policy "website_post_media_update"
on public.website_post_media for update to authenticated
using (public.can_edit_client_website(website_id))
with check (
  public.can_edit_client_website(website_id)
  and exists (
    select 1 from public.website_posts wp
    where wp.id = post_id and wp.website_id = website_post_media.website_id
  )
  and exists (
    select 1 from public.website_assets wa
    where wa.id = asset_id and wa.website_id = website_post_media.website_id
  )
  and exists (
    select 1 from public.website_asset_versions wav
    where wav.id = asset_version_id and wav.asset_id = website_post_media.asset_id
  )
);

drop policy if exists "website_post_media_delete" on public.website_post_media;
create policy "website_post_media_delete"
on public.website_post_media for delete to authenticated
using (public.can_edit_client_website(website_id));

drop policy if exists "website_story_submissions_select" on public.website_story_submissions;
create policy "website_story_submissions_select"
on public.website_story_submissions for select to authenticated
using (public.can_view_client_website(website_id));

drop policy if exists "website_story_submissions_update" on public.website_story_submissions;
create policy "website_story_submissions_update"
on public.website_story_submissions for update to authenticated
using (public.can_edit_client_website(website_id))
with check (public.can_edit_client_website(website_id));

alter table public.website_portal_features
drop constraint if exists website_portal_features_key_check;

alter table public.website_portal_features
add constraint website_portal_features_key_check check (feature_key in (
  'overview', 'progress', 'files_assets', 'services', 'billing', 'support', 'analytics', 'publishing'
));

insert into public.website_portal_features (website_id, feature_key, enabled)
select id, 'publishing', true
from public.client_websites
where slug = 'roots-and-relics-be7315'
on conflict (website_id, feature_key) do update set enabled = excluded.enabled;

insert into public.website_publishing_settings (website_id, page_title, page_kicker, page_intro, public_submissions_enabled)
select
  id,
  'From the Greenhouse',
  'New pieces · farm stories · gathered moments',
  'A living journal from Roots & Relics—new finds, greenhouse days, and the stories that follow pieces home.',
  true
from public.client_websites
where slug = 'roots-and-relics-be7315'
on conflict (website_id) do update set public_submissions_enabled = true;
;
