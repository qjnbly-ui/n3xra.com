# Migration-history reconciliation report

Date: 2026-08-13  
Production project inspected read-only: `vdbjlgmbpykjblprqnak`  
Supabase organization: `chedalmtnyydujbdjdqj`

## Result

The repository now has a reproducible, pre-ledger foundational baseline, the exact 131 production migration versions/names, 10 ordered supplements for schema changes that exist in production but are missing from its ledger, and the two pending Communications migrations.

Active sequence:

1. `20260515052659_foundational_schema_baseline.sql`
2. 131 production-ledger migrations from `20260612031702` through `20260813191255`
3. 10 production-schema drift supplements in their original dependency order
4. `20260814033024_communications_and_universal_forms_foundation.sql`
5. `20260814033028_roots_relics_communications_seed_forward.sql`

A read-only `supabase migration list --linked` comparison shows every one of the 131 production versions paired one-to-one. The additional local-only active versions are the new foundational baseline, 10 production-schema drift supplements, and the two intentionally pending Communications migrations.

A whitespace-insensitive SQL comparison against a fresh `supabase migration fetch --linked` returned zero differences for all 131 production-ledger files.

## Foundational baseline restored

`20260515052659_foundational_schema_baseline.sql` was reconstructed from the last committed aggregate schema snapshot before the production migration ledger began:

- Source commit: `42908bd9f38c35204c3045b4ac6e5912d33641d3`
- Source commit time: `2026-05-14T22:26:59-07:00` / `2026-05-15T05:26:59Z`
- Source path: `supabase/schema.sql`
- First production-ledger migration: `20260612031702_app_documents.sql`

The baseline was created through `supabase migration new foundational_schema_baseline`, then assigned the source snapshot's UTC timestamp so it runs before the hosted ledger on a fresh database.

## Production-ledger files restored

The following 76 production versions were absent under their actual ledger filenames and were restored from the hosted migration history:

- `20260708194238_add_substance_tracker_tables.sql`
- `20260708195129_remove_wrong_project_substance_tracker_tables.sql`
- `20260719162103_website_services_ownership.sql`
- `20260719162236_website_services_foreign_key_indexes.sql`
- `20260719212710_import_existing_website_projects.sql`
- `20260719215233_complete_close_delete_website_projects.sql`
- `20260719215317_allow_proposal_detach_on_project_delete.sql`
- `20260719221352_website_request_ai_review_audit.sql`
- `20260719224642_website_proposal_line_items_and_email_delivery.sql`
- `20260719234355_website_request_admin_delete.sql`
- `20260720012747_partner_portal_referrals.sql`
- `20260720012834_harden_partner_portal_tables.sql`
- `20260720050945_admin_notification_center.sql`
- `20260721020511_allow_partner_attribution_cleanup_on_delete.sql`
- `20260722164243_records_customer_granted_support_access.sql`
- `20260722164625_records_support_rpc_permissions_hardening.sql`
- `20260722165003_records_support_grant_integrity.sql`
- `20260722165857_preserve_notification_routing_with_records_privacy.sql`
- `20260724150748_isolated_website_billing_foundation.sql`
- `20260724150810_website_billing_operations_phase_two.sql`
- `20260724151126_index_website_billing_operations.sql`
- `20260724151417_index_website_billing_foundation_foreign_keys.sql`
- `20260725182158_website_founder_offer.sql`
- `20260725182241_separate_founder_offer_and_partner_referral.sql`
- `20260727053735_create_loan_tracker_mvp.sql`
- `20260727053817_harden_loan_tracker_table_grants.sql`
- `20260727053844_allow_loan_admin_account_management.sql`
- `20260727140659_loan_tracker_shared_access.sql`
- `20260727140919_fix_loan_access_identity_triggers.sql`
- `20260727141124_index_loan_access_foreign_keys.sql`
- `20260727142824_loan_tracker_settings_audit.sql`
- `20260727162327_n3xra_operations_mvp.sql`
- `20260727162425_index_n3xra_operations_foreign_keys.sql`
- `20260727162547_harden_n3xra_operations_links.sql`
- `20260729232359_link_records_contacts_and_invites.sql`
- `20260729233252_secure_records_invite_redemption.sql`
- `20260730030835_records_phone_meeting_foundation.sql`
- `20260730153121_records_phone_meeting_access_settings.sql`
- `20260730183601_records_phone_meeting_retention_and_reporting.sql`
- `20260730195321_fix_phone_meeting_delete_retention_trigger.sql`
- `20260804015731_add_account_phone_credentials.sql`
- `20260804015839_deny_client_account_phone_access.sql`
- `20260804015923_remove_redundant_account_phone_index.sql`
- `20260804021652_add_receptionist_password_reset_cooldown.sql`
- `20260804050841_sms_consent_events.sql`
- `20260805060448_external_record_packet_transfers.sql`
- `20260805060633_lock_down_external_record_packet_transfers.sql`
- `20260805154400_records_speaker_detection_setting.sql`
- `20260806042903_n3xra_files.sql`
- `20260806215638_admin_push_devices.sql`
- `20260806215730_admin_push_realtime.sql`
- `20260808010359_add_n3xra_files_cdn_publishing.sql`
- `20260808021423_reduce_admin_notification_noise.sql`
- `20260808024426_group_website_asset_batch_notifications.sql`
- `20260808024431_cleanup_empty_website_assets.sql`
- `20260808054047_add_business_information.sql`
- `20260808054201_harden_business_information_access.sql`
- `20260808191701_admin_app_reviewer_role.sql`
- `20260808191844_harden_app_reviewer_lookup.sql`
- `20260809040334_admin_asset_uploads_and_onboarding_import.sql`
- `20260809040346_website_proposal_copilot.sql`
- `20260809054427_preserve_proposal_ai_history_on_draft_delete.sql`
- `20260809060322_proposal_ai_run_retention.sql`
- `20260809062733_allow_admin_reviewed_proposal_ai_changes.sql`
- `20260809065404_onboarding_before_proposal_agreement_flow.sql`
- `20260809222828_careers_applications_and_notes.sql`
- `20260809232040_website_asset_cdn_optimization.sql`
- `20260809233912_website_file_libraries_realtime.sql`
- `20260810135436_add_careers_applicant_details.sql`
- `20260812043254_admin_only_meeting_records_restrictive.sql`
- `20260812053322_scope_admin_only_meeting_content_after_document_enforced.sql`
- `20260812220716_scope_records_storage_policies.sql`
- `20260812221159_scope_legacy_records_storage_policies.sql`
- `20260813144023_website_portal_brand_analysis_cache.sql`
- `20260813144055_lock_down_website_portal_brand_analysis_cache.sql`
- `20260813165301_branded_portal_app_entitlements.sql`

## Same-version SQL reconciled

The following 35 local files had the correct production version/name but materially different stored SQL. Their prior local contents are preserved in the archive, and their active copies now contain the SQL fetched from the production ledger:

- `20260612150238_organization_contacts.sql`
- `20260612150840_tighten_organization_contacts_select.sql`
- `20260612180942_recording_notes_ai_workflow.sql`
- `20260612181158_index_recording_transcript_document.sql`
- `20260618194107_founding_partner_applications.sql`
- `20260624234145_utility_modules.sql`
- `20260717223213_website_client_portal_foundation.sql`
- `20260717223957_website_client_portal_hardening.sql`
- `20260717224424_website_client_portal_admin_metadata.sql`
- `20260718190146_website_service_request_pipeline.sql`
- `20260718203510_website_proposal_approval_workflow.sql`
- `20260718203633_refine_website_proposal_visibility_indexes.sql`
- `20260718205053_website_onboarding_workflow.sql`
- `20260718205438_harden_website_onboarding_lifecycle.sql`
- `20260718211126_website_project_workspace_foundation.sql`
- `20260720153730_attribute_website_partner_referrals.sql`
- `20260720153900_sync_website_partner_referral_status.sql`
- `20260720154025_index_website_partner_attribution.sql`
- `20260720175622_attach_partner_referral_to_accounts.sql`
- `20260724154459_delete_draft_proposal_version.sql`
- `20260724155541_delete_draft_proposal_line_items_first.sql`
- `20260725174512_website_request_service_plan.sql`
- `20260801030703_meeting_recording_resumable_chunks.sql`
- `20260801030742_index_meeting_recording_chunks.sql`
- `20260805043224_transfer_record_packets.sql`
- `20260805054751_records_demo_workspace_claims.sql`
- `20260805135519_add_minutes_style_settings.sql`
- `20260810014359_website_portal_branding_settings.sql`
- `20260813052805_website_portal_tenant_foundation.sql`
- `20260813063024_allow_draft_website_portal_activation.sql`
- `20260813122814_expose_portal_public_brand_identity.sql`
- `20260813122919_expose_portal_public_brand_identity_from_cdn.sql`
- `20260813161533_add_default_portal_return_url.sql`
- `20260813185503_require_explicit_website_organization_links.sql`
- `20260813191255_clarify_website_account_independence.sql`

## Local-only historical files preserved

The following 83 historical files had no matching production ledger version and are preserved unchanged under `supabase/migration-design-references/production-ledger-reconciliation-2026-08-13/`:

- `20260701202838_records_activity_log.sql`
- `20260701234104_platform_admin_owner_invites.sql`
- `20260719161440_website_services_ownership.sql`
- `20260719162220_website_services_foreign_key_indexes.sql`
- `20260719175940_platform_support_admin.sql`
- `20260719212040_import_existing_website_projects.sql`
- `20260719214712_complete_close_delete_website_projects.sql`
- `20260719215302_allow_proposal_detach_on_project_delete.sql`
- `20260719221243_website_request_ai_review_audit.sql`
- `20260719224359_website_proposal_line_items_and_email_delivery.sql`
- `20260719234316_website_request_admin_delete.sql`
- `20260720012513_partner_portal_referrals.sql`
- `20260720012818_harden_partner_portal_tables.sql`
- `20260720045139_admin_notification_center.sql`
- `20260721020302_allow_partner_attribution_cleanup_on_delete.sql`
- `20260722155555_records_customer_granted_support_access.sql`
- `20260722164533_records_support_rpc_permissions_hardening.sql`
- `20260722164918_records_support_grant_integrity.sql`
- `20260722165758_preserve_notification_routing_with_records_privacy.sql`
- `20260723042405_isolated_website_billing_foundation.sql`
- `20260723162042_group_website_asset_batch_notifications.sql`
- `20260723185323_cleanup_empty_website_assets.sql`
- `20260724145809_website_billing_operations_phase_two.sql`
- `20260724151042_index_website_billing_operations.sql`
- `20260724151338_index_website_billing_foundation_foreign_keys.sql`
- `20260725170735_website_founder_offer.sql`
- `20260725181409_separate_founder_offer_and_partner_referral.sql`
- `20260725233043_investment_interest_waitlist.sql`
- `20260727053127_create_loan_tracker_mvp.sql`
- `20260727053804_harden_loan_tracker_table_grants.sql`
- `20260727053833_allow_loan_admin_account_management.sql`
- `20260727140135_loan_tracker_shared_access.sql`
- `20260727140857_fix_loan_access_identity_triggers.sql`
- `20260727141111_index_loan_access_foreign_keys.sql`
- `20260727142428_loan_tracker_settings_audit.sql`
- `20260727161659_n3xra_operations_mvp.sql`
- `20260727162404_index_n3xra_operations_foreign_keys.sql`
- `20260727162511_harden_n3xra_operations_links.sql`
- `20260727172223_sync_stripe_invoices_to_operations.sql`
- `20260727181158_operations_expense_review.sql`
- `20260727212113_fix_operations_import_duplicate_linking.sql`
- `20260729223158_link_records_contacts_and_invites.sql`
- `20260729233220_secure_records_invite_redemption.sql`
- `20260730030610_records_phone_meeting_foundation.sql`
- `20260730151748_records_phone_meeting_access_settings.sql`
- `20260730180137_records_phone_meeting_retention_and_reporting.sql`
- `20260730195239_fix_phone_meeting_delete_retention_trigger.sql`
- `20260804015334_add_account_phone_credentials.sql`
- `20260804015823_deny_client_account_phone_access.sql`
- `20260804015911_remove_redundant_account_phone_index.sql`
- `20260804021611_add_receptionist_password_reset_cooldown.sql`
- `20260804050501_sms_consent_events.sql`
- `20260805041028_recording_processing_progress.sql`
- `20260805055916_external_record_packet_transfers.sql`
- `20260805060623_lock_down_external_record_packet_transfers.sql`
- `20260805090000_n3xra_files.sql`
- `20260805144642_records_voice_profiles.sql`
- `20260805150308_meeting_speaker_identification.sql`
- `20260805154152_records_speaker_detection_setting.sql`
- `20260806025900_reduce_admin_notification_noise.sql`
- `20260806080000_admin_push_devices.sql`
- `20260808010012_add_n3xra_files_cdn_publishing.sql`
- `20260808053230_add_business_information.sql`
- `20260808054147_harden_business_information_access.sql`
- `20260808190802_admin_app_reviewer_role.sql`
- `20260808191822_harden_app_reviewer_lookup.sql`
- `20260808204032_admin_asset_uploads_and_onboarding_import.sql`
- `20260808213831_website_proposal_copilot.sql`
- `20260809053401_preserve_proposal_ai_history_on_draft_delete.sql`
- `20260809060052_proposal_ai_run_retention.sql`
- `20260809062321_allow_admin_reviewed_proposal_ai_changes.sql`
- `20260809070000_onboarding_before_proposal_agreement_flow.sql`
- `20260809213627_careers_applications_and_notes.sql`
- `20260809231813_website_asset_cdn_optimization.sql`
- `20260809233822_website_file_libraries_realtime.sql`
- `20260810103000_add_careers_applicant_details.sql`
- `20260812042150_admin_only_meeting_records.sql`
- `20260812045915_scope_admin_only_meeting_content.sql`
- `20260812220516_scope_records_storage_policies.sql`
- `20260812221124_scope_legacy_records_storage_policies.sql`
- `20260813143707_website_portal_brand_analysis_cache.sql`
- `20260813144040_lock_down_website_portal_brand_analysis_cache.sql`
- `20260813164832_branded_portal_app_entitlements.sql`

No archived file was deleted. Ten of these files were also restored to the active chain because read-only production inspection confirmed their resulting schema exists and later production migrations depend on it:

- `20260701202838_records_activity_log.sql`
- `20260701234104_platform_admin_owner_invites.sql`
- `20260719175940_platform_support_admin.sql`
- `20260725233043_investment_interest_waitlist.sql`
- `20260727172223_sync_stripe_invoices_to_operations.sql`
- `20260727181158_operations_expense_review.sql`
- `20260727212113_fix_operations_import_duplicate_linking.sql`
- `20260805041028_recording_processing_progress.sql`
- `20260805144642_records_voice_profiles.sql`
- `20260805150308_meeting_speaker_identification.sql`

Production read-only checks confirmed all corresponding tables, columns, and the import-posting function exist. The other 73 files remain non-executable historical references. The two pending Communications migrations remain active and are not part of this historical archive.

## Safety of already-applied production migrations

No production SQL, schema, data, migration-history row, branch, route, environment variable, authentication setting, function privilege, Twilio configuration, or Resend configuration was changed.

Already-applied production migrations were not rewritten in production. Local files were reconciled to the production ledger's versions and stored SQL. Original local variants remain available in the non-executable archive.

The foundational baseline and 10 schema-drift supplements must not be executed against the existing production schema because their resulting objects already exist there. After preview verification and separate production approval, the safe deployment prerequisite is to mark those 11 versions as applied in production migration history, then dry-run the normal push. Those future ledger-only actions are not authorized or performed by this report.

## Verification completed locally/read-only

- Supabase CLI: `2.98.1`
- Production migrations fetched read-only into an isolated temporary directory: 131
- Active migration files: 144
- Production filename/version mismatches after reconciliation: 0
- Material SQL mismatches after reconciliation: 0
- Linked migration comparison: 131/131 production versions paired; 13 intentional local-only versions
- Repository test suite: 338/338 passed
- TypeScript typecheck: passed
- Production writes: 0
- Preview branches created: 0; branch listing contains only `main`

A local `supabase db reset --local --no-seed` could not execute because Docker Desktop is not running on this machine. This is an environment limitation, not a migration mismatch. Per the approved workflow, the complete clean-database execution is the mandatory gate on the second disposable preview branch after its cost is separately approved.
