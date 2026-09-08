#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "skills", "personal-context");
const server = join(root, "src", "mcp-server.mjs");
const app = process.argv[2] || "codex";
const copy = process.argv.includes("--copy");
const skipMcp = process.argv.includes("--no-mcp");
const destinations = {
  codex: join(homedir(), ".codex", "skills", "personal-context"),
  claude: join(homedir(), ".claude", "skills", "personal-context"),
  cursor: join(homedir(), ".cursor", "skills", "personal-context"),
  opencode: join(homedir(), ".config", "opencode", "skills", "personal-context"),
};
const selected = app === "all" ? Object.entries(destinations) : [[app, destinations[app]]];
if (!selected[0][1]) throw new Error(`Unknown app '${app}'. Use codex, claude, cursor, opencode, or all.`);

for (const [name, destination] of selected) {
  mkdirSync(dirname(destination), { recursive: true });
  const existing = lstatSafe(destination);
  if (existing) {
    const sameLink = !copy && existing.isSymbolicLink() && resolve(dirname(destination), readlinkSync(destination)) === source;
    if (!sameLink) throw new Error(`${destination} already exists. Remove or rename it before installing.`);
  } else if (copy) {
    cpSync(source, destination, { recursive: true });
  } else {
    symlinkSync(source, destination, "dir");
  }
  process.stdout.write(`Installed Personal Context for ${name}: ${destination}\n`);
  if (!skipMcp) configureMcp(name);
}

process.stdout.write("\nReady. Restart the AI app, then say:\n");
process.stdout.write('  "Use my personal context for the Personal Context Layer project."\n');

function lstatSafe(path) {
  try { return lstatSync(path); } catch { return null; }
}

function configureMcp(name) {
  if (name === "codex") return configureCliMcp({
    executable: "codex",
    inspectArgs: ["mcp", "get", "personal-context", "--json"],
    addArgs: ["mcp", "add", "personal-context", "--", "node", server],
    parse: (output) => {
      const current = JSON.parse(output);
      return {
        command: current.command || current.transport?.command,
        args: current.args || current.transport?.args || [],
      };
    },
  });
  if (name === "claude") return configureCliMcp({
    executable: "claude",
    inspectArgs: ["mcp", "get", "personal-context"],
    addArgs: ["mcp", "add", "--scope", "user", "personal-context", "--", "node", server],
  });
  if (name === "opencode") return configureCliMcp({
    executable: "opencode",
    inspectArgs: ["mcp", "list"],
    addArgs: ["mcp", "add", "personal-context", "--", "node", server],
    isPresent: (output) => output.includes("personal-context"),
  });
  if (name === "cursor") return configureCursorMcp();
}

function configureCliMcp({ executable, inspectArgs, addArgs, parse, isPresent }) {
  if (!commandExists(executable)) {
    process.stdout.write(`Skipped MCP registration: '${executable}' is not installed or not on PATH.\n`);
    return;
  }

  let output = "";
  let found = false;
  try {
    output = execFileSync(executable, inspectArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    found = isPresent ? isPresent(output) : true;
  } catch {
    found = false;
  }

  if (found) {
    if (parse) {
      const current = parse(output);
      if (current.command === "node" && current.args.includes(server)) {
        process.stdout.write(`${executable} MCP registration is already correct.\n`);
      } else {
        process.stdout.write(`${executable} already has a different personal-context MCP registration; left unchanged.\n`);
      }
    } else {
      process.stdout.write(`${executable} already has a personal-context MCP registration; left unchanged.\n`);
    }
    return;
  }

  execFileSync(executable, addArgs, { stdio: "inherit" });
  process.stdout.write(`Registered the local personal-context MCP server in ${executable}.\n`);
}

function configureCursorMcp() {
  const configPath = join(homedir(), ".cursor", "mcp.json");
  mkdirSync(dirname(configPath), { recursive: true });
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`${configPath} is not valid JSON. It was not changed.`);
    }
  }
  config.mcpServers ||= {};
  const current = config.mcpServers["personal-context"];
  if (current) {
    if (current.command === "node" && current.args?.includes(server)) {
      process.stdout.write("Cursor MCP registration is already correct.\n");
    } else {
      process.stdout.write("Cursor already has a different personal-context MCP registration; left unchanged.\n");
    }
    return;
  }
  config.mcpServers["personal-context"] = { command: "node", args: [server] };
  const temporaryPath = `${configPath}.personal-context.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, configPath);
  process.stdout.write(`Registered the local personal-context MCP server in Cursor: ${configPath}\n`);
}

function commandExists(executable) {
  try {
    execFileSync("which", [executable], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
