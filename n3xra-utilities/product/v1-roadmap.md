# N3XRA Utilities V1 Roadmap

## Phase 0: Foundation

- Reserve `/utilities/` as the public portal route.
- Create a static operator portal skeleton.
- Document product boundaries and Supabase ownership.
- Draft coordination schema without production policies.
- Stub product-scoped API behavior.

## Phase 1: Tenant Registry

- Add utility tenant records.
- Store non-secret Supabase project metadata.
- Track N3XRA bootstrap owner and setup status.
- Define launch readiness fields.

## Phase 2: Operator Session Verification

- Resolve tenant from workspace slug or invite.
- Verify operator session against the utility-owned Supabase project.
- Link verified external operator IDs to N3XRA coordination records.
- Keep N3XRA auth separate from utility operator auth.

## Phase 3: Portal Operations

- Load tenant account context.
- Display backend connection and environment status.
- Manage master settings snapshots.
- Create support and implementation requests.
- Add audit events for sensitive coordination actions.

## Deferred

- Full billing automation
- Cross-tenant analytics
- Direct utility data editing
- Root Vercel API wrappers
- Production Supabase migrations
