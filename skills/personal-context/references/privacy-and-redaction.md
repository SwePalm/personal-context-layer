# Privacy and redaction protocol

Use correction or supersession for ordinary mistakes and changed thinking. Redaction is reserved for credentials, private data, or other content that should no longer appear in active retrieval.

1. Locate the exact event and verify its ID and project.
2. If a credential or token was exposed, tell the user to revoke or rotate it first. Redaction cannot make a leaked credential safe again.
3. Explain that `redact_event` replaces the active event file with a tombstone but does not erase earlier Git commits, remote copies, backups, or other clones.
4. Obtain explicit confirmation of the exact event ID. Never infer confirmation from a general request to tidy or correct the library.
5. Call `redact_event` with the same value in `event_id` and `confirm_event_id`. Keep the reason non-sensitive.
6. Call `lint_context`, then report what active content was removed and what historical copies may remain.

True erasure from Git requires a separate, deliberately authorized maintenance operation: rewrite history, force-update the remote, expire unreachable data where supported, and reconcile or replace every clone and backup. This MCP server does not provide that operation. Never claim that information has been fully forgotten unless that wider purge has been performed and verified.
