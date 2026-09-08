# CLI fallback

Use `pctx` only when the personal-context MCP tools are unavailable and the agent has a shell. Keep the workflow order and interpretation rules from `SKILL.md`.

| MCP tool | CLI equivalent |
|---|---|
| `context_status` | `pctx status` |
| `list_projects` | `pctx projects` |
| `get_project_context` | `pctx context <project>`; add `--full` only when needed |
| `search_context` | `pctx search <query>` |
| `create_project` | `pctx new-project ...` |
| `publish_learning` | `pctx publish --json -` |
| `harvest_session` | `pctx harvest --json -` |
| `lint_context` | `pctx lint` |
| `redact_event` | `pctx redact --json -` after the privacy protocol's confirmation |
| `sync_context` | `pctx sync <action>` |

Default stdout is one JSON value and errors go to stderr. Parse the JSON result rather than inferring success from prose. Use `pctx help <command>` for the current payload and flag contract.

For agent-authored contributions, pass one JSON object over stdin. Do not interpolate summaries or details into shell command text. Preserve the same source, relation, subject, status, and sensitivity fields used by MCP.

Before any write, confirm from `pctx status` that `repository` is the intended vault. `--vault PATH` overrides the installed selection when an explicit alternate vault is required.
