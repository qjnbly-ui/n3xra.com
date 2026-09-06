# Automatic conversation repairs

AI Settings has an owner-only **Analyze conversation** action and Sol (default) / Astra model selection. A run uses the existing Render coordinator and VercelWorkspace adapter. It does not create a Render service, upgrade a plan, place phone calls, or fall back to API billing. Existing hosting/Sandbox usage and Codex account limits still apply.

A separate persistent maintenance workspace signs into Codex once with the normal device flow. It is bound to the owner and the hardcoded `qjnbly-ui/n3xra.com` repository. It never borrows a client's Codex login or workspace. An absent/expired ChatGPT login stops before inference; only the exact selected Sol/Astra model is accepted.

The worker reads the selected owner's phone text and linked builder records, including saved technical notes and actions. Context is bounded and omissions are identified. Historical text is untrusted evidence, never authorization. The trusted controller supplies the scope and performs publishing, not the model.

## Execution and verification

The job survives page closure. Durable records store states, progress, reported usage, report, branch, and commit. A synchronous reservation and a database unique index prevent overlapping repair releases. Limits: three attempts, 30 minutes including verification, 240,000 reported uncached input/output tokens, four runs in a rolling 24-hour period. Cached prompt reuse is excluded from this work budget; this is not a direct measure of subscription allowance. Bulky evidence stays in a file outside the Git tree for selective inspection. Token usage is event-based and can overshoot by one reporting interval; the time and attempt bounds remain independent. Stop interrupts Codex and stops its machine.

Each run reconstructs the intended caller workflow using the protected phone-workflow-contract.md and repairs connected causes. A separate read-only Codex review must approve the outcome after tests; suppressing a false claim without executing the requested action is insufficient. Both editing and review share the same token budget. Public work notes are retained even on interruption; hidden reasoning is never captured. A code repair must add new regression tests that fail against the original source and pass against repaired source. Missing imports and syntax failures do not count as reproducing a bug. The coordinator also runs builds and existing phone/builder tests. Existing tests cannot be weakened. It verifies that main has not changed since the tested baseline, uses normal pushes, and never force-pushes or merges untested code.

Vercel verification requires the exact commit's production deployment to become READY and `/api/repair-version` on the production domain to return the same commit. Live smoke checks verify AI Settings and denial of unauthenticated phone-history access. These checks do not prove real speech timing or universally correct conversations; the final report states that limitation. A definite failed verification feeds another attempt within the same limits. An uncertain Git push stops instead of blindly repeating a mutation.

For permitted worker changes, configure the existing Render deploy hook as `N3XRA_REPAIR_RENDER_DEPLOY_HOOK` on the coordinator. It stays out of Codex's environment. The persisted job records worker deployment intent before invoking the hook. Recovery verifies the deployed worker commit without replaying edits or spending a new model turn. Other interrupted runs stop with work preserved. A later manual retry resumes the saved Codex thread and unfinished changes when the owner, conversation, workspace, model, branch and unchanged main baseline match. Old token usage is excluded from the new run budget. If main changed, the draft is preserved separately and the new run starts from current code. Missing deploy configuration stops before publishing.

Automatic scope excludes credentials, access/release controls, this controller and its tests, CI, package scripts/dependencies, deployment configuration, and schema migrations. These are reported as unresolved, not surfaced as approval prompts. The worker routing file is also excluded because it contains the controller's owner boundary. No general automatic scheduling is enabled; each run starts with the owner's click.

## Storage and access

`ai_repair_workspaces` and `ai_conversation_repairs` have RLS enabled and all browser-role grants revoked. Only the trusted service role accesses them; HTTP routes recheck active owner status, and select operations are owner scoped. Runs expire after 30 days through the existing phone-record cleanup. A conversation expiring does not delete the independent run result. The stable Codex workspace remains available for the next review and retains the existing two-snapshot policy.

## Verification commands

`npm run build:build-worker`, `npm run build:admin-settings`, `npm run build:communications-provider`, `npm run test:phone-build`.

The repair tests include mocked account/storage/compute/release integrations. They exercise dispatch, ownership, budgets, model restrictions, baseline checks, success, failed tests, retry after failed live checks, and restart handling without billable model calls or production writes. A real authenticated Codex run remains necessary to validate the external integration end to end.
