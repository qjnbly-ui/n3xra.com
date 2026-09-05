# N3XRA Build Worker

This private, persistent worker powers Build Studio. It keeps ChatGPT-managed Codex authentication and checked-out repositories off the public N3XRA web app. The browser talks to this worker through authenticated N3XRA requests; the worker talks to `codex app-server` over local stdio.

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

The persistent disk retains checked-out workspaces and the ChatGPT-managed Codex sign-in across restarts. The worker is intentionally separate from the Vercel website because it runs long-lived repository and preview processes.

## Recovery and preview behavior

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

## Capacity and release verification

Render recorded a 512 MB out-of-memory restart during the September 4, 2026 demo test. A local Linux ARM64 container test with 512 MiB RAM, no swap, and 0.5 CPU completed dependency installation and served the actual Astro 7.2.4 starter with Codex 0.143.0 initialized but unauthenticated. The starter lockfile failed `npm ci` (missing `@emnapi` entries); the existing `npm install --package-lock=false` fallback succeeded. At idle after the first page, cgroup usage was about 501 MiB: 341 MiB anonymous memory and 116 MiB file cache, with the remainder including kernel accounting. Peak usage reached 512 MiB, but `oom` and `oom_kill` counters remained zero. File cache is reclaimable; reaching that total alone does not establish an out-of-memory failure.

This probe did not include the HTTP worker, authenticated AI inference/tool execution, multiple previews, or Render's actual host environment. It neither proves full Starter reliability nor proves a paid upgrade is necessary. Use the resource logs during a controlled deployed demo test before making a capacity decision. Changing the paid plan requires owner approval.

Local verification used the pinned Codex CLI 0.143.0 to complete a real text turn and resume its conversation after restarting app-server. A real file-edit attempt in the local nested macOS sandbox was blocked by `sandbox-exec`; it is not evidence of successful editing on Render. Deploy the worker and matching browser bundle together, then verify an actual AI edit and preview on the dedicated demo. No production deployment is part of the local test commands above.
