# Awareness Hooks

Read this before installing, checking, removing, or debugging lifecycle hooks. For identity, TTL, correlation, fail-open, and payload behavior read `references/hook-semantics.md`.

Hooks automate the same CLI/runtime transitions; manual commands remain valid. Installed config is useful only when the host executes it.

## Lifecycle Map

| Behavior | Effect | Verify |
|---|---|---|
| Smart briefing | Touch agent registry; surface unread signals/context at prompt/session start. | `signal list --all` and `agent list`. |
| Pre-edit | Claim target files; block only a real conflict. | `workspace status` shows lock/holder. |
| Harness guard | Require explicit self-edit approval and a safe branch. | Confirm guard decision, then run requested checks. |
| Post-edit | Release this agent's lock as `PENDING`; write best-effort edit audit. | `verify audit` lists the task. |
| Stop verify | Block/remind when verification remains. | `verify mark`, then `verify audit`. |
| Session capture | Write a handoff refinement from locks + dirty tree. | `refinement get --include-handoffs`. |

## Hosts

| Host | Install model | Important check |
|---|---|---|
| Claude Code | Skill frontmatter while active, or project `.claude/settings.json`. | Project-wide install is separate from skill activation. |
| Codex | `.codex/hooks.json`, config, or plugin hook config. | Hooks must be enabled; no `SessionEnd`, so capture uses `PreCompact`. |
| Cursor | `.cursor/hooks.json`, user config, or plugin hooks. | Cloud supports fewer events; smoke a write path. |
| Pi | `wirePiAwarenessHooks(pi)` / Pi extension. | Do not run shell `hooks install --host pi`. |

## Install And Check

Writing host settings requires user approval. Preview first:

```bash
octocode-awareness hooks install --host <claude|codex|cursor> --project-dir . --dry-run --compact
octocode-awareness hooks install --host <claude|codex|cursor> --project-dir . --compact
octocode-awareness hooks check --host <claude|codex|cursor> --project-dir . --strict --compact
```

Use `hooks remove --host <host> --dry-run` before approved removal. The installer changes only Awareness-owned entries and treats old command paths as repairable drift.

After install, use one `OCTOCODE_AGENT_ID` for hooks and manual CLI, deliberately edit a harmless claimed file, confirm `PENDING`, run verification, and confirm the audit clears.
