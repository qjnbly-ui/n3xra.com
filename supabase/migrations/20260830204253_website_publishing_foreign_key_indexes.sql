create index if not exists website_publishing_settings_hero_version_idx
  on public.website_publishing_settings (hero_asset_version_id);
create index if not exists website_publishing_settings_updated_by_idx
  on public.website_publishing_settings (updated_by_user_id);

create index if not exists website_posts_created_by_idx
  on public.website_posts (created_by_user_id);
create index if not exists website_posts_updated_by_idx
  on public.website_posts (updated_by_user_id);

create index if not exists website_post_media_website_idx
  on public.website_post_media (website_id);
create index if not exists website_post_media_asset_version_idx
  on public.website_post_media (asset_version_id);
create index if not exists website_post_media_created_by_idx
  on public.website_post_media (created_by_user_id);

create index if not exists website_story_submissions_asset_idx
  on public.website_story_submissions (asset_id);
create index if not exists website_story_submissions_asset_version_idx
  on public.website_story_submissions (asset_version_id);
create index if not exists website_story_submissions_post_idx
  on public.website_story_submissions (post_id);
create index if not exists website_story_submissions_reviewed_by_idx
  on public.website_story_submissions (reviewed_by_user_id);
;
