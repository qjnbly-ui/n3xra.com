# Nex phone editing pilot

## Scope

Use the existing Nex receptionist to edit **N3XRA Build Studio Demo** through the existing Build Studio worker. This first release supports inbound calls and reconnecting by calling back. Automatic outbound callbacks are not implemented or enabled.

The caller asks for Build Studio, enters the existing four-digit keypad PIN, confirms the demo, describes a change, and confirms it. Nex opens or resumes the same owner-owned Build Studio session used by the dashboard. It polls readable progress without renewing the sandbox lifetime. The actual code-editing model and reasoning settings remain those of that workspace.

Nex uses the existing receptionist model (Groq) with application-owned tools, rather than matching phone commands against phrases. The model receives the recent call conversation and current selected-workspace state. It can discuss ideas, inspect page content, check progress, prepare a precise edit from agreed intent, propose branch/main saving, request cancellation, or close saved work. An unspecified save destination is clarified in conversation.

The server speaks each proposed edit/save/open/close action and issues an expiring confirmation ID. Execution requires a subsequent caller turn, a matching current proposal, and the model interpreting that response as approval. A proposal cannot approve itself in the same turn. Only the bound website and session are reachable; the model cannot supply arbitrary URLs, credentials, commands, or worker routes. Authorization remains in the worker. Model interpretation is probabilistic and needs live conversational testing.

Page inspection reads bounded HTML from the already-running isolated preview: text, headings and image alt/title descriptions. It does not execute JavaScript, follow redirects, fetch arbitrary external URLs, or see image pixels/the caller's screen. Nex must say what was retrieved and clarify ambiguous images. Page and builder content are untrusted data, not instructions. Client-rendered content may be absent. No screenshot/vision capability is claimed.

Tool calling is bounded to four rounds per caller statement. New caller input supersedes unfinished model planning; already-dispatched edits are not silently repeated or canceled. If the model is slow, a short thinking acknowledgment is spoken. Provider failure does not fall back to blindly sending the transcript as an edit. Phone disconnect stops the progress timer and model planning; it does not cancel, publish, or delete the existing task. The worker's existing idle rules still apply.

Build Studio speech is non-preemptible by subsequent application updates, but remains interruptible by the caller. Routine progress is coalesced to at most once per 30 seconds; final replies are delivered once and wait while a confirmation is pending.

A callback caller must verify a fresh PIN and confirm the demo again. Pending/unconfirmed spoken instructions are deliberately not resumed. Saved task history and results remain in the existing Supabase build session/event tables; no new database schema is needed.

## Configuration for activation

Add these to **both** the main n3xra.com Vercel project (receptionist) and the existing Render Build Studio worker:

- `N3XRA_PHONE_BUILD_ENABLED=true`
- `N3XRA_PHONE_BUILD_WEBSITE_ID=7cd358af-2fca-4a1f-8e7a-da3d7b703eb7`
- `N3XRA_PHONE_BUILD_SECRET`: one newly generated random secret of at least 32 characters, identical on both services. Never use a Supabase key, existing browser session, or a GitHub credential for this.

Add this to the **receptionist only**:

- `N3XRA_PHONE_BUILD_WORKER_URL=https://n3xra-build-worker.onrender.com`

The flag is disabled unless explicitly set to `true`. Missing configuration fails closed. No paid plan changes or additional service are required by this implementation. Existing call/hosting usage still applies.

Deploy the worker and the website from the same reviewed commit. Existing Twilio incoming routing and ConversationRelay are retained. Verify the actual deployed WebSocket route and project configuration before the live call; local tests do not prove that routing is configured in production.

The receptionist reuses `GROQ_API_KEY` and `GROQ_RECEPTIONIST_MODEL` (falling back to `GROQ_ASK_MODEL`, then `openai/gpt-oss-120b`). The selected model must support function calling. This adds conversational inference requests to existing Groq usage; no new service or plan is provisioned.

The caller needs an active platform **owner** account with an existing phone credential/PIN. The demo workspace needs its existing Codex sign-in; the phone channel cannot authorize Codex or copy another workspace's login.

## Security and failure behavior

- Twilio's existing signed WebSocket handshake is retained.
- PIN credentials are reloaded. Verification uses a conditional database update so concurrent failures cannot overwrite each other's counts.
- Each worker request carries a 45-second signature bound to user, call, website, method, path, body digest, and a unique nonce. The worker rejects in-process nonce replay. No token is stored in chat or returned to a browser.
- Before every phone action, the worker checks active owner access, active account status, recent PIN verification (15 minutes), and lockout state. The phone controller also expires after 15 minutes.
- Session ownership and website identity are checked before session recovery can wake a machine.
- The phone token cannot access raw pushes, login, model management, bearer preview links, or arbitrary worker endpoints. Its read-only page tool fetches only the bound live-preview origin.
- Failed or ambiguous mutation responses are never automatically retried. The caller is told to check status/dashboard first.
- Phone status omits technical notes and private preview URLs. Phone edits carry their call ID in the existing build audit event metadata.
- No automatic save, publish, or callback on disconnect.

## Verification

Build first:

```
npm run build:ai-core
npm run build:communications-provider
npm run build:build-worker
node --test tests/phone-build/*.test.mjs tests/receptionist/*.test.mjs tests/build-studio/*.test.mjs
```

The phone WebSocket test uses a real local signed connection and simulated keypad input. Worker recovery tests use real HTTP, Git repositories, child processes, and JSON-RPC, with mocked external services and model inference. They do not place calls or edit public sites.

Live acceptance after configuration:

1. User calls the existing Nex number; asks for Build Studio; enters PIN privately.
2. Confirm the demo. Open its dashboard preview.
3. Ask about a homepage image. Verify Nex inspects before describing its supplied image description. Discuss a reversible change using natural wording, verify the composed edit matches your intent, then confirm it. Hear progress and verify the preview.
   Also test unrelated speech, changing your mind, vague save requests, and declining a publish proposal; none should create unintended edits/publishes.
4. Disconnect while working, then call back and verify again. Confirm the same task is resumed without duplicating the edit.
5. Say `save`, choose the working branch, confirm, verify the remote branch, then confirm `close`.
   To test main separately, say `save to main`, confirm the live-publishing warning, and verify the demo deployment.
6. Verify only the selected destination was updated and the editing sandbox stopped.

Roll back phone access by setting `N3XRA_PHONE_BUILD_ENABLED=false` on the worker and receptionist. Normal dashboard building and the rest of Nex remain available. No migration rollback is required.
