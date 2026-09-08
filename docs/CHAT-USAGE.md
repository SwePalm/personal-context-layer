# Use Personal Context from a detached AI chat

An ordinary cloud chat cannot reach the local Personal Context MCP server or run `pctx`. It can still participate through two application-neutral JSON files:

```text
local vault → compact context file → detached chat
local vault ← candidate harvest file ← detached chat
```

The chat is a **detached client**. It can reason from an exported projection and prepare candidate contributions, but it cannot read or mutate the authoritative vault. Only the existing Personal Context command/store layer validates and saves its output.

## First experiment

1. If you do not already know which project applies, export the library catalog:

   ```sh
   pctx projects --pretty > projects.pctx.json
   ```

   Upload `projects.pctx.json` with the detached-client instructions. Ask the chat to show the available projects and suggest likely matches for the work you want to do. The catalog contains project names, purposes, aliases, and stable IDs—not their event histories.

2. After choosing a project, export its compact context:

   ```sh
   pctx context "PROJECT NAME" --pretty > context.pctx.json
   ```

   This reuses the normal compact retrieval contract. Do not add `--full` unless a specific event body is necessary for the conversation.

   Inspect the export before uploading it and include only the project context needed for the task. Uploaded files follow the chat provider's retention and data-control rules. For ChatGPT, review [File storage and Library](https://help.openai.com/en/articles/20001052-file-storage-and-library) and your Data Controls before moving sensitive context.

   If you already know the project, this can be your first step; the catalog round trip is optional.

3. Continue the same chat and attach `context.pctx.json`. Also attach or paste [the detached-client instructions](../skills/personal-context/references/detached-clients.md). In ChatGPT, a Project can retain uploaded files and project instructions across its chats; a normal one-off chat also works.

4. Have the conversation. Ask the model to distinguish stored context from new reasoning and to cite relevant event IDs.

5. When the conversation has durable outcomes, ask: “Harvest this conversation as a Personal Context candidate file.” Save the returned JSON as `harvest.pctx.json`.

6. Back on the vault machine, ingest through the existing authoritative boundary:

   ```sh
   pctx harvest --json harvest.pctx.json --pretty
   pctx lint --pretty
   ```

7. Inspect the receipt. The contribution is local while `synchronization.state` is `pending`. Synchronize only when intended:

   ```sh
   pctx sync push --pretty
   ```

The canonical candidate format is exactly the existing `harvest_session` input—not a second event model. See [the example harvest](../examples/detached-harvest.pctx.json). IDs, timestamps, normalized subjects, deduplication, effective status, linting, and storage are assigned or enforced during local ingestion.

## Trust boundary

| Connected client | Detached client |
|---|---|
| Reads current authoritative state through MCP or `pctx` | Reads only the supplied export |
| Submits writes to the command layer | Produces candidate JSON |
| Receives authoritative event and synchronization receipts | Cannot claim that anything was saved |
| Can lint and synchronize when authorized | Cannot validate, commit, or push the vault |

Do not let a detached chat edit authoritative event files, even if it can read the private GitHub repository. GitHub access in ChatGPT is read-only and availability varies by plan and product experience; it is not a substitute for `ContextStore`. A future GitHub bridge, if useful, should carry the same interchange artifacts through an inbox/outbox.

## Acceptance observations

For the first real chat, record:

- whether compact context was sufficient and economical;
- whether current, historical, and hypothetical knowledge stayed distinct;
- whether the harvest JSON ingested without repair;
- whether the durable-contribution quality gate was respected;
- whether provenance and existing event relationships were preserved;
- whether the chat avoided claiming that candidates were saved;
- where manual upload, download, naming, or copying caused friction.

Only observed friction should justify an `export` command, import shortcut, GitHub inbox/outbox, or hosted service.

Current ChatGPT capabilities referenced here: [Projects can retain uploaded files and project instructions](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), and [GitHub access is read-only and varies by experience](https://help.openai.com/en/articles/11145903).
