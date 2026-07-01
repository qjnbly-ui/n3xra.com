alter table public.organizations
  alter column storage_limit_mb set default 1024;

alter table public.organizations
  alter column user_limit set default 1;

alter table public.music_profiles
  alter column monthly_song_limit set default 2;

update public.organizations
set
  document_limit = 25,
  user_limit = 1,
  storage_limit_mb = 1024
where subscription_tier = 'free';

update public.organizations
set
  document_limit = 1000,
  user_limit = 1,
  storage_limit_mb = 10240
where subscription_tier = 'starter';

update public.organizations
set
  document_limit = 10000,
  user_limit = 15,
  storage_limit_mb = 51200
where subscription_tier = 'organization';

update public.music_profiles
set monthly_song_limit = 2
where plan = 'free';

update public.music_profiles
set monthly_song_limit = 25
where plan = 'creator';

update public.music_profiles
set monthly_song_limit = 100
where plan = 'studio';
