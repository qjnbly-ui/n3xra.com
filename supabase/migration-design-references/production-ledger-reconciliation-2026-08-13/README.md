# Production ledger reconciliation archive

This directory preserves local migration artifacts that were removed from the active sequence during the 2026-08-13 read-only reconciliation with the production `supabase_migrations.schema_migrations` ledger.

Files here are historical references only. They are not active migrations and must not be applied automatically. The reconciliation report documents whether each file was replaced by the exact production-ledger version or was local-only.

Inventory:

- 83 local-only historical migration files, including 10 whose production-present schema changes remain active as ordered supplements
- 35 prior local variants of same-version production migrations
- 118 preserved SQL files total

See `supabase/reports/migration-history-reconciliation-2026-08-13.md` for the exact classification and deployment safety notes.
