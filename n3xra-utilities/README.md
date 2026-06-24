# N3XRA Utilities

N3XRA Utilities is the multi-tenant portal foundation for utility providers on the main N3XRA platform.

The current version uses the single N3XRA Supabase project. Utility companies are represented by `public.utility_organizations`, and tenant-scoped records attach through `organization_id`.

## Product Boundary

N3XRA owns:

- shared platform code and API routes
- utility tenant records
- onboarding and launch checklist state
- branding, settings, and domain configuration
- N3XRA admin review tools
- future Stripe Connect, DNS, and email sender setup state

Each utility company gets:

- a branded portal shell
- organization-scoped settings
- launch readiness tracking
- future staff/admin access
- future customer-facing modules

## Current Routes

- `/utilities/` public product page
- `/utilities/onboarding/` tenant setup intake
- `/utilities/admin/` N3XRA admin review view
- `/utilities/portal/{slug}` branded portal shell

## Folder Structure

```txt
n3xra-utilities/
  README.md
  product/
    vision.md
    v1-roadmap.md
  supabase/
    README.md

utilities/
  index.html
  onboarding/
  admin/
  portal/
  utilities.css
  utilities.js

api/
  utilities-onboarding.js
  utilities-admin.js
  utilities-portal.js
```

## Deployment Note

Production API endpoints live in the root `api/` directory for Vercel. Supabase schema changes live in the root `supabase/migrations/` directory.
