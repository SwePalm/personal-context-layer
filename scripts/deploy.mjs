#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextStore } from "../src/context-store.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const vaultRoot = resolve(options.vault || join(homedir(), "Personal Context"));
const installRoot = resolve(options.runtime || join(homedir(), ".local", "share", "personal-context"));
const currentRuntime = join(installRoot, "current");

scaffoldVaultIfEmpty();
validateVault();
const release = installRuntime();
installCli();
installSkills();
if (!options.noAppConfig) configureApps();

process.stdout.write("\nPersonal Context is deployed.\n");
process.stdout.write(`  Vault:   ${vaultRoot}\n`);
process.stdout.write(`  Runtime: ${release}\n`);
process.stdout.write(`  Current: ${currentRuntime}\n`);
process.stdout.write("\nRestart an AI app, then ask: “Use my personal context. What projects exist?”\n");

function parseArgs(args) {
  const parsed = { vault: "", runtime: "", noAppConfig: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--vault") parsed.vault = args[++index] || "";
    else if (arg === "--runtime") parsed.runtime = args[++index] || "";
    else if (arg === "--no-app-config") parsed.noAppConfig = true;
    else throw new Error(`Unknown deployment option: ${arg}`);
  }
  return parsed;
}

function scaffoldVaultIfEmpty() {
  const configPath = join(vaultRoot, "context.config.json");
  if (existsSync(configPath)) return;
  mkdirSync(vaultRoot, { recursive: true });
  const content = readdirSync(vaultRoot).filter((name) => ![".git", ".DS_Store"].includes(name));
  if (content.length) {
    throw new Error(`Refusing to initialize a vault in non-empty folder without context.config.json: ${vaultRoot}`);
  }
  if (!existsSync(join(vaultRoot, ".git"))) {
    execFileSync("git", ["init", "-b", "main"], { cwd: vaultRoot, stdio: "ignore" });
  }
  mkdirSync(join(vaultRoot, "vault", "projects"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ schemaVersion: 1, vaultPath: "./vault", sync: { remote: "origin", branch: "main" } }, null, 2)}\n`);
  writeFileSync(join(vaultRoot, ".gitignore"), ".DS_Store\n*.tmp\n*.log\n");
  writeFileSync(join(vaultRoot, "README.md"), "# Personal Context Vault\n\nA private, agent-facing library managed through the personal-context MCP server. Do not store credentials here.\n");
  process.stdout.write(`Initialized new personal context vault: ${vaultRoot}\n`);
}

function validateVault() {
  const configPath = join(vaultRoot, "context.config.json");
  if (!existsSync(configPath)) throw new Error(`Vault config is missing: ${configPath}`);
  const report = new ContextStore({ repoRoot: vaultRoot }).lint();
  if (!report.ok) throw new Error(`Vault validation failed:\n${report.errors.join("\n")}`);
  process.stdout.write(`Validated vault: ${report.projects} project(s), ${report.events} event(s).\n`);
}

function installRuntime() {
  const readOnlyGit = { cwd: sourceRoot, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } };
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], readOnlyGit).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "skills", "bin"], readOnlyGit).trim();
  const releaseId = dirty ? `${commit}-working-${Date.now()}` : commit;
  const releases = join(installRoot, "releases");
  const releasePath = join(releases, releaseId);
  mkdirSync(releases, { recursive: true });

  if (!existsSync(releasePath)) {
    const staging = join(releases, `.${releaseId}.staging`);
    if (existsSync(staging)) rmSync(staging, { recursive: true });
    mkdirSync(staging, { recursive: true });
    for (const directory of ["src", "skills", "bin"]) cpSync(join(sourceRoot, directory), join(staging, directory), { recursive: true });
    for (const file of ["package.json", "README.md"]) cpSync(join(sourceRoot, file), join(staging, file));
    renameSync(staging, releasePath);
  }

  const nextLink = join(installRoot, ".current.next");
  if (lstatSafe(nextLink)) rmSync(nextLink);
  symlinkSync(relative(installRoot, releasePath), nextLink);
  const current = lstatSafe(currentRuntime);
  if (current && !current.isSymbolicLink()) throw new Error(`${currentRuntime} exists and is not a symbolic link.`);
  renameSync(nextLink, currentRuntime);
  process.stdout.write(`Installed runtime release: ${releasePath}\n`);
  return releasePath;
}

function installCli() {
  const configDirectory = join(homedir(), ".config", "personal-context");
  const configPath = join(configDirectory, "config.json");
  mkdirSync(configDirectory, { recursive: true });
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`${configPath} is not valid JSON. It was not changed.`);
    }
  }
  config.vault = vaultRoot;
  const temporaryConfig = `${configPath}.next`;
  writeFileSync(temporaryConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryConfig, configPath);

  const binaryDirectory = join(homedir(), ".local", "bin");
  const destination = join(binaryDirectory, "pctx");
  mkdirSync(binaryDirectory, { recursive: true });
  const existing = lstatSafe(destination);
  if (existing?.isSymbolicLink()) rmSync(destination);
  else if (existing) {
    const backup = `${destination}.backup-${Date.now()}`;
    renameSync(destination, backup);
    process.stdout.write(`Preserved existing command at ${backup}\n`);
  }
  symlinkSync(join(currentRuntime, "bin", "pctx.mjs"), destination);
  process.stdout.write(`Installed command: ${destination}\n`);
  if (!pathContains(binaryDirectory)) {
    process.stdout.write(`Add pctx to PATH: export PATH="$HOME/.local/bin:$PATH"\n`);
  }
}

function installSkills() {
  const skillSource = join(currentRuntime, "skills", "personal-context");
  const destinations = [
    join(homedir(), ".codex", "skills", "personal-context"),
    join(homedir(), ".claude", "skills", "personal-context"),
    join(homedir(), ".cursor", "skills", "personal-context"),
    join(homedir(), ".config", "opencode", "skills", "personal-context"),
  ];
  for (const destination of destinations) {
    mkdirSync(dirname(destination), { recursive: true });
    const existing = lstatSafe(destination);
    if (existing?.isSymbolicLink()) rmSync(destination);
    else if (existing) {
      const backup = `${destination}.backup-${Date.now()}`;
      renameSync(destination, backup);
      process.stdout.write(`Preserved existing skill at ${backup}\n`);
    }
    symlinkSync(skillSource, destination, "dir");
    process.stdout.write(`Installed skill: ${destination}\n`);
  }
}

function configureApps() {
  const server = join(currentRuntime, "src", "mcp-server.mjs");
  const environment = `PERSONAL_CONTEXT_ROOT=${vaultRoot}`;

  if (commandExists("codex")) {
    tryRun("codex", ["mcp", "remove", "personal-context"]);
    execFileSync("codex", ["mcp", "add", "--env", environment, "personal-context", "--", "node", server], { stdio: "inherit" });
  }
  if (commandExists("claude")) {
    tryRun("claude", ["mcp", "remove", "--scope", "user", "personal-context"]);
    execFileSync("claude", ["mcp", "add", "--scope", "user", "personal-context", "-e", environment, "--", "node", server], { stdio: "inherit" });
  }
  configureCursor(server);
  if (commandExists("opencode")) {
    execFileSync("opencode", ["mcp", "add", "personal-context", "--env", environment, "--", "node", server], { stdio: "inherit" });
  }
}

function configureCursor(server) {
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
  config.mcpServers["personal-context"] = {
    command: "node",
    args: [server],
    env: { PERSONAL_CONTEXT_ROOT: vaultRoot },
  };
  const temporaryPath = `${configPath}.personal-context.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, configPath);
}

function tryRun(executable, args) {
  try {
    execFileSync(executable, args, { stdio: "ignore" });
  } catch {}
}

function commandExists(executable) {
  try {
    execFileSync("which", [executable], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pathContains(directory) {
  return String(process.env.PATH || "").split(delimiter).some((entry) => resolve(entry) === resolve(directory));
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
