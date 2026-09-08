#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVaultLocation } from "../src/commands.mjs";
import { ContextStore } from "../src/context-store.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultFlag = process.argv.indexOf("--vault");
const requestedVault = vaultFlag >= 0 ? process.argv[vaultFlag + 1] : "";
const resolvedVault = resolveVaultLocation({ explicit: requestedVault });
const vaultRoot = existsSync(join(resolvedVault.path, "context.config.json")) ? resolvedVault.path : sourceRoot;
const runtimeRoot = join(homedir(), ".local", "share", "personal-context", "current");
const source = existsSync(join(runtimeRoot, "skills", "personal-context", "SKILL.md"))
  ? join(runtimeRoot, "skills", "personal-context")
  : join(sourceRoot, "skills", "personal-context");
const server = existsSync(join(runtimeRoot, "src", "mcp-server.mjs"))
  ? join(runtimeRoot, "src", "mcp-server.mjs")
  : join(sourceRoot, "src", "mcp-server.mjs");
const skillPaths = {
  Codex: join(homedir(), ".codex", "skills", "personal-context"),
  "Claude Code": join(homedir(), ".claude", "skills", "personal-context"),
  Cursor: join(homedir(), ".cursor", "skills", "personal-context"),
  OpenCode: join(homedir(), ".config", "opencode", "skills", "personal-context"),
};

const store = new ContextStore({ repoRoot: vaultRoot });
const lint = store.lint();
const rows = [
  ["Vault", lint.ok ? `ready (${lint.projects} project, ${lint.events} events)` : `needs attention (${lint.errors.length} errors)`],
  ["Vault path", vaultRoot],
  ["Runtime", server.startsWith(runtimeRoot) ? "installed release" : "development source"],
  ["Git", commandExists("git") ? "ready" : "missing"],
  ["Git remote", hasGitRemote() ? "configured" : "not configured yet"],
  ["pctx CLI", cliState()],
];

for (const [name, path] of Object.entries(skillPaths)) {
  const skill = skillState(path);
  const mcp = mcpState(name);
  rows.push([name, `${skill}; ${mcp}`]);
}

const width = Math.max(...rows.map(([label]) => label.length));
process.stdout.write("Personal Context doctor\n\n");
for (const [label, state] of rows) process.stdout.write(`${label.padEnd(width)}  ${state}\n`);
process.stdout.write(`\nNext test: ask an installed app, “Use my personal context for Personal Context Layer.”\n`);
if (!hasGitRemote()) process.stdout.write("For multi-machine sync, add a private Git remote when you are ready.\n");

function skillState(path) {
  if (!existsSync(join(path, "SKILL.md"))) return "skill missing";
  try {
    if (lstatSync(path).isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      return target === source ? "skill ready" : "skill points elsewhere";
    }
  } catch {}
  return "skill ready (copy)";
}

function mcpState(name) {
  if (name === "Codex") return cliMcp("codex", ["mcp", "get", "personal-context", "--json"]);
  if (name === "Claude Code") return cliMcp("claude", ["mcp", "get", "personal-context"]);
  if (name === "OpenCode") return cliMcp("opencode", ["mcp", "list"], "personal-context");
  if (name === "Cursor") {
    const configPath = join(homedir(), ".cursor", "mcp.json");
    try {
      const entry = JSON.parse(readFileSync(configPath, "utf8")).mcpServers?.["personal-context"];
      return entry?.command === "node" && entry.args?.includes(server) ? "MCP ready" : "MCP missing or different";
    } catch {
      return "MCP config missing or invalid";
    }
  }
  return "MCP unknown";
}

function cliMcp(executable, args, expectedText) {
  if (!commandExists(executable)) return "app command unavailable";
  try {
    const output = execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (expectedText && !output.includes(expectedText)) return "MCP missing";
    if (executable === "codex") {
      const entry = JSON.parse(output);
      const command = entry.command || entry.transport?.command;
      const commandArgs = entry.args || entry.transport?.args || [];
      return command === "node" && commandArgs.includes(server) ? "MCP ready" : "MCP points elsewhere";
    }
    return output.includes(server) ? "MCP ready" : "MCP registered; path not verified";
  } catch {
    return "MCP missing or disconnected";
  }
}

function commandExists(executable) {
  try {
    execFileSync("which", [executable], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function cliState() {
  const installed = join(homedir(), ".local", "bin", "pctx");
  if (!existsSync(installed)) return "not installed";
  if (!commandExists("pctx")) return `installed at ${installed}; not on PATH`;
  try {
    const output = execFileSync("pctx", ["status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const status = JSON.parse(output);
    return status.repository === vaultRoot ? `ready; vault ${status.repository}` : `ready; resolves different vault ${status.repository}`;
  } catch {
    return "installed; execution failed";
  }
}

function hasGitRemote() {
  try {
    return Boolean(execFileSync("git", ["remote"], { cwd: vaultRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim());
  } catch {
    return false;
  }
}
