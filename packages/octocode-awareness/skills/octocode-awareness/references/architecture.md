# Awareness Architecture & Navigation

Read this first: how the workspace fits together, and which reference to open next. Each row points to the one doc that owns the detail.

## High-Level Architecture

```text
agent (SKILL.md loop) -> CLI / bundled script / hooks / Pi bridge -> runtime modules
   -> ~/.octocode/memory/awareness.sqlite3   (CANONICAL, shared, scoped)
      -> query <view>  (live read)   |   repo inject (publish) -> <repo>/.octocode/ (GENERATED)
```

- One canonical SQLite store per machine (scoped by `workspace_path`/`artifact`/`repo`/`ref`/`agent_id`) is the source of truth; CLI, hooks, and Pi bridge all drive the same runtime — nothing else is authoritative.
- `<repo>/.octocode/` is a generated, read-mostly projection — leads, not proof. Regenerate it; never hand-edit.

## Lifecycle → which reference owns it

`sense → attend → claim → act → verify → reflect → project → hand off → maintain`

| Phase | Owner reference |
|---|---|
| Attend / sense (`attend`, `query workboard`, status) | `full-flow.md`, `agent-cheatsheet.md` |
| Recall / record (scope, decay, supersede) | `memory-recall.md` |
| Claim / act (`lock *`, dirty tree) | `coordination-protocol.md`, `files-awareness.md` |
| Communicate / verify (`signal *`, `refinement *`, `verify *`) | `coordination-protocol.md` |
| Reflect (`reflect *`, weakness, dev-review) | `learning-loop.md`; `self-reflection-dialogue.md` only for role challenge |
| Project (`repo inject`, `query`, outputs) | `output-routing.md`, then `repo-context-management.md` for mechanics |
| Maintain / clean (supersede, forget, digest, prune) | Cleanup below + `homeostatic-loop.md` |
| Schema / data (tables, columns, SQL) | `data-model.md` (+ `-entities`, `-relationships`) |
| Hooks / hosts, command map, search | `hooks.md`, `full-flow-cli.md`, `octocode.md` |
| Create / improve this skill | `skill-evolution.md` (via `octocode-skills`) |

## Outputs — written where, read how

Use `output-routing.md` to choose live output, durable rows, or generated files. Use `repo-context-management.md` only for projection mechanics, budgets, sharing, and the root pointer.

## Cleanup / Homeostasis — remove old + redundancy on the go

- **Supersede on the go:** `memory record --supersedes <id>` flips the old row `ACTIVE → SUPERSEDED`; recall returns the corrected fact, not both.
- **Decay:** salience falls with age / per-label half-life, so stale memories sink without deletion.
- **Forget:** `memory forget --dry-run`, then delete selected stale rows.
- **Digest:** `maintenance digest --dry-run` previews `would_archive|prune_old|prune_locks|prune_refinements`; drop `--dry-run` to apply.
- **Prune:** `lock prune` clears expired locks; `signal prune` clears resolved/old signals.
- **Projection budget:** Markdown indexes are capped; `repo inject` omits overflow and points to CSV/HTML/`query`.

## Always Refine and Improve

Route meaningful outcomes through `learning-loop.md`; prune stale state through the cleanup rules above. When a workflow gap repeats, use `skill-evolution.md` with `octocode-skills` for a bounded, user-approved edit and held-out check.
