# Local-first architecture

```text
product source ──deploy──> versioned local runtime
                              │
AI app A ──same skill + MCP────┤
AI app B ──same skill + MCP────┤
shell agent ─────pctx───────────┤
                              ▼
                    separate personal vault
                              │
                              ▼
                    private GitHub repository

Second machine repeats the runtime + local vault clone.
```

## Design choices

- Append-only events avoid silent history loss and minimize merge conflicts.
- Compiled current state distinguishes active decisions and open questions from superseded history.
- Portable files keep the knowledge readable if the server disappears.
- A thin MCP server gives agents stable verbs without requiring a model API key.
- A portable skill provides the interaction contract across compatible applications.
- MCP and `pctx` are thin transports over one command layer, preventing semantic drift between interfaces.
- Git synchronization is explicit so failures stay visible.
- Product development, installed execution, and personal data use separate folders and lifecycles.
- A stable `current` runtime link lets app configuration survive versioned upgrades.
- Compact projections are the default retrieval unit; full event bodies are opt-in.
- Source provenance and MCP runtime location are separate fields. Precise `source.app` display provenance is preserved while a derived `source.family` supports grouping application variants.

```text
MCP JSON-RPC framing ─┐
                     ├─> src/commands.mjs ─> src/context-store.mjs ─> vault
pctx argv/stdin ─────┘
```

Detached clients reuse the same semantic boundary without gaining direct vault access:

```text
context projection ──> cloud chat ──> candidate harvest file
                                           │
                                           v
                                   pctx/commands/store ──> vault
```

The candidate file is the existing `harvest_session` argument shape. It contains no generated event IDs, authoritative timestamps, or receipts. Manual upload/download is the first transport experiment; a future GitHub inbox/outbox may move the same artifacts but must not bypass the command layer.

## Event lifecycle

1. An agent reads the relevant project context.
2. The conversation produces a durable contribution.
3. The shared store validates the complete candidate or harvest batch before writing.
4. The agent publishes an immutable event with explicit provenance; an exact replay from the same source conversation reuses the existing ID. The write receipt immediately reports whether Git synchronization is pending.
5. Relations mark older events as superseded or resolved without editing them.
6. The server compiles the current view at read time.
7. The linter checks structural integrity and naming collisions.
8. Git transports new events between machines as a separate, explicit operation.

Active redaction is a narrow exception to append-only content: the event file is replaced with a tombstone so normal retrieval no longer exposes its body. Existing Git history and distributed copies still retain the prior bytes until a separately authorized and verified history purge is performed.

## When a remote gateway becomes useful

Add one only after the local workflow proves valuable and cloud-only access, an always-on moderator, near-real-time multi-client writes, lower Git friction, or per-client access policies become important. The event schema and skill vocabulary should remain stable if storage later moves behind a hosted service.

## Next experiments

- Verify whether ChatGPT mode in the unified desktop app can invoke the local skill and MCP server.
- After detached-chat testing, evaluate a generated `catalog.pctx.json` as a rebuildable GitHub/outbox discovery view. Build it when repeated catalog-upload friction or GitHub-based discovery is observed. It must be derived from project manifests, refreshed automatically, and never become the source read by `pctx projects`.
- Measure whether harvest captures enough of a learning journey without creating noise.
- Test canonical names and aliases across unrelated conversations.
- Test conflicting decisions written on two machines before synchronization.
- Compare explicit end-of-session harvest with automatic harvesting.
- Verify each actual AI application's skill and MCP conventions before claiming portability.
