alter table public.virals_creator_applications
  drop constraint if exists virals_creator_applications_normalized_code_key;

drop index if exists public.virals_creator_applications_normalized_code_active_idx;

create unique index virals_creator_applications_normalized_code_active_idx
on public.virals_creator_applications (normalized_code)
where status <> 'rejected';
