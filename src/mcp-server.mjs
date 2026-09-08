#!/usr/bin/env node
import readline from "node:readline";
import { callCommand, createCommandLayer } from "./commands.mjs";

const commands = createCommandLayer({
  repoRoot: process.env.PERSONAL_CONTEXT_ROOT || undefined,
  vaultSource: process.env.PERSONAL_CONTEXT_ROOT ? "PERSONAL_CONTEXT_ROOT" : "module default",
});

const eventProperties = {
  type: { type: "string", enum: ["note", "learning", "hypothesis", "decision", "pivot", "question", "result", "artifact", "terminology", "method", "correction", "brief"] },
  title: { type: "string" },
  summary: { type: "string", description: "A durable, standalone statement understandable outside the source conversation." },
  details: { type: "string" },
  status: { type: "string", enum: ["proposed", "accepted", "open", "resolved", "superseded", "rejected"] },
  subject: { type: "string", description: "Stable topic key. Required for decisions and questions; normalized by the server." },
  canonical_name: { type: "string" },
  aliases: { type: "array", items: { type: "string" } },
  tags: { type: "array", items: { type: "string" } },
  related_event_ids: { type: "array", items: { type: "string" } },
  supersedes: { type: "array", items: { type: "string" } },
  resolves: { type: "array", items: { type: "string" } },
  artifacts: { type: "array", items: { type: "object", additionalProperties: true } },
  sensitivity: { type: "string", enum: ["private", "restricted", "public"] },
};

const tools = [
  {
    name: "context_status",
    description: "Check whether the personal context vault is healthy and see its projects. Use before relying on the vault.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Check personal context", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_project",
    description: "Create a new long-running knowledge-work project in the personal context vault. The receipt reports whether synchronization is pending.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, purpose: { type: "string" }, aliases: { type: "array", items: { type: "string" } } }, additionalProperties: false },
    annotations: { title: "Create context project", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "list_projects",
    description: "List context projects and their stable IDs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List context projects", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_project_context",
    description: "Load the current brief, active decisions, open questions, terminology, methods, and recent history for a project.",
    inputSchema: { type: "object", required: ["project"], properties: { project: { type: "string" }, recent_limit: { type: "integer", minimum: 1, maximum: 100 }, detail: { type: "boolean", default: false, description: "Include full details. Defaults to compact event projections." } }, additionalProperties: false },
    annotations: { title: "Load project context", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_context",
    description: "Search durable context events across one project or the whole vault. Results include event IDs and source provenance.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, project: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, detail: { type: "boolean", default: false, description: "Include full details for matching events." } }, additionalProperties: false },
    annotations: { title: "Search personal context", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "publish_learning",
    description: "Append one validated durable contribution to a project, or reuse its existing ID when the same source conversation submits an exact replay. The receipt reports whether synchronization is pending. Never use this for transient chat or unsupported guesses.",
    inputSchema: { type: "object", required: ["project", "type", "title", "summary", "source_app"], properties: { project: { type: "string" }, ...eventProperties, source_app: { type: "string", description: "Originating application or person; must not be empty or 'unknown'." }, source_conversation: { type: "string" }, source_url: { type: "string" } }, additionalProperties: false },
    annotations: { title: "Publish project learning", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "harvest_session",
    description: "Validate the complete batch, then save the durable outcomes of a conversation and reuse exact replays. The receipt reports whether synchronization is pending. Preserve pivots, decisions, evidence, unresolved questions, and reusable methods—not a transcript dump.",
    inputSchema: {
      type: "object",
      required: ["project", "source_app", "events"],
      properties: {
        project: { type: "string" },
        source_app: { type: "string" },
        source_conversation: { type: "string" },
        source_url: { type: "string" },
        events: { type: "array", minItems: 1, items: { type: "object", required: ["type", "title", "summary"], properties: eventProperties, additionalProperties: false } },
      },
      additionalProperties: false,
    },
    annotations: { title: "Harvest conversation", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "lint_context",
    description: "Verify event schemas, provenance links, project references, unique IDs, and terminology collisions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Lint context vault", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "redact_event",
    description: "Replace one event's active content with a tombstone after explicit confirmation. This does not erase earlier Git history.",
    inputSchema: { type: "object", required: ["event_id", "confirm_event_id", "reason"], properties: { event_id: { type: "string" }, confirm_event_id: { type: "string", description: "Must exactly repeat event_id as confirmation." }, reason: { type: "string" } }, additionalProperties: false },
    annotations: { title: "Redact context event", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "sync_context",
    description: "Inspect or synchronize the context vault with its configured Git remote. Writing actions may create a commit and pull or push it.",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["status", "pull", "push", "both"], default: "status" } }, additionalProperties: false },
    annotations: { title: "Synchronize context", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

function result(value) {
  const structuredContent = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : { items: Array.isArray(value) ? value : [value] };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent };
}

function callTool(name, args = {}) {
  return result(callCommand(commands, name, args));
}

function handle(message) {
  if (message.method === "initialize") {
    return { protocolVersion: message.params?.protocolVersion || "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "personal-context", version: "0.1.0" }, instructions: "Use this server as the durable, provenance-preserving context layer. Read context before project work and publish only durable learnings." };
  }
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") return callTool(message.params?.name, message.params?.arguments || {});
  if (message.method === "resources/list") {
    return { resources: callCommand(commands, "list_projects").map((project) => ({ uri: `context://projects/${project.id}`, name: project.name, description: project.purpose, mimeType: "application/json" })) };
  }
  if (message.method === "resources/read") {
    const prefix = "context://projects/";
    const uri = message.params?.uri || "";
    if (!uri.startsWith(prefix)) throw new Error(`Unknown resource URI: ${uri}`);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(callCommand(commands, "get_project_context", { project: uri.slice(prefix.length) }), null, 2) }] };
  }
  if (message.method?.startsWith("notifications/")) return undefined;
  throw new Error(`Unsupported MCP method: ${message.method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const value = handle(message);
    if (message.id !== undefined && value !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: value })}\n`);
  } catch (error) {
    if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error.message } })}\n`);
    else process.stderr.write(`[personal-context] ${error.stack || error.message}\n`);
  }
});
