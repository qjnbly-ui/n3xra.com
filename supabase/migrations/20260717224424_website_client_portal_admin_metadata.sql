alter table public.client_websites
add column if not exists repository_full_name text;

alter table public.website_asset_versions
add column if not exists rejected_by_user_id uuid references auth.users (id) on delete set null,
add column if not exists rejected_at timestamptz,
add column if not exists rejection_reason text;

create index if not exists website_asset_versions_rejected_by_user_id_idx
on public.website_asset_versions (rejected_by_user_id);
