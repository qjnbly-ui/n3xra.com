# Records Database Build Sheet

This document is the working product sheet for the Records Database idea. It is meant to capture the current state, the target direction, and the build order so the product can be continued later without re-deriving the plan.

## Product summary

Records Database is a records-management product for small organizations that need a simple, searchable archive for recurring documents such as minutes, agendas, packets, and internal records.

It is not currently a full public-records portal product. The current direction is:

- private accounts first
- searchable records archive
- simple uploads
- document extraction
- clear upgrade path to billing, sharing, and later AI features

## Core product idea

The product should let a user:

- create an account
- manage a records library
- upload documents
- extract text once
- search the saved text later
- open, download, share, and delete files
- understand their plan and document limits

Longer term, it should support:

- organization accounts
- multi-user access
- subscription billing
- branded sharing on a custom domain
- PDF extraction and OCR
- AI summaries and AI search

## Current architecture

### Frontend

Current frontend is static HTML/CSS/JS hosted on the website.

App structure:

- [app/index.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/index.html): router entrypoint
- [app/login.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/login.html): auth page
- [app/dashboard.html](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/dashboard.html): logged-in product UI
- [app/styles.css](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/styles.css): shared styling
- [app/login.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/login.js): auth behavior
- [app/dashboard.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/dashboard.js): dashboard behavior
- [app/lib/supabase-client.js](/Users/quentinnichols/Documents/Websites/PublicRecordsApp/app/lib/supabase-client.js): shared Supabase client helper

### Backend / data

Current backend stack is:

- Supabase Auth
- Supabase Postgres
- Supabase Storage

Current architecture avoids a custom backend for extraction by doing extraction in the browser during upload.

That means:

- no Vercel API route yet
- no Supabase Edge Function required for MVP
- no service role key required in the current browser app

### Extraction model

Current extraction model mirrors the earlier CAT minutes idea:

- extract document text once
- save extracted text in the database
- search saved text later
- do not reparse original files on every query

Currently supported:

- `.docx`
- `.txt`
- `.md`
- `.csv`
- `.json`
- `.html`
- `.htm`

Not yet supported:

- `.pdf`
- OCR for scanned documents
- legacy `.doc`

## Current product state

### What exists now

- homepage / marketing page
- demo page
- login and create-account flow
- profile fields:
  - full name
  - organization name
  - role
- per-user private document storage
- upload flow
- browser-side text extraction
- keyword search
- year filter in search
- file preview modal
- file download
- file share using device default when possible
- file delete
- profile editing
- simple plan display
- document limit tracking

### Current signed-in structure

Current product app is organized into:

- `Account`
  - profile details
  - editable profile form
  - billing information placeholder
- `Library`
  - search
  - upload
  - all files management

### Current pricing direction

Current pricing direction in the product and homepage is:

- `Free`
  - 1 account
  - 25 documents
- `Starter`
  - 1 account
  - 250 documents
- `Organization`
  - larger archive direction, future-facing

Current app enforcement is client-side only.

Important:

- this is acceptable for MVP
- not acceptable for a real paid product
- real enforcement must move server-side later

## Product positioning

The product should be positioned as:

- records management
- searchable archive
- simple record keeping

It should not currently be positioned as:

- a fully mature public records publishing platform
- a complete multi-user board portal
- a finished AI records assistant

## Important current product decisions

### 1. Marketing site and app should stay separate

Recommended model:

- `/` = marketing site
- `/app/` = product entrypoint
- logged-in users should go straight to product pages, not back through the homepage

### 2. Sharing is temporary for now

Current share behavior uses:

- native device share if available
- fallback to signed link copy

This is temporary behavior.

Branded share links should wait until the final domain exists.

### 3. Domain-dependent features should wait

Do not fully build branded sharing yet because there is no final domain.

Once a domain is chosen, later share URLs can become something like:

- `yourdomain.com/records/share/:token`

### 4. Stripe should be prepared, not fully built yet

The schema is being prepared for Stripe with fields such as:

- `subscription_tier`
- `account_status`
- `document_limit`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_price_id`
- `subscription_current_period_end`

This means:

- the account model is billing-ready
- billing itself is not fully live yet

## Near-term roadmap

### Phase 1: stabilize MVP

Focus:

- make current flows reliable
- tighten UI
- remove claims that exceed actual features
- verify plan/account data is consistent

Tasks:

- confirm live auth flow works end-to-end
- confirm profile edits persist correctly
- confirm upload/search/delete/share/preview all work on deployed app
- improve first-time empty states
- improve error handling and user messaging
- verify mobile layout in login and dashboard

### Phase 2: records workflow improvements

Focus:

- make the product feel more like a usable archive

Tasks:

- better file sorting
- better browsing in all files
- stronger year/month filtering
- duplicate handling
- upload validation improvements
- archive organization improvements
- improved search ranking

### Phase 3: paid product foundation

Focus:

- prepare real paid tier behavior

Tasks:

- backend-side plan enforcement
- Stripe Checkout flow
- Stripe customer/subscription sync
- upgrade path in account area
- clearer plan UI
- policy and pricing finalization

### Phase 4: sharing and public access

Focus:

- branded sharing on owned domain

Tasks:

- add `shared_links` table
- create public share route on own domain
- create share-link creation endpoint
- support revoke / expire behavior
- decide preview vs download permissions

### Phase 5: heavier document processing

Focus:

- support more real-world records formats

Tasks:

- PDF text extraction
- OCR
- `.doc` handling
- backend extraction pipeline
- chunking for long documents

### Phase 6: multi-user organizations

Focus:

- move from personal archives to organization-owned archives

Tasks:

- organizations table
- organization membership table
- organization-level document ownership
- multi-user roles and permissions

### Phase 7: AI layer

Focus:

- build on the extraction/search foundation after the archive model is stable

Tasks:

- summaries
- better semantic search
- question answering
- AI document assistant

## Detailed future sharing model

This is deferred until domain acquisition, but this is the intended pattern.

### Goal

Instead of sharing raw signed storage URLs, create branded share links on the app domain.

Example:

- `yourdomain.com/records/share/8fj3k2`

### Intended architecture

- files remain private in storage
- app owns share links
- backend validates token
- backend issues short-lived internal file access

### Recommended model

Table:

- `shared_links`
  - token
  - document_id
  - created_by
  - is_active
  - expires_at
  - created_at

Request flow:

1. user clicks `Share`
2. backend creates token row
3. app shares branded URL
4. public route resolves token
5. backend redirects to short-lived signed URL or streams file

### Scalable recommendation

At scale, the best default is:

- app-owned public share URL
- backend validation
- redirect to short-lived signed URL

That is more scalable than proxy-streaming every file through the app backend.

## Detailed future Stripe model

### Recommended billing approach

When billing is implemented, use:

- Stripe Checkout Sessions for plan checkout
- subscription billing
- server-side webhook sync

The dashboard should eventually show:

- current plan
- billing status
- next renewal
- upgrade / downgrade options

### Minimum future billing flow

1. user clicks `Upgrade`
2. backend creates Stripe Checkout Session
3. user completes checkout
4. Stripe webhook updates `profiles`
5. app reflects updated plan and limit

### Important note

Plan enforcement should eventually happen:

- in backend checks
- not just in browser code

## Data model direction

### Current model

- user-based document ownership

This is acceptable for MVP.

### Future model

Eventually move toward:

- organizations
- organization_members
- documents owned by organizations, not just users

This matters because records usually belong to the organization, not the individual who uploaded them.

## UX direction

### Login

Should behave like product auth, not like a marketing page.

### Dashboard

Should behave like a real app with:

- account section
- working library section

### Marketing site

Should explain the product, but not overclaim features that are still future work.

## Things to avoid

- overbuilding branded sharing before domain is chosen
- overpromising AI features before the archive foundation is stable
- enforcing paid limits only in the UI forever
- mixing marketing navigation into product pages
- treating raw Supabase URLs as the long-term public sharing model

## Immediate next priorities

If work resumes later, start here:

1. verify live dashboard flow on deployed site
2. confirm current schema matches app expectations
3. polish file management and search UX
4. decide what billing UI should be visible before Stripe is live
5. buy final domain before branded sharing work

## Notes for future continuation

This product should be built in layers:

1. records archive foundation
2. stronger workflow and file management
3. billing and plan enforcement
4. branded sharing
5. organization ownership
6. AI

That order matters. The records and permissions layer should be stable before billing and AI complexity are added.
