# Organization-owned private products

`/account/admin/organizations/` is the platform-admin directory. It groups existing organizations, linked websites, entitled shared products, and private applications. Organization administration is deliberately separate from individual account enrollments and the global Products navigation.

`/client-portal/organization/` is an explicit application landing page. On a branded portal it resolves the organization from that hostname's authorized website, ignoring an `organization` query parameter. On the master hostname an explicit organization parameter is accepted only for platform administrators. The administrator preview retains administrator privileges; it does not impersonate a member.

The existing branded portal root also displays active private products. Private products are stored in `organization_private_products`, not `n3xra_product_catalog`. Draft and paused products remain visible only to platform administrators. Organization owners and members can read active products for their own organization, provided its account is active, trialing, or past due. They cannot modify the registry. Use the existing Organization Admin workspace to manage membership.

## Adding a new private application

1. Build the application with Supabase Auth and organization-scoped tables/API authorization. Keep client-specific configuration separate from shared code.
2. Add a Draft private product from the organization's admin page. Supply its local application path. No public catalog entry, account enrollment, or global Products-menu entry is needed.
3. The launch link carries both `organization` and `organization_product`. Treat these as requested context, never as proof of authorization.
4. For every application data read/write, enforce `organization_id` and the authenticated caller's permissions in RLS or trusted server code. The security-invoker helper `public.can_access_organization_private_product(product_id, organization_id)` checks the active product and uses registry RLS to enforce membership. Associate application tables with the registered product ID as well as the organization; never accept an arbitrary unrelated product ID as an authorization substitute. Use `WITH CHECK` on writes.
5. Keep sensitive content out of static HTML/JavaScript. Restrict storage access and signed URLs with the same organization/product checks. A hidden card or frontend guard cannot protect application data.
6. Verify member, unrelated-user, signed-out, paused-product, and mismatched-organization behavior before setting the product Active. Link the organization's website sign-in to its existing branded portal.

## Release and validation

Apply `20260905215808_organization_private_products.sql` before releasing the corresponding site files. This additive migration was applied to production on September 5, 2026 after transactional access checks passed. Production verification confirmed RLS enabled and no anonymous table access.

Validation performed:

- `npm run build:client-portal`
- 46 tests covering the new private-product flow, existing portal entitlements, tenant resolution, branding, and team permissions.
- Transactional SQL assertions: anonymous access denied; unrelated authenticated user sees zero private rows; organization owner sees only the active product; mismatched organization rejected; member insert/update denied. All temporary schema and rows were rolled back.

Visual browser validation remains pending because local preview navigation was blocked by the browser URL security policy.
