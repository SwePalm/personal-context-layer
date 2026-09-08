import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(root, "scripts", "install-skill.mjs");
const deployer = join(root, "scripts", "deploy.mjs");
const doctor = join(root, "scripts", "doctor.mjs");

test("installs the Cursor skill and merges MCP config without losing settings", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "personal-context-cursor-"));
  const cursorDirectory = join(fakeHome, ".cursor");
  mkdirSync(cursorDirectory, { recursive: true });
  const configPath = join(cursorDirectory, "mcp.json");
  writeFileSync(configPath, JSON.stringify({ theme: "dark", mcpServers: { existing: { command: "other" } } }));

  execFileSync(process.execPath, [installer, "cursor", "--copy"], {
    env: { ...process.env, HOME: fakeHome },
  });

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(config.theme, "dark");
  assert.equal(config.mcpServers.existing.command, "other");
  assert.equal(config.mcpServers["personal-context"].command, "node");
  assert.equal(existsSync(join(fakeHome, ".cursor", "skills", "personal-context", "SKILL.md")), true);
});

test("uses OpenCode's plural global skills directory", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "personal-context-opencode-"));
  execFileSync(process.execPath, [installer, "opencode", "--copy", "--no-mcp"], {
    env: { ...process.env, HOME: fakeHome },
  });

  assert.equal(existsSync(join(fakeHome, ".config", "opencode", "skills", "personal-context", "SKILL.md")), true);
  assert.equal(existsSync(join(fakeHome, ".config", "opencode", "skill")), false);
});

test("deploys an isolated runtime and points skills at its current release", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "personal-context-deploy-"));
  const vaultRoot = join(fakeHome, "Personal Context");
  const binaryDirectory = join(fakeHome, ".local", "bin");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(join(binaryDirectory, "pctx"), "preserve existing command\n");

  execFileSync(process.execPath, [deployer, "--vault", vaultRoot, "--no-app-config"], {
    env: { ...process.env, HOME: fakeHome },
  });

  const runtime = join(fakeHome, ".local", "share", "personal-context", "current");
  assert.equal(existsSync(join(runtime, "src", "mcp-server.mjs")), true);
  assert.equal(existsSync(join(runtime, "src", "commands.mjs")), true);
  assert.equal(existsSync(join(runtime, "bin", "pctx.mjs")), true);
  assert.equal(existsSync(join(runtime, "skills", "personal-context", "SKILL.md")), true);
  assert.equal(existsSync(join(fakeHome, ".codex", "skills", "personal-context", "SKILL.md")), true);
  assert.equal(existsSync(join(vaultRoot, "context.config.json")), true);
  assert.equal(existsSync(join(vaultRoot, ".git")), true);
  assert.equal(JSON.parse(readFileSync(join(fakeHome, ".config", "personal-context", "config.json"), "utf8")).vault, vaultRoot);
  assert.equal(readdirSync(binaryDirectory).some((name) => name.startsWith("pctx.backup-")), true);
  const cliStatus = JSON.parse(execFileSync(join(binaryDirectory, "pctx"), ["status"], { env: { ...process.env, HOME: fakeHome }, encoding: "utf8" }));
  assert.equal(cliStatus.repository, vaultRoot);
  const diagnosis = execFileSync(process.execPath, [doctor, "--vault", vaultRoot], { env: { ...process.env, HOME: fakeHome, PATH: `${binaryDirectory}:${process.env.PATH}` }, encoding: "utf8" });
  assert.match(diagnosis, /pctx CLI\s+ready; vault/);
});

test("refuses to scaffold over unrelated files", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "personal-context-deploy-refuse-"));
  const vaultRoot = join(fakeHome, "Not Empty");
  mkdirSync(vaultRoot, { recursive: true });
  writeFileSync(join(vaultRoot, "keep.txt"), "preserve me\n");

  assert.throws(() => execFileSync(process.execPath, [deployer, "--vault", vaultRoot, "--no-app-config"], {
    env: { ...process.env, HOME: fakeHome },
    stdio: "pipe",
  }), /Command failed/);
  assert.equal(readFileSync(join(vaultRoot, "keep.txt"), "utf8"), "preserve me\n");
});
