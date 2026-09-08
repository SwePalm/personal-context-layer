import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(MODULE_DIR, "..");
const EVENT_TYPES = new Set(["note", "learning", "hypothesis", "decision", "pivot", "question", "result", "artifact", "terminology", "method", "correction", "brief"]);
const EVENT_STATUSES = new Set(["proposed", "accepted", "open", "resolved", "superseded", "rejected"]);
const SENSITIVITIES = new Set(["private", "restricted", "public"]);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function rawSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugify(value, maxLength = 64) {
  const slug = rawSlug(value);
  if (slug.length <= maxLength) return slug;
  const suffix = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  const prefixLimit = maxLength - suffix.length - 1;
  const candidate = slug.slice(0, prefixLimit);
  const boundary = candidate.lastIndexOf("-");
  const prefix = boundary >= Math.floor(prefixLimit / 2) ? candidate.slice(0, boundary) : candidate;
  return `${prefix.replace(/-$/g, "")}-${suffix}`;
}

function walkJsonFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(full);
    return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
  });
}

function nowId() {
  const createdAt = new Date().toISOString();
  const sortable = createdAt.replace(/[-:.TZ]/g, "");
  return { createdAt, id: `evt_${sortable}_${randomBytes(4).toString("hex")}` };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeSubject(value) {
  return slugify(String(value || ""));
}

function sourceAppFamily(value) {
  const app = rawSlug(value);
  if (/^(openai-)?codex(?:-|$)/.test(app)) return "codex";
  if (/^(anthropic-)?claude(?:-|$)/.test(app)) return "claude";
  if (/^(openai-)?chatgpt(?:-|$)/.test(app)) return "chatgpt";
  if (/^cursor(?:-|$)/.test(app)) return "cursor";
  if (/^opencode(?:-|$)/.test(app)) return "opencode";
  return slugify(app);
}

function presentSource(source = {}) {
  return { ...source, family: source.family || sourceAppFamily(source.app) };
}

function validateOptionalString(input, field) {
  if (input[field] !== undefined && typeof input[field] !== "string") throw new Error(`${field} must be a string.`);
}

function validateOptionalStringArray(input, field) {
  if (input[field] === undefined) return;
  if (!Array.isArray(input[field]) || input[field].some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
}

function defaultStatus(type) {
  return type === "question" ? "open" : type === "hypothesis" ? "proposed" : "accepted";
}

function replayShape(event) {
  return {
    type: event.type,
    status: event.status,
    title: event.title,
    summary: event.summary,
    details: event.details || "",
    subject: event.subject || "",
    canonical_name: event.canonical_name || "",
    aliases: event.aliases || [],
    tags: event.tags || [],
    source: {
      app: event.source?.app || "",
      conversation: event.source?.conversation || "",
      url: event.source?.url || "",
    },
    relations: {
      related: event.relations?.related || [],
      supersedes: event.relations?.supersedes || [],
      resolves: event.relations?.resolves || [],
    },
    artifacts: event.artifacts || [],
    sensitivity: event.sensitivity || "private",
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

function tokenize(value) {
  return String(value || "").toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) || [];
}

function stripEmpty(value) {
  if (Array.isArray(value)) {
    const items = value.map(stripEmpty).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => key !== "_file" && key !== "device")
      .map(([key, item]) => [key, stripEmpty(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}

function eventState(events) {
  return {
    superseded: new Set(events.flatMap((event) => event.relations?.supersedes || [])),
    resolved: new Set(events.flatMap((event) => event.relations?.resolves || [])),
  };
}

function presentEvent(event, state, { detail = false, includeSource = false } = {}) {
  const effectiveStatus = state.resolved.has(event.id)
    ? "resolved"
    : state.superseded.has(event.id)
      ? "superseded"
      : event.status;
  const runtimeHost = event.runtime_host || event.device || "";
  const base = detail
    ? { ...event, _file: undefined, device: undefined, runtime_host: runtimeHost }
    : {
        id: event.id,
        type: event.type,
        status: effectiveStatus,
        title: event.title,
        summary: event.summary,
        subject: event.subject,
        canonical_name: event.canonical_name,
        aliases: event.aliases,
      };
  if (!detail && includeSource) base.source = presentSource(event.source);
  if (detail && event.source) base.source = presentSource(event.source);
  if (detail && effectiveStatus !== event.status) {
    base.recorded_status = event.status;
    base.status = effectiveStatus;
  }
  return stripEmpty(base) || {};
}

function searchScore(event, terms, rawQuery) {
  const lanes = [
    [event.title, 8],
    [[event.canonical_name, ...(event.aliases || [])], 8],
    [event.subject, 6],
    [event.tags, 5],
    [event.summary, 3],
    [event.details, 1],
  ];
  let score = 0;
  for (const [value, weight] of lanes) {
    const tokens = new Set(tokenize(Array.isArray(value) ? value.join(" ") : value));
    score += terms.filter((term) => tokens.has(term)).length * weight;
  }
  const phrase = String(rawQuery || "").trim().toLowerCase();
  if (terms.length > 1 && phrase.length > 2 && `${event.title || ""} ${event.summary || ""}`.toLowerCase().includes(phrase)) score += 10;
  return score;
}

export class ContextStore {
  constructor({ repoRoot = process.env.PERSONAL_CONTEXT_ROOT || REPO_ROOT } = {}) {
    this.repoRoot = resolve(repoRoot);
    const configPath = join(this.repoRoot, "context.config.json");
    this.config = existsSync(configPath)
      ? readJson(configPath)
      : { schemaVersion: 1, vaultPath: "./vault", sync: { remote: "origin", branch: "main" } };
    this.vaultPath = resolve(this.repoRoot, this.config.vaultPath);
    mkdirSync(join(this.vaultPath, "projects"), { recursive: true });
  }

  resolveProject(projectRef) {
    const wanted = String(projectRef || "").trim().toLowerCase();
    if (!wanted) throw new Error("A project name or ID is required.");
    const matches = this.listProjects().filter((project) =>
      [project.id, project.slug, project.name, ...(project.aliases || [])]
        .some((value) => String(value).toLowerCase() === wanted),
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Project reference is ambiguous: ${projectRef}`);
    throw new Error(`Unknown project: ${projectRef}. Create it first or call list_projects.`);
  }

  listProjects() {
    const root = join(this.vaultPath, "projects");
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, "project.json"))
      .filter(existsSync)
      .map(readJson)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  createProject({ name, purpose = "", aliases = [] }) {
    if (!name?.trim()) throw new Error("Project name is required.");
    const slug = slugify(name);
    if (!slug) throw new Error("Project name must contain letters or numbers.");
    const directory = join(this.vaultPath, "projects", slug);
    const manifest = join(directory, "project.json");
    if (existsSync(manifest)) throw new Error(`Project already exists: ${slug}`);
    const project = {
      schema_version: 1,
      id: `prj_${slug}`,
      slug,
      name: name.trim(),
      purpose: purpose.trim(),
      aliases: normalizeArray(aliases),
      created_at: new Date().toISOString(),
    };
    mkdirSync(join(directory, "events"), { recursive: true });
    writeJson(manifest, project);
    return project;
  }

  readEvents(projectRef) {
    const project = this.resolveProject(projectRef);
    const root = join(this.vaultPath, "projects", project.slug, "events");
    return walkJsonFiles(root)
      .map((file) => ({ ...readJson(file), _file: relative(this.repoRoot, file) }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  validateEventInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Event input must be an object.");
    if (!EVENT_TYPES.has(input.type)) throw new Error(`Unknown event type: ${input.type || "missing"}.`);
    for (const field of ["title", "summary", "details", "subject", "canonical_name", "source_app", "source_conversation", "source_url", "status", "sensitivity"]) {
      validateOptionalString(input, field);
    }
    if (!input.title?.trim() || !input.summary?.trim()) throw new Error("title and summary are required.");
    if (!input.source_app?.trim() || input.source_app.trim().toLowerCase() === "unknown") {
      throw new Error("source_app is required and must identify the originating application or person.");
    }
    const status = input.status || defaultStatus(input.type);
    if (!EVENT_STATUSES.has(status)) throw new Error(`Unknown event status: ${status}.`);
    if (input.type === "hypothesis" && status === "accepted") throw new Error("A hypothesis cannot have accepted status; use proposed or publish a supported learning.");
    if (["decision", "question"].includes(input.type) && !normalizeSubject(input.subject)) {
      throw new Error(`A normalized subject is required for ${input.type} events.`);
    }
    const sensitivity = input.sensitivity || "private";
    if (!SENSITIVITIES.has(sensitivity)) throw new Error(`Unknown sensitivity: ${sensitivity}.`);
    for (const field of ["aliases", "tags", "related_event_ids", "supersedes", "resolves"]) validateOptionalStringArray(input, field);
    if (input.artifacts !== undefined && (!Array.isArray(input.artifacts) || input.artifacts.some((item) => !item || typeof item !== "object" || Array.isArray(item)))) {
      throw new Error("artifacts must be an array of objects.");
    }
    return true;
  }

  publishEvent(input) {
    this.validateEventInput(input);
    const project = this.resolveProject(input.project);
    const durable = {
      type: input.type,
      status: input.status || defaultStatus(input.type),
      title: input.title.trim(),
      summary: input.summary.trim(),
      details: input.details?.trim() || "",
      subject: normalizeSubject(input.subject),
      canonical_name: input.canonical_name?.trim() || "",
      aliases: normalizeArray(input.aliases),
      tags: normalizeArray(input.tags),
      source: {
        app: input.source_app?.trim() || "unknown",
        family: sourceAppFamily(input.source_app),
        conversation: input.source_conversation?.trim() || "",
        url: input.source_url?.trim() || "",
      },
      relations: {
        related: normalizeArray(input.related_event_ids),
        supersedes: normalizeArray(input.supersedes),
        resolves: normalizeArray(input.resolves),
      },
      artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
      sensitivity: input.sensitivity || "private",
    };
    if (durable.source.conversation) {
      const candidateShape = JSON.stringify(stableJson(replayShape(durable)));
      const duplicate = this.readEvents(project.id).find((event) => event.type !== "redaction" && JSON.stringify(stableJson(replayShape(event))) === candidateShape);
      if (duplicate) {
        const { _file, ...existing } = duplicate;
        return { ...existing, duplicate: true };
      }
    }
    const { createdAt, id } = nowId();
    const event = {
      schema_version: 1,
      id,
      project_id: project.id,
      created_at: createdAt,
      runtime_host: hostname(),
      ...durable,
    };
    const day = createdAt.slice(0, 10);
    const file = join(this.vaultPath, "projects", project.slug, "events", day.slice(0, 4), day.slice(5, 7), `${id}.json`);
    writeJson(file, event);
    return { ...event, duplicate: false };
  }

  harvestSession({ project, source_app, source_conversation = "", source_url = "", events }) {
    if (!Array.isArray(events) || events.length === 0) throw new Error("Harvest requires at least one durable event.");
    const resolvedProject = this.resolveProject(project);
    const candidates = events.map((event) => ({
      ...event,
      project: resolvedProject.id,
      source_app,
      source_conversation,
      source_url,
    }));
    candidates.forEach((candidate, index) => {
      try {
        this.validateEventInput(candidate);
      } catch (error) {
        throw new Error(`Harvest candidate ${index + 1}: ${error.message}`);
      }
    });
    const saved = candidates.map((candidate) => this.publishEvent(candidate));
    const state = eventState(saved);
    return {
      saved_count: saved.filter((event) => !event.duplicate).length,
      duplicate_count: saved.filter((event) => event.duplicate).length,
      events: saved.map((event) => ({ ...presentEvent(event, state), duplicate: event.duplicate })),
    };
  }

  getProjectContext(projectRef, { recentLimit = 20, detail = false } = {}) {
    const project = this.resolveProject(projectRef);
    const events = this.readEvents(project.id);
    const state = eventState(events);
    const { superseded, resolved } = state;
    const latestBrief = events.filter((event) => event.type === "brief").at(-1) || null;
    const decisions = events.filter((event) => event.type === "decision" && event.status === "accepted" && !superseded.has(event.id));
    const questions = events.filter((event) => event.type === "question" && event.status === "open" && !resolved.has(event.id));
    const terminology = events.filter((event) => event.type === "terminology" && event.canonical_name && !superseded.has(event.id));
    const methods = events.filter((event) => event.type === "method" && !superseded.has(event.id));
    return {
      project,
      current_brief: latestBrief ? presentEvent(latestBrief, state, { detail }) : null,
      active_decisions: decisions.map((event) => presentEvent(event, state, { detail })),
      open_questions: questions.map((event) => presentEvent(event, state, { detail })),
      terminology: terminology.map((event) => presentEvent(event, state, { detail })),
      reusable_methods: methods.map((event) => presentEvent(event, state, { detail })),
      recent_events: events.slice(-Math.max(1, Math.min(Number(recentLimit) || 20, 100))).reverse().map((event) => presentEvent(event, state, { detail })),
      event_count: events.length,
    };
  }

  search(query, { project, limit = 20, detail = false } = {}) {
    const terms = [...new Set(tokenize(query).filter((term) => term.length > 1))];
    if (!terms.length) throw new Error("Search query is required.");
    const projects = project ? [this.resolveProject(project)] : this.listProjects();
    const scored = projects.flatMap((item) => {
      const events = this.readEvents(item.id);
      const state = eventState(events);
      return events.map((event) => ({
        score: searchScore(event, terms, query),
        project: { id: item.id, name: item.name },
        event: presentEvent(event, state, { detail, includeSource: true }),
        _created_at: event.created_at,
      }));
    }).filter((result) => result.score > 0);
    return scored
      .sort((a, b) => b.score - a.score || b._created_at.localeCompare(a._created_at))
      .slice(0, Math.min(Number(limit) || 20, 100))
      .map(({ _created_at, ...result }) => result);
  }

  redactEvent({ event_id, confirm_event_id, reason }) {
    if (!event_id || event_id !== confirm_event_id) throw new Error("event_id and confirm_event_id must match exactly.");
    if (!reason?.trim()) throw new Error("A redaction reason is required.");
    const matches = walkJsonFiles(join(this.vaultPath, "projects"))
      .filter((file) => basename(file) === `${event_id}.json`);
    if (matches.length !== 1) throw new Error(matches.length ? `Event ID is ambiguous: ${event_id}` : `Unknown event: ${event_id}`);
    const file = matches[0];
    const original = readJson(file);
    const tombstone = {
      schema_version: original.schema_version || 1,
      id: original.id,
      project_id: original.project_id,
      created_at: original.created_at,
      runtime_host: hostname(),
      type: "redaction",
      status: "redacted",
      title: "Redacted event",
      summary: `Content removed from active retrieval: ${reason.trim()}`,
      redacted_at: new Date().toISOString(),
      source: { app: "personal-context", family: "personal-context", conversation: "", url: "" },
      relations: {
        related: normalizeArray(original.relations?.related),
        supersedes: normalizeArray(original.relations?.supersedes),
        resolves: normalizeArray(original.relations?.resolves),
      },
      sensitivity: "restricted",
    };
    const temporary = `${file}.redacting`;
    writeFileSync(temporary, `${JSON.stringify(tombstone, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, file);
    return {
      id: event_id,
      redacted: true,
      reason: reason.trim(),
      warning: "Removed from active retrieval only. Earlier Git commits still contain the original content until history is deliberately rewritten.",
    };
  }

  lint() {
    const errors = [];
    const warnings = [];
    const ids = new Map();
    const aliases = new Map();
    const projectIds = new Set(this.listProjects().map((project) => project.id));
    const allFiles = walkJsonFiles(join(this.vaultPath, "projects")).filter((file) => basename(file) !== "project.json");
    const events = [];
    for (const file of allFiles) {
      try {
        const event = readJson(file);
        events.push(event);
        if (!event.id || !event.project_id || !event.type || !event.title || !event.summary || !event.created_at) {
          errors.push(`${relative(this.repoRoot, file)} is missing required event fields.`);
        }
        if (event.type !== "redaction" && !EVENT_TYPES.has(event.type)) errors.push(`${event.id || file} has unknown type ${event.type}.`);
        if (event.status !== "redacted" && !EVENT_STATUSES.has(event.status)) errors.push(`${event.id || file} has unknown status ${event.status}.`);
        if (event.type === "hypothesis" && event.status === "accepted") errors.push(`${event.id || file} is an accepted hypothesis.`);
        if (typeof event.source?.app !== "string" || !event.source.app.trim() || event.source.app.trim().toLowerCase() === "unknown") errors.push(`${event.id || file} requires source provenance.`);
        if (event.source?.family && event.source.family !== sourceAppFamily(event.source.app)) errors.push(`${event.id || file} has inconsistent source application family.`);
        if (!SENSITIVITIES.has(event.sensitivity)) errors.push(`${event.id || file} has unknown sensitivity ${event.sensitivity}.`);
        if (["decision", "question"].includes(event.type) && !normalizeSubject(event.subject)) {
          errors.push(`${event.id || file} requires a subject.`);
        }
        if (!projectIds.has(event.project_id)) errors.push(`${event.id || file} refers to unknown project ${event.project_id}.`);
        if (ids.has(event.id)) errors.push(`Duplicate event ID ${event.id}.`);
        ids.set(event.id, file);
        if (event.id && basename(file, ".json") !== event.id) warnings.push(`${event.id} filename does not match its ID.`);
      } catch (error) {
        errors.push(`${relative(this.repoRoot, file)} is invalid JSON: ${error.message}`);
      }
    }
    for (const event of events) {
      for (const [kind, targets] of Object.entries(event.relations || {})) {
        for (const target of targets || []) if (!ids.has(target)) warnings.push(`${event.id} ${kind} missing event ${target}.`);
      }
      if (event.type === "terminology" && event.canonical_name) {
        for (const label of [event.canonical_name, ...(event.aliases || [])]) {
          const key = label.toLowerCase();
          const previous = aliases.get(key);
          if (previous && previous !== event.canonical_name) warnings.push(`Name '${label}' maps to both '${previous}' and '${event.canonical_name}'.`);
          aliases.set(key, event.canonical_name);
        }
      }
    }
    const superseded = new Set(events.flatMap((event) => event.relations?.supersedes || []));
    const activeBySubject = new Map();
    for (const event of events.filter((item) => item.type === "decision" && item.status === "accepted" && item.subject && !superseded.has(item.id))) {
      const key = `${event.project_id}:${normalizeSubject(event.subject)}`;
      const group = activeBySubject.get(key) || [];
      group.push(event.id);
      activeBySubject.set(key, group);
    }
    for (const [subject, eventIds] of activeBySubject) {
      if (eventIds.length > 1) warnings.push(`Multiple active decisions for ${subject}: ${eventIds.join(", ")}. Add an explicit supersedes relation or distinguish their subjects.`);
    }
    return { ok: errors.length === 0, projects: projectIds.size, events: events.length, errors, warnings };
  }

  sync(action = "status") {
    const run = (...args) => execFileSync("git", args, { cwd: this.repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const inspect = (...args) => execFileSync("git", args, {
      cwd: this.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
    if (!existsSync(join(this.repoRoot, ".git"))) throw new Error("This context folder is not a Git repository.");
    if (action === "status") return { status: inspect("status", "--short", "--branch"), synchronization: this.synchronizationReceipt() };
    const remote = this.config.sync?.remote || "origin";
    const branch = this.config.sync?.branch || "main";
    const staged = inspect("status", "--porcelain", "--", relative(this.repoRoot, this.vaultPath));
    const steps = [];
    if (staged) {
      run("add", "--", relative(this.repoRoot, this.vaultPath));
      run("commit", "-m", `Capture context ${new Date().toISOString()}`);
      steps.push("committed local vault changes");
    }
    if (["pull", "both"].includes(action)) {
      run("pull", "--rebase", remote, branch);
      steps.push(`pulled ${remote}/${branch}`);
    }
    if (["push", "both"].includes(action)) {
      run("push", remote, branch);
      steps.push(`pushed ${remote}/${branch}`);
    }
    if (!steps.length) throw new Error("action must be status, pull, push, or both.");
    return { ok: true, steps, status: inspect("status", "--short", "--branch"), synchronization: this.synchronizationReceipt() };
  }

  synchronizationReceipt() {
    if (!existsSync(join(this.repoRoot, ".git"))) {
      return { state: "unavailable", pending: true, message: "Saved locally; this context folder is not connected to Git synchronization." };
    }
    try {
      const status = execFileSync("git", ["status", "--porcelain", "--", relative(this.repoRoot, this.vaultPath)], {
        cwd: this.repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }).trim();
      return status
        ? { state: "pending", pending: true, message: "Saved locally; synchronization pending." }
        : { state: "synchronized", pending: false, message: "No local context changes are waiting to synchronize." };
    } catch (error) {
      return { state: "unavailable", pending: true, message: `Saved locally; synchronization status is unavailable: ${error.message}` };
    }
  }
}

export function checksumFile(file) {
  const resolved = resolve(file);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`Artifact not found: ${file}`);
  return `sha256:${createHash("sha256").update(readFileSync(resolved)).digest("hex")}`;
}
