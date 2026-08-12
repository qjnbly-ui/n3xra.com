# N3XRA shared AI reliability architecture

## Scope of the first release

The shared core now powers the existing `/api/ask` endpoint and the context-aware assistant loaded by the shared site navigation. The assistant follows the Records presentation pattern: a pill action in the top navigation opens a full-height side drawer. It supports three server-verified audiences:

- Public: approved site knowledge and current page context.
- Account: public knowledge plus the signed-in user's own normalized account data.
- Platform admin: account context plus whitelisted, read-only admin data for accounts, applications, support, notifications, websites, billing, and operations.

The N3XRA Records assistant endpoints and interfaces are intentionally unchanged. Pages under `/n3xra-records` do not load the shared widget. Proposal Copilot and the other specialized AI endpoints also remain independent in this release.

Every conversational AI interface that presents suggested-question chips uses the shared `/api/ai-follow-ups` service after an answer. This covers the public, account, and admin shared assistant; both Codebase AI interfaces; and Records AI. The service generates three concise likely next questions from only the latest question and answer. It is optional: if generation fails or is unavailable, the interface keeps its safe mode-specific starter prompts and the completed answer remains unaffected.

Verified platform admins see `Ask Admin AI` in the navigation. Inside its drawer they can explicitly select `Turn on Codebase AI`, which uses the existing private `/api/codebase-ai` endpoint and private generated index. Public visitors and normal account users never receive that mode control, and the endpoint independently re-verifies platform-admin access.

## Security boundary

The browser sends its existing Supabase access token. The server validates that token against Supabase Auth on every request. Admin authorization is then checked against an active `platform_admins` row whose role is `owner` or `admin`. User-editable metadata is never used for authorization.

The model never receives a service-role key, arbitrary SQL access, unrestricted table access, or a generic database tool. Live-data capability loaders use explicit table and column allowlists. The first release is read-only. Requests to delete, approve, send, transfer, purchase, update, or otherwise change external state are routed to `admin_action` and stopped before execution.

When write capabilities are added, each one must use the action state machine in `state.ts`: `idle → proposed → awaiting_confirmation → executing → completed|failed`, with cancellation allowed before execution.

## Reliability order

The orchestrator answers in this order:

1. Current normalized structured data, formatted deterministically.
2. Latest-known-good in-memory data, explicitly labeled with its recorded time.
3. Primary Groq model with trusted application context.
4. Optional OpenAI provider, then an optional second Groq model.
5. Verified local knowledge and an appropriate internal route.

The latest-known-good cache survives warm serverless invocations. It is intentionally not represented as durable storage; a cold deployment starts with an empty cache.

## Core modules

- `contracts.ts`: capability, request, intent, session, tool-result, provider, response, action-state, and error contracts.
- `auth.ts`: bearer-token parsing, Supabase Auth verification, and the active `owner`/`admin` authorization check.
- `router.ts`: semantic capability classification with deterministic definitions and validated structured-provider classification for uncertain requests.
- `live-data.ts`: per-attempt timeouts, retry, partial-result, latest-known-good handling, and capability-specific allowlisted Supabase reads.
- `deterministic-answers.ts`: converts normalized structured facts into user-facing answers without asking a model to interpret raw JSON.
- `state.ts`: conversation ownership/isolation and consequential-action state transitions.
- `protocol.ts`: bounded inbound JSON, history, page-context, provider-response, and structured-intent validation.
- `providers.ts`: Groq primary, optional OpenAI/second-Groq fallback providers, provider timeouts, and failure-chain handling.
- `local-knowledge.ts`: trusted site/page context and useful grounded answers when structured data and providers are unavailable.
- `security.ts`: secret/token redaction for answers, warnings, and failure messages.
- `orchestrator.ts`: the answer-order coordinator and HTTP handler; it composes the modules without owning provider, storage, or routing implementation details.

`api/ask.js` is the only compatibility-only file in this release. It preserves `/api/ask` and delegates directly to the compiled orchestrator. `api/codebase-ai.js` and `api/records-help.js` are independent, existing specialized endpoints—not adapters around the shared core.

## Routing and isolation

- General assistant: all non-Records pages use `/api/ask`; public questions route to `public_site` or `current_page`.
- Account mode: a valid Supabase session changes the shared assistant to `account`; it can load only that verified user's profile and memberships.
- Admin-context mode: only a server-verified active `owner` or `admin` can route to the `admin_*` capability loaders. Non-admin requests stop before a live-data loader is called.
- Codebase AI: a visible admin-only mode switch calls `/api/codebase-ai`. That endpoint independently repeats session and platform-role verification, then searches only a redacted private source index.
- Records AI: `/n3xra-records` keeps its existing UI and `/api/records-help`. The shared widget is not loaded there, and shared requests on a Records path return `records_handoff` without calling shared providers or data loaders.

Conversation state is keyed by both the server-verified identity and conversation ID. No model receives a generic database, filesystem, or cross-assistant tool. Shared AI sees only the normalized output of its capability loader; Codebase AI sees only selected redacted source excerpts; Records AI separately verifies organization access before building its Records-specific context.

The follow-up service performs no database read or write beyond session and administrator verification. Account and Records suggestions require a valid Supabase user session, while Admin and Codebase suggestions additionally require a current active platform-admin role. The browser never sends a service key. Inputs are bounded and redacted, the model receives only the latest visible exchange, and its strict structured output is normalized before becoming clickable text.

## Environment variables

Existing production variables continue to work:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `GROQ_ASSISTANT_MODEL` or the existing `GROQ_ASK_MODEL`
- `GROQ_FOLLOW_UP_MODEL` optionally overrides the efficient `openai/gpt-oss-20b` follow-up model

Optional fallback configuration:

- `OPENAI_API_KEY` and `OPENAI_ASSISTANT_MODEL` enable the OpenAI Responses API fallback.
- `GROQ_FALLBACK_MODEL` enables a second Groq model after the OpenAI fallback.

No fallback provider is assumed when its model or credentials are absent.

Service-role and `sb_secret_` values are read only from server process environment variables. They are never returned to the browser, included in model messages, or logged by these handlers. `sb_secret_` keys are sent to Supabase only in the `apikey` header; legacy JWT service-role keys also use the server-side bearer header. The private-index build removes secret-shaped values, JWTs, and credential assignments. `npm run verify:ai-secrets` additionally scans browser-delivered files and generated server artifacts, including exact configured secret values when the checking environment supplies them.

## Verification commands

```sh
npm run typecheck
npm run test:ai-core
npm run test:ai-coverage
npm test
npm run build
npm run verify:ai-secrets
```

The coverage gate requires at least 80% lines, 75% functions, and 70% branches across the compiled core.

## Staged deployment

1. Deploy to a Vercel preview with the existing Supabase and provider variables.
2. Public: run the smoke command with only `AI_SMOKE_BASE_URL`; verify `Ask N3XRA`, public/current-page routing, a nonempty answer, and no generic failure wording.
3. Account: add a short-lived `AI_SMOKE_ACCOUNT_TOKEN`; verify `Account AI`, own-account context, and denial of a platform-admin request.
4. Admin: add a short-lived `AI_SMOKE_ADMIN_TOKEN`; verify `Admin AI`, applications, support, and cross-platform overview, including data-status/freshness labels.
5. Codebase: with the admin token, verify the private-index metadata, one source-grounded answer, source citations, and denial with a normal-account token.
6. Records: add `AI_SMOKE_RECORDS_TOKEN` plus `AI_SMOKE_RECORDS_ORGANIZATION_ID`; verify the existing organization-scoped Records answer and UI remain unchanged.
7. Outage behavior: temporarily disable the primary provider in preview and confirm fallback-provider or grounded-local answers; make one live-data dependency unavailable and confirm partial/cached freshness wording.
8. Review preview logs for timeouts and authorization failures, confirm no request body, answer, token, or secret value is logged, then promote.

The command supports the complete matrix without printing credentials:

```sh
AI_SMOKE_BASE_URL=https://preview.example \
AI_SMOKE_ACCOUNT_TOKEN=... \
AI_SMOKE_ADMIN_TOKEN=... \
AI_SMOKE_RECORDS_TOKEN=... \
AI_SMOKE_RECORDS_ORGANIZATION_ID=... \
npm run smoke:ai
```

Live Vercel Analytics is intentionally reported as not connected until staging has the required Vercel analytics credentials. The existing Analytics admin page remains unchanged.

## Rollback

Use Vercel's **Promote to Production** action on the immediately previous healthy deployment. This restores both the previous `/api/ask` implementation and previous shared assets together, avoiding a client/server version mismatch.

If a code rollback is required instead, revert the shared-AI commit as one unit, rebuild, run the complete test suite, and deploy. Do not revert only `api/ask.js`; the adapter and compiled core must stay version-aligned.

## Future migrations

Migrate specialized AI one product at a time behind compatibility adapters. Records AI should be last or moved only after its search, permissions, saved-memory approval, navigation actions, usage accounting, transcription, and document workflows have equivalent contract and integration coverage.
