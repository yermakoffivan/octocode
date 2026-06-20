# RFC: Remote-as-Local — run the octocode-engine on GitHub-fetched content, smartly cached

**Status:** Draft
**Date:** 2026-06-20
**Author:** (drafted with Claude Code)
**Supersedes:** `BRAINSTORM-remote-as-local-engine.md`, `BRAINSTORM-smart-fetch-and-eviction.md`

---

## 1. Summary

We already pay to pull source out of GitHub — file content, directory trees, and
full/sparse clones — but two of those three paths **throw the bytes away** after a
single render. This RFC proposes:

1. **Materialize every GitHub fetch into one content-addressed local cache** keyed
   by `{{owner}}/{{repo}}/{{sha}}/{{path}}`, and point the native octocode-engine
   (AST/structural search, structure, find, get-content, and — tiered — LSP) at it.
   *Remote code becomes local code.*
2. **Fetch smartly so the cache never bloats** — a single `materialize` granularity
   param plus bounds (`maxFiles`/`maxBytes`/`maxDepth`/`include`/`exclude`) keep the
   common path at kilobytes; a full clone is the rare, explicit top rung.
3. **Reclaim old/stale content automatically** — a GC that treats the cache as one
   budget: TTL expiry → ref-pointer re-resolution → LRU-by-access under size/count
   caps, with session pinning so we never evict what we're using.

Most of this is **generalizing code that already exists** (the clone disk cache +
`directoryFetch` + the native engine that already runs on arbitrary dirs), not
green-field work.

---

## 1.1 Scope — CLI ONLY, not MCP (hard constraint)

**This feature ships exclusively through the CLI package
`packages/octocode`. It is NOT exposed over MCP.** Non-negotiable:

- **No new MCP tools.** Nothing is registered in `packages/octocode-mcp`
  (`toolsManager.ts`) or added to the MCP-facing tool catalog / schemas in
  octocode-core. The MCP surface stays exactly as it is today.
- **Existing MCP tools are unchanged.** `ghGetFileContent` /
  `ghViewRepoStructure` keep their current **in-memory** behavior when called via
  MCP. The "materialize to `~/.octocode/tmp`" behavior is a **CLI-only code path** —
  it must not alter what the MCP server does.
- **All new surfaces are CLI commands/flags** in `packages/octocode` (e.g.
  `--repo owner/repo[@ref]` on `cat`/`ls`/`grep`/`find`/`symbol-outline`, plus a
  `cache` command). The CLI already routes through `executeDirectTool`; the new
  orchestration (resolve SHA → materialize → point local tools at cache →
  relativize output) lives in / is driven by the CLI.
- **Where the logic lives.** Reusable primitives (SHA-keyed writer, manifest, tmp
  GC) may sit in `octocode-tools-core` as plain functions, but they are **called
  only from the CLI** and **must not be wired into the MCP tool surface**. If a
  primitive can't be added to tools-core without leaking into MCP registration, it
  goes in `packages/octocode` instead.

**Why this is good, not just a limitation:**
- It **removes the worst concurrency hazard** (see Risk #2 in earlier review): the
  long-lived MCP server never reads/writes the tmp cache, so the only writers are
  short-lived CLI processes — a much smaller locking problem.
- **Zero MCP schema/core churn** → no token-budget, resource-text, or
  contract-test impact on the MCP side.
- Keeps the experimental disk-cache behavior off the stable MCP contract until it's
  proven via the CLI.

> Anything in this RFC that says "tool" means a **CLI command path**, not an MCP
> tool, unless it explicitly names an existing MCP tool's *unchanged* behavior.

---

## 2. Motivation

- **Stop re-reading to "look around."** Today an agent re-fetches a file to inspect
  its neighbors. If the fetch persisted, it could `grep`/AST/`ls`/outline the
  neighborhood from cache instead.
- **Unify three disconnected, mostly-amnesiac fetch paths** under one immutable
  key.
- **Reuse the expensive native engine for free.** Rust ast-grep, in-process
  ripgrep, and oxc symbol extraction already run on any directory on disk. We only
  need to *feed* them remote content.
- **Escalating cost.** Cheap point lookups stay cheap; you pay for a clone only when
  a question genuinely needs whole-repo semantics — and then only once per SHA.

---

## 3. Current state (grounded in the code)

### 3.1 Three fetch paths, two throwaway

| Tool | Pulls | Persisted? | Cache key |
|---|---|---|---|
| `ghGetFileContent` | one file | ❌ in-memory (NodeCache, 5 min) | `gh-api-file-content:sha256(owner,repo,path,branch)` |
| `ghViewRepoStructure` | a dir tree listing | ❌ in-memory (2 h) | `gh-repo-structure-api:…` |
| `ghCloneRepo` | full/sparse checkout | ✅ disk | `~/.octocode/repos/<owner>/<repo>/<branch>[__sp_<hash6>]/` + meta |
| `fetchDirectoryContents` (API) | a dir's files | ✅ disk (same layout, `source:"directoryFetch"`) | dir + meta |

Key files:
- `packages/octocode-tools-core/src/github/fileContent.ts` — `fetchGitHubFileContentAPI`
- `packages/octocode-tools-core/src/tools/github_view_repo_structure/execution.ts`
- `packages/octocode-tools-core/src/tools/github_clone_repo/{cloneRepo.ts,cache.ts}`
- `packages/octocode-tools-core/src/github/directoryFetch.ts`
- `packages/octocode-tools-core/src/shared/paths.ts` (`OCTOCODE_HOME = ~/.octocode`)

### 3.2 The disk cache + GC already exist

Clones live at `~/.octocode/repos/<owner>/<repo>/<branch>[__sp_<hash6>]/` with a
real manager in `cache.ts`: **24 h TTL, 2 GB cap, 50-clone cap, LRU eviction,
10-min GC** (env-overridable: `OCTOCODE_CACHE_TTL_MS` / `OCTOCODE_MAX_CACHE_SIZE` /
`OCTOCODE_MAX_CLONES`). Metadata in `.octocode-clone-meta.json`.

### 3.3 The native engine already runs on arbitrary disk paths

Every local tool does:
```
cwd = WORKSPACE_ROOT || config.local.workspaceRoot || process.cwd()
resolved = isAbsolute(path) ? path : resolve(cwd, path)
pathValidator.validate(resolved)   // must be under HOME / WORKSPACE_ROOT / ALLOWED_PATHS
```
(`utils/file/toolHelpers.ts`, `octocode-engine/src/security/pathValidator.ts`)

**Critical enabler:** `$HOME` is an allowed root by default and `~/.octocode` is
under it — so local tools can be pointed at the cache **with no security change**.

- `localSearchCode mode:structural` → `octocode-engine.structuralSearchFiles` (ast-grep). **LSP-free.**
- `localViewStructure` / `localFindFiles` → `octocode-engine.queryFileSystem`.
- `lspGetSemantics` → needs a language server + initialized workspace (heavier); JS/TS has a server-free oxc fast-path (`extractJsSymbols`, `findInFileReferences`).

### 3.4 The three gaps this RFC closes
1. Single-file and structure fetches are throwaway (in-memory only).
2. The cache keys on **branch**, not SHA — a staleness hazard (branch moves → stale tree).
3. The local engine isn't wired to *aim* at the cache.

---

## 4. Design

### 4.0 Storage location — everything under `~/.octocode`

**`~/.octocode` is THE folder.** No OS `/tmp`. Two reasons this is non-negotiable:
it's under `$HOME`, which `pathValidator` allows by default on **every platform**
(darwin / linux / windows) — so the native engine reads cache content with **zero
security change and no `ALLOWED_PATHS` setup** — and it keeps one cleanup regime,
one budget, one `octocode cache status`. Root is overridable via the existing
`OCTOCODE_HOME` env var; everything below stays relative to it.

#### Cross-platform home resolution (MANDATORY — reuse the config home resolver)

The cache must resolve home **identically on macOS, Linux, and Windows**, and it must
reuse the **same helper the config system already uses** — not a new one.

- **Reuse `getOctocodeDir()`** —
  `octocode-tools-core/src/shared/config/loader.ts:133`. This is *how config checks
  the home folder*: it returns `paths.home`. It lives in **tools-core, so both MCP
  and the CLI already share it** — exactly the cross-platform, single-source
  resolver to build on. Don't reimplement home resolution; call this.
- The resolution chain it sits on:
  `getOctocodeDir()` → `paths.home` (`octocode-tools-core/src/shared/paths.ts`) →
  `OCTOCODE_HOME` (env-overridable) → `join(HOME, '.octocode')` →
  `HOME = os.homedir()` (`shared/platform/platform.ts`, the only correct
  cross-platform source — reads `USERPROFILE` on Windows).
- **Add the new dirs in `paths.ts` only:** `paths.tmp = join(OCTOCODE_HOME, 'tmp')`
  (`paths.repos` already exists). Everything downstream gets home via
  `getOctocodeDir()` / `paths.*`. **Never `process.env.HOME`**, never an ad-hoc
  second path. (There is no `getHomeDir()` and `octocode-shared` is empty — so
  `getOctocodeDir()`/`paths` IS the canonical helper; reuse it rather than adding a
  rival.)
- **🐞 Fix the existing Windows bugs while here:** `status.ts:70`
  (`process.env.HOME || ''` → **empty string on Windows**) and `prompts.ts:350`
  must switch to `getOctocodeDir()` / `paths.home`. The `cache status` command
  extends `status.ts`, so this is in-path, not a detour. **CI must run on Windows**
  so it can't regress (already required for the eviction path — §5.5).

```
~/.octocode/
├── tmp/      ← NEW: API-materialized fetches — files + trees WITH content. GitHub-API-sourced, git-free, disposable.
├── repos/    ← EXISTING: git clones (sparse + full). Heavy, git-sourced, SEPARATE lifecycle (see §4.1.1).
├── credentials.json / .key / config / session.json / logs/   ← unchanged
```

### 4.1 The fetch cache — `~/.octocode/tmp`, content-addressed by SHA

```
~/.octocode/tmp/<owner>/<repo>/<sha>/<path...>
~/.octocode/tmp/<owner>/<repo>/<sha>/.octocode-manifest.json
```

- "tmp" = **our** scratch under our home — not the OS temp dir. It signals
  *disposable* (every byte is re-fetchable from GitHub → losing it is never data
  loss) while staying under `$HOME` so the security/portability guarantees above
  hold.
- `<sha>` = the **resolved commit SHA**, not a branch name → immutable, verifiable,
  de-dupes branches/tags pointing at the same commit, and lets file/tree
  materializations of the *same commit* share one directory (a file fetch is
  upgraded in place by a later tree fetch of the same SHA).
- Branch/tag → SHA resolution already happens in the GitHub client; we **persist**
  the resolved SHA and keep a short-lived `ref → sha` pointer so "give me `main`"
  stays fast.

#### 4.1.1 Clones are different — keep `~/.octocode/repos` separate

Clones are **not** folded into `~/.octocode/tmp`. They are a distinct mechanism with
a distinct lifecycle, and the RFC deliberately keeps them apart:

| | `~/.octocode/tmp` (fetch cache) | `~/.octocode/repos` (clones) |
|---|---|---|
| Source | GitHub REST API (loose files) | `git clone` (full/sparse working tree, has `.git`) |
| Granularity | files + bounded trees (with content) | whole repo / sparse path |
| Typical size | KB–few MB (bounded) | MB–GB |
| Created by | CLI `cat`/`ls`/`grep`/`find`/`symbol-outline` via GitHub API (`directoryFetch` repointed) | `ghCloneRepo` (existing `cloneRepo.ts`), incl. sparse |
| Manager | new tmp GC (this RFC) | existing `cache.ts` (24h/2GB/50-clone LRU) |
| `materialize` rung | `none` / `file` / `tree` | `clone` (sparse/full) |

So the `materialize` ladder splits across the two trees: `clone` lands in `repos/` via
the **unchanged** git path; `file` and `tree` (both **with content**, via the GitHub
API) land in `tmp/`. They are linked logically (the manifest can note "a clone of this
SHA exists at `repos/<…>`") but never share a directory. This lets the two GCs run
different budgets and TTLs — a 2 GB clone shouldn't compete for the same byte budget
as a few-MB tree, and clone eviction (expensive to re-create) can be more conservative
than tmp eviction (cheap to re-fetch).

#### Manifest schema (drives fetch, eviction, and LSP tiering)
```jsonc
{
  "owner": "facebook", "repo": "react", "sha": "abc123…",
  "refs": { "main": { "resolvedAt": "…", "pointerExpiresAt": "…" } },  // short TTL
  "files": {                                                            // tmp/ holds files + tree files, all WITH content (via GitHub API)
    "src/index.ts":          { "bytes": 1234, "fetchedAt": "…", "source": "file" },
    "packages/core/index.ts":{ "bytes": 980,  "fetchedAt": "…", "source": "tree" }
  },
  "trees": {                                                            // bounded directory fetches
    "packages/core": { "files": 23, "bytes": 99999, "fetchedAt": "…", "truncated": false }
  },
  "clone": { "kind": "sparse", "sparsePath": "packages/core", "dir": "repos/…" },  // cross-link, null if none
  "complete": false,            // true only after a FULL clone in repos/ → gates Tier-1 LSP (out of scope)
  "fetchedAt": "…", "expiresAt": "…",   // content TTL (long)
  "lastAccessedAt": "…",        // LRU key — bumped on every READ
  "pinned": false,              // session lease — exempt from budget eviction
  "sizeBytes": 101233           // rolled up for budget math
}
```

### 4.2 Smart fetch — the `materialize` ladder

Every GitHub read tool takes one optional `materialize` enum deciding *how much hits
disk*, independent of what it returns to the caller. **Default = cheapest rung that
answers the call.**

| `materialize` | On disk | Lands in | Mechanism | Default for | Use when |
|---|---|---|---|---|---|
| `none` | nothing (today's in-memory) | — | — | — | one-shot read, never revisited |
| `file` | requested file(s) **with content** | `tmp/` | **GitHub REST API** | `cat` | point lookup, single-file AST/outline |
| `tree` | bounded directory subtree **with content** | `tmp/` | **GitHub REST API** (`directoryFetch`) | `ls`, `grep`, `find`, `symbol-outline` | run local tools across a package **without cloning** |
| `clone` | sparse or full git checkout | `repos/` | git (existing `ghCloneRepo`) | — | whole-repo scope, large trees |

**The model (your call):** **files and trees are materialized to `~/.octocode/tmp`
via the GitHub API; clones are a separate git path.** A `tree` fetch pulls the
directory's file **bodies** (bounded — §4.3) so the **full local-tool suite runs on
it**: AST/structural search, ripgrep search, structure, find, get-content, and Tier-0
LSP — all with **no git, no clone**. This is exactly the existing `directoryFetch`
path (already GitHub-API → disk) **repointed from `repos/` to `tmp/`** and SHA-keyed —
not new machinery.

Why keep this distinct from clones (vs. routing trees to sparse clone): API
materialization is **git-free** (works where git is blocked/slow), **targeted** (only
the paths you fetch, not a checkout), and **already implemented**. Clones stay the
heavier, whole-repo mechanism. They overlap in capability by design — two existing
mechanisms for two situations, not two new ones.

Rules:
- **You opt *up*.** `none|file|tree` are **API fetches into `tmp/`**; `clone`
  (sparse/full) is the **separate git path** into `repos/` (§4.1.1).
- **Within `tmp/`, additive per `<sha>`** — files and tree fetches for the same commit
  accumulate in one `<sha>` dir.
- **Bounded** (§4.3) so a `tree` fetch can't drag in a huge directory — partial
  results are flagged, never silently complete.

### 4.3 Bounds (anti-bloat knobs, reuse `directoryFetch` limits)

| Bound | Default | Meaning |
|---|---|---|
| `maxFiles` | 50 | stop after N files |
| `maxBytes` | 5 MB total / 300 KB per file | size ceiling; oversize skipped + flagged |
| `maxDepth` | 2 | descent below `path` |
| `include` / `exclude` | — | **glob patterns** (e.g. `**/*.ts`), can't escape the subtree |
| `skipBinary` | true | skip `.png/.lock/.exe/...` (already in directoryFetch) |

When a bound trips, return the partial set **and** a flag
(`truncated: true, reason: "maxFiles", materialized: "50/214"`). A partial subtree
must never look complete (mirrors the existing archived-repo / redirect
"verify-absence" discipline).

### 4.4 Query-driven materialization (the biggest lever)

Let the query drive what lands on disk, not the directory size:
- **Query-scoped subtree** — a `lang:ts` structural search materializes only
  `**/*.ts(x)`, not the whole subtree.
- **Listing-first, body-on-demand** — `tree` gives the map for free; only paths the
  agent actually opens get bodies (`file` rung per hit). This is the natural "fetch
  a file, look around, pull the next" loop — each step a bounded write, never a
  clone.
- **Escalate, don't pre-fetch** — climb the ladder only when a question fails at the
  current rung. Most questions die at `file`/`tree`.

> Net effect: common path writes **kilobytes** (a listing) to **a few hundred KB**
> (a handful of files). A clone is the rare, explicit top rung — once per `<sha>`.

### 4.5 Tool wiring — CLI only (see §1.1)

All surfaces below are **CLI commands/flags in `packages/octocode`**, not MCP tools.

**`--repo owner/repo[@ref]` flag on read commands** (`cat`, `ls`, `grep`, `find`,
`symbol-outline`). When present, the CLI command:
1. resolves `repo[@ref] → <owner>/<repo>/<sha>`,
2. **ensures the needed granularity is materialized via the GitHub API** — `cat`→
   `file`, `ls`/`grep`/`find`/`symbol-outline`→`tree` (directory **with content**)
   into `tmp/`; only an explicit whole-repo need escalates to a `clone` in `repos/`
   (existing `ghCloneRepo` path),
3. rewrites the target to the on-disk cache path,
4. calls the **existing** local tool via `executeDirectTool` (unchanged native
   engine),
5. **relativizes results back** to repo-relative paths (so output shows
   `packages/react/src/React.js`, not `~/.octocode/tmp/...`).

```
octocode cat  facebook/react packages/react/src/React.js          # → file (w/ content) in tmp/ via API
octocode ls   facebook/react packages/scheduler                   # → tree (w/ content) in tmp/ via API
octocode grep --repo facebook/react@main "useReducer" packages/   # → tree in tmp/ via API, then localSearchCode
```

**Explicit staging command (ship first):** `octocode cache fetch owner/repo[@ref]
[path] [--depth file|tree|clone]` materializes and prints the cache path; the
user/agent can then run any normal local command on it. This proves the end-to-end
bet with **zero engine changes** and is trivially debuggable.

**Implementation note.** CLI is a thin renderer over `executeDirectTool` (confirmed:
`ls.ts → localViewStructure`, `clone.ts → ghCloneRepo`). The resolve→materialize→
relativize orchestration is driven by the CLI; reusable primitives may live in
tools-core **but are never registered as MCP tools** (§1.1). No data-shaping in the
CLI renderer beyond path rewriting/relativization (per project convention).

### 4.6 LSP tiering (be honest about the limit)

On a `tmp/` tree (API-materialized, with content), the **full syntactic local-tool
suite is drop-in**: AST/structural search, ripgrep search, structure, find,
get-content — all work fully, no git needed. LSP is the only partial one — it needs an
initialized server rooted at a real workspace (package.json/tsconfig/go.mod + deps),
and an API-fetched tree has no deps, so type-aware cross-file results aren't available.

- **Tier 0 (in scope, any granularity — incl. `tmp/` files & trees):** JS/TS native oxc fast-path — document
  symbols + in-file references. Server-free, works on one file. This is the **only**
  remote semantic tier this RFC ships.
- **Tier 1 — type-aware remote LSP — is OUT OF SCOPE.** It needs a full clone *plus*
  installed deps (`install --ignore-scripts` → arbitrary scripts, network, per-
  language toolchains): a rabbit hole with weak ROI on remote code. Deferred;
  revisit only if Tier 0 proves insufficient. (`manifest.complete` is recorded now
  so a future Tier 1 *could* gate on it, but nothing builds on it here.)
- **Always flag degraded modes** rather than silently returning thin results
  (matches the scanner "approximated + flagged" philosophy).

---

## 5. Eviction — removing old / stale content

SHA-keying changes what "stale" means:
- **Content can't go stale.** `gh/<o>/<r>/<sha>/...` is immutable — always correct.
  No content invalidation; only disk pressure and age.
- **Pointers go stale.** `ref → sha` drifts when a branch moves — the only thing
  needing freshness re-checks.

### 5.1 Two clocks

| Thing | TTL | Why |
|---|---|---|
| `ref → sha` pointer | short (~10 min / per-session) | branches move; cheap to re-resolve (1 API call) |
| materialized `<sha>` content | long (24 h, existing) | immutable; ages out only for space |

Decoupling avoids re-downloading immutable content just because a branch label was
re-checked.

### 5.2 GC sweep (extends the existing 10-min GC) — runs over both trees, separate budgets

The same 10-min GC sweeps **both** `tmp/` and `repos/`, but with **independent
budgets/TTLs** (clones are expensive to re-create, tmp is cheap to re-fetch — §4.1.1):

```
for each tree in [tmp/, repos/]:
  1. EXPIRE   drop <sha> entries past that tree's content TTL (expiresAt < now)
  2. ORPHAN   drop ref pointers whose <sha> dir is gone; re-resolve drifted refs
  3. BUDGET   while (tree.totalBytes > tree.maxSize || tree.entryCount > tree.maxEntries):
                 evict least-recently-USED entry that is NOT pinned
```

- **LRU by access, not by fetch** — bump `lastAccessedAt` on every read (search/ls/
  get-content). Today clone eviction is "least-recently-cloned"; upgrade both trees
  so an actively-searched cache survives.
- **Per-tree budgets** — `tmp/` gets a small cap (it's KB-scale loose files);
  `repos/` keeps the existing 2 GB / 50-clone caps. A 20 KB tree listing never
  competes for byte budget with a 2 GB clone.
- **Whole-entry eviction both trees** — `tmp/` holds bounded (few-MB) file/tree sets
  per `<sha>`, so per-path partial eviction isn't worth the bookkeeping; evict the
  whole `<sha>` entry. Clones already evict whole-entry (atomic git working trees).
- **tmp is evicted more aggressively** — cheap to re-fetch, so shorter TTL / tighter
  cap than `repos/` is the safe default.

### 5.3 Pinning

A session pins the SHAs it touches; pinned entries are exempt from BUDGET eviction
(but still TTL-expire after the session). Use the existing `session.json`
placeholder (`paths.ts`) for a `pins` set, or an access-lease timestamp ("pinned" =
leased within last N min — robust to crashes). Prevents the thrash where a big
search evicts the files the next query needs.

### 5.4 Manual + observability

- `octocode cache status` — extend existing `status.ts` (already reports `repos/`,
  `skills/`, `logs/` sizes) → per-repo/SHA breakdown, total vs cap, # pinned.
- `octocode cache clear [owner/repo[@sha]] [--all] [--stale]` — targeted purge;
  `--stale` runs EXPIRE+ORPHAN now.
- Alias `OCTOCODE_MAX_CLONES → OCTOCODE_MAX_ENTRIES` (entries are no longer only
  clones).

---

## 5.5 Concurrency & integrity

The CLI-only constraint (§1.1) **shrinks but does not eliminate** the concurrency
problem: there's no long-lived MCP writer, but multiple short-lived CLI processes
(and the background GC) can still touch the same `<sha>` dir and manifest at once.
Design for it from Phase 0 — retrofitting locks later is painful.

**Writers (materialization):**
- **Atomic, additive writes only.** Write each file to a temp name in the same dir,
  `fsync`, then `rename` (atomic on the same filesystem). A reader sees either the
  old state or the complete new file — never a half-written one.
- **Per-`<sha>` advisory lock for first materialization.** Serialize "is this SHA
  present? if not, fetch it" with a lockfile (`<sha>/.lock` via `O_EXCL`, carrying
  pid + timestamp; steal if stale > N min). Avoids two processes racing the same
  initial fetch. Once present, reads need no lock (writes are atomic + additive).
- **Manifest = derived, not authoritative.** Treat the manifest as a *hint/index*
  rebuildable from the actual files on disk. If it's missing/corrupt/out-of-sync, a
  reader falls back to scanning the dir; a writer rewrites it (temp+rename). Never
  let a bad manifest block access to files that are physically present.

**Readers (search/ls/cat):**
- Need no lock — atomic-rename writes + additive-only mutation make in-place reads
  safe. A concurrently-growing `<sha>` dir just means a reader might miss a
  not-yet-materialized file (acceptable; surfaces as the normal partial-coverage
  flag, §8).

**GC (the dangerous actor):**
- **Never delete in place.** To evict, `rename` the whole `<sha>` dir to a sibling
  `.trash/<sha>-<n>` then `rm -rf` the trash. A reader mid-search either kept its
  open handles or sees the dir vanish atomically — never a partial tree.
- **Respect leases.** Skip any entry whose pin-lease (§5.3) is fresh. Use leases,
  not a `pins` set, precisely because a CLI process can die without unpinning — a
  lease just expires.
- **Single GC at a time.** Guard the sweep with a global `tmp/.gc.lock`; if held,
  skip (another process is sweeping). GC is idempotent, so a skipped run is fine.

**Platform note — POSIX vs Windows (the rename-to-trash assumption).** The bullets
above are Unix semantics: on POSIX you can `rename`/`unlink` a dir that another
process has open, and that process's handles stay valid. **Windows does not allow
this** — renaming or deleting a directory with open handles fails with
`EBUSY`/`EPERM`, so a search holding files open would make GC's rename/`rm` throw.
The §4.0 "works on all platforms" claim therefore needs an explicit Windows branch:
- **Eviction is best-effort, never fatal.** Wrap the rename+rm in try/catch; on
  `EBUSY`/`EPERM`/`ENOTEMPTY`, **skip the entry this sweep and retry next sweep** —
  the entry is simply still over budget for 10 more minutes, which is harmless.
- **Trash dir is swept opportunistically.** A `.trash/*` entry that fails `rm` (open
  handle) is left and re-attempted on the next sweep, so nothing leaks permanently.
- **No lease held → still safe.** Because eviction can fail gracefully, an
  un-leased-but-open file on Windows is protected by the OS lock itself (rename
  fails), not just by our lease — leases remain the primary mechanism, the OS lock
  is the Windows backstop.
This keeps readers correct on both platforms; the only Windows cost is slightly
laggier reclamation under heavy concurrent use.

**Cross-tree links must be verified, never trusted.** The manifest's `clone`
cross-link (`{ dir: "repos/…" }`) is a *hint* — `repos/` runs its **own** GC and can
evict that clone independently of the `tmp/` manifest. Any code path that follows the
cross-link **must `stat` the clone dir at use time** and treat absence as "not
materialized" (re-clone on demand), exactly like a cache miss. Never assume a
recorded clone still exists. (This is the cross-tree exception to "manifest is
derived/rebuildable", which otherwise only governs the `tmp/` tree.)

**Cross-process model in one line:** *atomic-rename writes + additive-only +
rebuildable manifest + best-effort (Windows-safe) eviction + lease-based pins +
verify-on-use cross-links* → no reader ever sees a torn file, a half-deleted tree, or
a dangling clone pointer, and no global mutex is needed on the hot read path.
`repos/` clones inherit the existing `cache.ts` story (atomic dir rename on clone
completion); the new work is the `tmp/` tree.

---

## 6. Defaults (lean by design)

| Knob | Default | Rationale |
|---|---|---|
| `materialize` (file fetch) | `file` | only the file asked for |
| `materialize` (structure) | `tree` | directory with content, bounded — KB–few MB |
| `maxFiles` | 50 | matches directoryFetch |
| `maxBytes` | 5 MB total / 300 KB file | matches directoryFetch |
| `maxDepth` | 2 | shallow unless asked |
| cache root | `~/.octocode` | THE folder; under `$HOME` → allowed on all platforms (override: `OCTOCODE_HOME`) |
| fetch cache dir | `~/.octocode/tmp` | disposable, REST-sourced, our GC |
| clone dir | `~/.octocode/repos` | existing, git-sourced, separate lifecycle |
| `tmp/` content TTL | 6 h | cheap to re-fetch → evict eagerly |
| `repos/` content TTL | 24 h | existing; expensive to re-create |
| ref-pointer TTL | 10 min | branches drift slowly |
| `tmp/` size cap | 256 MB | loose files, kept small |
| `repos/` size cap | 2 GB | existing |
| `repos/` entry cap | 50 | existing |
| LRU basis | last **access** | survive active sessions |
| pinning | on for active session | no thrash |

**Principle:** every fetch defaults to the smallest footprint and escalates only on
demand; every byte on disk has an access clock and a budget that reclaims it.

---

## 7. Implementation plan (phased)

### Phase 0 — Foundation: SHA-keyed fetch cache + manifest
- Add `paths.tmp = join(OCTOCODE_HOME, 'tmp')` to `octocode-tools-core/.../paths.ts`;
  resolve home **only** via the config resolver `getOctocodeDir()` / `paths` — no
  `process.env.HOME`, no ad-hoc home computation (§4.0).
- New base `<paths.tmp>/<owner>/<repo>/<sha>/…` + `ref→sha` pointer file.
- Persist resolved SHA on every fetch; key on it.
- Write `.octocode-manifest.json` (schema §4.1).
- **Leave `~/.octocode/repos` (clones) untouched** — it's a separate tree with its
  own existing `cache.ts` manager (§4.1.1). Only add a manifest cross-link noting
  when a `full` clone of a SHA exists.

### Phase 1 — Self-cleaning cache (eviction) + concurrency
- Add `lastAccessedAt` to the manifest; bump on every read.
- GC over **both** trees with **separate budgets** (§5.2): EXPIRE → BUDGET
  (LRU-by-access). `tmp/` gets the new tighter caps; `repos/` keeps `cache.ts`'s.
- Land the concurrency primitives (§5.5): atomic temp+rename writes, per-`<sha>`
  lockfile, **best-effort (Windows-safe) eviction** (try/catch + skip-and-retry on
  `EBUSY`/`EPERM`), GC lock, lease-based pins, **verify-on-use cross-links**. **Do
  this now**, not later — readers/writers/GC assume it.
- **CI must cover Windows**, not just POSIX — the eviction-under-open-handle path
  diverges by platform (§5.5).

### Phase 2 — Smart bounded fetch (CLI path only, via GitHub API)
- Persist `file` (single file) and `tree` (directory **with content**) fetches into
  `tmp/` on the **CLI code path** via the GitHub API — repoint the existing
  `directoryFetch` writer from `repos/` to `paths.tmp`, SHA-keyed (MCP fetch stays
  in-memory — §1.1).
- `clone` (sparse/full) stays the existing separate git path in `repos/` (§4.1.1).
- Add the `materialize` enum + `maxFiles/maxBytes/maxDepth/include/exclude` bounds
  (directoryFetch already has the limit logic). Emit truncation flags.

### Phase 3 — Stale-pointer correctness
- Split ref-pointer TTL from content TTL; re-resolve drifted refs in GC (ORPHAN).
- Always resolve a passed ref to SHA before serving a cached listing.

### Phase 4 — Remote-as-local, explicit (ship first)
- CLI `octocode cache fetch owner/repo[@ref] [path] [--depth file|tree|clone]`
  → materializes + prints cache path. Document: "now run any local command on that
  path." → proves end-to-end with **zero engine changes**, no MCP surface touched.

### Phase 5 — Remote-as-local, sugar (CLI `--repo`) + LSP Tier 0
- `--repo owner/repo[@ref]` flag on `cat`/`ls`/`grep`/`find`/`symbol-outline`
  (resolve→materialize→relativize, §4.5).
- oxc remote symbol-outline (Tier 0, server-free, any granularity).
- **Type-aware remote LSP (Tier 1) is OUT OF SCOPE** for this RFC (dep-install rabbit
  hole, weak ROI on remote code). Revisit only if Tier 0 proves insufficient.

### Phase 6 — Operability
- `cache status` / `cache clear` CLI; pinning via `session.json`.
- Fix the in-path Windows home bugs (`status.ts:70`, `prompts.ts:350`) → route
  through `getOctocodeDir()`/`paths.home` (§4.0).

> Ordering rationale: Phases 0–1 make the cache correct and self-cleaning *before*
> Phase 2 starts filling it; Phase 4 proves the whole thesis with no engine risk
> before Phase 5 adds surface area.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **tmp-vs-clone overlap** | **intentional, low-cost (§4.2):** `tmp/` = files+trees via the GitHub API (the existing `directoryFetch` path repointed — not new code); `repos/` = git clones. Two existing mechanisms, git-free vs whole-repo, by design. |
| **Multi-process races (CLI ×N + GC)** | atomic temp+rename writes, per-`<sha>` lock, rename-to-trash eviction, GC lock, lease pins, rebuildable manifest (§5.5). CLI-only (§1.1) already removes the long-lived MCP writer. |
| **Windows file-locking (open-handle rename/delete)** | best-effort eviction: try/catch, skip-and-retry-next-sweep on `EBUSY`/`EPERM`; OS lock is the Windows backstop behind leases (§5.5 platform note). |
| **Stale clone cross-link** (`repos/` GC evicts a clone the manifest still records) | follow cross-links only after `stat`-ing the dir at use time; absence = cache miss → re-clone (§5.5). |
| Cache size blow-up across many SHAs | per-tree budgets + LRU-by-access; lean defaults (§6); tmp evicted aggressively |
| SHA-resolution API cost per first touch | cache `ref→sha` pointer (short TTL, refs rarely move mid-session) |
| Partial-tree false "not found" | manifest `complete:false` surfaced; partial searches **refuse a definitive "not found"** — they report "searched N of M; sparse-clone for full coverage" |
| LSP on incomplete workspaces | oxc Tier 0 only; **Tier 1 out of scope** (§Phase 5) |
| Path-validation regressions | no model change (`~/.octocode` under `$HOME`, all platforms); validate rewritten cache path exactly like a local one |
| **Wrong home dir on Windows** (`process.env.HOME` is empty there) | resolve home only via the config resolver `getOctocodeDir()`/`paths` (→ `os.homedir()`); fix existing `status.ts`/`prompts.ts` bugs; Windows CI (§4.0) |
| `@ref` ambiguity (`main`/`v1.2.3`/sha) | accept all; always resolve to and key on SHA |
| Binary/large files | carry directoryFetch's per-file/total caps + binary skip into single-file materialization |
| Eviction thrash mid-session | lease-based pinning (§5.3, §5.5) |
| MCP contract drift | **none** — no MCP tool added/changed (§1.1) |

---

## 9. Open questions

- **Pin lifetime** — lease-timer length (§5.5). Long enough to outlast a slow
  command, short enough to self-clear after a crash.
- **Cross-SHA dedup** — hardlink / content-addressed blob store for identical blobs
  across SHAs, or accept duplication first and revisit if caps bite?
- **`include/exclude` semantics** — confirm they stay glob patterns (can't escape
  the subtree), consistent with the local-tool security model.
- **Migration window** — how long to dual-run `repos/<branch>` alongside
  `gh/<sha>` before removing the old layout?

---

## 10. Why this is worth it

Turns one-shot fetches into a **searchable corpus**, **unifies** file/tree/clone
under one immutable key, **reuses** the native engine (the expensive part already
exists and already runs on arbitrary dirs), and keeps cost **escalating** — cheap
lookups stay cheap, and you pay for a clone only when a question truly needs it,
once per SHA. The cache stays small by default and self-reclaims old/stale bytes.
