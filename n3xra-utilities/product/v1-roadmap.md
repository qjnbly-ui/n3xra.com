# N3XRA Utilities V1 Roadmap

## Phase 0: Tenant Foundation

- Create `utility_organizations` as the permanent tenant record.
- Attach branding, settings, domains, roles, members, onboarding, audit, and launch readiness records by `organization_id`.
- Keep N3XRA Utilities in the main N3XRA Supabase project.

## Phase 1: Real Onboarding

- Replace lead capture with setup intake.
- Create organization, default roles, branding, settings, domain, onboarding session, onboarding steps, launch checklist, and audit event.
- Notify N3XRA after records are created.

## Phase 2: N3XRA Admin

- Review utility organizations.
- Inspect branding, settings, contacts, portal URL, payment state, and onboarding status.
- Update organization and launch status.
- Mark launch checklist steps.

## Phase 3: Branded Portal Shell

- Render `/utilities/portal/{slug}` from tenant configuration.
- Show utility branding, support contact, payment state, portal readiness, and public launch checklist.
- Keep the portal public-safe until customer auth and account data are built.

## Deferred

- Utility admin invitations and branded login
- Customer accounts and service addresses
- Configurable forms and ticket workflows
- Stripe Connect onboarding
- Custom domain and custom sender verification
- Billing, meter, outage, GIS, and work-order integrations
