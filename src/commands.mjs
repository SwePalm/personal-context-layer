import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ContextStore } from "./context-store.mjs";

export function resolveVaultLocation({ explicit = "", environment = process.env.PERSONAL_CONTEXT_ROOT || "", home = homedir() } = {}) {
  if (explicit) return { path: resolve(explicit), source: "--vault" };
  if (environment) return { path: resolve(environment), source: "PERSONAL_CONTEXT_ROOT" };

  const configPath = join(home, ".config", "personal-context", "config.json");
  if (existsSync(configPath)) {
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Personal context configuration is invalid: ${configPath}: ${error.message}`);
    }
    if (!config.vault) throw new Error(`Personal context configuration has no vault path: ${configPath}`);
    return { path: resolve(config.vault), source: configPath };
  }

  return { path: join(home, "Personal Context"), source: "default" };
}

export function createCommandLayer({ repoRoot, vaultSource = "configured" } = {}) {
  const store = new ContextStore({ repoRoot });
  const withSynchronization = (value) => ({ ...value, synchronization: store.synchronizationReceipt() });
  return {
    context_status: () => ({
      server: "personal-context",
      repository: store.repoRoot,
      vault: store.vaultPath,
      vault_resolution: { path: store.repoRoot, source: vaultSource },
      projects: store.listProjects(),
      lint: store.lint(),
      synchronization: store.synchronizationReceipt(),
    }),
    create_project: (args = {}) => withSynchronization(store.createProject(args)),
    list_projects: () => store.listProjects(),
    get_project_context: (args = {}) => store.getProjectContext(args.project, { recentLimit: args.recent_limit, detail: args.detail }),
    search_context: (args = {}) => store.search(args.query, args),
    publish_learning: (args = {}) => withSynchronization(store.publishEvent(args)),
    harvest_session: (args = {}) => withSynchronization(store.harvestSession(args)),
    lint_context: () => store.lint(),
    redact_event: (args = {}) => withSynchronization(store.redactEvent(args)),
    sync_context: (args = {}) => store.sync(args.action),
  };
}

export function callCommand(layer, name, args = {}) {
  const command = layer[name];
  if (!command) throw new Error(`Unknown command: ${name}`);
  return command(args);
}
