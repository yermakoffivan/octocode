#!/usr/bin/env node
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w?.name === 'ExperimentalWarning' && String(w?.message).includes('SQLite')) return;
  console.error(w?.stack ?? String(w));
});

// bin/hook-runner.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync2, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename as basename2, dirname as dirname3, join as join3, resolve as resolve7 } from "node:path";
import { fileURLToPath } from "node:url";

// src/helpers.ts
import { resolve } from "node:path";
var MEMORY_LABEL_VALUES = [
  "BUG",
  "FEATURE",
  "SUGGESTION",
  "GOTCHA",
  "IMPROVEMENT",
  "DECISION",
  "ARCHITECTURE",
  "SECURITY",
  "PERFORMANCE",
  "TEST",
  "BUILD",
  "DOCS",
  "CONFIG",
  "WORKFLOW",
  "REFACTOR",
  "API",
  "RELEASE",
  "INCIDENT",
  "EXPERIENCE",
  // post-task reflections (worked/partial/failed outcomes)
  "OVERRIDE",
  // contradicts model training defaults (e.g. "this repo uses Bun, not npm")
  "OTHER"
];
var MEMORY_LABELS = new Set(MEMORY_LABEL_VALUES);
function utcNow() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
var NOTIFICATION_KIND_VALUES = [
  "claim",
  "handoff",
  "question",
  "reply",
  "blocker",
  "request",
  "decision",
  "fyi"
];
var NOTIFICATION_KINDS = new Set(NOTIFICATION_KIND_VALUES);
function normalizeArtifact(value) {
  if (value == null) return null;
  const cleaned = String(value).trim().slice(0, 256);
  return cleaned.length > 0 ? cleaned : null;
}

// src/git.ts
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve as resolve2 } from "node:path";
function runCmd(cmd, args, cwd) {
  try {
    const r = spawnSync(cmd, args, { cwd: cwd ?? process.cwd(), encoding: "utf8", timeout: 5e3 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}
function detectGit(cwd) {
  const root = runCmd("git", ["-C", cwd ?? ".", "rev-parse", "--show-toplevel"]);
  if (!root) return { is_repo: false };
  const branch = runCmd("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]);
  const remote = runCmd("git", ["-C", root, "remote", "get-url", "origin"]);
  const repoName = remote ? (remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/) ?? [])[1] ?? basename(root) : basename(root);
  return { is_repo: true, root, repo: repoName, branch, remote };
}
function canonicalizePath(input) {
  let dir = resolve2(input);
  const tail = [];
  for (let guard = 0; guard < 4096; guard += 1) {
    try {
      return tail.length ? join(realpathSync(dir), ...tail) : realpathSync(dir);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve2(input);
      tail.unshift(basename(dir));
      dir = parent;
    }
  }
  return resolve2(input);
}
function fillScope(partial, cwd) {
  const explicitWorkspace = partial.workspace_path ? canonicalizePath(partial.workspace_path) : null;
  const scope = {
    workspace_path: explicitWorkspace,
    artifact: partial.artifact ?? null,
    repo: partial.repo ?? null,
    ref: partial.ref ?? null
  };
  const git = detectGit(scope.workspace_path ?? cwd ?? process.cwd());
  if (!git.is_repo) return scope;
  if (git.root) scope.workspace_path = canonicalizePath(git.root);
  if (!scope.repo && git.repo) scope.repo = git.repo;
  if (!scope.ref && git.branch) scope.ref = git.branch;
  return scope;
}
function normalizeWorkspacePath(workspacePath, cwd) {
  const candidate = workspacePath ? resolve2(workspacePath) : cwd ? resolve2(cwd) : null;
  const scope = fillScope({ workspace_path: candidate }, candidate ?? process.cwd());
  if (scope.workspace_path) return scope.workspace_path;
  return candidate;
}

// src/sql/agents.ts
var AGENTS_UPSERT = `INSERT INTO agents (agent_id, agent_name, workspace_path, artifact, context, registered_at, last_seen_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(agent_id) DO UPDATE SET
     agent_name     = CASE WHEN excluded.agent_name <> '' THEN excluded.agent_name ELSE agent_name END,
     workspace_path = COALESCE(excluded.workspace_path, workspace_path),
     artifact       = COALESCE(excluded.artifact, artifact),
     context        = COALESCE(excluded.context, context),
     last_seen_at   = excluded.last_seen_at`;

// src/agents.ts
function registerAgent(db2, params) {
  const agentId2 = params.agentId;
  const agentName2 = params.agentName ?? "";
  const workspacePath = params.workspacePath ? normalizeWorkspacePath(params.workspacePath, params.workspacePath) : null;
  const artifact2 = normalizeArtifact(params.artifact);
  const context = params.context ?? null;
  const now = utcNow();
  db2.prepare(AGENTS_UPSERT).run(agentId2, agentName2, workspacePath, artifact2, context, now, now);
  return { agent_id: agentId2, agent_name: agentName2, workspace_path: workspacePath, artifact: artifact2, context, registered_at: now, last_seen_at: now };
}

// src/audit.ts
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

// src/sql/audit.ts
var EDIT_LOG_INSERT = `
  INSERT INTO edit_log (
    edit_id, session_id, run_id, agent_id,
    file_path, operation, old_file_path,
    lines_added, lines_removed, content_hash,
    workspace_path, artifact, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// src/audit.ts
function insertEditLog(db2, params) {
  const editId = "edit_" + randomUUID();
  const now = utcNow();
  db2.prepare(EDIT_LOG_INSERT).run(
    editId,
    params.sessionId ?? null,
    params.runId ?? null,
    params.agentId,
    params.filePath,
    params.operation,
    params.oldFilePath ?? null,
    params.linesAdded ?? null,
    params.linesRemoved ?? null,
    params.contentHash ?? null,
    params.workspacePath ?? null,
    normalizeArtifact(params.artifact),
    now
  );
  return { editId };
}

// src/db.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join as join2, resolve as resolve3, dirname as dirname2 } from "node:path";
import { homedir, platform } from "node:os";
var DEFAULT_DB_NAME = "awareness.sqlite3";
var MEMORY_HOME_ENV = "OCTOCODE_MEMORY_HOME";
var _db;
function memoryHome() {
  const configured = process.env[MEMORY_HOME_ENV];
  if (configured?.trim()) return resolve3(configured.trim());
  const h = homedir();
  const p = platform();
  if (p === "win32") {
    const appData = process.env["APPDATA"] ?? join2(h, "AppData", "Roaming");
    return join2(appData, ".octocode", "memory");
  }
  if (p === "darwin") return join2(h, ".octocode", "memory");
  const xdg = process.env["XDG_CONFIG_HOME"] ?? join2(h, ".config");
  return join2(xdg, ".octocode", "memory");
}
function resolveDbPath(dbArg) {
  if (dbArg) return resolve3(dbArg);
  return join2(memoryHome(), DEFAULT_DB_NAME);
}
function connectDb(dbPath) {
  mkdirSync(dirname2(dbPath), { recursive: true });
  const db2 = new DatabaseSync(dbPath);
  db2.exec("PRAGMA foreign_keys = ON");
  db2.exec("PRAGMA busy_timeout = 5000");
  db2.exec("PRAGMA journal_mode = WAL");
  initDb(db2);
  _db = db2;
  return db2;
}
var SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS sessions (
      session_id     TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL,
      workspace_path TEXT,
      artifact       TEXT,
      repo           TEXT,
      ref            TEXT,
      started_at     TEXT NOT NULL,
      ended_at       TEXT,
      summary        TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      memory_id             TEXT PRIMARY KEY,
      agent_id              TEXT NOT NULL,
      task_context          TEXT NOT NULL,
      observation           TEXT NOT NULL,
      importance            INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 10),
      state                 TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE', 'SUPERSEDED')),
      label                 TEXT NOT NULL DEFAULT 'OTHER',
      superseded_by         TEXT,
      tags_json             TEXT NOT NULL DEFAULT '[]',
      workspace_path        TEXT,
      artifact              TEXT,
      repo                  TEXT,
      ref                   TEXT,
      file_tree_fingerprint TEXT,
      novelty_score         REAL,
      last_accessed_at      TEXT,
      access_count          INTEGER NOT NULL DEFAULT 0,
      decay_half_life_days  REAL,
      failure_signature     TEXT,
      valid_from            TEXT,
      valid_to              TEXT,
      expired_at            TEXT,
      embedding             BLOB,
      embedding_model       TEXT,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at            TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      plan_id        TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      objective      TEXT NOT NULL,
      lead_agent_id  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK(status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
      workspace_path TEXT NOT NULL,
      artifact       TEXT,
      doc_dir        TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_members (
      plan_id    TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
      agent_id   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'CONTRIBUTOR' CHECK(role IN ('LEAD','CONTRIBUTOR')),
      joined_at  TEXT NOT NULL,
      PRIMARY KEY(plan_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS plan_docs (
      plan_id       TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      title         TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'SUPPORTING' CHECK(kind IN ('PRIMARY','SUPPORTING')),
      ordinal       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(plan_id, relative_path)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id      TEXT PRIMARY KEY,
      plan_id      TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      reasoning    TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK(status IN ('OPEN','IN_PROGRESS','BLOCKED','VERIFY','DONE','FAILED','CANCELLED')),
      priority     INTEGER NOT NULL DEFAULT 0,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_paths (
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      path    TEXT NOT NULL,
      ordinal INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(task_id, path)
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id            TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      depends_on_task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      created_by         TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      PRIMARY KEY(task_id, depends_on_task_id),
      CHECK(task_id <> depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      run_id         TEXT PRIMARY KEY,
      task_id        TEXT REFERENCES tasks(task_id) ON DELETE SET NULL,
      agent_id       TEXT NOT NULL,
      session_id     TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
      rationale      TEXT NOT NULL,
      test_plan      TEXT NOT NULL,
      context_ref    TEXT,
      status         TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK(status IN ('PENDING','ACTIVE','SUCCESS','FAILED')),
      workspace_path TEXT,
      artifact       TEXT,
      files_json     TEXT NOT NULL DEFAULT '[]',
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS task_claims (
      task_id      TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
      run_id       TEXT NOT NULL UNIQUE REFERENCES task_runs(run_id) ON DELETE CASCADE,
      agent_id     TEXT NOT NULL,
      claimed_at   TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      event_id   TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      run_id     TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
      agent_id   TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locks (
      lock_id     TEXT PRIMARY KEY,
      file_path   TEXT NOT NULL,
      run_id      TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      session_id  TEXT,
      lock_type   TEXT NOT NULL CHECK(lock_type IN ('SHARED','EXCLUSIVE')),
      acquired_at TEXT NOT NULL,
      expires_at  TEXT,
      FOREIGN KEY(run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE,
      UNIQUE(file_path, run_id)
    );

    CREATE TABLE IF NOT EXISTS run_log (
      event_id   TEXT PRIMARY KEY,
      run_id     TEXT,
      agent_id   TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES task_runs(run_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS refinements (
      refinement_id  TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      artifact       TEXT,
      repo           TEXT,
      ref            TEXT,
      files_json     TEXT NOT NULL DEFAULT '[]',
      reasoning      TEXT NOT NULL,
      remember       TEXT NOT NULL,
      quality        TEXT NOT NULL CHECK(quality IN ('good','bad','handoff','instructions')) DEFAULT 'good',
      state          TEXT NOT NULL CHECK(state IN ('open','ongoing','done')) DEFAULT 'open',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      signal_id      TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      artifact       TEXT,
      repo           TEXT,
      ref            TEXT,
      from_agent     TEXT NOT NULL,
      to_agent       TEXT,
      kind           TEXT NOT NULL,
      subject        TEXT NOT NULL,
      body           TEXT,
      files_json     TEXT NOT NULL DEFAULT '[]',
      refs_json      TEXT NOT NULL DEFAULT '[]',
      thread_id      TEXT NOT NULL,
      reply_to       TEXT,
      importance     INTEGER NOT NULL DEFAULT 5,
      status         TEXT NOT NULL DEFAULT 'open',
      resolved_at    TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signal_reads (
      signal_id TEXT NOT NULL,
      agent_id  TEXT NOT NULL,
      read_at   TEXT NOT NULL,
      PRIMARY KEY (signal_id, agent_id),
      FOREIGN KEY(signal_id) REFERENCES signals(signal_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_refs (
      memory_id TEXT    NOT NULL,
      reference TEXT    NOT NULL,
      kind      TEXT,
      ordinal   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (memory_id, reference),
      FOREIGN KEY(memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE
    );

    -- ARCH-5: Agent identity registry \u2014 maps opaque agentIds to human-readable names.
    -- Separate from memories so the mapping persists even when memories are pruned.
    -- ON CONFLICT logic in agents.ts ensures a non-empty name is never overwritten by ''.
    CREATE TABLE IF NOT EXISTS agents (
      agent_id       TEXT PRIMARY KEY,
      agent_name     TEXT NOT NULL DEFAULT '',
      workspace_path TEXT,
      artifact       TEXT,
      context        TEXT,   -- 'pi' | 'cursor' | 'claude-code' | etc
      registered_at  TEXT NOT NULL,
      last_seen_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edit_log (
      edit_id        TEXT PRIMARY KEY,
      session_id     TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
      run_id         TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
      agent_id       TEXT NOT NULL,
      file_path      TEXT NOT NULL,
      operation      TEXT NOT NULL CHECK(operation IN ('create','update','delete','move','rename')),
      old_file_path  TEXT,          -- populated for move/rename operations
      lines_added    INTEGER,
      lines_removed  INTEGER,
      content_hash   TEXT,          -- sha256 of file content after edit
      workspace_path TEXT,
      artifact       TEXT,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS harness_log (
      harness_id   TEXT PRIMARY KEY,
      session_id   TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
      agent_id     TEXT NOT NULL,
      workspace_path TEXT,
      artifact     TEXT,
      event_type   TEXT NOT NULL CHECK(event_type IN ('mine','propose','validate','apply','capture','reflect')),
      payload_json TEXT,           -- JSON with event-specific data
      memory_id    TEXT REFERENCES memories(memory_id) ON DELETE SET NULL,
      run_id       TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
`;
function tableExists(db2, table) {
  return Boolean(db2.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table));
}
function renameColumnIfPresent(db2, table, from, to) {
  if (!tableExists(db2, table)) return;
  const columns = tableColumns(db2, table);
  if (columns.has(from) && !columns.has(to)) {
    db2.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}
function migrateLegacyTaskRuns(db2) {
  if (!tableExists(db2, "tasks")) return;
  const columns = tableColumns(db2, "tasks");
  const isLegacyExecutionTable = columns.has("agent_id") && columns.has("test_plan") && !columns.has("plan_id");
  if (!isLegacyExecutionTable) return;
  if (tableExists(db2, "task_runs")) {
    throw new Error("schema migration cannot move legacy tasks: task_runs already exists");
  }
  db2.exec("PRAGMA foreign_keys = OFF");
  db2.exec("BEGIN IMMEDIATE");
  try {
    for (const index of ["idx_tasks_status", "idx_tasks_agent_status", "idx_tasks_workspace", "idx_tasks_scope"]) {
      db2.exec(`DROP INDEX IF EXISTS ${index}`);
    }
    db2.exec("ALTER TABLE tasks RENAME TO task_runs");
    renameColumnIfPresent(db2, "task_runs", "task_id", "run_id");
    renameColumnIfPresent(db2, "task_runs", "plan_doc_ref", "context_ref");
    renameColumnIfPresent(db2, "locks", "task_id", "run_id");
    if (tableExists(db2, "task_log") && !tableExists(db2, "run_log")) {
      db2.exec("ALTER TABLE task_log RENAME TO run_log");
    }
    renameColumnIfPresent(db2, "run_log", "task_id", "run_id");
    renameColumnIfPresent(db2, "edit_log", "task_id", "run_id");
    renameColumnIfPresent(db2, "harness_log", "task_id", "run_id");
    db2.exec("COMMIT");
  } catch (error) {
    try {
      db2.exec("ROLLBACK");
    } catch {
    }
    throw error;
  } finally {
    db2.exec("PRAGMA foreign_keys = ON");
  }
}
function initDb(db2) {
  migrateLegacyTaskRuns(db2);
  db2.exec(SCHEMA_DDL);
  migrateExistingTables(db2);
  migrateRefinementQualityConstraint(db2);
  migrateCheckConstraints(db2);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_agent     ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_scope     ON sessions(workspace_path, artifact);

    CREATE INDEX IF NOT EXISTS idx_memories_importance      ON memories(importance);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at      ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_state           ON memories(state);
    CREATE INDEX IF NOT EXISTS idx_memories_label           ON memories(label);
    CREATE INDEX IF NOT EXISTS idx_memories_failure_sig     ON memories(failure_signature);
    CREATE INDEX IF NOT EXISTS idx_memories_workspace_path  ON memories(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_memories_scope           ON memories(workspace_path, repo, ref);
    CREATE INDEX IF NOT EXISTS idx_memories_artifact_scope  ON memories(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_memories_repo_ref        ON memories(repo, ref);
    CREATE INDEX IF NOT EXISTS idx_memories_valid           ON memories(valid_from, valid_to);
    CREATE INDEX IF NOT EXISTS idx_memories_embedding_model ON memories(embedding_model);

    CREATE INDEX IF NOT EXISTS idx_plans_scope          ON plans(workspace_path, artifact, status);
    CREATE INDEX IF NOT EXISTS idx_plans_lead           ON plans(lead_agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_plan_members_agent   ON plan_members(agent_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_plan_status    ON tasks(plan_id, status, priority DESC, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_deps_dependency ON task_dependencies(depends_on_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_claims_agent    ON task_claims(agent_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_task_claims_expiry   ON task_claims(expires_at);
    CREATE INDEX IF NOT EXISTS idx_task_runs_status     ON task_runs(status);
    CREATE INDEX IF NOT EXISTS idx_task_runs_agent      ON task_runs(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_runs_task       ON task_runs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_scope      ON task_runs(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_task_events_task     ON task_events(task_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_locks_file_path   ON locks(file_path);
    CREATE INDEX IF NOT EXISTS idx_locks_agent_id    ON locks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_locks_acquired_at ON locks(acquired_at);
    CREATE INDEX IF NOT EXISTS idx_locks_expires_at  ON locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_locks_session_id  ON locks(session_id);

    CREATE INDEX IF NOT EXISTS idx_refinements_state         ON refinements(state);
    CREATE INDEX IF NOT EXISTS idx_refinements_scope         ON refinements(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_refinements_repo          ON refinements(repo);
    CREATE INDEX IF NOT EXISTS idx_refinements_state_updated ON refinements(state, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_signals_status         ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_to_agent       ON signals(to_agent);
    CREATE INDEX IF NOT EXISTS idx_signals_workspace_path ON signals(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_signals_scope          ON signals(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_signals_created_at     ON signals(created_at);
    CREATE INDEX IF NOT EXISTS idx_signals_thread         ON signals(thread_id);

    CREATE INDEX IF NOT EXISTS idx_memory_refs_ref  ON memory_refs(reference);
    CREATE INDEX IF NOT EXISTS idx_memory_refs_kind ON memory_refs(kind);

    CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_agents_scope     ON agents(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS idx_edit_log_session     ON edit_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_edit_log_run         ON edit_log(run_id);
    CREATE INDEX IF NOT EXISTS idx_edit_log_agent       ON edit_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_edit_log_file        ON edit_log(file_path);
    CREATE INDEX IF NOT EXISTS idx_edit_log_workspace   ON edit_log(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_edit_log_scope       ON edit_log(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_edit_log_created_at  ON edit_log(created_at);

    CREATE INDEX IF NOT EXISTS idx_harness_log_session    ON harness_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_harness_log_agent      ON harness_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_harness_log_scope      ON harness_log(workspace_path, artifact);
    CREATE INDEX IF NOT EXISTS idx_harness_log_event_type ON harness_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_harness_log_memory     ON harness_log(memory_id);
    CREATE INDEX IF NOT EXISTS idx_harness_log_run        ON harness_log(run_id);
  `);
  try {
    db2.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(memory_id UNINDEXED, task_context, observation, tags)
    `);
  } catch {
  }
  if (hasFts(db2)) {
    const row = db2.prepare("SELECT COUNT(*) AS cnt FROM memories_fts").get();
    if (row.cnt === 0) rebuildFts(db2);
  }
  db2.exec("PRAGMA user_version = 2");
}
function tableColumns(db2, tableName) {
  const rows = db2.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(rows.map((r) => r.name));
}
var _canonicalColumns;
function canonicalColumns() {
  if (_canonicalColumns) return _canonicalColumns;
  const tmp = new DatabaseSync(":memory:");
  try {
    tmp.exec(SCHEMA_DDL);
    const tables = tmp.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all();
    const map = /* @__PURE__ */ new Map();
    for (const { name } of tables) {
      map.set(name, tmp.prepare(`PRAGMA table_info(${name})`).all());
    }
    _canonicalColumns = map;
    return map;
  } finally {
    tmp.close();
  }
}
function isConstantDefault(dflt) {
  return dflt !== null && !dflt.includes("(");
}
function migrateExistingTables(db2) {
  for (const [table, columns] of canonicalColumns()) {
    const existing = tableColumns(db2, table);
    for (const col of columns) {
      if (existing.has(col.name)) continue;
      let clause = `${col.name} ${col.type}`;
      if (isConstantDefault(col.dflt_value)) {
        if (col.notnull) clause += " NOT NULL";
        clause += ` DEFAULT ${col.dflt_value}`;
      }
      db2.exec(`ALTER TABLE ${table} ADD COLUMN ${clause}`);
    }
  }
}
var _canonicalTableSql;
function canonicalTableSql() {
  if (_canonicalTableSql) return _canonicalTableSql;
  const tmp = new DatabaseSync(":memory:");
  try {
    tmp.exec(SCHEMA_DDL);
    const rows = tmp.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
    ).all();
    _canonicalTableSql = new Map(rows.map((r) => [r.name, r.sql]));
    return _canonicalTableSql;
  } finally {
    tmp.close();
  }
}
function checkClauses(createSql) {
  const matches = createSql.match(/CHECK\s*\([^)]*\)/gi) ?? [];
  return matches.map((c) => c.replace(/\s+/g, " ").trim().toLowerCase()).sort().join(" | ");
}
function rebuildTableFromCanonical(db2, table, canonSql) {
  const liveCols = tableColumns(db2, table);
  const canonCols = (canonicalColumns().get(table) ?? []).map((c) => c.name).filter((n) => liveCols.has(n));
  if (canonCols.length === 0) return;
  const colList = canonCols.join(", ");
  const tmpName = `${table}__ckmig`;
  const createTmp = canonSql.replace(
    new RegExp(`(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)"?${table}"?`, "i"),
    `$1${tmpName}`
  );
  if (!createTmp.includes(tmpName)) {
    throw new Error(`check-constraint migration: cannot rename table ${table} in canonical DDL`);
  }
  const savepoint = `migrate_check_${table}`;
  db2.exec(`SAVEPOINT ${savepoint}`);
  try {
    db2.exec(`DROP TABLE IF EXISTS ${tmpName};`);
    db2.exec(createTmp);
    db2.exec(`INSERT INTO ${tmpName} (${colList}) SELECT ${colList} FROM ${table};`);
    db2.exec(`DROP TABLE ${table};`);
    db2.exec(`ALTER TABLE ${tmpName} RENAME TO ${table};`);
    db2.exec(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (err) {
    try {
      db2.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch {
    }
    try {
      db2.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
    }
    throw err;
  }
}
function migrateCheckConstraints(db2) {
  const drifted = [];
  for (const [table, canonSql] of canonicalTableSql()) {
    const live = db2.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!live?.sql) continue;
    if (checkClauses(live.sql) !== checkClauses(canonSql)) drifted.push([table, canonSql]);
  }
  if (drifted.length === 0) return;
  db2.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const [table, canonSql] of drifted) rebuildTableFromCanonical(db2, table, canonSql);
  } finally {
    db2.exec("PRAGMA foreign_keys = ON");
  }
}
function migrateRefinementQualityConstraint(db2) {
  const row = db2.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='refinements'"
  ).get();
  if (!row?.sql || row.sql.includes("'instructions'")) return;
  db2.exec("SAVEPOINT migrate_refinement_quality_constraint");
  try {
    db2.exec(`
      DROP TABLE IF EXISTS refinements_migration_new;
      CREATE TABLE refinements_migration_new (
        refinement_id  TEXT PRIMARY KEY,
        agent_id       TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        artifact       TEXT,
        repo           TEXT,
        ref            TEXT,
        files_json     TEXT NOT NULL DEFAULT '[]',
        reasoning      TEXT NOT NULL,
        remember       TEXT NOT NULL,
        quality        TEXT NOT NULL CHECK(quality IN ('good','bad','handoff','instructions')) DEFAULT 'good',
        state          TEXT NOT NULL CHECK(state IN ('open','ongoing','done')) DEFAULT 'open',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      INSERT INTO refinements_migration_new (
        refinement_id, agent_id, workspace_path, artifact, repo, ref,
        files_json, reasoning, remember, quality, state, created_at, updated_at
      )
      SELECT
        refinement_id, agent_id, workspace_path, artifact, repo, ref,
        files_json, reasoning, remember, quality, state, created_at, updated_at
      FROM refinements;
      DROP TABLE refinements;
      ALTER TABLE refinements_migration_new RENAME TO refinements;
    `);
    db2.exec("RELEASE SAVEPOINT migrate_refinement_quality_constraint");
  } catch (err) {
    try {
      db2.exec("ROLLBACK TO SAVEPOINT migrate_refinement_quality_constraint");
    } catch {
    }
    try {
      db2.exec("RELEASE SAVEPOINT migrate_refinement_quality_constraint");
    } catch {
    }
    throw err;
  }
}
function hasFts(db2) {
  const row = db2.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memories_fts'"
  ).get();
  return Boolean(row);
}
function ftsTermsForRow(row) {
  const tags = parseJsonList(row.tags_json);
  const label = (row.label ?? "OTHER").toLowerCase();
  return [...tags, label, ...row.references ?? []].filter(Boolean).join(" ");
}
function rebuildFts(db2) {
  db2.exec("SAVEPOINT rebuild_fts");
  try {
    db2.exec("DELETE FROM memories_fts");
    const rows = db2.prepare(
      "SELECT memory_id, task_context, observation, tags_json, label FROM memories"
    ).all();
    if (rows.length > 0) {
      const refs = db2.prepare(
        `SELECT r.memory_id, r.reference
         FROM memory_refs r
         JOIN memories m ON m.memory_id = r.memory_id
         ORDER BY r.memory_id, r.ordinal`
      ).all();
      const refsByMemory = /* @__PURE__ */ new Map();
      for (const ref of refs) {
        const list = refsByMemory.get(ref.memory_id) ?? [];
        list.push(ref.reference);
        refsByMemory.set(ref.memory_id, list);
      }
      for (const row of rows) row.references = refsByMemory.get(row.memory_id) ?? [];
    }
    const insert = db2.prepare(
      "INSERT INTO memories_fts(memory_id, task_context, observation, tags) VALUES (?, ?, ?, ?)"
    );
    for (const row of rows) {
      insert.run(row.memory_id, row.task_context, row.observation, ftsTermsForRow(row));
    }
    db2.exec("RELEASE SAVEPOINT rebuild_fts");
  } catch (e) {
    try {
      db2.exec("ROLLBACK TO SAVEPOINT rebuild_fts");
    } catch {
    }
    try {
      db2.exec("RELEASE SAVEPOINT rebuild_fts");
    } catch {
    }
    throw e;
  }
}
function evictExpiredLocks(db2) {
  const now = utcNow();
  const stale = db2.prepare(
    "SELECT COUNT(*) AS c FROM locks WHERE expires_at IS NOT NULL AND expires_at <= ?"
  ).get(now);
  if (stale.c === 0) return { pruned_locks: 0, updated_runs: 0 };
  db2.exec("SAVEPOINT evict_expired_locks");
  try {
    db2.exec("CREATE TEMP TABLE IF NOT EXISTS temp_expired_lock_runs(run_id TEXT PRIMARY KEY)");
    db2.exec("DELETE FROM temp_expired_lock_runs");
    db2.prepare(
      `INSERT OR IGNORE INTO temp_expired_lock_runs(run_id)
       SELECT run_id FROM locks WHERE expires_at IS NOT NULL AND expires_at <= ?`
    ).run(now);
    const deleteRes = db2.prepare(
      "DELETE FROM locks WHERE expires_at IS NOT NULL AND expires_at <= ?"
    ).run(now);
    const updateRes = db2.prepare(
      `UPDATE task_runs
       SET status = 'PENDING', updated_at = ?
       WHERE status = 'ACTIVE'
         AND run_id IN (SELECT run_id FROM temp_expired_lock_runs)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE locks.run_id = task_runs.run_id)`
    ).run(now);
    db2.exec("DELETE FROM temp_expired_lock_runs");
    db2.exec("RELEASE SAVEPOINT evict_expired_locks");
    return { pruned_locks: deleteRes.changes, updated_runs: updateRes.changes };
  } catch (e) {
    try {
      db2.exec("ROLLBACK TO SAVEPOINT evict_expired_locks");
    } catch {
    }
    try {
      db2.exec("RELEASE SAVEPOINT evict_expired_locks");
    } catch {
    }
    throw e;
  }
}

// src/intents.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { isAbsolute, resolve as resolve4 } from "node:path";
var MAX_LOCK_TTL_MS = 10 * 6e4;
var VALID_RELEASE_STATUSES = /* @__PURE__ */ new Set(["PENDING", "ACTIVE", "SUCCESS", "FAILED"]);
function effectiveTtlMs(ttlMs) {
  return Math.min(Math.max(1, ttlMs ?? MAX_LOCK_TTL_MS), MAX_LOCK_TTL_MS);
}
function expiresAtFromNow(ttlMs) {
  return new Date(Date.now() + effectiveTtlMs(ttlMs)).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function workspaceScopeRoot(workspacePath) {
  const candidate = workspacePath ?? process.cwd();
  return normalizeWorkspacePath(candidate, candidate) ?? resolve4(candidate);
}
function workspaceFileBase(workspacePath) {
  return workspacePath ? resolve4(workspacePath) : process.cwd();
}
function resolveTargetFiles(targetFiles = [], workspacePath) {
  const root = workspaceFileBase(workspacePath);
  return targetFiles.map((file) => isAbsolute(file) ? resolve4(file) : resolve4(root, file));
}
function preFlightIntent(db2, params) {
  const {
    agentId: agentId2 = "agent",
    sessionId: sessionId2 = null,
    workspacePath,
    artifact: artifact2,
    runId: requestedRunId = null,
    rationale = "agent write operation",
    testPlan = "post-edit verification",
    contextRef = null,
    targetFiles = [],
    lockType = "EXCLUSIVE",
    ttlMs = MAX_LOCK_TTL_MS
  } = params;
  const runId = requestedRunId ?? `run_${randomUUID2().replace(/-/g, "")}`;
  const now = utcNow();
  const wsPath = workspaceScopeRoot(workspacePath);
  const artifactScope = normalizeArtifact(artifact2);
  const absFiles = resolveTargetFiles(targetFiles, workspacePath);
  let linkedTaskId = null;
  let effectiveContextRef = contextRef;
  evictExpiredLocks(db2);
  db2.exec("BEGIN IMMEDIATE");
  try {
    const conflicts = [];
    for (const absPath of absFiles) {
      const conflictMode = lockType === "SHARED" ? "fl.lock_type = 'EXCLUSIVE'" : "1 = 1";
      const existing = db2.prepare(`
        SELECT fl.*, ai.agent_id AS run_agent_id,
               ai.rationale AS reasoning, ai.test_plan AS test_plan
          FROM locks fl
        JOIN task_runs ai ON ai.run_id = fl.run_id
        WHERE fl.file_path = ?
          AND ai.agent_id <> ?
          AND ai.status = 'ACTIVE'
          AND ${conflictMode}
          AND (fl.expires_at IS NULL OR fl.expires_at > ?)
      `).all(absPath, agentId2, now);
      conflicts.push(...existing);
    }
    if (conflicts.length > 0) {
      db2.exec("ROLLBACK");
      return {
        ok: false,
        conflict: true,
        conflicts: conflicts.map((c) => {
          const holderSession = c.session_id ? db2.prepare("SELECT ended_at FROM sessions WHERE session_id = ?").get(c.session_id) : void 0;
          const holderSessionActive = !holderSession || holderSession.ended_at == null;
          return {
            file_path: c.file_path,
            lock_type: c.lock_type,
            agent_id: c.run_agent_id ?? c.agent_id,
            acquired_at: c.acquired_at,
            expires_at: c.expires_at,
            // Surface the holder's who/why so a blocked agent can act on it.
            run_id: c.run_id,
            reasoning: c.reasoning ?? "agent write operation",
            test_plan: c.test_plan ?? "post-edit verification",
            session_id: c.session_id ?? null,
            holder_session_active: holderSessionActive
          };
        })
      };
    }
    if (sessionId2) {
      db2.prepare(
        `INSERT OR IGNORE INTO sessions (session_id, agent_id, workspace_path, artifact, started_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(sessionId2, agentId2, wsPath, artifactScope, now);
    }
    if (requestedRunId) {
      const existingRun = db2.prepare(
        "SELECT task_id, agent_id, status, context_ref, files_json FROM task_runs WHERE run_id = ?"
      ).get(requestedRunId);
      if (!existingRun) throw new Error(`run not found: ${requestedRunId}`);
      if (existingRun.agent_id !== agentId2) throw new Error(`run ${requestedRunId} belongs to ${existingRun.agent_id}`);
      if (existingRun.status !== "ACTIVE") throw new Error(`run ${requestedRunId} is not ACTIVE`);
      linkedTaskId = existingRun.task_id;
      effectiveContextRef = existingRun.context_ref;
      const previousFiles = JSON.parse(existingRun.files_json || "[]");
      db2.prepare("UPDATE task_runs SET files_json = ?, updated_at = ? WHERE run_id = ?").run(JSON.stringify([.../* @__PURE__ */ new Set([...previousFiles, ...absFiles])]), now, runId);
    } else {
      db2.prepare(`
        INSERT INTO task_runs
          (run_id, task_id, agent_id, session_id, rationale, test_plan, context_ref, status, workspace_path, artifact, files_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
      `).run(runId, null, agentId2, sessionId2, rationale, testPlan, contextRef, wsPath, artifactScope, JSON.stringify(absFiles), now, now);
    }
    const expiresAt = expiresAtFromNow(ttlMs);
    const acquiredLocks = [];
    for (const absPath of absFiles) {
      const lockId = "lock_" + randomUUID2().replace(/-/g, "");
      db2.prepare(`
        INSERT OR REPLACE INTO locks
          (lock_id, file_path, run_id, agent_id, session_id, lock_type, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lockId, absPath, runId, agentId2, sessionId2, lockType, now, expiresAt);
      acquiredLocks.push({ lock_id: lockId, file_path: absPath, lock_type: lockType, expires_at: expiresAt });
    }
    db2.exec("COMMIT");
    return {
      ok: true,
      run: {
        run_id: runId,
        task_id: linkedTaskId,
        agent_id: agentId2,
        session_id: sessionId2,
        lock_type: lockType,
        workspace_path: wsPath,
        artifact: artifactScope,
        context_ref: effectiveContextRef,
        target_files: absFiles,
        locks: acquiredLocks.map((l) => ({
          lock_id: l.lock_id,
          file_path: l.file_path,
          lock_type: l.lock_type,
          agent_id: agentId2,
          session_id: sessionId2,
          acquired_at: now,
          expires_at: l.expires_at
        })),
        status: "ACTIVE",
        created_at: now
      }
    };
  } catch (e) {
    try {
      db2.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
}
function releaseFileLock(db2, params) {
  const {
    agentId: agentId2 = "agent",
    sessionId: sessionId2 = null,
    workspacePath = null,
    artifact: artifact2 = null,
    runId = null,
    targetFiles = [],
    status: statusArg = "SUCCESS",
    verified = false,
    verifiedNote
  } = params;
  if (!VALID_RELEASE_STATUSES.has(String(statusArg))) {
    throw new Error(`releaseFileLock status must be ACTIVE, PENDING, SUCCESS, or FAILED; got "${statusArg}"`);
  }
  const requestedStatus = String(statusArg);
  const requestedSuccessWithoutVerification = requestedStatus === "SUCCESS" && !verified;
  const effectiveStatus = requestedSuccessWithoutVerification ? "PENDING" : requestedStatus;
  const now = utcNow();
  const whereClauses = ["fl.agent_id = ?"];
  const whereParams = [agentId2];
  if (sessionId2) {
    whereClauses.push("fl.session_id = ?");
    whereParams.push(sessionId2);
  }
  const artifactScope = normalizeArtifact(artifact2);
  if (workspacePath || artifactScope) {
    whereClauses.push("ai.run_id = fl.run_id");
  }
  if (workspacePath) {
    whereClauses.push("ai.workspace_path = ?");
    whereParams.push(workspaceScopeRoot(workspacePath));
  }
  if (artifactScope) {
    whereClauses.push("(ai.artifact = ? OR ai.artifact IS NULL)");
    whereParams.push(artifactScope);
  }
  if (runId) {
    whereClauses.push("fl.run_id = ?");
    whereParams.push(runId);
  }
  const absFiles = resolveTargetFiles(targetFiles, workspacePath);
  if (absFiles.length > 0) {
    const ph = absFiles.map(() => "?").join(",");
    whereClauses.push(`fl.file_path IN (${ph})`);
    whereParams.push(...absFiles);
  }
  const where = whereClauses.join(" AND ");
  const locks = db2.prepare(
    `SELECT fl.lock_id, fl.run_id, fl.file_path
       FROM locks fl${workspacePath || artifactScope ? ", task_runs ai" : ""}
      WHERE ${where}`
  ).all(...whereParams);
  const runIds = [...new Set(locks.map((l) => l.run_id))];
  const ambiguousRelease = !runId && absFiles.length > 0 && runIds.length > 1;
  if (ambiguousRelease) {
    return {
      agent_id: agentId2,
      status: effectiveStatus,
      released: false,
      locks_released: 0,
      run_ids: runIds,
      updated_at: now,
      ambiguousRelease: "target-file release matched multiple active runs; pass --run-id to release exactly one run"
    };
  }
  if (locks.length === 0) {
    return {
      agent_id: agentId2,
      status: effectiveStatus,
      released: false,
      locks_released: 0,
      run_ids: [],
      updated_at: now
    };
  }
  db2.exec("BEGIN IMMEDIATE");
  try {
    const lockIds = locks.map((lock) => lock.lock_id);
    db2.prepare(`DELETE FROM locks WHERE lock_id IN (${lockIds.map(() => "?").join(",")})`).run(...lockIds);
    for (const tid of runIds) {
      const remaining = db2.prepare("SELECT 1 FROM locks WHERE run_id = ? LIMIT 1").get(tid);
      if (!remaining) {
        db2.prepare(
          "UPDATE task_runs SET status = ?, updated_at = ? WHERE run_id = ? AND agent_id = ?"
        ).run(effectiveStatus, now, tid, agentId2);
        if (verified && verifiedNote) {
          try {
            db2.prepare(
              `INSERT INTO run_log(event_id, run_id, agent_id, event_type, message, created_at)
               VALUES (?, ?, ?, 'VERIFIED', ?, ?)`
            ).run("evt_" + randomUUID2().replace(/-/g, ""), tid, agentId2, verifiedNote, now);
          } catch {
          }
        }
      }
    }
    db2.exec("COMMIT");
  } catch (e) {
    try {
      db2.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
  return {
    agent_id: agentId2,
    status: effectiveStatus,
    released: locks.length > 0,
    locks_released: locks.length,
    run_ids: runIds,
    updated_at: now,
    ...requestedSuccessWithoutVerification ? { unverifiedConclusion: "SUCCESS requested without --verified; stored as PENDING until verify records the test result." } : {}
  };
}

// src/tasks.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { isAbsolute as isAbsolute2, relative, resolve as resolve5, sep } from "node:path";
var DEFAULT_CLAIM_LEASE_MS = 30 * 6e4;
var MAX_CLAIM_LEASE_MS = 60 * 6e4;
function event(db2, taskId, runId, agentId2, eventType, message, now = utcNow()) {
  db2.prepare(`INSERT INTO task_events(event_id, task_id, run_id, agent_id, event_type, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(`tevt_${randomUUID3().replace(/-/g, "")}`, taskId, runId, agentId2, eventType, message, now);
}
function evictExpiredTaskClaims(db2, now = utcNow()) {
  const expired = db2.prepare(
    "SELECT task_id, run_id, agent_id FROM task_claims WHERE expires_at <= ?"
  ).all(now);
  for (const claim of expired) {
    db2.prepare("DELETE FROM locks WHERE run_id = ?").run(claim.run_id);
    db2.prepare("UPDATE task_runs SET status = 'FAILED', updated_at = ? WHERE run_id = ? AND status = 'ACTIVE'").run(now, claim.run_id);
    db2.prepare("UPDATE tasks SET status = 'OPEN', updated_at = ? WHERE task_id = ? AND status = 'IN_PROGRESS'").run(now, claim.task_id);
    db2.prepare("DELETE FROM task_claims WHERE task_id = ?").run(claim.task_id);
    event(db2, claim.task_id, claim.run_id, claim.agent_id, "CLAIM_EXPIRED", "claim lease expired", now);
  }
}
function activeTaskClaimForAgent(db2, params) {
  evictExpiredTaskClaims(db2);
  const workspacePath = normalizeWorkspacePath(params.workspacePath, params.workspacePath) ?? resolve5(params.workspacePath);
  const where = ["c.agent_id = ?", "p.workspace_path = ?", "c.expires_at > ?"];
  const binds = [params.agentId, workspacePath, utcNow()];
  if (params.artifact) {
    where.push("(p.artifact = ? OR p.artifact IS NULL)");
    binds.push(params.artifact);
  }
  const claims = db2.prepare(`SELECT c.* FROM task_claims c
    JOIN tasks t ON t.task_id = c.task_id
    JOIN plans p ON p.plan_id = t.plan_id
    WHERE ${where.join(" AND ")} ORDER BY c.claimed_at DESC LIMIT 2`).all(...binds);
  return claims.length === 1 ? claims[0] : null;
}

// src/verify.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// src/sql/runs.ts
var RUNS_UPDATE_PENDING_TO_FAILED = `UPDATE task_runs SET status = 'FAILED', updated_at = ? WHERE run_id = ? AND status = 'PENDING'`;
var RUNS_UPDATE_ACTIVE_TO_FAILED = `UPDATE task_runs SET status = 'FAILED', updated_at = ? WHERE run_id = ? AND status = 'ACTIVE'`;
var RUN_LOG_INSERT_ABANDONED = `INSERT INTO run_log(event_id, run_id, agent_id, event_type, message, created_at)
   VALUES (?, ?, ?, 'ABANDONED', 'orphaned by audit-unverified --abandon', ?)`;
var RUN_LOG_INSERT_STALE_ABANDONED = `INSERT INTO run_log(event_id, run_id, agent_id, event_type, message, created_at)
   VALUES (?, ?, ?, 'ABANDONED', 'stale active (no live locks) abandoned by audit-unverified --abandon', ?)`;

// src/verify.ts
function abandonLinkedTask(db2, runId, agentId2, now, message) {
  const linked = db2.prepare("SELECT task_id FROM task_runs WHERE run_id = ?").get(runId);
  if (!linked?.task_id) return;
  const updated = db2.prepare(`UPDATE tasks SET status = 'FAILED', updated_at = ?, completed_at = ?
    WHERE task_id = ? AND status IN ('IN_PROGRESS', 'VERIFY')`).run(now, now, linked.task_id);
  if (updated.changes === 0) return;
  db2.prepare("DELETE FROM task_claims WHERE task_id = ?").run(linked.task_id);
  db2.prepare(`INSERT INTO task_events(event_id, task_id, run_id, agent_id, event_type, message, created_at)
    VALUES (?, ?, ?, ?, 'ABANDONED', ?, ?)`).run(`tevt_${randomUUID4().replace(/-/g, "")}`, linked.task_id, runId, agentId2, message, now);
}
function auditUnverified(db2, params = {}) {
  const workspacePath = params.workspacePath ? normalizeWorkspacePath(params.workspacePath, params.workspacePath) : null;
  const where = ["status = 'PENDING'"];
  const binds = [];
  if (params.agentId) {
    where.push("agent_id = ?");
    binds.push(params.agentId);
  }
  if (workspacePath) {
    where.push("workspace_path = ?");
    binds.push(workspacePath);
  }
  const artifact2 = normalizeArtifact(params.artifact);
  if (artifact2) {
    where.push("(artifact = ? OR artifact IS NULL)");
    binds.push(artifact2);
  }
  const rows = db2.prepare(
    `SELECT run_id, agent_id, status, test_plan, context_ref, rationale, workspace_path, artifact, files_json, created_at
     FROM task_runs
     WHERE ${where.join(" AND ")}
     ORDER BY created_at ASC`
  ).all(...binds);
  const unverified = rows.map((r) => ({
    run_id: r.run_id,
    agent_id: r.agent_id,
    status: r.status,
    test_plan: r.test_plan,
    context_ref: r.context_ref,
    rationale: r.rationale,
    target_files: parseJsonList(r.files_json),
    workspace_path: r.workspace_path,
    artifact: r.artifact,
    created_at: r.created_at
  }));
  if (params.abandon && unverified.length > 0) {
    const now = utcNow();
    for (const intent of unverified) {
      db2.prepare(RUNS_UPDATE_PENDING_TO_FAILED).run(now, intent.run_id);
      abandonLinkedTask(db2, intent.run_id, intent.agent_id, now, "pending run abandoned by verification audit");
      try {
        db2.prepare(RUN_LOG_INSERT_ABANDONED).run(
          "evt_" + randomUUID4().replace(/-/g, ""),
          intent.run_id,
          intent.agent_id,
          now
        );
      } catch {
      }
    }
  }
  const staleActive = [];
  try {
    const nowIso = utcNow();
    const staleWhere = [
      "ai.status = 'ACTIVE'",
      // Exclude tasks that never had any files to claim: a zero-target-file task
      // holds no locks by construction, so it would otherwise be reported as
      // "stale_active" the instant it is created (age ~0h) — a false positive
      // that blocks the Stop/conclude gate. Real orphaned work always has files.
      "COALESCE(ai.files_json,'[]') NOT IN ('[]','null','')",
      `NOT EXISTS (
        SELECT 1 FROM locks fl
        WHERE fl.run_id = ai.run_id
          AND (fl.expires_at IS NULL OR fl.expires_at > ?)
      )`,
      `NOT EXISTS (
        SELECT 1 FROM task_claims tc
        WHERE tc.run_id = ai.run_id AND tc.expires_at > ?
      )`
    ];
    const staleBinds = [nowIso, nowIso];
    if (params.agentId) {
      staleWhere.push("ai.agent_id = ?");
      staleBinds.push(params.agentId);
    }
    if (workspacePath) {
      staleWhere.push("ai.workspace_path = ?");
      staleBinds.push(workspacePath);
    }
    if (artifact2) {
      staleWhere.push("(ai.artifact = ? OR ai.artifact IS NULL)");
      staleBinds.push(artifact2);
    }
    const staleRows = db2.prepare(
      `SELECT ai.run_id, ai.agent_id, ai.rationale, ai.context_ref, ai.workspace_path, ai.artifact, ai.files_json, ai.created_at
       FROM task_runs ai
       WHERE ${staleWhere.join(" AND ")}
       ORDER BY ai.created_at ASC`
    ).all(...staleBinds);
    for (const r of staleRows) {
      const ageMs = Date.now() - new Date(r.created_at).getTime();
      staleActive.push({
        run_id: r.run_id,
        agent_id: r.agent_id,
        status: "ACTIVE",
        rationale: r.rationale,
        context_ref: r.context_ref,
        target_files: parseJsonList(r.files_json),
        workspace_path: r.workspace_path,
        artifact: r.artifact,
        created_at: r.created_at,
        age_hours: Math.round(ageMs / 36e5 * 10) / 10
      });
    }
  } catch (e) {
    if (!(e instanceof Error && e.message.includes("no such table"))) throw e;
  }
  if (params.abandon && staleActive.length > 0) {
    const now = utcNow();
    for (const intent of staleActive) {
      db2.prepare(RUNS_UPDATE_ACTIVE_TO_FAILED).run(now, intent.run_id);
      abandonLinkedTask(db2, intent.run_id, intent.agent_id, now, "stale task run abandoned by verification audit");
      try {
        db2.prepare(RUN_LOG_INSERT_STALE_ABANDONED).run(
          "evt_" + randomUUID4().replace(/-/g, ""),
          intent.run_id,
          intent.agent_id,
          now
        );
      } catch {
      }
    }
  }
  const total = unverified.length + staleActive.length;
  return { ok: true, unverified, stale_active: staleActive, count: total };
}

// src/maintenance.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { randomUUID as randomUUID6 } from "node:crypto";
import { isAbsolute as isAbsolute3, resolve as resolve6 } from "node:path";

// src/notifications.ts
import { randomUUID as randomUUID5 } from "node:crypto";

// src/sql/sessions.ts
var SESSIONS_UPDATE_END = `UPDATE sessions SET ended_at = ?, summary = ? WHERE session_id = ? RETURNING *`;

// src/sql/signals.ts
var SIGNALS_SELECT_BASE = "SELECT n.* FROM signals n";
var SIGNALS_SELECT_LEFT_JOIN_READS = "LEFT JOIN signal_reads nr ON nr.signal_id = n.signal_id AND nr.agent_id = ?";
var SIGNALS_SELECT_ORDER_LIMIT = "ORDER BY n.created_at DESC LIMIT ?";
var SIGNAL_READS_INSERT_IGNORE = "INSERT OR IGNORE INTO signal_reads(signal_id, agent_id, read_at) VALUES (?, ?, ?)";

// src/sql/refinements.ts
var COLS = "refinement_id, agent_id, workspace_path, artifact, repo, ref, files_json, reasoning, remember, quality, state, created_at, updated_at";
var REFINEMENTS_SELECT_OPEN = `SELECT ${COLS} FROM refinements
   WHERE state IN ('open','ongoing') AND quality NOT IN ('handoff','instructions')
   ORDER BY CASE state WHEN 'ongoing' THEN 0 ELSE 1 END, updated_at DESC`;
var REFINEMENTS_SELECT_BY_WORKSPACE = `SELECT ${COLS} FROM refinements
   WHERE (workspace_path = ? OR workspace_path IS NULL)
   ORDER BY CASE state WHEN 'ongoing' THEN 0 ELSE 1 END, updated_at DESC`;

// src/notifications.ts
function rowToNotification(r) {
  return {
    signal_id: r.signal_id,
    workspace_path: r.workspace_path,
    artifact: r.artifact,
    repo: r.repo,
    ref: r.ref,
    from_agent: r.from_agent,
    to_agent: r.to_agent,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    // ARCH-7: Use shared parseJsonList helper instead of duplicated inline IIFEs
    files: parseJsonList(r.files_json),
    refs: parseJsonList(r.refs_json),
    thread_id: r.thread_id,
    reply_to: r.reply_to,
    importance: r.importance,
    status: r.status,
    created_at: r.created_at
  };
}
function appendSignalScope(where, binds, scope, alias = "n") {
  const prefix = alias ? `${alias}.` : "";
  if (scope.workspace_path) {
    where.push(`(${prefix}workspace_path = ? OR ${prefix}workspace_path IS NULL)`);
    binds.push(scope.workspace_path);
  }
  if (scope.artifact) {
    where.push(`(${prefix}artifact = ? OR ${prefix}artifact IS NULL)`);
    binds.push(scope.artifact);
  }
  if (scope.repo) {
    where.push(`(${prefix}repo = ? OR ${prefix}repo IS NULL)`);
    binds.push(scope.repo);
  }
  if (scope.ref) {
    where.push(`(${prefix}ref = ? OR ${prefix}ref IS NULL)`);
    binds.push(scope.ref);
  }
}
function getNotifications(db2, params) {
  const {
    agentId: agentId2,
    kinds = [],
    threadId = null,
    unreadOnly = true,
    markRead = false,
    limit = 20,
    cwd
  } = params;
  const scope = fillScope(
    { workspace_path: params.workspacePath ?? null, artifact: normalizeArtifact(params.artifact), repo: params.repo ?? null, ref: params.ref ?? null },
    cwd ?? process.cwd()
  );
  const where = [];
  const binds = [];
  appendSignalScope(where, binds, scope);
  if (threadId) {
    where.push("n.thread_id = ?");
    binds.push(threadId);
    if (unreadOnly) {
      where.push("n.status = 'open'");
      where.push("nr.signal_id IS NULL");
    }
  } else {
    where.push("(n.to_agent IS NULL OR n.to_agent = ?)");
    binds.push(agentId2);
    where.push("n.from_agent <> ?");
    binds.push(agentId2);
    if (unreadOnly) {
      where.push("n.status = 'open'");
      where.push("nr.signal_id IS NULL");
    }
  }
  if (kinds.length > 0) {
    where.push(`n.kind IN (${kinds.map(() => "?").join(",")})`);
    binds.push(...kinds);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const joinClause = unreadOnly ? SIGNALS_SELECT_LEFT_JOIN_READS : "";
  const allBinds = unreadOnly ? [agentId2, ...binds] : binds;
  const sql = `
    ${SIGNALS_SELECT_BASE}
    ${joinClause}
    ${whereClause}
    ${SIGNALS_SELECT_ORDER_LIMIT}
  `;
  const rows = db2.prepare(sql).all(...allBinds, limit);
  const signals = rows.map(rowToNotification);
  if (markRead && signals.length > 0) {
    const now = utcNow();
    const insertRead = db2.prepare(SIGNAL_READS_INSERT_IGNORE);
    for (const n of signals) {
      insertRead.run(n.signal_id, agentId2, now);
    }
  }
  return { count: signals.length, signals, unread_only: unreadOnly };
}

// src/maintenance.ts
var SESSION_CAPTURE_FILE_LIMIT = 40;
var SESSION_CAPTURE_VISIBLE_FILE_LIMIT = 20;
var SESSION_CAPTURE_RUN_DETAIL_LIMIT = 8;
var SESSION_CAPTURE_RUN_FILE_LIMIT = 8;
var SESSION_CAPTURE_TEXT_LIMIT = 180;
function compactText(value, max = SESSION_CAPTURE_TEXT_LIMIT) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}
function listSummary(label, items, visibleLimit = SESSION_CAPTURE_VISIBLE_FILE_LIMIT) {
  if (items.length === 0) return null;
  const shown = items.slice(0, visibleLimit);
  const omitted = items.length - shown.length;
  return `${label}${omitted > 0 ? ` (showing ${shown.length} of ${items.length})` : ""}: ${shown.join(", ")}${omitted > 0 ? `; ${omitted} omitted` : ""}.`;
}
function pruneStale(db2, params = {}) {
  const dryRun = Boolean(params.dry_run ?? params.dryRun);
  const expiredOnly = Boolean(params.expired_only ?? params.expiredOnly);
  const olderThanMinutes = params.older_than_minutes != null ? Number(params.older_than_minutes) : params.olderThanMinutes != null ? Number(params.olderThanMinutes) : null;
  const agentId2 = typeof params.agent_id === "string" ? params.agent_id : typeof params.agentId === "string" ? params.agentId : null;
  const rawWorkspacePath = typeof params.workspace === "string" ? params.workspace : typeof params.workspace_path === "string" ? params.workspace_path : typeof params.workspacePath === "string" ? params.workspacePath : null;
  const workspacePath = rawWorkspacePath ? normalizeWorkspacePath(rawWorkspacePath, rawWorkspacePath) : null;
  const artifact2 = normalizeArtifact(params.artifact);
  const rawTarget = params.target_file ?? params.targetFile;
  const targetFiles = (Array.isArray(rawTarget) ? rawTarget : rawTarget != null ? [rawTarget] : []).map(String).filter(Boolean).map((file) => {
    const base = rawWorkspacePath ? resolve6(rawWorkspacePath) : process.cwd();
    return isAbsolute3(file) ? resolve6(file) : resolve6(base, file);
  });
  const now = utcNow();
  const ageCutoff = olderThanMinutes != null && !expiredOnly ? new Date(Date.now() - olderThanMinutes * 6e4).toISOString() : null;
  const conditions = [];
  const binds = [];
  const staleClauses = ["(l.expires_at IS NOT NULL AND l.expires_at < ?)"];
  binds.push(now);
  if (ageCutoff) {
    staleClauses.push("(l.acquired_at < ?)");
    binds.push(ageCutoff);
  }
  conditions.push(`(${staleClauses.join(" OR ")})`);
  if (agentId2) {
    conditions.push("l.agent_id = ?");
    binds.push(agentId2);
  }
  if (targetFiles.length > 0) {
    conditions.push(`l.file_path IN (${targetFiles.map(() => "?").join(",")})`);
    binds.push(...targetFiles);
  }
  const scopedByTask = Boolean(workspacePath || artifact2);
  if (workspacePath) {
    conditions.push("t.workspace_path = ?");
    binds.push(workspacePath);
  }
  if (artifact2) {
    conditions.push("(t.artifact = ? OR t.artifact IS NULL)");
    binds.push(artifact2);
  }
  const where = conditions.join(" AND ");
  const from = scopedByTask ? "locks l JOIN task_runs t ON t.run_id = l.run_id" : "locks l";
  let staleLocks = [];
  try {
    staleLocks = db2.prepare(
      `SELECT l.lock_id, l.run_id FROM ${from} WHERE ${where}`
    ).all(...binds);
  } catch {
  }
  if (dryRun) {
    return { pruned_locks: 0, updated_runs: 0, dry_run: true, would_prune: staleLocks.length };
  }
  if (staleLocks.length === 0) {
    return { pruned_locks: 0, updated_runs: 0 };
  }
  let updatedRuns = 0;
  db2.exec("BEGIN IMMEDIATE");
  try {
    staleLocks = db2.prepare(
      `SELECT l.lock_id, l.run_id FROM ${from} WHERE ${where}`
    ).all(...binds);
    if (staleLocks.length === 0) {
      db2.exec("COMMIT");
      return { pruned_locks: 0, updated_runs: 0 };
    }
    const affectedRunIds = [...new Set(staleLocks.map((l) => l.run_id))];
    const ph = staleLocks.map(() => "?").join(",");
    db2.prepare(`DELETE FROM locks WHERE lock_id IN (${ph})`).run(...staleLocks.map((l) => l.lock_id));
    for (const tid of affectedRunIds) {
      const remaining = db2.prepare("SELECT 1 FROM locks WHERE run_id = ? LIMIT 1").get(tid);
      if (!remaining) {
        const r = db2.prepare(
          "UPDATE task_runs SET status = 'PENDING', updated_at = ? WHERE run_id = ? AND status = 'ACTIVE'"
        ).run(now, tid);
        if (r.changes) updatedRuns++;
      }
    }
    db2.exec("COMMIT");
  } catch (e) {
    try {
      db2.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
  return { pruned_locks: staleLocks.length, updated_runs: updatedRuns };
}
function openRefinementCount(db2, params = {}) {
  const scope = fillScope(
    { workspace_path: params.workspacePath ?? null, artifact: normalizeArtifact(params.artifact), repo: params.repo ?? null, ref: params.ref ?? null },
    params.cwd ?? process.cwd()
  );
  const queryParams = [];
  let sql = "SELECT COUNT(*) AS c FROM refinements WHERE state IN ('open','ongoing')";
  if (!params.includeHandoffs) sql += " AND quality NOT IN ('handoff','instructions')";
  if (scope.workspace_path) {
    sql += " AND (workspace_path = ? OR workspace_path IS NULL)";
    queryParams.push(scope.workspace_path);
  }
  if (scope.artifact) {
    sql += " AND (artifact = ? OR artifact IS NULL)";
    queryParams.push(scope.artifact);
  }
  if (scope.repo) {
    sql += " AND (repo = ? OR repo IS NULL)";
    queryParams.push(scope.repo);
  }
  if (scope.ref) {
    sql += " AND (ref = ? OR ref IS NULL)";
    queryParams.push(scope.ref);
  }
  return db2.prepare(sql).get(...queryParams).c;
}
var BRIEFING_LABELS = ["GOTCHA", "BUG", "DECISION", "IMPROVEMENT", "ARCHITECTURE", "SECURITY"];
function notifyGet(db2, params = {}) {
  const wsPath = params.workspace ?? null;
  const artifact2 = normalizeArtifact(params.artifact);
  const format = params.format ?? "json";
  const agentId2 = String(params.agent_id ?? params.agentId ?? "agent");
  const notifyCwd = wsPath ?? params.cwd ?? process.cwd();
  const items = [];
  try {
    const inbox = getNotifications(db2, {
      agentId: agentId2,
      workspacePath: wsPath,
      artifact: artifact2,
      unreadOnly: true,
      markRead: false,
      limit: 5,
      cwd: notifyCwd
    });
    for (const n of inbox.signals) {
      const target = n.to_agent ? `to ${n.to_agent}` : "broadcast";
      const fileSuffix = n.files.length > 0 ? ` files=${n.files.join(", ")}` : "";
      const bodySuffix = n.body ? ` \u2014 ${n.body.slice(0, 120)}` : "";
      items.push({
        kind: "notification",
        text: `\u{1F4E8} ${n.kind} from ${n.from_agent} (${target}): ${n.subject}${bodySuffix}${fileSuffix}`,
        importance: n.importance
      });
    }
  } catch {
  }
  try {
    const overrideConds = ["state = 'ACTIVE'", "label = 'OVERRIDE'"];
    const overrideBinds = [];
    if (wsPath) {
      overrideConds.push("(workspace_path = ? OR workspace_path IS NULL)");
      overrideBinds.push(wsPath);
    }
    if (artifact2) {
      overrideConds.push("(artifact = ? OR artifact IS NULL)");
      overrideBinds.push(artifact2);
    }
    const overrideRows = db2.prepare(
      `SELECT memory_id, observation, importance
       FROM memories
       WHERE ${overrideConds.join(" AND ")}
       ORDER BY importance DESC, last_accessed_at DESC
       LIMIT 2`
    ).all(...overrideBinds);
    for (const m of overrideRows) {
      items.push({
        kind: "memory",
        text: `OVERRIDE(${m.importance}): ${m.observation.slice(0, 120)}`,
        importance: m.importance
      });
    }
  } catch {
  }
  try {
    const conditions = [
      "state = 'ACTIVE'",
      "importance >= 6",
      `label IN (${BRIEFING_LABELS.map(() => "?").join(",")})`
    ];
    const bindParams = [...BRIEFING_LABELS];
    if (wsPath) {
      conditions.push("(workspace_path = ? OR workspace_path IS NULL)");
      bindParams.push(wsPath);
    }
    if (artifact2) {
      conditions.push("(artifact = ? OR artifact IS NULL)");
      bindParams.push(artifact2);
    }
    const memRows = db2.prepare(
      `SELECT memory_id, observation, label, importance
       FROM memories
       WHERE ${conditions.join(" AND ")}
       ORDER BY importance DESC, last_accessed_at DESC
       LIMIT 3`
    ).all(...bindParams);
    for (const m of memRows) {
      items.push({
        kind: "memory",
        text: `${m.label}(${m.importance}): ${m.observation.slice(0, 120)}`,
        importance: m.importance
      });
    }
  } catch {
  }
  try {
    const wkConditions = ["failure_signature IS NOT NULL", "state = 'ACTIVE'"];
    const wkParams = [];
    if (wsPath) {
      wkConditions.push("(workspace_path = ? OR workspace_path IS NULL)");
      wkParams.push(wsPath);
    }
    if (artifact2) {
      wkConditions.push("(artifact = ? OR artifact IS NULL)");
      wkParams.push(artifact2);
    }
    const topWk = db2.prepare(
      `SELECT failure_signature, count(*) AS freq, avg(importance) AS avg_imp
       FROM memories
       WHERE ${wkConditions.join(" AND ")}
       GROUP BY failure_signature HAVING freq >= 2
       ORDER BY freq * avg_imp DESC LIMIT 1`
    ).get(...wkParams);
    if (topWk) {
      items.push({
        kind: "weakness",
        text: `\u26A0\uFE0F Recurring: ${topWk.failure_signature} (${topWk.freq}x, avg imp ${Math.round(topWk.avg_imp)})`
      });
    }
  } catch {
  }
  try {
    const refCount = openRefinementCount(db2, { workspacePath: wsPath, artifact: artifact2, cwd: notifyCwd });
    if (refCount > 0) {
      items.push({ kind: "refinement", text: `\u{1F4CB} ${refCount} open refinement(s) pending` });
    }
  } catch {
  }
  if (items.length === 0) {
    return { ok: true, count: 0, notifications: [] };
  }
  const result = {
    ok: true,
    count: items.length,
    notifications: items
  };
  if (format === "hook") {
    const lines = [
      `\u{1F9E0} Memory brief (${items.length}):`,
      ...items.map((i) => `  \u2022 ${i.text}`)
    ];
    result.additionalContext = lines.join("\n");
  }
  return result;
}
function parseGitStatusShortLines(stdout) {
  const files = [];
  for (const rawLine of String(stdout).split("\n")) {
    if (!rawLine || rawLine.length < 4) continue;
    const xy = rawLine.slice(0, 2);
    let pathPart = rawLine.slice(3);
    if (xy.includes("R") || xy.includes("C")) {
      const arrow = pathPart.indexOf(" -> ");
      if (arrow >= 0) pathPart = pathPart.slice(arrow + 4);
    }
    const filePath = pathPart.trim();
    if (filePath) files.push(filePath);
  }
  return files;
}
function gitDirtyFiles(workspacePath) {
  if (!workspacePath) return [];
  try {
    const result = spawnSync2("git", ["-C", workspacePath, "status", "--porcelain=v1"], {
      encoding: "utf8",
      timeout: 5e3
    });
    if (result.status !== 0) return [];
    return parseGitStatusShortLines(String(result.stdout));
  } catch {
    return [];
  }
}
function sessionCapture(db2, params = {}) {
  const agentId2 = String(params.agent_id ?? params.agentId ?? "agent");
  const reason = params.reason ? String(params.reason) : null;
  const workspaceInput = params.workspace ?? params.workspace_path ?? params.workspacePath;
  const rawWorkspacePath = typeof workspaceInput === "string" && workspaceInput.trim() ? resolve6(workspaceInput.trim()) : null;
  const scope = fillScope(
    {
      workspace_path: rawWorkspacePath,
      artifact: normalizeArtifact(params.artifact),
      repo: params.repo ?? null,
      ref: params.ref ?? null
    },
    params.cwd ?? process.cwd()
  );
  const workspacePath = scope.workspace_path ?? rawWorkspacePath ?? process.cwd();
  const runWorkspaceCandidates = [...new Set([workspacePath, rawWorkspacePath].filter((value) => Boolean(value)))];
  const artifact2 = scope.artifact;
  const workspacePlaceholders = runWorkspaceCandidates.map(() => "?").join(",");
  const runRows = db2.prepare(
    `SELECT run_id, rationale, test_plan, context_ref, status, files_json, created_at, updated_at
     FROM task_runs
     WHERE agent_id = ?
       AND status IN ('ACTIVE', 'PENDING')
       AND (workspace_path IN (${workspacePlaceholders}) OR workspace_path IS NULL)
       AND (? IS NULL OR artifact = ? OR artifact IS NULL)
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 20`
  ).all(agentId2, ...runWorkspaceCandidates, artifact2, artifact2);
  const files = [...new Set(runRows.flatMap((row) => parseJsonList(row.files_json)))];
  const dirtyFiles = gitDirtyFiles(workspacePath);
  const activeRuns = runRows.filter((row) => row.status === "ACTIVE").length;
  const pendingRuns = runRows.filter((row) => row.status === "PENDING").length;
  let consolidationOpportunities = 0;
  try {
    const cConds = ["novelty_score IS NOT NULL", "novelty_score < 0.2", "state = 'ACTIVE'"];
    const cBinds = [];
    if (workspacePath) {
      cConds.push("(workspace_path = ? OR workspace_path IS NULL)");
      cBinds.push(workspacePath);
    }
    if (artifact2) {
      cConds.push("(artifact = ? OR artifact IS NULL)");
      cBinds.push(artifact2);
    }
    consolidationOpportunities = db2.prepare(
      `SELECT COUNT(*) AS c FROM memories WHERE ${cConds.join(" AND ")}`
    ).get(...cBinds).c;
  } catch {
  }
  if (runRows.length === 0 && dirtyFiles.length === 0) {
    return {
      ok: true,
      captured: false,
      refinement_id: null,
      pending_runs: 0,
      active_runs: 0,
      files: [],
      dirty_files: [],
      reason,
      consolidation_opportunities: consolidationOpportunities
    };
  }
  const now = utcNow();
  const refinementId = "ref_" + randomUUID6().replace(/-/g, "");
  const allCapturedFiles = [.../* @__PURE__ */ new Set([...files, ...dirtyFiles])];
  const capturedFiles = allCapturedFiles.slice(0, SESSION_CAPTURE_FILE_LIMIT);
  const capturedDirtyFiles = dirtyFiles.slice(0, SESSION_CAPTURE_FILE_LIMIT);
  const statusSummary = runRows.slice(0, SESSION_CAPTURE_RUN_DETAIL_LIMIT).map((row) => {
    const rowFiles = parseJsonList(row.files_json);
    const shownFiles = rowFiles.slice(0, SESSION_CAPTURE_RUN_FILE_LIMIT);
    const omittedFiles = rowFiles.length - shownFiles.length;
    const fileSuffix = rowFiles.length > 0 ? ` files=${shownFiles.join(", ")}${omittedFiles > 0 ? ` (+${omittedFiles} more)` : ""}` : "";
    const planSuffix = row.context_ref ? ` plan=${row.context_ref}` : "";
    return `${row.status} ${row.run_id}: ${compactText(row.rationale)}; verify=${compactText(row.test_plan)}${planSuffix}${fileSuffix}`;
  });
  const omittedRunDetails = runRows.length - statusSummary.length;
  const reasoning = [
    `Session capture for ${agentId2}${reason ? ` (${reason})` : ""}.`,
    `Unresolved runs: ${runRows.length} (${activeRuns} active, ${pendingRuns} pending).`,
    listSummary("Dirty files", dirtyFiles),
    statusSummary.length > 0 ? `Run details: ${statusSummary.join(" | ")}${omittedRunDetails > 0 ? ` | ${omittedRunDetails} more runs omitted` : ""}` : null
  ].filter(Boolean).join(" ");
  const remember = [
    `Review session handoff for ${agentId2}: ${activeRuns} active and ${pendingRuns} pending runs remain.`,
    listSummary("Touched files", allCapturedFiles),
    dirtyFiles.length > 0 ? "Check dirty git state before continuing." : null,
    pendingRuns > 0 ? "Run the recorded verification before claiming completion." : null
  ].filter(Boolean).join(" ");
  db2.prepare(
    `INSERT INTO refinements (
       refinement_id, agent_id, workspace_path, repo, ref,
       artifact, files_json, reasoning, remember, quality, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'handoff', 'open', ?, ?)`
  ).run(
    refinementId,
    agentId2,
    workspacePath,
    scope.repo,
    scope.ref,
    artifact2,
    JSON.stringify(capturedFiles),
    reasoning,
    remember,
    now,
    now
  );
  return {
    ok: true,
    captured: true,
    refinement_id: refinementId,
    pending_runs: pendingRuns,
    active_runs: activeRuns,
    files: capturedFiles,
    dirty_files: capturedDirtyFiles,
    file_count: allCapturedFiles.length,
    dirty_file_count: dirtyFiles.length,
    omitted_files: Math.max(0, allCapturedFiles.length - capturedFiles.length),
    omitted_dirty_files: Math.max(0, dirtyFiles.length - capturedDirtyFiles.length),
    reason,
    consolidation_opportunities: consolidationOpportunities
  };
}
function digest(db2, params = {}) {
  const retentionDays = Number(params.retention_days ?? 90);
  const handoffRetentionDays = Number(params.refinement_handoff_retention_days ?? params.refinementHandoffRetentionDays ?? 7);
  const doneRetentionDays = Number(params.refinement_done_retention_days ?? params.refinementDoneRetentionDays ?? 30);
  const rawWorkspacePath = typeof params.workspace === "string" ? params.workspace : typeof params.workspace_path === "string" ? params.workspace_path : typeof params.workspacePath === "string" ? params.workspacePath : null;
  const workspacePath = rawWorkspacePath ? normalizeWorkspacePath(rawWorkspacePath, rawWorkspacePath) : null;
  const artifact2 = normalizeArtifact(params.artifact);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
  const handoffCutoff = new Date(Date.now() - handoffRetentionDays * 864e5).toISOString();
  const doneCutoff = new Date(Date.now() - doneRetentionDays * 864e5).toISOString();
  const memoryScope = [];
  const memoryScopeBinds = [];
  if (workspacePath) {
    memoryScope.push("workspace_path = ?");
    memoryScopeBinds.push(workspacePath);
  }
  if (artifact2) {
    memoryScope.push("artifact = ?");
    memoryScopeBinds.push(artifact2);
  }
  const memoryScopeSql = memoryScope.length > 0 ? ` AND ${memoryScope.join(" AND ")}` : "";
  const refinementScope = [];
  const refinementScopeBinds = [];
  if (workspacePath) {
    refinementScope.push("workspace_path = ?");
    refinementScopeBinds.push(workspacePath);
  }
  if (artifact2) {
    refinementScope.push("artifact = ?");
    refinementScopeBinds.push(artifact2);
  }
  const refinementScopeSql = refinementScope.length > 0 ? ` AND ${refinementScope.join(" AND ")}` : "";
  if (params.dry_run) {
    const wouldArchive = db2.prepare(
      `SELECT COUNT(*) AS c FROM memories WHERE valid_to IS NOT NULL AND valid_to < ? AND state = 'ACTIVE'${memoryScopeSql}`
    ).get(now, ...memoryScopeBinds).c;
    const wouldPruneOld = db2.prepare(
      `SELECT COUNT(*) AS c FROM memories WHERE state = 'SUPERSEDED' AND updated_at < ?${memoryScopeSql}`
    ).get(cutoff, ...memoryScopeBinds).c;
    const lockDryRun = pruneStale(db2, {
      ...workspacePath ? { workspace: workspacePath } : {},
      ...artifact2 ? { artifact: artifact2 } : {},
      expired_only: true,
      dry_run: true
    });
    const wouldPruneLocks = lockDryRun.would_prune ?? 0;
    const wouldPruneRefinements = db2.prepare(`SELECT COUNT(*) AS c FROM refinements
       WHERE ((quality = 'handoff' AND updated_at < ?)
          OR (quality IN ('good','bad') AND state = 'done' AND updated_at < ?))${refinementScopeSql}`).get(handoffCutoff, doneCutoff, ...refinementScopeBinds).c;
    return {
      ok: true,
      archived_memories: 0,
      pruned_old: 0,
      pruned_locks: 0,
      pruned_refinements: 0,
      fts_rebuilt: false,
      dry_run: true,
      would_archive: wouldArchive,
      would_prune_old: wouldPruneOld,
      would_prune_locks: wouldPruneLocks,
      would_prune_refinements: wouldPruneRefinements
    };
  }
  const archiveRes = db2.prepare(
    `UPDATE memories
     SET state = 'SUPERSEDED', expired_at = ?, updated_at = ?
     WHERE valid_to IS NOT NULL AND valid_to < ? AND state = 'ACTIVE'${memoryScopeSql}`
  ).run(now, now, now, ...memoryScopeBinds);
  const deleteRes = db2.prepare(
    `DELETE FROM memories
     WHERE state = 'SUPERSEDED' AND updated_at < ?${memoryScopeSql}`
  ).run(cutoff, ...memoryScopeBinds);
  const { pruned_locks } = pruneStale(db2, {
    ...workspacePath ? { workspace: workspacePath } : {},
    ...artifact2 ? { artifact: artifact2 } : {},
    expired_only: true
  });
  const pruneRefinementsRes = db2.prepare(
    `DELETE FROM refinements
     WHERE ((quality = 'handoff' AND updated_at < ?)
        OR (quality IN ('good','bad') AND state = 'done' AND updated_at < ?))${refinementScopeSql}`
  ).run(handoffCutoff, doneCutoff, ...refinementScopeBinds);
  let ftsRebuilt = false;
  try {
    if (hasFts(db2)) {
      rebuildFts(db2);
      ftsRebuilt = true;
    }
  } catch {
  }
  return {
    ok: true,
    archived_memories: archiveRes.changes,
    pruned_old: deleteRes.changes,
    pruned_locks,
    pruned_refinements: pruneRefinementsRes.changes,
    fts_rebuilt: ftsRebuilt
  };
}

// src/sessions.ts
import { randomUUID as randomUUID7 } from "node:crypto";
function endSession(db2, params) {
  const now = utcNow();
  const result = db2.prepare(SESSIONS_UPDATE_END).get(
    now,
    params.summary ?? null,
    params.sessionId
  );
  return result ?? null;
}

// src/pi-hooks.ts
import path from "node:path";
import { spawnSync as spawnSync3 } from "node:child_process";
import { randomUUID as randomUUID8 } from "node:crypto";
import { realpathSync as realpathSync2 } from "node:fs";
var _sessionStartupToken = randomUUID8().slice(0, 8);
function addPathValue(paths, value) {
  if (typeof value === "string" && value.trim().length > 0) {
    paths.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) addPathValue(paths, item);
  }
}
function addApplyPatchPaths(paths, command) {
  if (typeof command !== "string") return;
  for (const line of command.split("\n")) {
    const addUpdDel = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (addUpdDel) {
      paths.push(addUpdDel[1].trim());
      continue;
    }
    const moveTo = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveTo) paths.push(moveTo[1].trim());
  }
}
function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function addQueryPaths(paths, value) {
  if (!Array.isArray(value)) return;
  for (const query of value) {
    const payload = objectOrEmpty(query);
    addPathValue(paths, payload.path);
    addPathValue(paths, payload.filePath);
    addPathValue(paths, payload.file_path);
    addPathValue(paths, payload.paths);
    addPathValue(paths, payload.filePaths);
    addPathValue(paths, payload.file_paths);
  }
}
function extractPiWriteTargetPaths(toolName2, input = {}, options = {}) {
  const normalizedToolName = String(toolName2 ?? "").toLowerCase();
  const isWriteTool = Boolean(options.assumeWrite) || [
    "write",
    "edit",
    "multi_edit",
    "multiedit",
    "notebookedit",
    "notebook_edit",
    "apply_patch",
    "applypatch"
  ].includes(normalizedToolName);
  const payload = objectOrEmpty(input);
  const command = typeof input === "string" ? input : firstString(payload.command, payload.patch);
  if (!isWriteTool) {
    const patchPaths = [];
    addApplyPatchPaths(patchPaths, command);
    return [...new Set(patchPaths)];
  }
  const paths = [];
  addPathValue(paths, payload.path);
  addPathValue(paths, payload.filePath);
  addPathValue(paths, payload.file_path);
  addPathValue(paths, payload.paths);
  addPathValue(paths, payload.filePaths);
  addPathValue(paths, payload.file_paths);
  addQueryPaths(paths, payload.queries);
  addApplyPatchPaths(paths, command);
  return [...new Set(paths)];
}
function canonicalPath(input) {
  const resolved = path.resolve(input);
  try {
    return realpathSync2(resolved);
  } catch {
    const missingParts = [];
    let cursor = resolved;
    while (true) {
      const parent = path.dirname(cursor);
      if (parent === cursor) return resolved;
      missingParts.unshift(path.basename(cursor));
      cursor = parent;
      try {
        return path.join(realpathSync2(cursor), ...missingParts);
      } catch {
        continue;
      }
    }
  }
}
function resolvePiTargetPath(file, cwd) {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}
function isInsidePath(candidate, root) {
  const resolvedCandidate = canonicalPath(candidate);
  const resolvedRoot = canonicalPath(root);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}
function gitBranchOf(dir) {
  try {
    const result = spawnSync3("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 5e3
    });
    return result.status === 0 ? String(result.stdout).trim() : null;
  } catch {
    return null;
  }
}
function evaluateHarnessGuard(params) {
  const { targetFiles, skillRoot, cwd } = params;
  const env = params.env ?? process.env;
  if (!skillRoot) return null;
  if (targetFiles.length === 0) return null;
  const insideSkill = targetFiles.some((file) => isInsidePath(resolvePiTargetPath(file, cwd), skillRoot));
  if (!insideSkill) return null;
  if (env.OCTOCODE_ALLOW_HARNESS_APPLY !== "1") {
    return "octocode-awareness: editing the skill itself is gated. A human must set OCTOCODE_ALLOW_HARNESS_APPLY=1.";
  }
  const branch = gitBranchOf(skillRoot);
  if (branch === "main" || branch === "master") {
    return `octocode-awareness: harness self-fix is never allowed on ${branch}. Create a dedicated branch first.`;
  }
  if (!branch || branch === "HEAD") {
    if (env.OCTOCODE_HARNESS_BRANCH_OK !== "1") {
      return "octocode-awareness: cannot confirm a dedicated git branch for the skill. Create one, or set OCTOCODE_HARNESS_BRANCH_OK=1 to acknowledge.";
    }
  }
  return null;
}

// bin/hook-runner.ts
function readStdin() {
  return new Promise((resolve8) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve8(raw));
    process.stdin.on("error", () => resolve8(raw));
  });
}
function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return raw.trim() ? { input: raw } : {};
  }
}
function objectOrEmpty2(value) {
  return value && typeof value === "object" ? value : {};
}
function payloadInput(payload) {
  return payload.tool_input ?? payload.input ?? payload.args ?? payload;
}
function payloadForFileExtraction(payload) {
  const input = payloadInput(payload);
  const inputObj = objectOrEmpty2(input);
  if (inputObj === payload) return input;
  if (Object.keys(inputObj).length === 0) return input;
  return { ...payload, ...inputObj };
}
var warnedFallbackAgentId = false;
function firstString2(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function agentId(payload) {
  const input = objectOrEmpty2(payloadInput(payload));
  const explicit = firstString2(
    process.env.OCTOCODE_AGENT_ID,
    payload.agent_id,
    payload.agentId,
    input.agent_id,
    input.agentId,
    payload.session_id,
    payload.sessionId,
    input.session_id,
    input.sessionId
  );
  if (explicit) return explicit;
  const host = firstString2(
    process.env.OCTOCODE_AGENT_HOST,
    payload.host,
    payload.client,
    payload.source,
    payload.context
  ) ?? "shell";
  const scope = `${host}\0${workspace(payload) ?? process.cwd()}`;
  const suffix = createHash2("sha1").update(scope).digest("hex").slice(0, 12);
  const fallback = `hook:${host.replace(/[^a-zA-Z0-9_.:-]/g, "_")}:${suffix}`;
  if (!warnedFallbackAgentId) {
    warnedFallbackAgentId = true;
    console.error(`octocode-awareness: OCTOCODE_AGENT_ID or host session id missing; using fallback agent id "${fallback}". Set OCTOCODE_AGENT_ID for reliable multi-agent lock isolation.`);
  }
  return fallback;
}
function sessionId(payload) {
  const input = objectOrEmpty2(payloadInput(payload));
  return firstString2(
    payload.session_id,
    payload.sessionId,
    input.session_id,
    input.sessionId
  );
}
function toolName(payload) {
  const input = objectOrEmpty2(payloadInput(payload));
  return firstString2(
    payload.tool_name,
    payload.toolName,
    payload.name,
    input.tool_name,
    input.toolName
  ) ?? "";
}
function autoClaimRationale(payload, files) {
  const tool = toolName(payload);
  const names = files.map((f) => f.split("/").pop() || f);
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length > 3 ? ` +${names.length - 3} more` : "";
  const action = tool ? `${tool}` : "edit";
  return `auto: ${action} ${shown}${extra} (lifecycle hook)`;
}
function agentName(payload) {
  const value = process.env.OCTOCODE_AGENT_NAME ?? payload.agent_name ?? payload.agentName ?? payload.agent_display_name ?? payload.agentDisplayName;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
function workspace(payload) {
  const value = payload.cwd ?? payload.workspace ?? payload.workspacePath;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function artifact(payload) {
  const input = objectOrEmpty2(payloadInput(payload));
  const value = process.env.OCTOCODE_ARTIFACT ?? process.env.OCTOCODE_PACKAGE ?? process.env.OCTOCODE_SERVICE ?? payload.artifact ?? payload.package ?? payload.service ?? input.artifact ?? input.package ?? input.service;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function hookReason(payload) {
  return typeof payload.reason === "string" ? payload.reason : "";
}
function isStopHookActive(payload) {
  return Boolean(payload.stop_hook_active);
}
function extractFiles(payload) {
  const input = payloadForFileExtraction(payload);
  const inputObj = objectOrEmpty2(input);
  const toolName2 = payload.tool_name ?? payload.toolName ?? payload.name ?? inputObj.tool_name ?? inputObj.toolName ?? "";
  return extractPiWriteTargetPaths(toolName2, input, { assumeWrite: true });
}
function resolveHookPath(file, cwd = process.cwd()) {
  return resolve7(cwd, file);
}
function db() {
  return connectDb(resolveDbPath(null));
}
function hookRunStateDir() {
  const stateDir = join3(dirname3(resolveDbPath(null)), "hook-state", "runs");
  mkdirSync2(stateDir, { recursive: true });
  return stateDir;
}
function hookRunStateFile(key) {
  return join3(hookRunStateDir(), `${key}.json`);
}
function legacyHookRunStateFile() {
  const stateDir = join3(dirname3(resolveDbPath(null)), "hook-state");
  mkdirSync2(stateDir, { recursive: true });
  return join3(stateDir, "shell-hook-tasks.json");
}
function readLegacyPerRunFile(key) {
  const file = join3(dirname3(resolveDbPath(null)), "hook-state", "tasks", `${key}.json`);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : [];
    if (entries.length > 0) {
      try {
        unlinkSync(file);
      } catch {
      }
    }
    return entries;
  } catch {
    return [];
  }
}
function readLegacyHookRunEntries(key) {
  try {
    const legacyFile = legacyHookRunStateFile();
    const state = JSON.parse(readFileSync(legacyFile, "utf8"));
    const entries = Array.isArray(state[key]) ? state[key] : [];
    if (entries.length === 0) return [];
    delete state[key];
    writeFileSync(legacyFile, JSON.stringify(state, null, 2) + "\n", "utf8");
    return entries;
  } catch {
    return [];
  }
}
function readHookRunEntries(key) {
  try {
    const parsed = JSON.parse(readFileSync(hookRunStateFile(key), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return readLegacyPerRunFile(key).concat(readLegacyHookRunEntries(key));
  }
}
function writeHookRunEntries(key, entries) {
  const file = hookRunStateFile(key);
  if (entries.length === 0) {
    try {
      unlinkSync(file);
    } catch {
    }
    return;
  }
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(entries, null, 2) + "\n", "utf8");
  renameSync(tempFile, file);
}
function hookEventId(payload) {
  const input = objectOrEmpty2(payloadInput(payload));
  return firstString2(
    payload.tool_use_id,
    payload.toolUseId,
    payload.tool_call_id,
    payload.toolCallId,
    payload.event_id,
    payload.eventId,
    payload.id,
    input.tool_use_id,
    input.toolUseId,
    input.tool_call_id,
    input.toolCallId,
    input.event_id,
    input.eventId,
    input.id
  );
}
function hookRunKey(payload, files, cwd) {
  const explicitId = hookEventId(payload);
  const identity = {
    agent: agentId(payload),
    workspace: normalizeWorkspacePath(cwd, cwd) ?? resolve7(cwd),
    artifact: artifact(payload),
    event: explicitId,
    files: explicitId ? [] : files.map((file) => resolveHookPath(file, cwd)).sort()
  };
  return createHash2("sha1").update(JSON.stringify(identity)).digest("hex");
}
function recordHookRun(payload, files, cwd, runId) {
  const key = hookRunKey(payload, files, cwd);
  const entries = readHookRunEntries(key);
  entries.push({
    runId,
    files: files.map((file) => resolveHookPath(file, cwd)),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  writeHookRunEntries(key, entries.slice(-20));
}
function consumeHookRun(payload, files, cwd) {
  const key = hookRunKey(payload, files, cwd);
  const entries = readHookRunEntries(key);
  const entry = entries.shift();
  writeHookRunEntries(key, entries);
  return entry?.runId ?? null;
}
function uniqueActiveHookRunId(database, params) {
  const absFiles = params.files.map((file) => resolveHookPath(file, params.workspacePath));
  if (absFiles.length === 0) return null;
  const where = [
    "fl.agent_id = ?",
    "ai.status = 'ACTIVE'",
    `fl.file_path IN (${absFiles.map(() => "?").join(",")})`,
    "ai.workspace_path = ?"
  ];
  const binds = [
    params.agentId,
    ...absFiles,
    normalizeWorkspacePath(params.workspacePath, params.workspacePath) ?? resolve7(params.workspacePath)
  ];
  if (params.artifact) {
    where.push("(ai.artifact = ? OR ai.artifact IS NULL)");
    binds.push(params.artifact);
  }
  const rows = database.prepare(
    `SELECT DISTINCT fl.run_id
       FROM locks fl
       JOIN task_runs ai ON ai.run_id = fl.run_id
      WHERE ${where.join(" AND ")}
      ORDER BY fl.run_id ASC`
  ).all(...binds);
  return rows.length === 1 ? rows[0].run_id : null;
}
function hookAgentContext(payload, hookName) {
  const value = process.env.OCTOCODE_AGENT_CONTEXT ?? process.env.OCTOCODE_AGENT_HOST ?? payload.context ?? payload.host ?? payload.client ?? payload.source;
  return typeof value === "string" && value.trim() ? value.trim() : hookName;
}
function registerHookAgent(database, payload, hookName) {
  try {
    registerAgent(database, {
      agentId: agentId(payload),
      agentName: agentName(payload),
      workspacePath: workspace(payload),
      artifact: artifact(payload),
      context: hookAgentContext(payload, hookName)
    });
  } catch {
  }
}
function scopeArgs(payload) {
  const ws = workspace(payload);
  const art = artifact(payload);
  return {
    ...ws ? { workspacePath: ws } : {},
    ...art ? { artifact: art } : {}
  };
}
async function runPreEdit(payload) {
  const files = extractFiles(payload);
  if (files.length === 0) return 0;
  try {
    const database = db();
    registerHookAgent(database, payload, "hook:pre-edit");
    const activeClaim = activeTaskClaimForAgent(database, {
      agentId: agentId(payload),
      workspacePath: workspace(payload) ?? process.cwd(),
      artifact: artifact(payload)
    });
    const result = preFlightIntent(database, {
      agentId: agentId(payload),
      sessionId: sessionId(payload),
      workspacePath: workspace(payload) ?? process.cwd(),
      artifact: artifact(payload),
      runId: activeClaim?.run_id,
      rationale: autoClaimRationale(payload, files),
      testPlan: "post-edit verification",
      targetFiles: files,
      ttlMs: 10 * 6e4
    });
    if (!result.ok) {
      console.error("octocode-awareness: target file is locked by another agent \u2014 edit blocked.");
      console.error(JSON.stringify(result));
      return 2;
    }
    recordHookRun(payload, files, workspace(payload) ?? process.cwd(), result.run.run_id);
    return 0;
  } catch (error) {
    console.error(`octocode-awareness pre-flight warning (continuing): ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}
async function runPostEdit(payload) {
  const files = extractFiles(payload);
  if (files.length === 0) return 0;
  try {
    const database = db();
    registerHookAgent(database, payload, "hook:post-edit");
    const hookAgentId = agentId(payload);
    const hookWorkspace = workspace(payload) ?? process.cwd();
    const hookArtifact = artifact(payload);
    const correlatedRunId = consumeHookRun(payload, files, hookWorkspace) ?? uniqueActiveHookRunId(database, {
      agentId: hookAgentId,
      workspacePath: hookWorkspace,
      artifact: hookArtifact,
      files
    });
    if (!correlatedRunId) {
      console.error("octocode-awareness post-edit warning (continuing): could not identify a unique hook run to release; leaving locks for verify/cleanup.");
      return 0;
    }
    const linkedClaim = database.prepare("SELECT 1 FROM task_claims WHERE run_id = ? LIMIT 1").get(correlatedRunId);
    const release = releaseFileLock(database, {
      agentId: hookAgentId,
      workspacePath: hookWorkspace,
      artifact: hookArtifact,
      runId: correlatedRunId,
      status: linkedClaim ? "ACTIVE" : "PENDING"
    });
    const runId = release.run_ids.length === 1 ? release.run_ids[0] : correlatedRunId;
    for (const file of files) {
      insertEditLog(database, {
        agentId: hookAgentId,
        runId,
        filePath: resolveHookPath(file, hookWorkspace),
        operation: "update",
        workspacePath: hookWorkspace,
        artifact: hookArtifact
      });
    }
  } catch (error) {
    console.error(`octocode-awareness post-edit warning (continuing): ${error instanceof Error ? error.message : String(error)}`);
  }
  return 0;
}
async function runHarnessGuard(payload) {
  const reason = evaluateHarnessGuard({
    targetFiles: extractFiles(payload),
    skillRoot: process.env.OCTOCODE_SKILL_ROOT,
    cwd: process.cwd()
  });
  if (reason) {
    console.error(`${reason} Edit blocked.`);
    return 2;
  }
  return 0;
}
async function runStopVerify(payload) {
  if (process.env.OCTOCODE_NO_VERIFY_GATE === "1" || isStopHookActive(payload)) return 0;
  try {
    const database = db();
    registerHookAgent(database, payload, "hook:stop-verify");
    const report = auditUnverified(database, { agentId: agentId(payload), ...scopeArgs(payload) });
    if (report.count > 0) {
      const parts = [];
      if (report.unverified.length > 0) {
        parts.push(report.unverified.map((u) => `${u.status}:${u.run_id}: ${u.test_plan}`).join("; "));
      }
      if (report.stale_active.length > 0) {
        parts.push("Stale active (lock expired): " + report.stale_active.map((s) => `${s.run_id}: ${s.rationale}`).join("; "));
      }
      console.error(`octocode-awareness: concluding with unverified work. ${parts.join(" | ")}`);
      return 2;
    }
  } catch (error) {
    console.error(`octocode-awareness verify warning (continuing): ${error instanceof Error ? error.message : String(error)}`);
  }
  return 0;
}
function maybeRunDigest(payload) {
  if (process.env.OCTOCODE_NO_DIGEST === "1") return;
  if (process.env.OCTOCODE_NOTIFY_RUN_DIGEST !== "1") return;
  const intervalHours = Number(process.env.OCTOCODE_DIGEST_INTERVAL_HOURS ?? 4);
  const intervalMs = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours * 36e5 : 4 * 36e5;
  const memoryHome2 = process.env.OCTOCODE_MEMORY_HOME || `${process.env.HOME ?? ""}/.octocode/memory`;
  const markerPath = join3(memoryHome2, ".last-digest-epoch-ms");
  try {
    const database = db();
    let last = 0;
    try {
      last = Number(readFileSync(markerPath, "utf8").trim() || 0);
    } catch {
      last = 0;
    }
    const now = Date.now();
    if (!last || now - last >= intervalMs) {
      mkdirSync2(memoryHome2, { recursive: true });
      writeFileSync(markerPath, String(now), "utf8");
      digest(database, { workspace: workspace(payload), memoryHome: memoryHome2 });
    }
  } catch (error) {
    console.error(`octocode-awareness digest warning (continuing): ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function runNotifyDeliver(payload) {
  if (process.env.OCTOCODE_NO_NOTIFY === "1") return 0;
  maybeRunDigest(payload);
  try {
    const database = db();
    registerHookAgent(database, payload, "hook:notify-deliver");
    const result = notifyGet(database, {
      agent_id: agentId(payload),
      workspace: workspace(payload) ?? void 0,
      artifact: artifact(payload) ?? void 0,
      format: "hook"
    });
    if (result.additionalContext) {
      process.stdout.write(JSON.stringify({
        additionalContext: result.additionalContext,
        additional_context: result.additionalContext
      }) + "\n");
    }
  } catch (error) {
    console.error(`octocode-awareness session-capture warning (continuing): ${error instanceof Error ? error.message : String(error)}`);
  }
  return 0;
}
async function runSessionEnd(payload) {
  if (process.env.OCTOCODE_NO_SESSION_CAPTURE === "1" || hookReason(payload) === "clear") return 0;
  try {
    const database = db();
    registerHookAgent(database, payload, "hook:session-end");
    sessionCapture(database, {
      agent_id: agentId(payload),
      workspace: workspace(payload) ?? void 0,
      artifact: artifact(payload) ?? void 0,
      reason: hookReason(payload) || void 0
    });
    const sid = sessionId(payload);
    if (sid) endSession(database, { sessionId: sid });
  } catch {
  }
  return 0;
}
async function runHookCommand(command, rawPayload) {
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write("usage: hook-runner <pre-edit|post-edit|harness-guard|stop-verify|notify-deliver|session-end> < hook-payload.json\n");
    return 0;
  }
  const payload = parsePayload(rawPayload ?? await readStdin());
  switch (command) {
    case "pre-edit":
      return runPreEdit(payload);
    case "post-edit":
      return runPostEdit(payload);
    case "harness-guard":
      return runHarnessGuard(payload);
    case "stop-verify":
      return runStopVerify(payload);
    case "notify-deliver":
      return runNotifyDeliver(payload);
    case "session-end":
      return runSessionEnd(payload);
    default:
      console.error(`unknown hook command: ${command}`);
      return 1;
  }
}
async function main() {
  return runHookCommand(process.argv[2] ?? "help");
}
var isMain = process.argv[1] ? fileURLToPath(import.meta.url) === resolve7(process.argv[1]) : false;
var invokedAsHookRunner = process.argv[1] ? /^hook-runner\.(js|mjs|ts)$/.test(basename2(process.argv[1])) : false;
if (isMain && invokedAsHookRunner) {
  process.exitCode = await main();
}
export {
  runHookCommand
};
//# sourceMappingURL=hook-runner.js.map
