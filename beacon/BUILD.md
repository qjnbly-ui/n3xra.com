# BEACON Build Sheet

## Product

**Name:** BEACON

**Description:** A secure platform for community reporting, coordination, and safety alerts.

**Attribution:** Use a discreet “Powered by N3XRA” label. Do not include “by N3XRA” in the BEACON title.

## Structure

- `n3xra.com/beacon` — public product page
- `n3xra.com/beacon/app` — application
- `beacon.n3xra.com` — optional future application address if separate hosting or infrastructure is needed

## Color Palette

| Role | Color | Hex |
| --- | --- | --- |
| Foundation | Midnight | `#101820` |
| Trust and community | Evergreen | `#254E46` |
| Light surfaces and text | Warm white | `#F7F6F2` |
| Reports and attention | Beacon amber | `#F4AD45` |
| Secondary text | Slate | `#66757F` |
| Genuine emergencies only | Critical red | `#C94B4B` |

Critical red must be reserved exclusively for genuine emergency states. It should not be used for ordinary errors, decorative accents, or general emphasis.

Slate (`#66757F`) should primarily be used on light surfaces. Do not use it for small text on the midnight background unless contrast testing confirms that the specific size and weight meet accessibility requirements.

## Visual Direction

- Use a deep charcoal/navy foundation with warm off-white surfaces.
- Use muted evergreen to communicate trust and community.
- Use beacon amber for reports, attention, and active signals.
- Favor clear typography, spacing, dividers, and layout hierarchy over containers.
- Use full-width panels and map-first interfaces where appropriate.
- Keep borders thin and shadows restrained.
- Prefer square or subtly rounded edges.
- Use rounded cards only when content genuinely needs containment.
- Avoid grids of floating, heavily rounded cards and excessive pill-shaped controls.

## Interface Principles

- Make maps clear and easy to understand.
- Use large, accessible touch targets.
- Keep text highly readable at all screen sizes.
- Make alert severity understandable without relying on color alone.
- Keep primary actions obvious and reduce visual clutter.
- Design mobile-first while making good use of wider screens.
- Keep the N3XRA attribution visible but secondary to BEACON.

## Technical Direction

### Core Languages

- Use **TypeScript** as the primary application language.
- Use **SQL** for database schemas, migrations, permissions, and geospatial queries.
- Use HTML and CSS for the public product page.
- Do not introduce additional production languages without a demonstrated technical need.

### Web and Mobile

- Build `/beacon/app` as a mobile-first React and TypeScript progressive web application.
- Use Expo and React Native for native mobile applications.
- Share types, validation, API clients, permissions, and business logic between web and mobile.
- Allow platform-specific interface components when necessary, especially for maps, cameras, notifications, and location services.

### Platform

- Use N3XRA’s existing Supabase foundation for authentication, PostgreSQL, private file storage, realtime features, and server-side functions.
- Use PostGIS for service-area boundaries, distance calculations, and privacy-safe map aggregation.
- Use Vercel for the public website and web application.
- Use background queues and workers for media processing, notifications, and automated submission review.

### Product Isolation

- Give BEACON dedicated database schemas, storage buckets, permissions, and audit records.
- Share N3XRA identity only where appropriate.
- Do not allow another N3XRA product to access BEACON data by default.
- Keep the initial test boundary configurable. Never hardcode a community name into the permanent application architecture.

### Security Requirements

- Enforce authorization in the database with row-level security.
- Store trusted roles in protected account metadata, never user-editable profile metadata.
- Keep uploaded evidence private by default and use short-lived signed links.
- Never expose administrative or service credentials in browser or mobile code.
- Preserve original submissions separately from sanitized or public versions.
- Record access to sensitive information in tamper-resistant audit logs.
- Encrypt data in transit and at rest, with additional field-level protection where justified.

### Scaling Approach

- Begin with a well-structured modular application rather than premature microservices.
- Scale storage, database reads, realtime delivery, and background processing independently as usage grows.
- Introduce Go or Rust services only when measured performance, security, or processing requirements justify them.
- Keep dependencies pinned, commit lockfiles, and maintain separate development, staging, and production environments.

## Current Scope

The public `/beacon` page establishes the product identity. The application will live at `/beacon/app` when development begins.
