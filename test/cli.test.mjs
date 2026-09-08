import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ContextStore } from "../src/context-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "pctx.mjs");
const server = join(root, "src", "mcp-server.mjs");

function temporaryVault() {
  const repoRoot = mkdtempSync(join(tmpdir(), "personal-context-cli-"));
  mkdirSync(join(repoRoot, "vault", "projects"), { recursive: true });
  writeFileSync(join(repoRoot, "context.config.json"), '{"schemaVersion":1,"vaultPath":"./vault"}\n');
  execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}

function runCli(vault, args, { input = "" } = {}) {
  return spawnSync(process.execPath, [cli, ...args, "--vault", vault], { input, encoding: "utf8" });
}

function successfulJson(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

async function withMcp(vault, callback) {
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PERSONAL_CONTEXT_ROOT: vault },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let nextId = 0;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const response = JSON.parse(line);
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    }
  });
  const request = (name, args = {}) => new Promise((resolveResponse, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => reject(new Error(`MCP timeout: ${name}`)), 2000);
    pending.set(id, (response) => {
      clearTimeout(timeout);
      if (response.error) reject(new Error(response.error.message));
      else resolveResponse(response.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: name, params: args })}\n`);
  });
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "parity-test", version: "1" } });
    await callback(async (name, args = {}) => {
      const response = await request("tools/call", { name, arguments: args });
      return response.structuredContent;
    });
  } finally {
    child.stdin.end();
    child.kill();
  }
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (["created_at", "redacted_at", "runtime_host"].includes(key)) return [key, "NORMALIZED"];
      if (key === "id" && typeof item === "string" && item.startsWith("evt_")) return [key, "evt_NORMALIZED"];
      return [key, normalized(item)];
    }));
  }
  return value;
}

test("pctx runs the full shell workflow and preserves stdin JSON exactly", () => {
  const vault = temporaryVault();
  const created = successfulJson(runCli(vault, ["new-project", "--name", "CLI Trial", "--purpose", "Exercise every command", "--alias", "Shell Trial"]));
  assert.equal(created.id, "prj_cli-trial");
  assert.equal(created.synchronization.state, "pending");
  assert.match(created.synchronization.message, /Saved locally; synchronization pending/);
  const status = successfulJson(runCli(vault, ["status"]));
  assert.equal(status.vault_resolution.source, "--vault");
  assert.equal(status.synchronization.pending, true);
  assert.equal(successfulJson(runCli(vault, ["projects"]))[0].id, created.id);
  const textProjects = runCli(vault, ["projects", "--text"]);
  assert.equal(textProjects.status, 0);
  assert.match(textProjects.stdout, /CLI Trial \(prj_cli-trial\)/);
  assert.doesNotThrow(() => JSON.parse(runCli(vault, ["status", "--pretty"]).stdout));

  const summary = "Line one\nLine two has \"quotes\", an apostrophe's mark, a \\ slash, and räksmörgås.";
  const published = successfulJson(runCli(vault, ["publish", "--json", "-"], {
    input: JSON.stringify({ project: "Shell Trial", type: "learning", title: "Round trip", summary, details: "Full body", source_app: "test", source_conversation: "round-trip" }),
  }));
  const replayed = successfulJson(runCli(vault, ["publish", "--json", "-"], {
    input: JSON.stringify({ project: "Shell Trial", type: "learning", title: "Round trip", summary, details: "Full body", source_app: "test", source_conversation: "round-trip" }),
  }));
  assert.equal(replayed.id, published.id);
  assert.equal(replayed.duplicate, true);
  assert.equal(published.synchronization.state, "pending");
  const compact = successfulJson(runCli(vault, ["context", "CLI Trial"]));
  const full = successfulJson(runCli(vault, ["context", "CLI Trial", "--full"]));
  assert.equal(compact.recent_events[0].details, undefined);
  assert.equal(full.recent_events.find((event) => event.id === published.id).summary, summary);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length);
  assert.equal(JSON.stringify(compact).includes("_file"), false);

  const found = successfulJson(runCli(vault, ["search", "round trip"]));
  assert.equal(found[0].event.id, published.id);
  const harvested = successfulJson(runCli(vault, ["harvest", "--json", "-"], {
    input: JSON.stringify({ project: "CLI Trial", source_app: "test", events: [{ type: "question", subject: "cli reach", title: "Can shells contribute?", summary: "Verify the CLI." }] }),
  }));
  assert.equal(harvested.saved_count, 1);
  assert.equal(successfulJson(runCli(vault, ["lint"])).ok, true);

  const sync = successfulJson(runCli(vault, ["sync", "status"]));
  assert.match(sync.status, /^##/);
  assert.equal(sync.synchronization.pending, true);
  const redacted = successfulJson(runCli(vault, ["redact", "--event-id", published.id, "--confirm-event-id", published.id, "--reason", "test cleanup"]));
  assert.equal(redacted.redacted, true);
});

test("CLI and MCP adapters return equivalent command results", async () => {
  const cliVault = temporaryVault();
  const mcpVault = temporaryVault();
  const cliProject = successfulJson(runCli(cliVault, ["new-project", "--name", "Parity Project"]));
  let mcpProject;
  let mcpPublished;
  let mcpContext;
  let mcpSearch;
  let mcpLint;
  const payload = { project: "Parity Project", type: "decision", subject: "interface parity", title: "One command layer", summary: "Both transports share behavior.", source_app: "test" };
  const cliPublished = successfulJson(runCli(cliVault, ["publish", "--json", "-"], { input: JSON.stringify(payload) }));
  await withMcp(mcpVault, async (call) => {
    mcpProject = await call("create_project", { name: "Parity Project" });
    mcpPublished = await call("publish_learning", payload);
    mcpContext = await call("get_project_context", { project: "Parity Project" });
    mcpSearch = await call("search_context", { query: "command layer" });
    mcpLint = await call("lint_context", {});
  });
  assert.deepEqual(normalized(cliProject), normalized(mcpProject));
  assert.deepEqual(normalized(cliPublished), normalized(mcpPublished));
  assert.deepEqual(normalized(successfulJson(runCli(cliVault, ["context", "Parity Project"]))), normalized(mcpContext));
  assert.deepEqual(normalized(successfulJson(runCli(cliVault, ["search", "command layer"]))), normalized(mcpSearch.items || mcpSearch));
  assert.deepEqual(successfulJson(runCli(cliVault, ["lint"])), mcpLint);
});

test("pctx uses stable JSON output and distinguishes usage, operational, and lint failures", () => {
  const vault = temporaryVault();
  successfulJson(runCli(vault, ["new-project", "--name", "Exit Codes"]));
  const unknownFlag = runCli(vault, ["status", "--wat"]);
  assert.equal(unknownFlag.status, 2);
  assert.equal(unknownFlag.stdout, "");
  const unknownProject = runCli(vault, ["context", "Missing"]);
  assert.equal(unknownProject.status, 1);
  assert.equal(unknownProject.stdout, "");
  const missingSource = runCli(vault, ["publish", "--json", "-"], { input: JSON.stringify({ project: "Exit Codes", type: "learning", title: "Missing source", summary: "This must fail." }) });
  assert.equal(missingSource.status, 2);

  const store = new ContextStore({ repoRoot: vault });
  store.publishEvent({ project: "Exit Codes", type: "decision", subject: "collision", title: "First", summary: "First choice.", source_app: "test" });
  store.publishEvent({ project: "Exit Codes", type: "decision", subject: "collision", title: "Second", summary: "Second choice.", source_app: "test" });
  assert.equal(runCli(vault, ["lint"]).status, 0);
  assert.equal(runCli(vault, ["lint", "--strict"]).status, 1);

  const helpResult = spawnSync(process.execPath, [cli, "help", "publish"], { encoding: "utf8" });
  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /--json -/);
});

test("the detached harvest example enters through the normal command layer", () => {
  const vault = temporaryVault();
  successfulJson(runCli(vault, ["new-project", "--name", "Example Research"]));
  const example = join(root, "examples", "detached-harvest.pctx.json");
  const harvested = successfulJson(runCli(vault, ["harvest", "--json", example]));
  assert.equal(harvested.saved_count, 2);
  assert.equal(harvested.duplicate_count, 0);
  assert.equal(harvested.synchronization.state, "pending");
  assert.equal(successfulJson(runCli(vault, ["lint"])).ok, true);
});
