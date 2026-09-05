# N3XRA Build Worker

This trusted coordinator powers the shared Build Studio for connected N3XRA websites. With `N3XRA_BUILD_EXECUTION_PROVIDER=vercel`, each website/user/session has its own persistent Vercel Sandbox. Git commands, dependency installation, Codex and preview processes run in that machine. Render retains administrator authentication, session/event persistence, GitHub App credentials and authenticated preview routing.

The separate machine enforces isolation. Codex uses its documented `externalSandbox` policy there; this mode is never enabled for the shared Render process. Platform database keys, the GitHub App private key and Vercel credentials are not passed into the machine. A short-lived token scoped to the selected repository is used only for trusted Git operations. Each workspace has its own fresh Codex device sign-in; no existing Render or local Codex login is copied into it.

The local provider remains available for regression tests and compatible local hosts. It does not resolve Render's observed native-sandbox restriction.

## Activate the Vercel execution provider

Set these **server-only** environment variables on the Render worker:

- `N3XRA_BUILD_EXECUTION_PROVIDER=vercel`
- `N3XRA_VERCEL_PROJECT_ID` — the main **n3xra.com** project, not an individual client/demo project
- `N3XRA_VERCEL_TEAM_ID` — its Vercel team
- `N3XRA_VERCEL_TOKEN` — a dedicated credential with Sandbox access; do not use a temporary test-login token for production
- `N3XRA_BUILD_SANDBOX_SECRET` — a stable secret containing at least 32 random bytes, used to authenticate the coordinator to each workspace
- Optional `N3XRA_BUILD_SANDBOX_ALLOWED_DOMAINS` — additional comma-separated package/development endpoints required by a site's dependencies

Deploy the worker and matching browser bundle together. The existing `buildWorkerUrl` and Supabase schema remain unchanged. Never put these credentials in browser code, Git, or a client repository. The provider defaults to `local` until configured, allowing reviewed activation without changing an existing service merely by checking out this code.

Open a connected website, recover or start its workspace, and connect Codex using the displayed device sign-in. Previews support static HTML, Astro and Vite sites. Other development servers report that a preview adapter is needed instead of claiming their preview is ready. Checkpoints remain on the work branch; pushes never force-overwrite remote work. A remote conflict is rejected for review.

Existing Render repository files transfer in bounded chunks when first opening an existing session on Vercel; dependency caches are reinstalled. The original copy remains intact. Reopening failed or unfinished sessions reuses them instead of archiving unsaved work. A changed repository association requires resolving the old workspace first.

## Isolated compute and persistence

Each machine starts with 1 vCPU / 2 GB RAM and a 15-minute session limit, renewed by explicit workspace actions. Idle workspaces stop. **Pause workspace** stops one immediately when no turn/preparation is active. Stopping snapshots files and the Codex conversation; resuming restores them. SSE heartbeats do not keep machines running. The bridge endpoint requires a per-workspace credential; browser preview requests still pass through the authenticated worker.

The latest two snapshots are retained without an expiry; older superseded snapshots are removed to bound storage growth. Saved snapshot storage can still incur charges. Stopping Vercel machines does not suspend Render or remove its hosting charge. The current unfinished workspace is never automatically deleted.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `N3XRA_BUILD_WORKSPACE_ROOT` — a dedicated absolute directory
- `N3XRA_BUILD_ALLOWED_ORIGIN` — normally `https://n3xra.com`
- `N3XRA_BUILD_PUBLIC_URL` — the private worker's HTTPS URL
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_INSTALLATION_ID`

The worker creates a short-lived installation token for only the selected website repository. Render's own GitHub connection remains limited to the `n3xra.com` deployment repository.
- `PORT` — defaults to `4317`

Install the Codex CLI on the worker, compile this service with `npm run build:build-worker`, and start `node dist/build-worker/server.js`. Then set `buildWorkerUrl` in `shared/config.js` to the worker's HTTPS URL.

Run the worker behind authenticated HTTPS. Do not expose the Codex App Server itself; only this worker's narrow HTTP surface should be reachable.

## Render deployment

The repository includes `render.yaml` and a pinned Docker image definition. Create a Render Blueprint from this repository, enter the Supabase and N3XRA GitHub App secret environment values requested by Render, and use the attached `/var/data` disk. After the service is live, set its HTTPS address as `buildWorkerUrl` in `shared/config.js`.

In Vercel mode, the Render disk preserves legacy workspaces for migration; active repository and preview processes run in Vercel Sandbox. In local mode, the disk retains repositories and the local Codex sign-in.

## Local-provider recovery and preview behavior

Authenticated session requests reload the caller's saved workspace after a worker restart. Repository files stay on the persistent disk. Codex conversations are explicitly resumed before editing; a missing saved conversation is replaced with a visible notice, while existing repository files remain intact. Concurrent turns are rejected, and failed/interrupted turns are reported as errors.

The browser reconnects its event stream, deduplicates replayed events, and applies the current session snapshot instead of old event state. A failed send retains its prompt. Checkpoint availability depends on uncommitted files; push availability depends on unpushed commits.

Preview installs include development dependencies. A successful install saves a fingerprint of the package manifest and lockfiles; changes invalidate the cache. Preview startup is queued across projects so dependency installations do not overlap. Astro runs as a managed foreground process; readiness is checked over HTTP. Session-scoped URLs and cookies cover preview assets, and the worker proxies the development WebSocket. Restart/shutdown stops preview process groups; timed-out commands and worker shutdown also stop their command process groups.

After 15 minutes without preview requests or session actions, an idle preview process stops. Set `N3XRA_BUILD_PREVIEW_IDLE_SECONDS` to a positive number to change the interval. SSE heartbeats do not count as activity, and previews are not paused during preparation or an active AI turn. The conversation and repository remain saved; the preview refresh button restarts it. This does **not** suspend the Render service or stop its hosting charge. Remote Git conflict resolution and automatic disk cleanup remain outside this change.

Resource logs at install start/completion, preview readiness, and idle pause include worker RSS, Linux cgroup memory/limit, anonymous memory, file cache, and active preview count. These are diagnostic samples, not a hard memory reservation or a guarantee that multiple running previews fit.

## Verification

```sh
npm run build:build-worker
npm run build:build-studio
node --test tests/build-studio/*.test.mjs
```

The recovery integration test runs the real HTTP worker, Git commands against a temporary local bare repository, child processes, and JSON-RPC transport. Supabase/GitHub responses, dependency installation, and model inference are fixtures; it never pushes to GitHub. It checks restoration through a message request, ownership, overlapping turns, preview restart/access, edit output, checkpoint/push state, failures, missing saved conversations, and event replay.

For an installed Astro runtime, additionally set `N3XRA_TEST_ASTRO_MODULES` to its absolute `node_modules` directory when running `worker-recovery.test.mjs`. This uses actual Astro for the page, assets, and HMR WebSocket; model inference remains simulated. Use a disposable installation because the test writes its install marker there.

## Historical local-provider capacity tests

Render recorded a 512 MB out-of-memory restart during the September 4, 2026 demo test. A local Linux ARM64 container test with 512 MiB RAM, no swap, and 0.5 CPU completed dependency installation and served the actual Astro 7.2.4 starter with Codex 0.143.0 initialized but unauthenticated. The starter lockfile failed `npm ci` (missing `@emnapi` entries); the existing `npm install --package-lock=false` fallback succeeded. At idle after the first page, cgroup usage was about 501 MiB: 341 MiB anonymous memory and 116 MiB file cache, with the remainder including kernel accounting. Peak usage reached 512 MiB, but `oom` and `oom_kill` counters remained zero. File cache is reclaimable; reaching that total alone does not establish an out-of-memory failure.

This probe did not include the HTTP worker, authenticated AI inference/tool execution, multiple previews, or Render's actual host environment. It neither proves full Starter reliability nor proves a paid upgrade is necessary. Use the resource logs during a controlled deployed demo test before making a capacity decision. Changing the paid plan requires owner approval.

Local verification used the pinned Codex CLI 0.143.0 to complete a real text turn and resume its conversation after restarting app-server. A real file-edit attempt in the local nested macOS sandbox was blocked by `sandbox-exec`; it is not evidence of successful editing on Render. Deploy the worker and matching browser bundle together, then verify an actual AI edit and preview on the dedicated demo. No production deployment is part of the local test commands above.
