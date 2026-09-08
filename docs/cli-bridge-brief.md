# Seed brief: a CLI surface for the personal context layer

Status: implemented. Written after an external behavioural test of this repository by a
cloud Claude session on 2026-09-06 and refined during implementation.

## Why this exists

The vault is currently reachable only through a local stdio MCP server. That covers hosts
with an MCP client. It does not cover a large and growing set of agents that have a shell
but no MCP client, and it does not cover cloud sessions that reach the machine through a
file/shell bridge rather than through a registered connector.

That gap was tested, not assumed. A cloud Claude session with a shell on the machine read
`skills/personal-context/SKILL.md`, followed the protocol by hand, and drove
`src/mcp-server.mjs` directly over JSON-RPC on stdin. Every workflow completed: create
project, publish, harvest, resolve a question, search, compile current state, lint. The
protocol travelled. The transport was the only thing missing, and it was replaced with
hand-rolled JSON-RPC, which is not something we should expect any agent to do.

A CLI is therefore the cheapest large increase in reach available. In practice it is more
portable than MCP, because every coding agent has a shell even when it has no MCP client.

## Goal

Ship `pctx`, a thin command-line surface over the same store, so that any agent or human
with a shell has the full context vocabulary without an MCP client and without JSON-RPC.

Non-goal: replacing the MCP server. Both interfaces stay, and both must stay in step.

## Architectural constraint, read this first

Do not implement the CLI against `src/mcp-server.mjs`, and do not reimplement store logic
inside the CLI. Refactor so there is one command layer that both interfaces call.

```
src/context-store.mjs      unchanged storage and compilation
src/commands.mjs           NEW: one function per verb, plain in/out, no transport concerns
src/mcp-server.mjs         thin: JSON-RPC framing + tool schemas -> commands.mjs
bin/pctx.mjs                NEW: thin: argv/stdin parsing + exit codes -> commands.mjs
```

If the CLI and the MCP server can produce different answers for the same operation, the
design has failed. There must be a test that proves they cannot.

## Command surface

One command per existing MCP tool, same names in spirit, shell-shaped.

```
pctx status
pctx projects
pctx context <project> [--recent N] [--full]
pctx search <query> [--project P] [--limit N] [--full]
pctx new-project --name NAME --purpose TEXT [--alias A]...
pctx publish --json <path|->
pctx publish --project P --type T --title T --summary S --source-app APP [--status S] [--subject S] ...
pctx harvest --json <path|->
pctx redact --json <path|->
pctx lint [--strict]
pctx sync [status|pull|push|both]
pctx help [<command>]
```

### Required ergonomics

**Stdin JSON is the primary write path.** `pctx publish --json -` and `pctx harvest --json -`
must accept a JSON document on stdin. This is the single most important detail in the
brief. A durable summary is several sentences, frequently containing quotes, newlines and
apostrophes, and shell-quoting it is exactly where agents produce corrupted events. Flags
are the convenience path for humans and short entries; stdin is the correct path for
agents. The `--json` payload uses the same shape as the MCP tool arguments, so a caller
who knows one interface already knows the other.

**Compact output by default through both interfaces.** The test found `get_project_context` returning 12KB for
seven events, because every response carries full event objects including the internal
`_file` path and every empty field. At a hundred events that is well over 100KB for one
preflight call. Default responses must be projections carrying `id`, `type`, `status`,
`title`, `summary` and `subject` only, with `--full` opting into complete public events.
Internal `_file` paths remain private in both modes. A context layer that is expensive to
consult will not be consulted.

**Machine output by default, human output on request.** stdout is compact single-line JSON
so a caller can pipe it into `jq` or parse it directly. `--pretty` produces indented JSON.
`--text` produces a short human summary. Diagnostics and errors go to stderr only, never to
stdout, so stdout is always parseable.

**Exit codes.** `0` success. `1` operational failure such as an unknown project, a missing
vault, or a Git failure. `2` usage error such as an unknown flag or a missing required
argument. `pctx lint` exits `0` when there are only warnings and `1` when there are errors;
`--strict` makes warnings exit `1` too, which is what a pre-commit hook should call.

**Vault resolution order.** `--vault PATH`, then `PERSONAL_CONTEXT_ROOT`, then the
installed user configuration, then `~/Personal Context`. `pctx status` must print which one was used, because a caller silently
writing to the wrong vault is the worst failure this tool can have.

**Self-describing help.** `pctx help` and `pctx help <command>` must be complete enough that
an agent with no skill installed can learn the whole surface from the binary. Include one
worked example per command, including a stdin-JSON publish example. This is what makes the
CLI portable in a way documentation is not.

## Implementation constraints

No new runtime dependencies. Use `parseArgs` from `node:util`, already available on the
Node 20 floor declared in `package.json`. No event schema changes. No changes to the vault
layout. Do not touch the existing installers' behaviour beyond the addition described next.

## Deployment

`scripts/deploy.mjs` should symlink `~/.local/bin/pctx` to the `current` release's
`bin/pctx.mjs`, following the same staging-and-atomic-rename discipline the runtime install
already uses, and should back up any existing non-symlink at that path rather than
clobbering it. If `~/.local/bin` is not on `PATH`, print the exact line to add rather than
editing a shell profile. `scripts/doctor.mjs` should report whether `pctx` resolves on
`PATH` and which vault it resolves to.

## Acceptance tests

Add to `test/`, using the existing temp-vault pattern. Nothing may write to `vault/` in
this repository.

1. Every command runs end to end against a temp vault and exits `0`.
2. **Interface parity.** For the same operation, the CLI and the MCP server return
   equivalent results. Compare reads directly; compare writes in equivalent isolated
   vaults after normalising generated IDs, timestamps, and runtime hosts. This is the drift
   guard and it is the most important test in the set.
3. **Round-trip fidelity.** A `publish --json -` payload whose summary contains newlines,
   double quotes, single quotes, a backslash and a non-ASCII character is stored and read
   back byte-identical.
4. Compact output omits `_file` and empty fields; `--full` includes complete public event
   fields but never `_file`; the compact form of a seven-event project is materially
   smaller than the current 12KB.
5. Exit codes are correct for success, unknown project, and unknown flag.
6. `lint --strict` exits `1` on a warning-only vault; plain `lint` exits `0`.
7. stdout contains only valid JSON in default mode, with all diagnostics on stderr.

## Documentation to update in the same change

`README.md` gains a CLI install and usage section. `docs/EXPERIENCE.md` gains a fifth
compatibility level for a shell-only or bridged client, described as: the agent can follow
the protocol and reach the vault, but the skill is read as a document rather than invoked
by the host. The tested-applications table should record that this path was verified from a
cloud session with a machine bridge. `skills/personal-context/SKILL.md` gains a short
fallback clause: when the `personal-context` MCP tools are unavailable but a shell is,
check for `pctx` and use the equivalent commands, keeping the same workflow order.

## Explicitly out of scope

A hosted remote MCP gateway. Any change to who may write to the vault. The curated concept
and index layer. The defect list from the same review was resolved separately: first-run
scaffolding, lexical precision, runtime provenance, subject normalization, effective
status, and active redaction are part of the shared store and apply to both interfaces.
