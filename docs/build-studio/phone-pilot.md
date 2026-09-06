# Nex phone editing pilot

## Scope

Use the existing Nex receptionist to edit **N3XRA Build Studio Demo** through the existing Build Studio worker. This first release supports inbound calls and reconnecting by calling back. Automatic outbound callbacks are not implemented or enabled.

The caller asks for Build Studio, enters the existing four-digit keypad PIN, confirms the demo, describes a change, and confirms it. Nex opens or resumes the same owner-owned Build Studio session used by the dashboard. It polls readable progress without renewing the sandbox lifetime. The actual code-editing model and reasoning settings remain those of that workspace.

Commands: `status`, `cancel`, `save`, `close`. Save requires confirmation and uses the working branch. Close requires confirmation and the worker verifies that all work is saved on GitHub. Publishing to main remains a dashboard action. Phone disconnect stops the phone progress timer; it does not cancel, repeat, publish, or delete the task. The worker's existing idle rules still apply.

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

The caller needs an active platform **owner** account with an existing phone credential/PIN. The demo workspace needs its existing Codex sign-in; the phone channel cannot authorize Codex or copy another workspace's login.

## Security and failure behavior

- Twilio's existing signed WebSocket handshake is retained.
- PIN credentials are reloaded. Verification uses a conditional database update so concurrent failures cannot overwrite each other's counts.
- Each worker request carries a 45-second signature bound to user, call, website, method, path, body digest, and a unique nonce. The worker rejects in-process nonce replay. No token is stored in chat or returned to a browser.
- Before every phone action, the worker checks active owner access, active account status, recent PIN verification (15 minutes), and lockout state. The phone controller also expires after 15 minutes.
- Session ownership and website identity are checked before session recovery can wake a machine.
- The phone token cannot access main publishing, raw pushes, login, model management, previews, or arbitrary worker endpoints.
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
3. Request one reversible visible change and confirm it. Hear progress and verify the change in the preview.
4. Disconnect while working, then call back and verify again. Confirm the same task is resumed without duplicating the edit.
5. Confirm `save`, verify the remote working branch, then confirm `close`.
6. Verify the public main branch was not published and the editing sandbox stopped.

Roll back phone access by setting `N3XRA_PHONE_BUILD_ENABLED=false` on the worker and receptionist. Normal dashboard building and the rest of Nex remain available. No migration rollback is required.
