# Production security findings — read-only remediation report

Snapshot date: 2026-08-13  
Production project inspected read-only: `vdbjlgmbpykjblprqnak`

## Scope and status

This report preserves the production security findings separately from the Nexra Communications migration. It is advisory only.

No function access was revoked, no function was changed between `SECURITY DEFINER` and `SECURITY INVOKER`, no schema or extension was moved, no RLS policy was added or removed, and no authentication setting was changed.

Current Supabase security-advisor result: **142 findings** — 136 warnings and 6 informational findings.

## Findings by category

- 44 `SECURITY DEFINER` functions executable by `anon`
- 70 `SECURITY DEFINER` functions executable by `authenticated`
- 20 functions with mutable `search_path`
- 6 RLS-enabled tables with no policy
- 1 extension installed in `public` (`citext`)
- 1 disabled Auth leaked-password-protection setting

The anon and authenticated function lists overlap where a function is callable by both roles; the counts are advisor findings, not unique function counts.

## RLS enabled with no policy

- `document_share_links`
- `platform_support_requests`
- `records_demo_workspace_claims`
- `records_voice_profiles`
- `website_proposal_ai_runs`
- `website_stripe_events`

Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

These tables require individual intent review. “No policy” can deliberately deny all Data API access, so remediation should not add permissive policies mechanically.

## Mutable search path

- `public.jsonb_first_text`
- `public.normalize_account_billing_status`
- `public.normalize_membership_account_type`
- `public.protect_account_member_update`
- `public.protect_heater_use_update`
- `public.protect_music_profile_billing_fields`
- `public.protect_organization_billing_fields`
- `public.protect_profile_billing_fields`
- `public.protect_timesheet_update`
- `public.protect_virals_creator_billing_fields`
- `public.protect_virals_profile_billing_fields`
- `public.set_updated_at`
- `public.set_virals_updated_at`
- `public.slugify`
- `public.storage_object_org_id`
- `public.try_parse_bool`
- `public.try_parse_date`
- `public.try_parse_int`
- `public.try_parse_timestamptz`
- `public.unique_org_slug`

Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

Recommended review: qualify referenced objects and set a safe fixed `search_path`, especially for privileged functions and triggers. Test each change independently because these are shared production functions.

## SECURITY DEFINER executable by anon

- `public.account_billing_allows_access(account uuid, member_type public.membership_account_type)`
- `public.alert_unauthorized_sign_in()`
- `public.auto_sign_out_open_rows(sign_out_time timestamp with time zone)`
- `public.bill_guest_entry()`
- `public.bill_heater_use_entry()`
- `public.bootstrap_music_profile()`
- `public.bootstrap_organization(input_organization_name text, input_invite_code text)`
- `public.can_manage_billing(target_organization_id uuid)`
- `public.can_manage_documents(target_organization_id uuid)`
- `public.can_manage_members(target_organization_id uuid)`
- `public.can_manage_org_settings(target_organization_id uuid)`
- `public.can_manage_recordings(target_organization_id uuid)`
- `public.can_manage_templates(target_organization_id uuid)`
- `public.can_manage_utility_organization(target_organization_id uuid)`
- `public.can_read_heater_group_member(heater_entry_id uuid, group_account_member uuid)`
- `public.can_read_heater_use_entry(heater_entry_id uuid, responsible_member uuid)`
- `public.can_view_organization(target_organization_id uuid)`
- `public.can_view_utility_organization(target_organization_id uuid)`
- `public.create_organization_invite(input_organization_id uuid, input_role text, input_max_uses integer, input_expires_at timestamp with time zone)`
- `public.create_owned_organization(input_organization_name text)`
- `public.current_account_id()`
- `public.current_account_member_id()`
- `public.enqueue_heater_automation()`
- `public.enqueue_timesheet_insert_automation()`
- `public.enqueue_timesheet_sign_out_automation()`
- `public.get_public_embed_config(input_organization_id uuid)`
- `public.get_public_embed_config_by_slug(input_slug text)`
- `public.get_public_embed_documents(input_organization_id uuid)`
- `public.is_admin()`
- `public.is_platform_admin()`
- `public.is_platform_owner()`
- `public.is_sign_in_authorized(member uuid, signed_in_time timestamp with time zone)`
- `public.is_virals_admin()`
- `public.member_can_bring_guests(member uuid)`
- `public.member_can_use_heater(member uuid)`
- `public.member_has_access(member uuid)`
- `public.organization_role(target_organization_id uuid)`
- `public.platform_set_organization_owner(input_organization_id uuid, input_user_id uuid)`
- `public.remove_organization_member(input_membership_id uuid)`
- `public.reserve_music_generation(input_title text, input_prompt text, input_lyrics text, input_instrumental boolean)`
- `public.resolve_website_portal(portal_hostname text)`
- `public.sync_current_memberships_to_app_tables()`
- `public.update_membership_role(input_membership_id uuid, input_role text)`
- `public.utility_member_role(target_organization_id uuid)`

Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

Recommended review order:

1. Classify each RPC as intentionally public, indirectly required by an RLS policy, trigger-only, or internal.
2. For internal/trigger-only functions, revoke API-facing execution or move implementation into a non-exposed schema.
3. For intentionally public functions, verify explicit caller checks, tenant predicates, fixed `search_path`, input validation, and least-privilege grants.
4. Regression-test public embeds, onboarding, billing gates, utility access, and organization membership before changing grants.

## SECURITY DEFINER executable by authenticated

- `public.accept_loan_invitation(input_token text)`
- `public.account_billing_allows_access(account uuid, member_type public.membership_account_type)`
- `public.active_records_support_grant(target_organization_id uuid)`
- `public.alert_unauthorized_sign_in()`
- `public.apply_website_proposal_ai_run(target_run_id uuid, accepted_operation_ids text[], rejected_operation_ids text[])`
- `public.auto_sign_out_open_rows(sign_out_time timestamp with time zone)`
- `public.begin_records_emergency_access(input_organization_id uuid, input_reason text)`
- `public.bill_guest_entry()`
- `public.bill_heater_use_entry()`
- `public.bootstrap_music_profile()`
- `public.bootstrap_organization(input_organization_name text, input_invite_code text)`
- `public.can_change_records_content(target_organization_id uuid)`
- `public.can_change_records_recordings(target_organization_id uuid)`
- `public.can_change_records_templates(target_organization_id uuid)`
- `public.can_edit_client_website(target_website_id uuid)`
- `public.can_manage_billing(target_organization_id uuid)`
- `public.can_manage_client_website(target_website_id uuid)`
- `public.can_manage_documents(target_organization_id uuid)`
- `public.can_manage_members(target_organization_id uuid)`
- `public.can_manage_org_settings(target_organization_id uuid)`
- `public.can_manage_recordings(target_organization_id uuid)`
- `public.can_manage_records_support(target_organization_id uuid)`
- `public.can_manage_templates(target_organization_id uuid)`
- `public.can_manage_utility_organization(target_organization_id uuid)`
- `public.can_read_heater_group_member(heater_entry_id uuid, group_account_member uuid)`
- `public.can_read_heater_use_entry(heater_entry_id uuid, responsible_member uuid)`
- `public.can_view_client_website(target_website_id uuid)`
- `public.can_view_organization(target_organization_id uuid)`
- `public.can_view_records_documents(target_organization_id uuid)`
- `public.can_view_records_recordings(target_organization_id uuid)`
- `public.can_view_utility_organization(target_organization_id uuid)`
- `public.create_organization_invite(input_organization_id uuid, input_role text, input_max_uses integer, input_expires_at timestamp with time zone)`
- `public.create_owned_organization(input_organization_name text)`
- `public.create_website_proposal_draft_revision(target_version_id uuid)`
- `public.current_account_id()`
- `public.current_account_member_id()`
- `public.delete_website_proposal_draft_version(target_version_id uuid)`
- `public.end_records_emergency_access(input_emergency_access_id uuid)`
- `public.enqueue_heater_automation()`
- `public.enqueue_timesheet_insert_automation()`
- `public.enqueue_timesheet_sign_out_automation()`
- `public.get_meeting_recording_private_content(input_organization_id uuid, input_recording_ids uuid[])`
- `public.get_public_embed_config(input_organization_id uuid)`
- `public.get_public_embed_config_by_slug(input_slug text)`
- `public.get_public_embed_documents(input_organization_id uuid)`
- `public.has_records_support_scope(target_organization_id uuid, requested_scope text)`
- `public.is_admin()`
- `public.is_platform_admin()`
- `public.is_platform_owner()`
- `public.is_records_organization_member(target_organization_id uuid)`
- `public.is_sign_in_authorized(member uuid, signed_in_time timestamp with time zone)`
- `public.is_virals_admin()`
- `public.member_can_bring_guests(member uuid)`
- `public.member_can_use_heater(member uuid)`
- `public.member_has_access(member uuid)`
- `public.organization_role(target_organization_id uuid)`
- `public.platform_set_organization_owner(input_organization_id uuid, input_user_id uuid)`
- `public.reconcile_records_support_expirations(input_organization_id uuid)`
- `public.record_records_support_event(input_organization_id uuid, input_event_type text, input_resource_type text, input_resource_id text, input_reason text, input_metadata jsonb)`
- `public.redeem_invite_code(input_code text)`
- `public.remove_organization_member(input_membership_id uuid)`
- `public.reserve_music_generation(input_title text, input_prompt text, input_lyrics text, input_instrumental boolean)`
- `public.resolve_website_portal(portal_hostname text)`
- `public.reveal_loan_number(input_loan_account_id uuid)`
- `public.sync_current_memberships_to_app_tables()`
- `public.transfer_record_packet(input_recording_id uuid, input_target_organization_id uuid, input_recording_storage_path text, input_transcript_storage_path text)`
- `public.update_loan_account_settings(input_loan_account_id uuid, input_changes jsonb)`
- `public.update_membership_role(input_membership_id uuid, input_role text)`
- `public.utility_member_role(target_organization_id uuid)`
- `public.website_member_role(target_website_id uuid)`

Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Recommended review order is the same as the anon inventory, with added tenant-boundary and privilege-escalation tests for every authenticated RPC.

## Extension in public schema

- `citext`

Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public

This should be handled in a dedicated migration after dependency analysis. Moving an extension can affect object resolution and must not be bundled into Communications.

## Auth leaked-password protection disabled

Supabase Auth leaked-password protection is disabled.

Remediation reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

This is an authentication configuration change and is explicitly excluded from the Communications deployment.

## Recommended separate remediation sequence

1. Confirm which no-policy tables are intentionally deny-all.
2. Audit the 44 anonymous privileged RPC findings first.
3. Audit remaining authenticated privileged RPCs by product/tenant boundary.
4. Fix mutable `search_path` in small product-scoped batches.
5. Review `citext` dependencies before moving it.
6. Enable leaked-password protection only through a separately approved Auth change.
7. Verify each batch on a disposable preview branch and run security advisors again.

None of these actions is included in the Communications migrations.
