# Personal Context Layer

A local-first context ledger shared by AI applications through one portable Agent Skill and one local MCP server.

The intended experience is conversational:

- “Use my context for Personal Context Layer before we continue.”
- “What did we decide about using GitHub?”
- “Remember this as a project learning.”
- “Close and harvest this conversation.”
- “Lint and sync my context.”

The AI application interprets those requests by following the installed skill. The MCP server performs deterministic storage, retrieval, validation, and Git synchronization.

## Why local MCP first

Each machine runs the same server against its local clone. GitHub can synchronize the append-only vault between machines. A remote MCP gateway is unnecessary for this stage.

This works directly for desktop or coding agents that can launch local MCP servers. A cloud-only chat cannot reach the local process, but it can participate as a detached client through compact context and candidate-harvest files. No hosted MCP service is required for that experiment.

## Install for personal use

Requirements: Node.js 20 or newer and Git.

Keep the product source and personal library in separate folders. The recommended vault location is `~/Personal Context`, with its own private Git repository.

1. Verify the product repository:

   ```sh
   npm test
   npm run verify
   ```

2. Deploy a versioned runtime, install the skill, and connect supported AI apps to the vault:

   ```sh
   npm run setup -- --vault "$HOME/Personal Context"
   ```

   On first use, setup may target a missing or empty folder. It creates the vault structure, configuration, README, `.gitignore`, and a local Git repository. It deliberately refuses to scaffold over a folder containing unrelated files. Adding a private GitHub remote remains an explicit step under your control.

   AI apps launch the local stdio MCP server on demand; no background service or terminal window is required.

   The runtime is installed under `~/.local/share/personal-context/`. Skills point to its stable `current` release rather than this development checkout.

   Setup also installs `pctx` at `~/.local/bin/pctx`. If that directory is not on `PATH`, setup prints the exact line to add. The selected vault is stored in `~/.config/personal-context/config.json` so shell-only agents reach the same library as MCP clients.

3. For development-only installation of one app, use:

   ```sh
   npm run install-skill -- codex
   ```

   Supported installer targets are `codex`, `claude`, `cursor`, `opencode`, and `all`. The default uses a symbolic link, so skill improvements are immediately available. Add `--copy` after the app name only when the application cannot follow symbolic links. The installer also registers the local MCP server without replacing an existing registration of the same name.

4. If an app's command-line tool was unavailable, configure an MCP server named `personal-context` with:

   ```text
   command: node
   argument: ~/.local/share/personal-context/current/src/mcp-server.mjs
   environment: PERSONAL_CONTEXT_ROOT=/absolute/path/to/the/personal-vault
   transport: stdio
   ```

   A typical JSON-based application configuration is:

   ```json
   {
     "mcpServers": {
       "personal-context": {
         "command": "node",
         "args": ["/absolute/path/to/.local/share/personal-context/current/src/mcp-server.mjs"],
         "env": {
           "PERSONAL_CONTEXT_ROOT": "/absolute/path/to/the/personal-vault"
         }
       }
     }
   }
   ```

   To register Codex manually, or to inspect what deployment does, use:

   ```sh
   codex mcp add --env PERSONAL_CONTEXT_ROOT=/absolute/path/to/the/personal-vault personal-context -- node ~/.local/share/personal-context/current/src/mcp-server.mjs
   ```

5. Check readiness at any time:

   ```sh
   npm run doctor
   ```

6. Restart the AI application, then say:

   ```text
   Use my personal context for the Personal Context Layer project. Tell me the current direction and open questions.
   ```

## Use the shell interface

`pctx` exposes the same command layer as the MCP server. It is intended for humans and AI buddies that have a shell but no MCP client.

```sh
pctx status --pretty
pctx projects --text
pctx context "Personal Context Layer"
pctx search "compact retrieval"
pctx lint --strict
```

Machine-readable single-line JSON is the default. Add `--pretty` for indented JSON or `--text` for a short human view. Context and search are compact by default; add `--full` only when the complete public event bodies are needed. Internal file paths are never part of the public result.

For durable writes, agents should send JSON over stdin so quotes, apostrophes, Unicode, backslashes, and line breaks survive without shell escaping:

```sh
printf '%s' '{"project":"Personal Context Layer","type":"learning","title":"Example","summary":"A durable standalone contribution.","source_app":"manual","source_conversation":"example-1"}' | pctx publish --json -
```

`source_app` is required. It preserves the precise originating experience, while the store derives a canonical application family so values such as `Codex` and `Codex Desktop` can still be analyzed together. When `source_conversation` is stable, submitting the exact same contribution again returns its existing event ID with `duplicate: true` instead of creating another event. Harvest validates every candidate before writing any candidate, so a malformed later item cannot leave a partially accepted batch.

Every consequential write receipt includes a compact `synchronization` result. `pending` means the knowledge is safely stored in the local vault but has not yet been committed and pushed for use on another machine. Publishing does not silently push: contribution and synchronization are deliberately separate so network or authentication failures remain visible. Use `pctx sync push`—or ask an AI buddy to sync your context—when the contribution should become portable.

Run `pctx help` or `pctx help <command>` for the complete surface. Exit code `0` means success, `1` means an operational or lint failure, and `2` means invalid command usage.

## Use an ordinary cloud chat

Export the existing compact projection, upload it with the detached-client instructions, and locally ingest the candidate harvest returned by the chat:

```sh
pctx projects --pretty > projects.pctx.json  # when the project is not known
pctx context "PROJECT NAME" --pretty > context.pctx.json
pctx harvest --json harvest.pctx.json --pretty
pctx lint --pretty
```

Upload `projects.pctx.json` first when ChatGPT should discover the available projects and help select one; skip that round trip when the project is already known. The detached chat never writes authoritative events and must not claim that its candidate JSON was saved. Start with [the detached-chat workflow](docs/CHAT-USAGE.md), [copyable client instructions](skills/personal-context/references/detached-clients.md), and the application-neutral [context](examples/detached-context.pctx.json) and [harvest](examples/detached-harvest.pctx.json) examples.

## Synchronize another machine

1. Clone the private personal-vault repository on the second machine.
2. Clone or download this product repository separately.
3. Run `npm run setup -- --vault /path/to/the/personal-vault` from the product repository.
4. Run `npm run doctor -- --vault /path/to/the/personal-vault`.
5. Ask the AI buddy to “sync my context” before switching machines and after returning to one.

Events use unique filenames, which makes Git conflicts uncommon. Project manifests are created once, and current state is compiled from events rather than maintained as frequently edited shared files. Write receipts and `context_status` expose whether local context is waiting to synchronize.

## What is authoritative

- The separate personal vault repository: authoritative personal knowledge and Git history.
- `<personal-vault>/vault/projects/*/events/`: immutable history and provenance.
- `<personal-vault>/vault/projects/*/project.json`: stable project identity.
- `skills/personal-context/`: portable behavior for AI applications.
- The installed MCP runtime: an interface, not the source of truth.
- Search results and compiled current state: derived views that can be rebuilt.

Retrieval uses compact event cards by default—identity, type, effective status, title, summary, subject, and terminology labels. Agents request full details, provenance, and relations only when needed. This keeps the memory layer from consuming the context window it is meant to conserve.

Do not store credentials in the vault. Large artifacts should remain in appropriate file or object storage; capture a reference and checksum as an artifact event.

`redact_event` can replace an active event with a tombstone after exact confirmation. It does not remove the original from Git history, remotes, clones, or backups. Full erasure is a separate, disruptive history-rewrite procedure and is intentionally not exposed as a routine MCP tool.

See [docs/EXPERIENCE.md](docs/EXPERIENCE.md) for the interaction contract and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and future path.

## License

[MIT](LICENSE)
