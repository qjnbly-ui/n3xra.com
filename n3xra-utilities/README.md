# N3XRA Utilities

N3XRA Utilities is the operator portal foundation for utility companies that need a managed layer between their backend systems and N3XRA.

The first version is intentionally a foundation, not a production login system. It reserves the public `/utilities/` route and keeps product planning, API notes, and Supabase schema work inside this folder.

## Product Boundary

N3XRA Utilities Supabase owns coordination data:

- utility tenant records
- N3XRA bootstrap owner and setup records
- utility Supabase project metadata
- external operator identity links
- master settings snapshots
- support and implementation requests

Each utility company's Supabase project owns:

- operator Auth users
- utility-specific backend data
- operational roles that belong inside the utility environment
- project-level policies, storage, and realtime behavior for that utility

N3XRA is the temporary owner and creator during bootstrap. The long-term model should let a utility own its operator users while N3XRA keeps the coordination layer needed for setup, support, billing context, and master controls.

## Initial Workflow

```txt
Utility tenant selected -> operator session verified against utility Supabase -> N3XRA linkage checked -> portal settings loaded
```

The reserved portal areas are:

- operator sign in
- utility account context
- backend connection status
- master settings
- N3XRA support handoff

## Folder Structure

```txt
n3xra-utilities/
  README.md
  product/
    vision.md
    v1-roadmap.md
  supabase/
    README.md
    schema.sql
  api/
    README.md
    tenant-session.js

utilities/
  index.html
  utilities.css
  utilities.js
```

## Deployment Note

The public portal shell lives at `/utilities/` so the URL can be `n3xra.com/utilities/`. The `n3xra-utilities/` folder keeps product planning, API notes, and future Supabase work together.

On Vercel, production API endpoints usually need thin wrappers in the root `api/` directory. No root endpoint is added yet because the current portal is static.
