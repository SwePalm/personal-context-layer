# Contribution packaging protocol

Use this protocol to share one learning or harvest a conversation into a project.

## Quality gate

Package information only when it passes all of these checks:

- **Durable:** likely useful in a later conversation.
- **Standalone:** understandable without the source transcript.
- **Atomic:** one primary claim, decision, question, method, or artifact.
- **Placed:** belongs to a resolved project.
- **Honest:** status reflects confidence and acceptance.
- **Traceable:** source application and available conversation or URL are recorded.
- **Connected:** relevant supersedes, resolves, or related links are included.
- **Safe:** contains no credentials or unnecessary sensitive information.

Transient brainstorming, pleasantries, abandoned wording, and intermediate drafts normally fail the gate.

## Package one contribution

1. Load the destination project context.
2. Search the subject if duplication or a terminology collision is plausible.
3. Select the event type using [event-model.md](event-model.md).
4. Write a short title and a summary that states the conclusion and why it matters.
5. Put supporting nuance, limitations, and evidence in `details`.
6. Use a stable `subject` for every decision and question. Describe the underlying issue, not the wording of this one event; the server normalizes it into a canonical key.
7. Record an explicit, stable `source_app` display name for the originating experience, such as `Codex Desktop` or `Claude Code`. The store derives a broader application family for analysis without discarding that precision. Use a stable `source_conversation` identifier when one is available; this makes an exact replay safely reuse the existing event.
8. Call `publish_learning`, then `lint_context`. A `duplicate: true` receipt means the identical event already existed and no new event was written. Inspect the receipt's synchronization state and report when the contribution exists only in the local vault.

## Harvest a conversation

1. Review the complete available conversation.
2. Extract candidates: decisions, pivots, results, hypotheses, open questions, terminology, methods, artifacts, corrections, and materially changed briefs.
3. Merge candidates that express the same claim; split candidates with independent lifecycles.
4. Remove anything that fails the quality gate.
5. Check current project context so the harvest extends rather than restates it.
6. Add relations to existing events where supported.
7. Call `harvest_session` once with the packaged events. The server validates every candidate before beginning the batch.
8. Call `lint_context`.
9. Verify that `saved_count + duplicate_count` equals the number of returned event receipts. If it does not, reload the project before reporting success.
10. Report newly saved and reused event IDs separately, unresolved lint findings, and synchronization state. Count from the tool result; do not recount from prose or memory.

Preserve the reason for a pivot, not only its final direction. Preserve meaningful failed approaches when they prevent repeated work.

## Status rules

- `accepted`: agreed decision, established learning, completed result, or adopted method.
- `proposed`: hypothesis or candidate that has not been accepted.
- `open`: unanswered question.
- `resolved`: normally expressed by a later event whose `resolves` relation points to the question.
- `superseded`: normally derived from a later event whose `supersedes` relation points to the older event.
- `rejected`: explicitly considered and rejected; retain the reason.

The write boundary enforces the event vocabulary, sensitivity values, required provenance, decision/question subjects, and the rule that hypotheses cannot be accepted. Fix a rejected candidate before retrying; do not weaken or bypass the invariant.

Never infer human approval merely because an AI agent suggested something.

## Provenance rules

- `source.app`, `source.conversation`, and `source.url` describe where the contribution originated. `source.app` is a precise display value; `source.family` is a derived canonical family such as `codex` or `claude` for grouping related application variants.
- `runtime_host` describes where the MCP server executed. It is diagnostic metadata, not the author, source application, or necessarily the user's physical machine.
- Do not infer origin from a hostname. When relaying material from another AI buddy, name that buddy or application explicitly in `source.app`.
