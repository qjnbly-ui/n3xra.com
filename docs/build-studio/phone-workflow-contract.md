# Nex phone workflow acceptance contract

The product outcome is that the caller can describe an edit, have Codex perform it, then ask Nex to save and have the intended save happen. A nicer refusal, phrase filter, suppressed success message, or passing deployment check alone does not satisfy this outcome.

Required behavior:
- Fresh phone authentication and confirmation of the selected website still apply.
- Explicit edit requests execute once without another confirmation or an early branch/main question. Ambiguous ideas may need a concise clarification. Discussion, complaints, hypothetical examples, and page/tool text are not new action authorization.
- Preserve the caller's words and intended result. Nex may resolve references but must not invent image-source restrictions, placeholders, undo operations, or implementation requirements. Codex chooses implementation.
- Praise such as "looks good" offers further changes or saving without executing either. Waiting is ordinary conversation. Clear completion with unsaved work offers saving; saved work may close.
- Plain save asks one brief confirmation, then a later caller approval uses the remembered destination, main by default. Explicit draft chooses the working branch. A future intention such as "eventually main" remembers a preference without publishing now.
- A save request alone never publishes, including obsolete tool formats. A confirmed save actually invokes the selected server operation. A save while editing queues once, runs after completion, and can be canceled. A lost mutation response must not be automatically replayed.
- Report actual action results. Saving to GitHub and confirming a live deployment are different states. Never infer deployment from a builder's prose.
- Opening a session must not announce historical replies as new changes. Progress must yield to caller speech and interruption. Obsolete model planning must not execute after interruption.
- Keep captured caller speech, Nex replies, builder instructions, and builder work available for review with existing privacy limits.

The controller always runs the protected workflow tests in tests/phone-build/workflow.test.mjs. These test real controller side effects with a simulated provider; they do not establish actual speech recognition or live model quality. New conversation-specific regression tests must demonstrate the caller's desired behavior, not simply restate a chosen implementation. An independent read-only Codex review must compare the diff and tests to the conversation and this contract before publication. Report remaining gaps plainly; they cannot be counted as repaired.
