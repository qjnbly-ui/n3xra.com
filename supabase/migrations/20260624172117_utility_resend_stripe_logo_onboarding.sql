insert into storage.buckets (id, name, public)
values ('organization-assets', 'organization-assets', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'organization-assets';

delete from public.utility_portal_launch_steps
where step_key = 'email_sender_setup';

update public.utility_portal_launch_steps
set
  description = 'Stripe Connect readiness.',
  status = case when status = 'not_started' then 'in_progress' else status end,
  required = true,
  updated_at = now(),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('payment_mode', 'stripe_connect')
where step_key = 'payment_setup';

update public.utility_organization_settings
set
  modules = coalesce(modules, '{}'::jsonb) - 'custom_email',
  notification_settings = coalesce(notification_settings, '{}'::jsonb)
    || jsonb_build_object('email_provider', 'resend', 'custom_sender_requested', false),
  launch_checklist = coalesce(launch_checklist, '{}'::jsonb) - 'email_sender_setup',
  updated_at = now()
where launch_checklist ? 'email_sender_setup'
   or modules ? 'custom_email'
   or notification_settings ? 'custom_sender_requested';

update public.utility_organization_settings
set
  modules = (coalesce(modules, '{}'::jsonb) - 'custom_email')
    || jsonb_build_object('payments', true, 'stripe_connect', true),
  payment_preferences = (coalesce(payment_preferences, '{}'::jsonb) - 'existing_payment_url')
    || jsonb_build_object('wants_stripe_connect', true, 'payment_mode', 'stripe_connect'),
  updated_at = now();

update public.utility_organizations
set
  stripe_connect_status = case
    when stripe_connect_status = 'disabled' then 'not_started'
    else stripe_connect_status
  end,
  updated_at = now();
