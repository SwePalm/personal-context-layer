# Library model

Use these distinctions when explaining, retrieving, or curating context.

| System term | Library metaphor | Meaning |
|---|---|---|
| Vault | Library | The complete personal context collection |
| Project | Project room or collection | One long-running objective and its learning journey |
| Event | Journal entry | Immutable contribution with provenance and relations |
| Concept | Curated library item | Current reusable explanation synthesized from evidence |
| Artifact | Published work | Article, presentation, report, dataset, or other output |
| Skill | Librarian handbook | Portable process telling agents how to use tools consistently |
| MCP server | Service desk | Deterministic operations over the library |
| Index | Card catalog | Compact overview used before deeper retrieval |

The service desk follows progressive disclosure: catalog and context calls return compact cards first; `detail: true` retrieves full bodies only when an agent needs them.

## History and current knowledge

Events preserve what happened: questions, decisions, pivots, results, and corrections. Never rewrite them to make history look cleaner.

Concepts present the best current reusable explanation. They may evolve, become stale, or be deprecated while retaining links to the events and sources behind them.

The current implementation stores events and compiles project state. The curated concept/index layer is an intended extension, not a capability to pretend exists. Until concept tools are available, use `list_projects`, `search_context`, and `get_project_context` as the catalog workflow.

## Carefully adopted OKF ideas

Use these ideas for future curated concepts without requiring strict OKF compliance:

- Markdown bodies readable by people and agents.
- Small structured metadata blocks.
- Stable identifiers and ordinary links.
- Source provenance.
- Separate generated and verified actors/timestamps.
- Draft, stable, and deprecated lifecycle.
- Optional freshness or `stale_after` signals.
- Compact generated indexes for progressive discovery.
- Attested procedures for important verifiers or computations.

Do not force every event into a concept document. Do not make the user maintain metadata or indexes manually. The event ledger remains evidence; the curated library remains a derived, reviewable view.
