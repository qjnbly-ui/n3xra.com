alter table public.careers_applications
  add column if not exists proposed_title text,
  add column if not exists role_vision text,
  add column if not exists n3xra_interest text,
  add column if not exists contribution_vision text,
  add column if not exists contribution_areas text[] not null default '{}'::text[],
  add column if not exists participation_preferences text[] not null default '{}'::text[];

alter table public.careers_applications
  alter column role_interest set default 'open_to_best_fit',
  alter column experience_level set default 'not_specified',
  alter column message set default '';

alter table public.careers_applications
  drop constraint if exists careers_applications_role_check,
  drop constraint if exists careers_applications_experience_level_check,
  drop constraint if exists careers_applications_proposed_title_length_check,
  drop constraint if exists careers_applications_role_vision_length_check,
  drop constraint if exists careers_applications_n3xra_interest_length_check,
  drop constraint if exists careers_applications_contribution_vision_length_check,
  drop constraint if exists careers_applications_contribution_areas_check,
  drop constraint if exists careers_applications_participation_preferences_check;

alter table public.careers_applications
  add constraint careers_applications_role_check
  check (
    role_interest in (
      'open_to_best_fit',
      'software_product',
      'websites_portals',
      'design_brand',
      'ai_automation',
      'business_development',
      'sales',
      'marketing_communications',
      'content_social',
      'partnerships',
      'client_success',
      'operations',
      'project_delivery',
      'support',
      'finance',
      'leadership_strategy',
      'research',
      'internship_learning',
      'advisor',
      'investor',
      'frontend_developer',
      'software_developer',
      'design',
      'internship',
      'other'
    )
  ),
  add constraint careers_applications_experience_level_check
  check (experience_level in ('not_specified', 'student', 'entry_level', 'junior', 'mid_level', 'senior')),
  add constraint careers_applications_proposed_title_length_check
  check (length(coalesce(proposed_title, '')) <= 160),
  add constraint careers_applications_role_vision_length_check
  check (length(coalesce(role_vision, '')) <= 4000),
  add constraint careers_applications_n3xra_interest_length_check
  check (length(coalesce(n3xra_interest, '')) <= 4000),
  add constraint careers_applications_contribution_vision_length_check
  check (length(coalesce(contribution_vision, '')) <= 5000),
  add constraint careers_applications_contribution_areas_check
  check (
    cardinality(contribution_areas) <= 18
    and contribution_areas <@ array[
      'software_product',
      'websites_portals',
      'design_brand',
      'ai_automation',
      'business_development',
      'sales',
      'marketing_communications',
      'content_social',
      'partnerships',
      'client_success',
      'operations',
      'project_delivery',
      'support',
      'finance',
      'leadership_strategy',
      'research',
      'internship_learning',
      'other'
    ]::text[]
  ),
  add constraint careers_applications_participation_preferences_check
  check (
    cardinality(participation_preferences) <= 8
    and participation_preferences <@ array[
      'employment',
      'contract_project',
      'commission',
      'equity_ownership',
      'investor',
      'advisor',
      'internship',
      'open_to_discussion'
    ]::text[]
  );

comment on column public.careers_applications.proposed_title is
  'The title the applicant would propose for their own contribution at N3XRA.';
comment on column public.careers_applications.role_vision is
  'The responsibilities and ownership the applicant imagines for that role.';
comment on column public.careers_applications.n3xra_interest is
  'What stands out to the applicant about N3XRA.';
comment on column public.careers_applications.contribution_vision is
  'Where the applicant believes they could create the clearest value.';
comment on column public.careers_applications.contribution_areas is
  'One or more company areas where the applicant would like to contribute.';
comment on column public.careers_applications.participation_preferences is
  'Employment, commission, contract, ownership, investment, advisory, learning, or open-ended relationship interests.';
