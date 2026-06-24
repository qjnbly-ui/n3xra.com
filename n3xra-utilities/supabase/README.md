# N3XRA Utilities Supabase

N3XRA Utilities uses the main N3XRA Supabase project.

Do not apply product-scoped schema drafts from this folder. Production schema changes belong in the root `supabase/migrations/` directory.

Current Utilities migrations:

- `supabase/migrations/20260624160856_utility_tenant_foundation.sql`
- `supabase/migrations/20260624163024_utility_portal_status_tracking.sql`

The canonical tenant key is `public.utility_organizations.id`, and future utility records should attach through `organization_id`.
