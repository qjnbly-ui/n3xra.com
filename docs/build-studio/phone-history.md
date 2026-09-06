# Phone conversation review

Open **Admin → AI Settings**. Only an authenticated active platform owner may access their own records. This release covers the existing verified owner phone-building pilot, not all customer calls or other assistants.

## Capture and cost

Reuse ConversationRelay's existing final caller transcript and text sent for Nex speech; no recording, separate transcription product, paid monitoring service, model analysis call, or new scheduled job. Normal phone/model usage and database usage still apply. Optional instruction additions consume context in the existing model request.

Capture begins only after successful PIN verification for Build Studio. Earlier speech, keypad frames and speech while waiting for a PIN are excluded. The 800-character input limit in the existing phone handler is unchanged; the saved received text may be longer. Busy/transfer-time speech is labelled received but not processed. Interruptions preserve the provider-reported spoken portion, not an audio guarantee. Text is redacted and bounded; no raw request bundles, credentials, preview tokens, or hidden reasoning are stored. Links and standalone four-digit numbers are omitted conservatively.

Each connection segment has its own conversation ID, owner, website, call ID, configured model, base-rule hash and reviewed instruction version. The exact returned provider model is not currently captured. Existing website_build_events link Nex's submitted instruction to the first following builder reply/error, stopping at the next user request; no additional result copy or inference is needed, including after hang-up.

The recorder uses a bounded in-process queue (50 pending events, 1,000 total events, 15-minute capture limit). Stable UUIDs allow one safe retry after a lost response. Writes happen during the call, independently of speech. Dropped events are counted when storage is available. Abrupt process loss can leave an open/partial record; this is deliberately **not** a durable, lossless audit log. A failed startup tells the caller history is unavailable without blocking the existing builder.

## Review and instruction changes

The page shows up to 50 recent call segments and 50 builder requests per call. Notes are manual. No automatic AI review, model training or prompt rewriting runs. Owners can edit instruction additions and their expected effect, preview the current/proposed text, then explicitly apply. Editing a preview invalidates its approval. The database serializes changes by owner and rejects stale versions. Reviewed additions are loaded for the next verified phone-building session; active sessions remain stable. Clear the additions with an empty instruction plus an explanation to restore the base rules. Authentication and server tool boundaries are unchanged.

Base Nex rules now explicitly preserve requested image creation and leave implementation choices to Codex instead of inventing placeholder URLs or substituting another asset workflow.

## Storage and cleanup

Three RLS-enabled service-only tables: ai_phone_conversations, ai_phone_events, ai_phone_instructions. Browser roles have no table privileges or executable access to the service-only, SECURITY INVOKER approval RPC. The server authenticates and checks active owner membership, then scopes reads/writes to that owner. No general administrator transcript access is granted.

Phone text and review notes expire after 30 days, become inaccessible in the review API, and are deleted by the existing authenticated daily cleanup-recording-chunks job. Event rows cascade with the conversation. Explicitly applied instruction additions persist separately until replaced/cleared. The existing builder history and database backup retention are unchanged. No archive or export copies are created. Cleanup failures log a generic message without interrupting existing recording cleanup.

## Verification

- npm run test:phone-build includes phone-history unit/API tests plus the existing phone/build suite.
- tests/phone-history/access.integration.sql runs inside a rollback-only local database transaction after the migration: grants/RLS, approval version conflicts, audit updates, clear-to-default and expiry cascade.
- Signed local WebSocket fixture verifies PIN exclusion, both conversation sides and interruption capture with simulated storage/model responses.
- Browser fixture verifies plain-text rendering of HTML-looking content, note save, explicit approval, invalidating edited previews, and 390px mobile layout.
- A real phone call is still required to confirm live end-to-end capture with Twilio; no billable test call is made automatically.

To disable new capture without altering phone editing, remove the PhoneRecorder hooks from the receptionist and redeploy. Existing records remain private until their ordinary expiry. No worker runtime, Twilio settings, provider plan or secrets are changed by this release.
