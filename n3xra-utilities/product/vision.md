# N3XRA Utilities Vision

N3XRA Utilities is a multi-tenant utility portal platform operated from the single N3XRA Supabase project.

Each utility company gets a branded customer portal, admin setup state, launch checklist, and future module configuration, while N3XRA owns the platform code, database foundation, auth boundary, and operational controls.

## Principles

- N3XRA owns the shared platform, migrations, API routes, and tenant foundation.
- Utility companies get branded portals and organization-scoped configuration.
- Tenant boundaries are enforced with explicit `organization_id` relationships and RLS.
- Service-role keys never reach browser code.
- Public portal routes expose only safe customer-facing configuration.
- Company-specific domains, Resend email delivery, Stripe Connect, and deeper integrations are layered onto the shared tenant model over time.

## Current Platform Shape

- Public product route: `/utilities/`
- Onboarding route: `/utilities/onboarding/`
- N3XRA admin route: `/utilities/admin/`
- Branded portal shell: `/utilities/portal/{slug}`
- Canonical tenant table: `public.utility_organizations`
- Launch readiness table: `public.utility_portal_launch_steps`

## Future Capabilities

- Utility admin account invitations
- Branded customer login
- Customer profiles and service addresses
- Configurable service request forms
- Announcements and alerts
- Document uploads
- Stripe Connect onboarding
- Custom domain and email sender verification
- Billing, meter, outage, GIS, and work-order integrations driven by customer need
