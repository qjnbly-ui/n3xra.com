# N3XRA Build Worker

This private, persistent worker powers Build Studio. It keeps ChatGPT-managed Codex authentication and checked-out repositories off the public N3XRA web app. The browser talks to this worker through authenticated N3XRA requests; the worker talks to `codex app-server` over local stdio.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `N3XRA_BUILD_WORKSPACE_ROOT` — a dedicated absolute directory
- `N3XRA_BUILD_ALLOWED_ORIGIN` — normally `https://n3xra.com`
- `N3XRA_BUILD_PUBLIC_URL` — the private worker's HTTPS URL
- `GITHUB_TOKEN` — repository-scoped token (replace with GitHub App installation tokens in production)
- `PORT` — defaults to `4317`

Install the Codex CLI on the worker, compile this service with `npm run build:build-worker`, and start `node dist/build-worker/server.js`. Then set `buildWorkerUrl` in `shared/config.js` to the worker's HTTPS URL.

Run the worker behind authenticated HTTPS. Do not expose the Codex App Server itself; only this worker's narrow HTTP surface should be reachable.

## Render deployment

The repository includes `render.yaml` and a pinned Docker image definition. Create a Render Blueprint from this repository, enter the four secret environment values requested by Render, and use the attached `/var/data` disk. After the service is live, set its HTTPS address as `buildWorkerUrl` in `shared/config.js`.

The persistent disk retains checked-out workspaces and the ChatGPT-managed Codex sign-in across restarts. The worker is intentionally separate from the Vercel website because it runs long-lived repository and preview processes.
