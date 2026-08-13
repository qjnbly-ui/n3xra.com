# N3XRA Repository Instructions

Before planning or making code changes in this repository, read and follow the complete guidance in [`N3XRA_DEVELOPMENT_DIRECTION.md`](./N3XRA_DEVELOPMENT_DIRECTION.md).

## Required Direction

- Inspect and understand the existing architecture before changing it.
- Preserve working systems and avoid unrelated rewrites or refactors.
- Move new development toward **Astro + React + TypeScript + HTML/CSS + Supabase/PostgreSQL + SQL**.
- Use TypeScript for new application logic by default. Do not add new plain JavaScript unless existing tooling or integration requirements make it necessary.
- Use React with TypeScript (`.tsx`) for genuinely interactive interfaces and reusable application components.
- Use Astro for routing, layouts, public/static content, and application structure where appropriate.
- Keep ordinary content and simple interfaces in semantic HTML and understandable CSS when React is unnecessary.
- Use Supabase Auth for authentication and PostgreSQL/RLS for authorization and tenant isolation.
- Enforce sensitive security boundaries in the database or trusted server-side code, never only in frontend checks.
- Make structural database changes through reviewed SQL migrations.
- Reuse existing components, utilities, types, patterns, and dependencies before adding new abstractions.
- Do not add a framework, backend, ORM, state-management library, language, database, or major dependency without a clear architectural need.
- Keep shared N3XRA systems multi-tenant and reusable rather than duplicating client-specific application code.

## Working Standard

Choose the smallest safe implementation that satisfies the request and moves touched code toward the preferred direction. When an existing constraint prevents the preferred approach, preserve compatibility and explain the reason for the deviation.

Run checks, tests, builds, migrations, and relevant functional verification in proportion to the change. Successful compilation alone is not proof that a feature works or that its security boundaries are correct.
