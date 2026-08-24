alter table public.platform_support_requests
  add column if not exists intake_mode text not null default 'standard',
  add column if not exists change_kind text,
  add column if not exists change_scope text,
  add column if not exists automation_status text not null default 'not_requested',
  add column if not exists assistant_summary text;

alter table public.platform_support_requests
  drop constraint if exists platform_support_requests_intake_mode_check,
  add constraint platform_support_requests_intake_mode_check
    check (intake_mode in ('standard', 'ai_assisted', 'sms')),
  drop constraint if exists platform_support_requests_change_kind_check,
  add constraint platform_support_requests_change_kind_check
    check (change_kind is null or change_kind in ('business_hours', 'contact_information', 'content', 'asset', 'design', 'functionality', 'code', 'other')),
  drop constraint if exists platform_support_requests_change_scope_check,
  add constraint platform_support_requests_change_scope_check
    check (change_scope is null or change_scope in ('content', 'code', 'unknown')),
  drop constraint if exists platform_support_requests_automation_status_check,
  add constraint platform_support_requests_automation_status_check
    check (automation_status in ('not_requested', 'awaiting_review', 'approved', 'queued', 'running', 'preview_ready', 'rejected', 'failed', 'completed')),
  drop constraint if exists platform_support_requests_assistant_summary_check,
  add constraint platform_support_requests_assistant_summary_check
    check (assistant_summary is null or char_length(btrim(assistant_summary)) between 1 and 1000);

create index if not exists platform_support_requests_ai_review_idx
on public.platform_support_requests (website_id, automation_status, updated_at desc)
where intake_mode = 'ai_assisted';

grant select (
  intake_mode,
  change_kind,
  change_scope,
  automation_status,
  assistant_summary
) on public.platform_support_requests to authenticated;

comment on column public.platform_support_requests.intake_mode is
'How the client request entered the support workflow. AI-assisted and SMS requests remain human-reviewed.';
comment on column public.platform_support_requests.automation_status is
'Controlled automation lifecycle. AI intake starts at awaiting_review and cannot publish or edit code.';
comment on column public.platform_support_requests.assistant_summary is
'Client-visible summary produced during intake. The original client message remains authoritative.';
