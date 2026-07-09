# Files Awareness And Collisions

Read this when multiple agents may touch the same repo or a claim conflicts. For command flags read `references/lock-protocol.md`; for timestamps, views, and session capture read `references/session-observability.md`.

## Workspace Status

`workspace status --workspace "$PWD"` reads the canonical DB and shows active plans, ready/in-progress/verify tasks, active/pending runs, live locks, memories, and refinements. It cleans expired standalone locks into `PENDING` runs; it never reads generated `.octocode/` files.

Use `refinement get` for handoff bodies and plain Git for the working tree:

```bash
octocode-awareness workspace status --workspace "$PWD" --compact
octocode-awareness refinement get --workspace "$PWD" --state open --compact
git status --porcelain
git rev-parse --abbrev-ref HEAD
```

Keep one normalized workspace root. Pass absolute target paths or run from repo root so same-file claims collide.

## Collision Protocol

A collision is a live lock, `lock acquire` exit `2`, a task already claimed by another agent, or an `ongoing` refinement over the same work.

1. Stop before editing; preserve the conflict payload.
2. Report holder, file, acquisition/expiry time, rationale, and test plan.
3. Choose bounded wait, non-overlapping work, direct coordination, or approved stale cleanup.
4. If waiting, run `lock wait`; exit `0` means clear, not claimed. Immediately run `lock acquire` again.
5. If cleanup is justified, preview `lock prune --dry-run`; pruning releases files but leaves standalone run verification `PENDING`. Task claims have their own lease and heartbeat.

Use `signal publish --kind request|blocker` for a longer wait or ownership question. Never steal a live lock or treat stale cleanup as success.

## Scope Facts

Refinements may auto-fill repo/ref from Git. Non-Git workspaces remain unscoped rather than inheriting another cwd.
Mismatched scope can hide correct rows. Keep workspace/artifact/repo/ref consistent across attend, task choice, locks, verification, and handoff.

Hooks enforce the mechanical conflict gate; this page owns the human decision after a conflict.
