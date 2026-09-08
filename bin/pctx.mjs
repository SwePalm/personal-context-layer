#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { callCommand, createCommandLayer, resolveVaultLocation } from "../src/commands.mjs";

class UsageError extends Error {}

const commonOptions = {
  vault: { type: "string" },
  pretty: { type: "boolean", default: false },
  text: { type: "boolean", default: false },
};

const commandOptions = {
  status: {},
  projects: {},
  context: { recent: { type: "string" }, full: { type: "boolean", default: false } },
  search: { project: { type: "string" }, limit: { type: "string" }, full: { type: "boolean", default: false } },
  "new-project": { name: { type: "string" }, purpose: { type: "string" }, alias: { type: "string", multiple: true } },
  publish: {
    json: { type: "string" }, project: { type: "string" }, type: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
    details: { type: "string" }, status: { type: "string" }, subject: { type: "string" }, "canonical-name": { type: "string" },
    alias: { type: "string", multiple: true }, tag: { type: "string", multiple: true }, related: { type: "string", multiple: true },
    supersedes: { type: "string", multiple: true }, resolves: { type: "string", multiple: true }, sensitivity: { type: "string" },
    "source-app": { type: "string" }, "source-conversation": { type: "string" }, "source-url": { type: "string" },
  },
  harvest: { json: { type: "string" } },
  redact: { json: { type: "string" }, "event-id": { type: "string" }, "confirm-event-id": { type: "string" }, reason: { type: "string" } },
  lint: { strict: { type: "boolean", default: false } },
  sync: {},
};

const help = {
  main: `pctx — personal context from any shell

Usage: pctx <command> [options]

Commands:
  status                         Check the selected vault and show its path
  projects                       List projects
  context <project>              Load project context (--recent N, --full)
  search <query>                 Search context (--project P, --limit N, --full)
  new-project                    Create a project
  publish                        Publish one event; prefer --json - for agents
  harvest                        Harvest several events from --json PATH|-
  redact                         Remove active event content after exact confirmation
  lint                           Validate the vault (--strict fails on warnings)
  sync [status|pull|push|both]   Inspect or synchronize Git state
  help [command]                 Show complete command help

Global options after the command:
  --vault PATH   Override the configured vault
  --pretty       Indented JSON output
  --text         Short human-readable output

Examples:
  pctx status --pretty
  pctx context "Personal Context Layer"
  pctx publish --json - < event.json
  pctx help publish`,
  status: `Usage: pctx status [--vault PATH] [--pretty|--text]
Example: pctx status --pretty`,
  projects: `Usage: pctx projects [--vault PATH] [--pretty|--text]
Example: pctx projects --text`,
  context: `Usage: pctx context <project> [--recent N] [--full] [--vault PATH]
Example: pctx context "Personal Context Layer" --recent 10 --pretty`,
  search: `Usage: pctx search <query> [--project P] [--limit N] [--full] [--vault PATH]
Example: pctx search "compact retrieval" --project "Personal Context Layer"`,
  "new-project": `Usage: pctx new-project --name NAME [--purpose TEXT] [--alias A]... [--vault PATH]
Example: pctx new-project --name "Research Trial" --purpose "Test a durable idea"`,
  publish: `Usage: pctx publish --json PATH|- [--vault PATH]
   or: pctx publish --project P --type T --title T --summary S --source-app APP [event options]

JSON uses the same fields as publish_learning. Stdin JSON is the primary agent path.
Flag options: --details, --status, --subject, --canonical-name, --alias (repeatable),
--tag (repeatable), --related (repeatable), --supersedes (repeatable), --resolves
(repeatable), --sensitivity, --source-app, --source-conversation, and --source-url.
Example:
  printf '%s' '{"project":"Research Trial","type":"learning","title":"Result","summary":"Quotes, apostrophes, and newlines survive JSON.","source_app":"manual","source_conversation":"trial-1"}' | pctx publish --json -`,
  harvest: `Usage: pctx harvest --json PATH|- [--vault PATH]
JSON uses the same fields as harvest_session.
Example: pctx harvest --json - < harvest.json`,
  redact: `Usage: pctx redact --json PATH|- [--vault PATH]
   or: pctx redact --event-id ID --confirm-event-id ID --reason TEXT
This removes active content but does not erase Git history, clones, or backups.
Example: pctx redact --event-id evt_123 --confirm-event-id evt_123 --reason "private data"`,
  lint: `Usage: pctx lint [--strict] [--vault PATH]
Example: pctx lint --strict`,
  sync: `Usage: pctx sync [status|pull|push|both] [--vault PATH]
Example: pctx sync both`,
};

async function main(argv) {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    const topic = command === "help" ? argv[1] : "main";
    if (!help[topic || "main"]) throw new UsageError(`Unknown help topic: ${topic}`);
    process.stdout.write(`${help[topic || "main"]}\n`);
    return;
  }
  if (!commandOptions[command]) throw new UsageError(`Unknown command: ${command}. Run 'pctx help'.`);

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: { ...commonOptions, ...commandOptions[command] },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (parsed.values.pretty && parsed.values.text) throw new UsageError("Choose either --pretty or --text, not both.");

  const location = resolveVaultLocation({ explicit: parsed.values.vault, home: homedir() });
  if (!existsSync(resolve(location.path, "context.config.json"))) {
    throw new Error(`Vault config is missing: ${resolve(location.path, "context.config.json")}`);
  }
  const layer = createCommandLayer({ repoRoot: location.path, vaultSource: location.source });
  const { name, args, strictLint = false } = commandInvocation(command, parsed.values, parsed.positionals);
  const value = callCommand(layer, name, args);
  writeOutput(command, value, parsed.values);
  if (name === "lint_context" && (!value.ok || (strictLint && value.warnings.length))) process.exitCode = 1;
}

function commandInvocation(command, values, positionals) {
  if (command === "status") return noPositionals(positionals, { name: "context_status", args: {} });
  if (command === "projects") return noPositionals(positionals, { name: "list_projects", args: {} });
  if (command === "context") {
    if (positionals.length !== 1) throw new UsageError("context requires exactly one project name or ID.");
    return { name: "get_project_context", args: { project: positionals[0], recent_limit: positiveInteger(values.recent, "--recent"), detail: values.full } };
  }
  if (command === "search") {
    if (positionals.length < 1) throw new UsageError("search requires a query.");
    return { name: "search_context", args: { query: positionals.join(" "), project: values.project, limit: positiveInteger(values.limit, "--limit"), detail: values.full } };
  }
  if (command === "new-project") {
    noPositionals(positionals);
    if (!values.name) throw new UsageError("new-project requires --name.");
    return { name: "create_project", args: { name: values.name, purpose: values.purpose, aliases: values.alias || [] } };
  }
  if (command === "publish") {
    noPositionals(positionals);
    const args = values.json ? readJsonPayload(values.json) : compactObject({
      project: values.project, type: values.type, title: values.title, summary: values.summary, details: values.details,
      status: values.status, subject: values.subject, canonical_name: values["canonical-name"], aliases: values.alias,
      tags: values.tag, related_event_ids: values.related, supersedes: values.supersedes, resolves: values.resolves,
      sensitivity: values.sensitivity, source_app: values["source-app"], source_conversation: values["source-conversation"], source_url: values["source-url"],
    });
    for (const field of ["project", "type", "title", "summary", "source_app"]) if (!args[field]) throw new UsageError(`publish requires ${values.json ? `JSON field '${field}'` : `--${field.replaceAll("_", "-")}`}.`);
    return { name: "publish_learning", args };
  }
  if (command === "harvest") {
    noPositionals(positionals);
    if (!values.json) throw new UsageError("harvest requires --json PATH|-.");
    const args = readJsonPayload(values.json);
    for (const field of ["project", "source_app", "events"]) if (!args[field]) throw new UsageError(`harvest JSON requires '${field}'.`);
    return { name: "harvest_session", args };
  }
  if (command === "redact") {
    noPositionals(positionals);
    const args = values.json ? readJsonPayload(values.json) : compactObject({ event_id: values["event-id"], confirm_event_id: values["confirm-event-id"], reason: values.reason });
    for (const field of ["event_id", "confirm_event_id", "reason"]) if (!args[field]) throw new UsageError(`redact requires ${values.json ? `JSON field '${field}'` : `--${field.replaceAll("_", "-")}`}.`);
    return { name: "redact_event", args };
  }
  if (command === "lint") return noPositionals(positionals, { name: "lint_context", args: {}, strictLint: values.strict });
  if (command === "sync") {
    if (positionals.length > 1) throw new UsageError("sync accepts at most one action.");
    const action = positionals[0] || "status";
    if (!new Set(["status", "pull", "push", "both"]).has(action)) throw new UsageError(`Unknown sync action: ${action}`);
    return { name: "sync_context", args: { action } };
  }
  throw new UsageError(`Unknown command: ${command}`);
}

function readJsonPayload(path) {
  let text;
  try {
    text = path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
  } catch (error) {
    throw new UsageError(`Cannot read JSON payload ${path}: ${error.message}`);
  }
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("expected a JSON object");
    return value;
  } catch (error) {
    throw new UsageError(`Invalid JSON payload: ${error.message}`);
  }
}

function positiveInteger(value, option) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new UsageError(`${option} must be an integer from 1 to 100.`);
  return number;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function noPositionals(positionals, result) {
  if (positionals.length) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  return result;
}

function writeOutput(command, value, options) {
  if (options.text) process.stdout.write(`${humanText(command, value)}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, options.pretty ? 2 : undefined)}\n`);
}

function humanText(command, value) {
  const synchronization = value.synchronization?.pending ? ` ${value.synchronization.message}` : "";
  if (command === "status") return `Vault: ${value.repository} (${value.lint.projects} projects, ${value.lint.events} events, ${value.lint.ok ? "healthy" : "needs attention"})`;
  if (command === "projects") return value.length ? value.map((item) => `${item.name} (${item.id})`).join("\n") : "No projects.";
  if (command === "context") return `${value.project.name} (${value.project.id}): ${value.event_count} events, ${value.active_decisions.length} active decisions, ${value.open_questions.length} open questions`;
  if (command === "search") return value.length ? value.map((item) => `${item.event.title} [${item.event.id}]`).join("\n") : "No matches.";
  if (command === "new-project") return `${value.name} (${value.id}).${synchronization}`;
  if (command === "publish") return `${value.title} (${value.id})${value.duplicate ? " — existing exact replay" : ""}.${synchronization}`;
  if (command === "redact") return `Redacted ${value.id}; Git history is unchanged.${synchronization}`;
  if (command === "harvest") return `Saved ${value.saved_count} new; reused ${value.duplicate_count} exact replays: ${value.events.map((item) => item.id).join(", ")}.${synchronization}`;
  if (command === "lint") return `${value.ok ? "OK" : "ERROR"}: ${value.projects} projects, ${value.events} events, ${value.errors.length} errors, ${value.warnings.length} warnings`;
  if (command === "sync") return value.status || value.steps?.join("; ") || "Synchronized.";
  return JSON.stringify(value);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
