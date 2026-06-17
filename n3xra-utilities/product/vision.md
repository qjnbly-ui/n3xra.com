# N3XRA Utilities Vision

N3XRA Utilities should become the coordination layer between utility operators and N3XRA-managed services.

The portal is not meant to replace a utility company's own backend. It should connect to that backend, verify operator access through the utility-owned Supabase project, and expose the N3XRA controls needed to manage account setup, service configuration, support, and shared operating standards.

## Principles

- Utility companies own their operator users.
- N3XRA owns the coordination and bootstrap layer.
- Service-role keys never reach browser code.
- Tenant boundaries are explicit and auditable.
- The portal starts static until the auth and tenant trust model is final.

## Future Capabilities

- Tenant onboarding and handoff checklist
- Utility Supabase project registration
- Operator identity mapping
- Master settings and feature flags
- Support requests and implementation tasks
- Environment health and connection status
- Audit trails for N3XRA-assisted changes
