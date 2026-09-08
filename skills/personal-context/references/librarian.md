# Librarian protocol

The Librarian is the maintenance function for consistency and reuse. It may be performed by any capable agent following this protocol; it is not a privileged personality or a separate source of truth.

## Responsibilities

- Detect likely duplicate projects, concepts, terms, methods, and artifacts.
- Connect isolated but related contributions.
- Identify conflicting active decisions and unresolved terminology collisions.
- Separate current knowledge from superseded history.
- Flag stale, weakly sourced, or unverified conclusions.
- Propose reusable concepts from clusters of project events.
- Keep discovery indexes compact and current when the library layer supports them.

## Maintenance sequence

1. Call `context_status` and define the requested scope.
2. Call `list_projects`; search cross-project when checking duplication or reuse.
3. Load only affected project contexts.
4. Call `lint_context` for deterministic structural findings.
5. Perform judgment-based checks that the linter cannot:
   - same thing under different names;
   - different things sharing one ambiguous name;
   - repeated methods that should be reusable;
   - conclusions whose evidence or freshness is doubtful;
   - disconnected artifacts or unanswered questions;
   - a newer event that should explicitly supersede or resolve an older one.
6. Separate findings into automatic-safe and judgment-required proposals.
7. Publish corrections, terminology, relations, or curated knowledge only when the user asked for changes or an established maintenance policy authorizes them.
8. Re-run `lint_context` and return receipts.

## Authority boundary

The Librarian may organize and flag without changing meaning. It must not silently:

- merge projects;
- rename a canonical term;
- accept a hypothesis;
- choose between conflicting interpretations;
- deprecate knowledge;
- discard history.

Escalate those decisions with concise evidence and a recommended option.

## Suggested maintenance output

```text
Scope checked
Deterministic lint findings
Likely duplicates or aliases
Connections worth adding
Stale or weakly verified knowledge
Proposed changes requiring judgment
Changes applied, with event IDs
```
