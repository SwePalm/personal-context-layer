# Event model

Use one event for one durable contribution. Raw events are append-only; later events may supersede or resolve earlier ones.

Every decision and question requires a `subject`: a stable key for the issue being decided or answered. Use the same underlying phrase across related events; the server normalizes spaces, capitalization, and punctuation. Long keys are shortened at a readable boundary and receive a deterministic hash suffix, so do not manually truncate them. Relations remain the authoritative way to supersede or resolve a specific event.

| Type | Use for | Typical status |
|---|---|---|
| `brief` | A current orientation or material change in project direction | `accepted` |
| `learning` | Supported insight expected to remain useful | `accepted` |
| `hypothesis` | Plausible but unverified claim | `proposed` |
| `decision` | Chosen direction and its rationale | `accepted` |
| `pivot` | Meaningful change of direction and why | `accepted` |
| `question` | Unresolved issue that should survive the session | `open` |
| `result` | Experiment, verification, or outcome | `accepted` |
| `artifact` | A produced document, deck, image, dataset, or other output | `accepted` |
| `terminology` | Canonical name plus aliases for one concept | `accepted` |
| `method` | Repeatable way of working; potential future skill | `accepted` |
| `correction` | A factual or interpretive correction | `accepted` |
| `note` | Durable material that fits no narrower type | `accepted` |

## Relationships

- `related_event_ids`: contextual association without changing state.
- `supersedes`: replace earlier current state while preserving history.
- `resolves`: answer or close an earlier question.

## Recorded and effective status

The stored status records how an event entered the ledger. Retrieval computes an effective status from later relations: a question targeted by `resolves` is shown as `resolved`, and an event targeted by `supersedes` is shown as `superseded`. Detailed retrieval may include `recorded_status` when it differs. Reason over the effective status while preserving the recorded value as history.

## Quality test

Before publishing, ask whether it will matter in another conversation, makes sense without the transcript, has an honest status, retains provenance, and contains no credentials or unnecessary sensitive data.
