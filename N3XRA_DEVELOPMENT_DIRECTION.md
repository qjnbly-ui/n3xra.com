# N3XRA Development Direction

## Purpose

This document defines the preferred technical direction for N3XRA projects.

It is intended to guide new development without forcing unnecessary rewrites of existing working projects.

The overall goal is to move N3XRA toward a consistent, modern, maintainable stack while keeping development practical and understandable.

---

# 1. Core Philosophy

N3XRA should favor:

- Simple architecture where possible
- Modern professional development practices
- Type safety
- Reusable components
- Secure database-backed applications
- Shared systems rather than duplicated client code
- Incremental modernization rather than unnecessary rewrites
- Technologies that work well with AI-assisted development and remain understandable to a human developer
- As few unnecessary frameworks and dependencies as possible

Do not introduce a new framework, language, database, state-management system, ORM, or major dependency simply because it is popular.

There should be a clear reason for every major technology added to a project.

---

# 2. Preferred N3XRA Stack

The long-term preferred N3XRA stack is:

**Astro + React + TypeScript + HTML/CSS + Supabase/PostgreSQL + SQL**

These technologies serve different purposes and are intended to work together rather than replace one another.

### TypeScript

TypeScript should become the default programming language for new application logic.

Prefer:

```text
.ts
.tsx
```

over new:

```text
.js
.jsx
```

Existing JavaScript does not need to be converted simply for the sake of conversion.

When existing JavaScript must be substantially modified, consider converting that specific area to TypeScript if it can be done safely.

### React

Use React for interactive application interfaces and reusable UI components.

Examples:

- Dashboards
- Forms
- Tables
- Modals
- Navigation
- Client portals
- Admin interfaces
- Interactive records systems
- Application settings
- Complex user interactions

Prefer TypeScript React components:

```text
.tsx
```

### Astro

Use Astro as the preferred web framework where it fits the project.

Astro can provide:

- Routing
- Pages
- Layouts
- Application structure
- Server functionality
- Integration with React
- Build tooling

Do not force every piece of a project into React when ordinary Astro, HTML, or CSS is sufficient.

### HTML and CSS

HTML and CSS remain fundamental technologies.

Continue using semantic HTML and understandable CSS.

React, Astro, and TypeScript do not eliminate the need to understand HTML and CSS.

Avoid unnecessary abstraction when simple HTML/CSS solves the problem well.

### Supabase / PostgreSQL

Supabase is the preferred backend platform for N3XRA applications unless a project has a specific reason to use something else.

Use it for:

- PostgreSQL databases
- Authentication
- Row Level Security
- Storage
- Realtime functionality where appropriate
- Server/database functions where appropriate

Database design should assume that security cannot depend solely on the frontend.

### SQL

SQL is the preferred language for database structure and database-level logic.

Use migrations for structural database changes.

Important security rules, especially tenant isolation and authorization, should be enforced at the database level using PostgreSQL and RLS where appropriate.

---

# 3. Standard Client Websites

A normal N3XRA client website should remain as simple as its requirements allow.

Typical direction:

```text
Astro
├── HTML
├── CSS
├── TypeScript
└── React only where interaction requires it
```

A six-page business website does not need to behave like a massive SaaS application.

Use Astro pages and components for ordinary content.

Use React selectively for genuinely interactive portions.

Examples:

- Interactive forms
- Account controls
- Dynamic dashboards
- Complex search/filtering
- Client tools

Do not convert static content into React components without a useful reason.

---

# 4. N3XRA Applications

Applications should generally use:

```text
Astro
+
React
+
TypeScript
+
Supabase
+
PostgreSQL / SQL
```

Examples include:

- N3XRA Records
- Mapping
- Inventory
- CRM
- Scheduling
- Client management
- AI tools
- Administrative systems
- Future N3XRA products

Applications should favor reusable components and clearly separated application logic.

New application code should default to TypeScript.

---

# 5. N3XRA Client Portal

The N3XRA client portal should be developed as a shared multi-tenant application.

Preferred structure:

```text
N3XRA Platform

app.n3xra.com
└── N3XRA administrative platform

*.portal.n3xra.com
└── Client-facing tenant portals
```

Examples:

```text
client-a.portal.n3xra.com
client-b.portal.n3xra.com
client-c.portal.n3xra.com
```

All client portals should run from the shared N3XRA portal application rather than maintaining independent copies of portal code.

Updates to the shared application should improve all client portals.

---

# 6. Tenant Architecture

Client isolation must not depend on the URL alone.

The subdomain identifies the tenant.

Supabase/PostgreSQL determines whether the authenticated user is authorized to access that tenant's resources.

Conceptually:

```text
Request
   ↓
client.portal.n3xra.com
   ↓
Resolve tenant
   ↓
Authenticated N3XRA user
   ↓
Organization membership / permissions
   ↓
Supabase RLS
   ↓
Authorized data
```

A client must never be able to access another client's information by modifying frontend requests, IDs, URLs, or browser state.

Tenant isolation should ultimately be enforced at the database level.

---

# 7. Organizations

Prefer an organization/tenant model rather than attaching everything directly to individual users.

Conceptually:

```text
Organization
├── Members
├── Websites
├── Portal
├── Files
├── Billing
├── Requests
├── Records
├── Mapping
├── Inventory
└── Other N3XRA products
```

A user may eventually belong to multiple organizations.

An organization may own multiple websites or N3XRA products.

Permissions should be designed with this future capability in mind.

---

# 8. N3XRA Ecosystem Goal

N3XRA should gradually become a unified platform rather than a collection of unrelated applications.

A client should eventually be able to use one N3XRA identity to access the products enabled for their organization.

Example:

```text
N3XRA Client Portal

Website
Files
Change Requests
Billing

Add-ons
├── Records
├── Mapping
├── Inventory
├── CRM
├── Scheduling
├── Payments
└── AI
```

Products should be modular.

A client should only see features their organization is authorized to use.

---

# 9. Authentication

Prefer a shared N3XRA identity system rather than creating completely separate authentication systems for every N3XRA product.

The long-term experience should be:

```text
One N3XRA account
        ↓
Organizations
        ↓
Authorized N3XRA products
```

Authentication establishes who the user is.

Authorization determines what that user is allowed to access.

These should be treated as separate concerns.

---

# 10. Development Workflow

Modern N3XRA projects may use a development/build system.

Typical development:

```bash
npm run dev
```

This starts the local development environment.

It normally only needs to be started once during a development session.

Changes can then be made while the development server remains running.

Production verification commonly includes:

```bash
npm run build
```

A developer does not need to manually visit every page for the build system to process the application.

However, important UI and functional changes should still be tested appropriately.

---

# 11. Existing Projects

Do not rewrite working N3XRA projects solely to make them conform to this document.

Existing projects may contain:

- HTML
- CSS
- JavaScript
- Older architectural patterns

That is acceptable.

Modernization should generally happen incrementally.

When working on an existing feature:

```text
Does existing code work?
        ↓
YES
        ↓
Does this task require changing it?
        ↓
NO → Leave it alone.

YES
        ↓
Can it reasonably move toward the preferred architecture?
        ↓
YES → Improve it as part of the work.
```

Avoid large unrelated refactors.

---

# 12. AI-Assisted Development

N3XRA uses AI-assisted development heavily.

AI should help accelerate development without creating unnecessary architectural complexity.

When implementing a feature:

1. Inspect the existing repository first.
2. Understand existing architecture and conventions.
3. Reuse existing systems where appropriate.
4. Determine the smallest safe implementation.
5. Follow the preferred N3XRA direction for new code.
6. Avoid unrelated refactors.
7. Explain significant architectural decisions.
8. Run relevant checks and builds.
9. Preserve security boundaries.
10. Do not assume successful compilation proves functional correctness.

AI-generated code should remain understandable and maintainable.

---

# 13. Dependency Philosophy

Prefer fewer dependencies.

Before adding a package, determine whether:

- The project already contains something that solves the problem.
- The platform already provides the capability.
- The functionality can reasonably be implemented without another dependency.

Do not add large frameworks to solve small problems.

Avoid maintaining multiple libraries that perform essentially the same job.

---

# 14. Security Direction

Security should be built into architecture rather than added afterward.

For N3XRA applications, prioritize:

- Supabase Auth
- PostgreSQL Row Level Security
- Server-side authorization
- Organization membership
- Explicit permissions
- Least privilege
- Secure secrets management
- Database constraints
- Auditability for sensitive actions

Never rely exclusively on hiding buttons or frontend routes to protect privileged functionality.

---

# 15. Future Custom Domains

Client portals should initially use:

```text
client-name.portal.n3xra.com
```

Custom portal domains can be added later.

Example:

```text
manage.clientwebsite.com
```

Both addresses should ultimately resolve to the same tenant application.

Custom domains should be an extension of the tenant architecture, not a separate application architecture.

---

# 16. What N3XRA Should Avoid

Avoid drifting toward:

```text
Project A → completely different stack
Project B → another framework
Project C → another database
Project D → another authentication system
Project E → another frontend architecture
```

unless requirements genuinely justify the difference.

The preferred direction is:

```text
                 N3XRA
                   │
        ┌──────────┴──────────┐
        │                     │
    Websites                Apps
        │                     │
      Astro            Astro + React
        │                     │
   TypeScript             TypeScript
        │                     │
        └─────────┬───────────┘
                  │
               Supabase
                  │
              PostgreSQL
                  │
                 SQL
```

---

# 17. Decision Rule

When choosing how to implement something new, ask:

> Can this be built cleanly using the existing N3XRA architecture and the preferred Astro + React + TypeScript + Supabase/PostgreSQL stack?

If yes, use it.

If another technology would provide a meaningful architectural advantage, it may be considered, but the reason should be explicit.

Do not add technology merely for novelty.

---

# Long-Term Direction

N3XRA should gradually converge around:

**Astro + React + TypeScript + HTML/CSS + Supabase/PostgreSQL + SQL**

The objective is not to use the most technologies.

The objective is to build a coherent platform that is:

**Secure, understandable, maintainable, scalable, reusable, and increasingly consistent across N3XRA products.**
