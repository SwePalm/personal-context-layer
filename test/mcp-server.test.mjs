import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("serves a complete create, publish, retrieve, and lint flow over MCP", async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "personal-context-mcp-"));
  mkdirSync(join(temporaryRoot, "vault", "projects"), { recursive: true });
  writeFileSync(join(temporaryRoot, "context.config.json"), '{"schemaVersion":1,"vaultPath":"./vault"}\n');
  const child = spawn(process.execPath, [join(root, "src", "mcp-server.mjs")], {
    env: { ...process.env, PERSONAL_CONTEXT_ROOT: temporaryRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
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

  let nextId = 1;
  const request = (method, params = {}) => new Promise((resolveResponse, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 2000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolveResponse(response);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  try {
    const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(initialized.result.serverInfo.name, "personal-context");
    const created = await request("tools/call", { name: "create_project", arguments: { name: "MCP Trial", aliases: ["Trial"] } });
    assert.equal(created.result.structuredContent.id, "prj_mcp-trial");
    assert.equal(created.result.structuredContent.synchronization.state, "unavailable");
    const projects = await request("tools/call", { name: "list_projects", arguments: {} });
    assert.equal(projects.result.structuredContent.items[0].id, "prj_mcp-trial");
    const published = await request("tools/call", { name: "publish_learning", arguments: { project: "Trial", type: "decision", subject: "architecture", title: "Keep the ledger append-only", summary: "Immutable events preserve the learning journey.", details: "Detailed rationale loaded only when requested.", source_app: "test" } });
    assert.match(published.result.structuredContent.id, /^evt_/);
    const context = await request("tools/call", { name: "get_project_context", arguments: { project: "MCP Trial" } });
    assert.equal(context.result.structuredContent.active_decisions.length, 1);
    assert.equal("details" in context.result.structuredContent.active_decisions[0], false);
    const detailed = await request("tools/call", { name: "get_project_context", arguments: { project: "MCP Trial", detail: true } });
    assert.match(detailed.result.structuredContent.active_decisions[0].details, /Detailed rationale/);
    const linted = await request("tools/call", { name: "lint_context", arguments: {} });
    assert.equal(linted.result.structuredContent.ok, true);
    const redacted = await request("tools/call", { name: "redact_event", arguments: { event_id: published.result.structuredContent.id, confirm_event_id: published.result.structuredContent.id, reason: "acceptance test" } });
    assert.equal(redacted.result.structuredContent.redacted, true);
    assert.match(redacted.result.structuredContent.warning, /Git commits/);
  } finally {
    child.stdin.end();
    child.kill();
  }
});
