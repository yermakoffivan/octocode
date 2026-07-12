# Scripts

Root-level automation scripts for the Octocode monorepo.

## Scripts

### `workspace-health.mjs`

Workspace orchestration tool that discovers all packages and skills, resolves their dependency graph, and runs tasks in topological order.

**Modes:**

| Mode | Command | Description |
|------|---------|-------------|
| `report` | `yarn health:report` | Print script matrix for all workspaces |
| `check` | `yarn health:check` | Verify every workspace has its required scripts |
| `check-outputs` | _(direct)_ | Verify expected build artifacts exist |
| `run <script>` | `yarn build`, `yarn test`, `yarn lint`, `yarn typecheck` | Run a named script across all workspaces in dependency order |
| `verify` | `yarn verify` | Full CI-grade check: contracts, docs, build, lint, test, typecheck, outputs |

### `dedupe-deps.mjs`

Workspace dependency-version deduper (replaces `syncpack`). Scans every workspace `package.json` and ensures each external dependency is declared at **one** consistent version range across all packages — a package pinning `zod@^4.3.6` while another pins `zod@^4.4.3` is a mismatch that lets two copies resolve. Local protocols (`workspace:`/`file:`/`link:`/`portal:`/`npm:`) and the exact-pinned native platform sub-packages are left untouched.

**Commands:**

| Command | Description |
|---------|-------------|
| `yarn deps:dedupe` | Report mismatches (exits non-zero if any) |
| `yarn deps:dedupe:fix` | Rewrite every occurrence to the highest declared version, then run `yarn install` |

### `sync-package-readmes.mjs`

Propagates the root `README.md` into each publishable package so the published npm package carries the canonical README. Run with no args to sync all packages, or pass package dirs to target specific ones.

**Command:** `yarn readme:sync` (also invoked per-package via each package's own `readme:sync`)

### `docs-verify.mjs`

Documentation link validator. Ensures every markdown link inside `docs/` uses absolute GitHub URLs (per the [Documentation Links Rule](https://github.com/bgauryy/octocode/blob/main/AGENTS.md)) and that in-repo links point to files that actually exist. Also validates that `.github/workflows/README.md` only references workflow files that are present on disk.

**Command:** `yarn docs:verify`
