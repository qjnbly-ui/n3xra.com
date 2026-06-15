# N3XRA Virals Supabase

This folder is for the separate N3XRA Virals Supabase project.

Use `schema.sql` to initialize the Virals database. This schema intentionally stores `master_user_id` and `organization_id` values from N3XRA Master instead of using Virals as the auth source.

## Security Model

- N3XRA Master owns login and product access.
- Server-side API routes verify the Master session.
- Server-side API routes write to this Virals Supabase project.
- Virals tables include RLS as defense in depth.
- Service-role keys must never be exposed in browser code.

Because the V1 API is server-mediated, this schema does not grant broad browser policies to `anon` or `authenticated`.

