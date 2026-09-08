import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextStore } from "../src/context-store.mjs";

function temporaryStore() {
  const repoRoot = mkdtempSync(join(tmpdir(), "personal-context-test-"));
  mkdirSync(join(repoRoot, "vault", "projects"), { recursive: true });
  writeFileSync(join(repoRoot, "context.config.json"), '{"schemaVersion":1,"vaultPath":"./vault"}\n');
  return new ContextStore({ repoRoot });
}

test("creates a project and preserves a durable event", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Learning Experiment", purpose: "Test the context loop" });
  const event = store.publishEvent({ project: project.id, type: "decision", subject: "storage model", title: "Use an event ledger", summary: "Store immutable events as the source of truth.", source_app: "test" });
  assert.match(event.id, /^evt_/);
  const context = store.getProjectContext(project.slug);
  assert.equal(context.active_decisions[0].id, event.id);
  assert.equal(context.event_count, 1);
  assert.equal(store.lint().ok, true);
});

test("superseding and resolving events change the compiled current view", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Project Alpha" });
  const oldDecision = store.publishEvent({ project: project.id, type: "decision", subject: "direction", title: "Old", summary: "Old decision", source_app: "test" });
  const question = store.publishEvent({ project: project.id, type: "question", subject: "unknown", title: "Unknown", summary: "Something is unresolved", source_app: "test" });
  const newDecision = store.publishEvent({ project: project.id, type: "decision", subject: "direction", title: "New", summary: "New decision", supersedes: [oldDecision.id], resolves: [question.id], source_app: "test" });
  const context = store.getProjectContext(project.id);
  assert.deepEqual(context.active_decisions.map((event) => event.id), [newDecision.id]);
  assert.equal(context.open_questions.length, 0);
  const recentQuestion = context.recent_events.find((event) => event.id === question.id);
  assert.equal(recentQuestion.status, "resolved");
  const detailed = store.getProjectContext(project.id, { detail: true });
  const detailedQuestion = detailed.recent_events.find((event) => event.id === question.id);
  assert.equal(detailedQuestion.status, "resolved");
  assert.equal(detailedQuestion.recorded_status, "open");
});

test("search returns provenance-bearing events", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Project Search" });
  store.publishEvent({ project: project.id, type: "learning", title: "Moderation", summary: "A moderator connects aliases and contradictions.", source_app: "buddy", source_conversation: "thread-1" });
  const results = store.search("aliases contradictions", {});
  assert.equal(results.length, 1);
  assert.equal(results[0].event.source.conversation, "thread-1");
});

test("project aliases resolve and conflicting current decisions are linted", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Canonical Project", aliases: ["Project Nickname"] });
  store.publishEvent({ project: "Project Nickname", type: "decision", subject: "Storage Model", title: "First", summary: "Use the first store.", source_app: "test" });
  store.publishEvent({ project: project.id, type: "decision", subject: "storage-model", title: "Second", summary: "Use the second store.", source_app: "test" });
  const report = store.lint();
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /Multiple active decisions/);
});

test("compact retrieval omits bodies, empty fields, and internal paths by default", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Compact Project" });
  store.publishEvent({
    project: project.id,
    type: "learning",
    title: "A concise title",
    summary: "A concise summary.",
    details: "A long body that should only be loaded on demand. ".repeat(100),
    source_app: "test",
  });
  const compact = store.getProjectContext(project.id);
  const detailed = store.getProjectContext(project.id, { detail: true });
  const compactJson = JSON.stringify(compact);
  const detailedJson = JSON.stringify(detailed);
  assert.doesNotMatch(compactJson, /long body/);
  assert.doesNotMatch(compactJson, /_file/);
  assert.doesNotMatch(compactJson, /\"details\":\"\"/);
  assert.match(detailedJson, /long body/);
  assert.ok(detailedJson.length > compactJson.length * 2);
});

test("search matches tokens rather than substrings and excludes internal fields", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Context Artifact" });
  store.publishEvent({ project: project.id, type: "learning", title: "Context artifact", summary: "Reusable context lives here.", source_app: "test" });
  assert.equal(store.search("act", {}).length, 0);
  assert.equal(store.search("context", {}).length, 1);
});

test("decision and question subjects are required and normalized", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Subjects" });
  assert.throws(() => store.publishEvent({ project: project.id, type: "decision", title: "No subject", summary: "This should fail.", source_app: "test" }), /subject is required/);
  const event = store.publishEvent({ project: project.id, type: "question", subject: "Retrieval Cost", title: "How compact?", summary: "Measure it.", source_app: "test" });
  assert.equal(event.subject, "retrieval-cost");
  const longSubject = "External decision architecture and operational replay relationship across recurring leadership decisions";
  const longEvent = store.publishEvent({ project: project.id, type: "question", subject: longSubject, title: "How should the layers connect?", summary: "Preserve a readable stable key.", source_app: "test" });
  assert.ok(longEvent.subject.length <= 64);
  assert.match(longEvent.subject, /^external-decision-architecture-and-operational-replay-[a-f0-9]{8}$/);
  assert.equal(longEvent.subject.endsWith("relationsh"), false);
});

test("runtime location is distinct from source provenance", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Provenance" });
  const event = store.publishEvent({ project: project.id, type: "learning", title: "Origin", summary: "Captured from another application.", source_app: "Claude Cowork" });
  assert.equal(event.source.app, "Claude Cowork");
  assert.equal(event.source.family, "claude");
  const codex = store.publishEvent({ project: project.id, type: "learning", title: "Second origin", summary: "Captured from a Codex desktop session.", source_app: "Codex Desktop" });
  assert.equal(codex.source.app, "Codex Desktop");
  assert.equal(codex.source.family, "codex");
  assert.equal(typeof event.runtime_host, "string");
  assert.equal("device" in event, false);
});

test("redaction removes active content but warns that Git history remains", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Privacy" });
  const question = store.publishEvent({ project: project.id, type: "question", subject: "privacy finding", title: "Is the finding confirmed?", summary: "Awaiting private evidence.", source_app: "test" });
  const event = store.publishEvent({ project: project.id, type: "learning", title: "Sensitive phrase", summary: "canary947 must disappear", details: "canary947", resolves: [question.id], source_app: "test" });
  assert.throws(() => store.redactEvent({ event_id: event.id, confirm_event_id: "wrong", reason: "privacy cleanup" }), /must match/);
  const result = store.redactEvent({ event_id: event.id, confirm_event_id: event.id, reason: "privacy cleanup" });
  assert.match(result.warning, /Git commits/);
  assert.equal(store.search("canary947", {}).length, 0);
  const context = store.getProjectContext(project.id, { detail: true });
  const tombstone = context.recent_events.find((item) => item.id === event.id);
  assert.equal(tombstone.type, "redaction");
  assert.equal(tombstone.status, "redacted");
  assert.equal(context.open_questions.length, 0);
});

test("the store enforces event vocabulary, provenance, and status invariants", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Validation" });
  const base = { project: project.id, type: "learning", title: "Valid", summary: "A valid event.", source_app: "test" };
  assert.throws(() => store.publishEvent({ ...base, type: "mystery" }), /Unknown event type/);
  assert.throws(() => store.publishEvent({ ...base, status: "maybe" }), /Unknown event status/);
  assert.throws(() => store.publishEvent({ ...base, sensitivity: "secret-ish" }), /Unknown sensitivity/);
  assert.throws(() => store.publishEvent({ ...base, source_app: "unknown" }), /source_app is required/);
  assert.throws(() => store.publishEvent({ ...base, source_app: "" }), /source_app is required/);
  assert.throws(() => store.publishEvent({ ...base, type: "hypothesis", status: "accepted" }), /hypothesis cannot have accepted/);
  assert.throws(() => store.publishEvent({ ...base, tags: "not-an-array" }), /tags must be an array/);
  assert.equal(store.getProjectContext(project.id).event_count, 0);
});

test("harvest validates every candidate before writing any candidate", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Harvest Preflight" });
  assert.throws(() => store.harvestSession({
    project: project.id,
    source_app: "test",
    source_conversation: "batch-1",
    events: [
      { type: "learning", title: "Would be valid", summary: "This must not be partially saved." },
      { type: "hypothesis", title: "Invalid second event", summary: "Accepted hypotheses are disallowed.", status: "accepted" },
    ],
  }), /Harvest candidate 2/);
  assert.equal(store.getProjectContext(project.id).event_count, 0);
});

test("an exact replay from the same source conversation reuses the existing event", () => {
  const store = temporaryStore();
  const project = store.createProject({ name: "Replay Protection" });
  const input = {
    project: project.id,
    type: "learning",
    title: "One durable finding",
    summary: "Replaying the same captured contribution should be harmless.",
    source_app: "test",
    source_conversation: "conversation-42",
    artifacts: [{ kind: "link", url: "https://example.test/finding" }],
  };
  const first = store.publishEvent(input);
  const replay = store.publishEvent({ ...input, artifacts: [{ url: "https://example.test/finding", kind: "link" }] });
  const changed = store.publishEvent({ ...input, summary: `${input.summary} This sentence is new.` });
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.id, first.id);
  assert.notEqual(changed.id, first.id);
  assert.equal(store.getProjectContext(project.id).event_count, 2);

  const harvested = store.harvestSession({
    project: project.id,
    source_app: input.source_app,
    source_conversation: input.source_conversation,
    events: [{ type: input.type, title: input.title, summary: input.summary, artifacts: input.artifacts }],
  });
  assert.equal(harvested.saved_count, 0);
  assert.equal(harvested.duplicate_count, 1);
  assert.equal(harvested.events[0].duplicate, true);
  assert.equal(harvested.events[0].id, first.id);
});

test("read-only Git probes explicitly disable optional locks", () => {
  const store = temporaryStore();
  mkdirSync(join(store.repoRoot, ".git"));
  const binaryDirectory = mkdtempSync(join(tmpdir(), "personal-context-git-spy-"));
  const gitSpy = join(binaryDirectory, "git");
  writeFileSync(gitSpy, `#!/bin/sh
if [ "$GIT_OPTIONAL_LOCKS" != "0" ]; then
  echo "optional locks were not disabled" >&2
  exit 91
fi
printf '## main\n'
`);
  chmodSync(gitSpy, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaryDirectory}:${originalPath}`;
  try {
    assert.equal(store.synchronizationReceipt().state, "pending");
    assert.match(store.sync("status").status, /## main/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("a real status probe leaves no index lock and a subsequent commit succeeds", () => {
  const store = temporaryStore();
  execFileSync("git", ["init", "-b", "main"], { cwd: store.repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: store.repoRoot });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: store.repoRoot });
  assert.doesNotThrow(() => store.synchronizationReceipt());
  assert.equal(existsSync(join(store.repoRoot, ".git", "index.lock")), false);
  execFileSync("git", ["add", "context.config.json"], { cwd: store.repoRoot });
  assert.doesNotThrow(() => execFileSync("git", ["commit", "-m", "after status probe"], { cwd: store.repoRoot, stdio: "ignore" }));
});
