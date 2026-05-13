alter table public.organizations
  add column if not exists records_ai_context text,
  add column if not exists records_ai_response_style text,
  add column if not exists records_ai_memory text;

alter table public.documents
  add column if not exists records_ai_note text;
