# Secure texting pilot

Scope: the verified sender may ask whether their own N3XRA account is active or on a trial. No website edits, saved phone PINs, account changes, balances, documents, or other private data are exposed by this pilot. Ordinary Nex SMS conversation remains unchanged.

Text VERIFY (or SIGN IN) to receive a random single-use link valid for ten minutes. If opted out, text START first. The link token travels in the URL fragment and is stored only as a SHA-256 hash on the server. The browser removes the fragment and retains the token in session storage for the normal account sign-in round trip. POST check does not consume the link. POST approve validates the account through Supabase Auth, matches its registered texting number, checks active account/SMS consent, then atomically consumes the challenge.

Approval lasts thirty minutes. ACCOUNT STATUS rechecks the sender, active account, expiry, current registered phone and credential version before returning the allowed status. LOCK, LOGOUT or LOG OUT deletes the verification; STOP and other opt-out keywords also revoke it. A new link replaces previous verification. Standalone four-digit text or an explicitly labeled four-digit PIN is omitted before N3XRA inbox persistence and never passed to the AI; this does not remove the message from the phone or Twilio.

The server-only nex_sms_sessions table has RLS enabled and no anon/authenticated privileges. The RLS-without-policy advisor notice is intentional: only the service role accesses it. One row per conversation bounds storage. Migration 20260906204800_nex_sms_verification.sql was applied directly through the database connector.

Validation: nine automated checks cover single use/races, expiry, wrong account/phone, credential changes, locking, consent, webhook signature gating, and PIN omission. The existing 147 phone checks passed. Browser approval UI was checked with simulated credentials. No real SMS or private account status was sent during implementation.
