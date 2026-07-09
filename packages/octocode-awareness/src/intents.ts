/**
 * intents.ts — execution-run and file-lock operations.
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeArtifact, utcNow } from './helpers.js';
import { evictExpiredLocks } from './db.js';
import { normalizeWorkspacePath } from './git.js';
import type {
  PreFlightRunParams, PreFlightRunResult,
  ReleaseFileLockParams, ReleaseFileLockResult,
  FileLockRow,
  FileLockParams,
  FileLockResult,
  FileLockStatusEntry,
} from './types.js';

const MAX_LOCK_TTL_MS = 10 * 60_000;
const VALID_RELEASE_STATUSES = new Set(['PENDING', 'ACTIVE', 'SUCCESS', 'FAILED']);
type ReleaseStatus = 'PENDING' | 'ACTIVE' | 'SUCCESS' | 'FAILED';

function effectiveTtlMs(ttlMs: number | null | undefined): number {
  return Math.min(Math.max(1, ttlMs ?? MAX_LOCK_TTL_MS), MAX_LOCK_TTL_MS);
}

function expiresAtFromNow(ttlMs: number | null | undefined): string {
  return new Date(Date.now() + effectiveTtlMs(ttlMs)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function workspaceScopeRoot(workspacePath?: string | null): string {
  const candidate = workspacePath ?? process.cwd();
  return normalizeWorkspacePath(candidate, candidate) ?? resolve(candidate);
}

function workspaceFileBase(workspacePath?: string | null): string {
  return workspacePath ? resolve(workspacePath) : process.cwd();
}

function resolveTargetFiles(targetFiles: string[] = [], workspacePath?: string | null): string[] {
  const root = workspaceFileBase(workspacePath);
  return targetFiles.map((file) => isAbsolute(file) ? resolve(file) : resolve(root, file));
}

function activeLockRows(
  db: DatabaseSync,
  params: { workspacePath?: string | null; artifact?: string | null; agentId?: string | null; sessionId?: string | null; runId?: string | null } = {},
): FileLockStatusEntry[] {
  // ARCH-3: Delegate eviction to the shared evictExpiredLocks instead of
  // duplicating the DELETE. Note: eviction here is intentional — stale locks
  // must be cleared before the caller decides whether a file is locked.
  evictExpiredLocks(db);
  const now = utcNow(); // re-read after eviction so the SELECT filter is consistent

  const clauses = ["ai.status = 'ACTIVE'", "(fl.expires_at IS NULL OR fl.expires_at > ?)"];
  const binds: (string | number)[] = [now];
  if (params.workspacePath) {
    clauses.push('ai.workspace_path = ?');
    binds.push(workspaceScopeRoot(params.workspacePath));
  }
  const artifact = normalizeArtifact(params.artifact);
  if (artifact) {
    clauses.push('(ai.artifact = ? OR ai.artifact IS NULL)');
    binds.push(artifact);
  }
  if (params.agentId) {
    clauses.push('ai.agent_id = ?');
    binds.push(params.agentId);
  }
  if (params.sessionId) {
    clauses.push('ai.session_id = ?');
    binds.push(params.sessionId);
  }
  if (params.runId) {
    clauses.push('fl.run_id = ?');
    binds.push(params.runId);
  }

  return db.prepare(
    `SELECT fl.lock_id, fl.run_id, fl.file_path, ai.agent_id, ai.session_id, ai.workspace_path, ai.artifact,
            ai.rationale AS reasoning, ai.test_plan AS test_plan, fl.lock_type, fl.acquired_at, fl.expires_at
       FROM locks fl
       JOIN task_runs ai ON ai.run_id = fl.run_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY fl.acquired_at DESC`
  ).all(...binds) as unknown as FileLockStatusEntry[];
}

/**
 * Claim file locks for an agent write operation.
 * Returns { ok: true, run } on success or { ok: false, conflict, conflicts } on conflict.
 */
export function preFlightIntent(
  db: DatabaseSync,
  params: PreFlightRunParams,
): PreFlightRunResult {
  const {
    agentId = 'agent',
    sessionId = null,
    workspacePath,
    artifact,
    runId: requestedRunId = null,
    rationale = 'agent write operation',
    testPlan = 'post-edit verification',
    contextRef = null,
    targetFiles = [],
    lockType = 'EXCLUSIVE',
    ttlMs = MAX_LOCK_TTL_MS,
  } = params;
  const runId = requestedRunId ?? `run_${randomUUID().replace(/-/g, '')}`;
  const now = utcNow();
  const wsPath = workspaceScopeRoot(workspacePath);
  const artifactScope = normalizeArtifact(artifact);
  const absFiles = resolveTargetFiles(targetFiles, workspacePath);
  let linkedTaskId: string | null = null;
  let effectiveContextRef = contextRef;

  // ARCH-3: Drop expired locks before checking conflicts so dangling locks never block new work.
  evictExpiredLocks(db);

  // BEGIN IMMEDIATE acquires a write lock upfront, serializing the check-then-insert sequence
  // and eliminating the TOCTOU race where two agents both pass the conflict check before either
  // inserts, then both hold EXCLUSIVE locks on the same file.
  db.exec('BEGIN IMMEDIATE');
  try {
    // Check for conflicts with OTHER agents.
    const conflicts: FileLockRow[] = [];
    for (const absPath of absFiles) {
      const conflictMode = lockType === 'SHARED' ? "fl.lock_type = 'EXCLUSIVE'" : '1 = 1';
      const existing = db.prepare(`
        SELECT fl.*, ai.agent_id AS run_agent_id,
               ai.rationale AS reasoning, ai.test_plan AS test_plan
          FROM locks fl
        JOIN task_runs ai ON ai.run_id = fl.run_id
        WHERE fl.file_path = ?
          AND ai.agent_id <> ?
          AND ai.status = 'ACTIVE'
          AND ${conflictMode}
          AND (fl.expires_at IS NULL OR fl.expires_at > ?)
      `).all(absPath, agentId, now) as unknown as FileLockRow[];
      conflicts.push(...existing);
    }

    if (conflicts.length > 0) {
      db.exec('ROLLBACK');
      return {
        ok: false,
        conflict: true,
        conflicts: conflicts.map(c => {
          // Session liveness: if the holder's session has ended, the lock is
          // likely abandoned (not yet TTL-expired). Surface it — don't auto-steal
          // — so a blocked agent can decide to wait, work elsewhere, or reclaim.
          const holderSession = c.session_id
            ? (db.prepare('SELECT ended_at FROM sessions WHERE session_id = ?').get(c.session_id) as { ended_at: string | null } | undefined)
            : undefined;
          const holderSessionActive = !holderSession || holderSession.ended_at == null;
          return {
            file_path: c.file_path,
            lock_type: c.lock_type as 'EXCLUSIVE' | 'SHARED',
            agent_id: c.run_agent_id ?? c.agent_id,
            acquired_at: c.acquired_at,
            expires_at: c.expires_at,
            // Surface the holder's who/why so a blocked agent can act on it.
            run_id: c.run_id,
            reasoning: c.reasoning ?? 'agent write operation',
            test_plan: c.test_plan ?? 'post-edit verification',
            session_id: c.session_id ?? null,
            holder_session_active: holderSessionActive,
          };
        }),
      };
    }

    // Auto-register session when provided so the FK on task_runs.session_id is satisfied.
    if (sessionId) {
      db.prepare(
        `INSERT OR IGNORE INTO sessions (session_id, agent_id, workspace_path, artifact, started_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(sessionId, agentId, wsPath, artifactScope, now);
    }

    // A task claim may provide its existing run. Quick lock-only flows omit it
    // and get a standalone run with task_id = NULL.
    if (requestedRunId) {
      const existingRun = db.prepare(
        "SELECT task_id, agent_id, status, context_ref, files_json FROM task_runs WHERE run_id = ?",
      ).get(requestedRunId) as { task_id: string | null; agent_id: string; status: string; context_ref: string | null; files_json: string } | undefined;
      if (!existingRun) throw new Error(`run not found: ${requestedRunId}`);
      if (existingRun.agent_id !== agentId) throw new Error(`run ${requestedRunId} belongs to ${existingRun.agent_id}`);
      if (existingRun.status !== 'ACTIVE') throw new Error(`run ${requestedRunId} is not ACTIVE`);
      linkedTaskId = existingRun.task_id;
      effectiveContextRef = existingRun.context_ref;
      const previousFiles = JSON.parse(existingRun.files_json || '[]') as string[];
      db.prepare('UPDATE task_runs SET files_json = ?, updated_at = ? WHERE run_id = ?')
        .run(JSON.stringify([...new Set([...previousFiles, ...absFiles])]), now, runId);
    } else {
      db.prepare(`
        INSERT INTO task_runs
          (run_id, task_id, agent_id, session_id, rationale, test_plan, context_ref, status, workspace_path, artifact, files_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
      `).run(runId, null, agentId, sessionId, rationale, testPlan, contextRef, wsPath, artifactScope, JSON.stringify(absFiles), now, now);
    }

    const expiresAt = expiresAtFromNow(ttlMs);

    const acquiredLocks: Array<{ lock_id: string; file_path: string; lock_type: 'EXCLUSIVE' | 'SHARED'; expires_at: string | null }> = [];
    for (const absPath of absFiles) {
      const lockId = 'lock_' + randomUUID().replace(/-/g, '');
      db.prepare(`
        INSERT OR REPLACE INTO locks
          (lock_id, file_path, run_id, agent_id, session_id, lock_type, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lockId, absPath, runId, agentId, sessionId, lockType, now, expiresAt);
      acquiredLocks.push({ lock_id: lockId, file_path: absPath, lock_type: lockType, expires_at: expiresAt });
    }

    db.exec('COMMIT');

    return {
      ok: true,
      run: {
        run_id: runId,
        task_id: linkedTaskId,
        agent_id: agentId,
        session_id: sessionId,
        lock_type: lockType,
        workspace_path: wsPath,
        artifact: artifactScope,
        context_ref: effectiveContextRef,
        target_files: absFiles,
        locks: acquiredLocks.map(l => ({
          lock_id: l.lock_id,
          file_path: l.file_path,
          lock_type: l.lock_type,
          agent_id: agentId,
          session_id: sessionId,
          acquired_at: now,
          expires_at: l.expires_at,
        })),
        status: 'ACTIVE',
        created_at: now,
      },
    };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* not in transaction */ }
    throw e;
  }
}

/**
 * Release file locks for a run or specific files.
 */
export function releaseFileLock(
  db: DatabaseSync,
  params: ReleaseFileLockParams,
): ReleaseFileLockResult {
  const {
    agentId = 'agent',
    sessionId = null,
    workspacePath = null,
    artifact = null,
    runId = null,
    targetFiles = [],
    status: statusArg = 'SUCCESS',
    verified = false,
    verifiedNote,
  } = params;

  if (!VALID_RELEASE_STATUSES.has(String(statusArg))) {
    throw new Error(`releaseFileLock status must be ACTIVE, PENDING, SUCCESS, or FAILED; got "${statusArg}"`);
  }
  const requestedStatus = String(statusArg) as ReleaseStatus;
  const requestedSuccessWithoutVerification = requestedStatus === 'SUCCESS' && !verified;
  const effectiveStatus: ReleaseStatus = requestedSuccessWithoutVerification ? 'PENDING' : requestedStatus;

  const now = utcNow();
  const whereClauses: string[] = ['fl.agent_id = ?'];
  const whereParams: (string | number)[] = [agentId];

  if (sessionId) {
    whereClauses.push('fl.session_id = ?');
    whereParams.push(sessionId);
  }
  const artifactScope = normalizeArtifact(artifact);
  if (workspacePath || artifactScope) {
    whereClauses.push('ai.run_id = fl.run_id');
  }
  if (workspacePath) {
    whereClauses.push('ai.workspace_path = ?');
    whereParams.push(workspaceScopeRoot(workspacePath));
  }
  if (artifactScope) {
    whereClauses.push('(ai.artifact = ? OR ai.artifact IS NULL)');
    whereParams.push(artifactScope);
  }

  if (runId) {
    whereClauses.push('fl.run_id = ?');
    whereParams.push(runId);
  }

  const absFiles = resolveTargetFiles(targetFiles, workspacePath);
  if (absFiles.length > 0) {
    const ph = absFiles.map(() => '?').join(',');
    whereClauses.push(`fl.file_path IN (${ph})`);
    whereParams.push(...absFiles);
  }

  const where = whereClauses.join(' AND ');
  const locks = db.prepare(
    `SELECT fl.lock_id, fl.run_id, fl.file_path
       FROM locks fl${workspacePath || artifactScope ? ', task_runs ai' : ''}
      WHERE ${where}`
  ).all(...whereParams) as unknown as Array<{ lock_id: string; run_id: string; file_path: string }>;

  const runIds = [...new Set(locks.map(l => l.run_id))];
  const ambiguousRelease = !runId && absFiles.length > 0 && runIds.length > 1;
  if (ambiguousRelease) {
    return {
      agent_id: agentId,
      status: effectiveStatus,
      released: false,
      locks_released: 0,
      run_ids: runIds,
      updated_at: now,
      ambiguousRelease: 'target-file release matched multiple active runs; pass --run-id to release exactly one run',
    };
  }

  if (locks.length === 0) {
    return {
      agent_id: agentId,
      status: effectiveStatus,
      released: false,
      locks_released: 0,
      run_ids: [],
      updated_at: now,
    };
  }

  // FIX #3 (P0): Wrap DELETE from locks AND UPDATE task_runs status in a single atomic transaction
  // so a crash between the two statements never leaves orphaned lock rows with no task update.
  db.exec('BEGIN IMMEDIATE');
  try {
    const lockIds = locks.map((lock) => lock.lock_id);
    db.prepare(`DELETE FROM locks WHERE lock_id IN (${lockIds.map(() => '?').join(',')})`).run(...lockIds);

    for (const tid of runIds) {
      const remaining = db.prepare('SELECT 1 FROM locks WHERE run_id = ? LIMIT 1').get(tid);
      if (!remaining) {
        db.prepare(
          'UPDATE task_runs SET status = ?, updated_at = ? WHERE run_id = ? AND agent_id = ?'
        ).run(effectiveStatus, now, tid, agentId);
        if (verified && verifiedNote) {
          try {
            db.prepare(
              `INSERT INTO run_log(event_id, run_id, agent_id, event_type, message, created_at)
               VALUES (?, ?, ?, 'VERIFIED', ?, ?)`
            ).run('evt_' + randomUUID().replace(/-/g, ''), tid, agentId, verifiedNote, now);
          } catch { /* non-critical audit log */ }
        }
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* not in transaction */ }
    throw e;
  }

  return {
    agent_id: agentId,
    status: effectiveStatus,
    released: locks.length > 0,
    locks_released: locks.length,
    run_ids: runIds,
    updated_at: now,
    ...(requestedSuccessWithoutVerification
      ? { unverifiedConclusion: 'SUCCESS requested without --verified; stored as PENDING until verify records the test result.' }
      : {}),
  };
}

export function fileLock(db: DatabaseSync, params: FileLockParams): FileLockResult {
  switch (params.type) {
    case 'lock': {
      const result = preFlightIntent(db, {
        agentId: params.agentId,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
        artifact: params.artifact,
        runId: params.runId,
        targetFiles: params.targetFiles ?? [],
        lockType: params.lockType,
        ttlMs: params.ttlMs,
        rationale: params.reasoning?.trim() || 'manual: fileLock lock',
        testPlan: 'release or verify file-lock run',
      });
      if (!result.ok) return { ok: false, type: 'lock', conflict: true, conflicts: result.conflicts };
      const locks = activeLockRows(db, { runId: result.run.run_id });
      return {
        ok: true,
        type: 'lock',
        runId: result.run.run_id,
        files: result.run.target_files,
        reasoning: params.reasoning?.trim() || 'manual: fileLock lock',
        acquiredAt: result.run.locks[0]?.acquired_at ?? null,
        expiresAt: result.run.locks[0]?.expires_at ?? null,
        locks,
      };
    }
    case 'release': {
      if (!params.runId && (!params.targetFiles || params.targetFiles.length === 0)) {
        throw new Error('fileLock release requires runId or targetFiles');
      }
      const rel = releaseFileLock(db, {
        agentId: params.agentId,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
        artifact: params.artifact,
        runId: params.runId,
        targetFiles: params.targetFiles,
        status: params.status,
        verified: params.verified,
        verifiedNote: params.verifiedNote,
      });
      return {
        ok: !('unverifiedConclusion' in rel),
        type: 'release',
        ...rel,
      };
    }
    case 'status':
      return {
        ok: true,
        type: 'status',
        locks: activeLockRows(db, {
          workspacePath: params.workspacePath,
          artifact: params.artifact,
          agentId: params.agentId,
          sessionId: params.sessionId,
          runId: params.runId,
        }),
      };
    case 'renew': {
      if (!params.runId) throw new Error('fileLock renew requires runId');
      const agentId = params.agentId ?? 'agent';
      const expiresAt = expiresAtFromNow(params.ttlMs);
      const res = db.prepare(
        `UPDATE locks SET expires_at = ? WHERE run_id = ? AND agent_id = ?`
      ).run(expiresAt, params.runId, agentId) as { changes: number };
      db.prepare('UPDATE task_runs SET updated_at = ? WHERE run_id = ? AND agent_id = ?')
        .run(utcNow(), params.runId, agentId);
      return {
        ok: true,
        type: 'renew',
        runId: params.runId,
        renewed: res.changes > 0,
        locks_renewed: res.changes,
        expiresAt: res.changes > 0 ? expiresAt : null,
      };
    }
  }
}
