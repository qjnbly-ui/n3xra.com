-- Diagnostics share the existing administrator-only RLS and service-role write access.
alter table public.website_build_events add column technical_notes text;
comment on column public.website_build_events.technical_notes is
  'Redacted developer diagnostics, separate from the user-facing message; hidden by default in Build Studio.';

