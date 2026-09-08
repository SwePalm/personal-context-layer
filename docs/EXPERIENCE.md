# Experience contract

The product boundary is a vocabulary, not a portal. Once the skill and MCP server are installed, the same requests should work in every compatible AI application.

## Core interactions

| Human request | Expected agent behavior | Receipt |
|---|---|---|
| “Use my context for Project X” | Verify the vault, resolve X, load current state, and use it in the task | Project ID and important event IDs |
| “What did we decide about Y?” | Search current decisions and older history; distinguish current from superseded | Answer with event IDs and source provenance |
| “Remember this” | Save one standalone durable event with honest status | Saved title and event ID |
| “Close and harvest” | Extract durable outcomes, preserving pivots and open questions without dumping the transcript | List of event IDs and lint result |
| “Moderate Project X” | Find aliases, contradictions, stale conclusions, and disconnected learnings | Proposed changes; no silent rewrite |
| “Remove sensitive event X” | Verify the exact event, explain Git-history limits, require confirmation, and replace active content with a tombstone | Redacted ID, lint result, and remaining-history warning |
| “Sync my context” | Inspect state, commit vault events, pull with rebase, and push | Performed steps or actionable failure |

## Trust rules

- Never claim context was loaded or saved without a successful tool result.
- Never silently turn a hypothesis into an accepted learning.
- Never discard an earlier decision when a new decision supersedes it.
- Never expose one project's context merely because another project uses similar words.
- Never store credentials.
- Always make important conclusions traceable to event IDs.
- Treat source provenance as origin and `runtime_host` only as the server execution location.
- Begin with compact retrieval and load full bodies only when needed.

## Compatibility levels

1. **Full**: the application supports Agent Skills and local MCP.
2. **Tool-only**: it supports local MCP but not skills; add equivalent standing instructions manually.
3. **Shell bridge**: it can call `pctx` through a local shell or machine bridge, reaching the same command layer without MCP.
4. **Skill-only**: it understands the workflow but cannot reach the vault unless given a shell bridge or export.
5. **Detached client**: it has neither local MCP nor shell access, but can consume a compact export and return a candidate harvest for later authoritative ingestion.
6. **Unreachable**: it has no tools and has not received an interchange export; it cannot claim access to the shared library.

Installing files does not guarantee identical behavior across models. The acceptance test is behavioral: can the agent load, publish, harvest, cite, lint, and sync correctly?

## Tested application paths

| Application | Skill location | MCP registration | Expected level |
|---|---|---|---|
| Codex | `~/.codex/skills/personal-context` | `codex mcp add` | Full; behavior tested |
| Claude Code | `~/.claude/skills/personal-context` | `claude mcp add --scope user` | Full; behavior tested |
| Cursor | `~/.cursor/skills/personal-context` | `~/.cursor/mcp.json` | Expected full; installation tested |
| OpenCode | `~/.config/opencode/skills/personal-context` | `opencode mcp add` | Full; behavior tested with a tool-capable model |
| ChatGPT mode in the unified desktop app | Codex skill metadata | To be verified | Acceptance test pending |
| ChatGPT web/chat | Uploaded compact context plus detached instructions | Candidate harvest returned as JSON | Detached; behavioral test pending |
| Shell-only or machine-bridged agent | Skill read as a document | `pctx` | Shell path verified; host-specific bridge still required |

Claude Desktop, Gemini Desktop, browser-only chats, and mobile apps are not claimed as full integrations by this prototype. When they can consume and return files or text, they can use the same application-neutral detached-client protocol; behavior still needs testing in each experience. Claude Desktop can use a local MCP extension, but that alone does not prove the same portable skill behavior.

The shell-bridge protocol was demonstrated by a cloud Claude session that drove the MCP server through hand-written JSON-RPC. `pctx` productizes that route without claiming that an ordinary cloud chat can reach a user's local machine: the shell or filesystem bridge must actually expose the machine and vault.

OpenCode's selected model must support tool use. The app can load the skill and connect the MCP server correctly while a text or image model selected through a provider route still rejects tool calls; choose a tool-capable model in that case.
