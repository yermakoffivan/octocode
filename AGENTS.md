# AGENTS.md — Octocode Monorepo

> Single source of AI-agent guidance for the whole monorepo. There is **no** per-package `AGENTS.md`. Per-package internals are documented in each package's `ARCHITECTURE.md` and in [`docs/`](#documentation).

Octocode is a code-research toolset: search/read code across GitHub, npm, and the local filesystem, plus LSP semantic navigation — exposed both as an **MCP server** (for AI assistants) and a **CLI** (for terminals).

## Architecture in one picture

Logic flows bottom-up. The bottom layers own all behavior; the top layers are **thin** and only adapt that behavior to a transport.

```
                octocode-mcp            octocode            octocode-vscode
 INTERFACES   (MCP / stdio server)   (CLI: run + manage)   (VS Code extension)
                      └──────────────────┴── depend on ──┐
                                                          ▼
 BRAIN        @octocodeai/octocode-tools-core  ── all tool execution logic
              (github/, lsp/, tools/, utils/, security/, hints/, providers/)
              + shared infra (credentials, session, config, platform)
                      ├── metadata from ──▶  @octocodeai/octocode-core  (external dep:
                      │                       Zod schemas, tool descriptions, system prompt,
                      │                       mode enums — the metadata source of truth)
                      └── native calls ──▶  @octocodeai/octocode-engine  (Rust/napi)
 PRIMITIVES                                  minify · signatures · structural/AST search ·
                                             ripgrep parse · LSP · secret scan/sanitize · text
```

**Golden rule:** business logic, schemas, and tool metadata live in `octocode-tools-core` / `octocode-core` / `octocode-engine`. The interface packages (`octocode-mcp`, `octocode`, `octocode-vscode`) only register, render, and configure — never put data-shaping there.

## Packages

| Package (dir) | npm name | Role | Detail |
|---|---|---|---|
| [`packages/octocode-tools-core`](packages/octocode-tools-core) | `@octocodeai/octocode-tools-core` | **Brain** — every `execute*`/`search*` tool runner, GitHub/Octokit client, LSP pool, security wrappers, hints, providers, **and** shared credentials/session/config/platform. Consumed by both interfaces. | `src/{tools,github,lsp,security,hints,providers,utils,scheme,shared}/` |
| [`packages/octocode-engine`](packages/octocode-engine) | `@octocodeai/octocode-engine` | **Native primitives** (Rust/napi, the only Rust package): minify, signature extraction, structural/AST search, ripgrep parsing, secret detection + sanitization, LSP, text utils. | [ARCHITECTURE.md](packages/octocode-engine/ARCHITECTURE.md) |
| [`packages/octocode-mcp`](packages/octocode-mcp) | `octocode-mcp` | **MCP server** (stdio) for AI assistants. Thin: lifecycle + tool registration + output sanitization. Owns no logic. | [ARCHITECTURE.md](packages/octocode-mcp/ARCHITECTURE.md) |
| [`packages/octocode`](packages/octocode) | `octocode` | **CLI** — runs any tool from the terminal **and** manages install/auth/skills/MCP-marketplace. Thin: parse + render. | `src/{cli,configs,features,ui,utils}/` |
| `packages/octocode-vscode` | `octocode-mcp-vscode` | VS Code extension: GitHub OAuth, multi-editor MCP install, token sync. | — |

> `@octocodeai/octocode-core` is an **external** dependency (sibling `octocode-mcp-host` repo), not a workspace package here. It is the single source for schemas, descriptions, and the system prompt — `octocode-mcp`/CLI must not redefine those.

## Tools (13)

Same set surfaces through both MCP and CLI; defined once in `octocode-tools-core`.

**GitHub:** `ghSearchCode` · `ghGetFileContent` (dir mode needs `ENABLE_CLONE`) · `ghViewRepoStructure` · `ghSearchRepos` · `ghHistoryResearch` (PR/commit history) · `ghCloneRepo` (needs `ENABLE_CLONE`)
**Package:** `npmSearch`
**Local** (need `ENABLE_LOCAL`, default on): `localSearchCode` (ripgrep + `mode:"structural"` AST) · `localViewStructure` · `localFindFiles` · `localGetFileContent` · `localBinaryInspect`
**LSP:** `lspGetSemantics` (definition/references/callers/callees/callHierarchy/hover/symbols/typeDefinition/implementation — standalone, no IDE)

Every tool accepts **1–N bulk queries**; each query carries research context (`mainResearchGoal`, `researchGoal`, `reasoning`). All I/O is sanitized (secrets redacted, paths validated, command whitelist `rg`/`find`/`ls`). Output defaults to YAML, minified, paginated.

## Key flows

**Tool call (both interfaces share the same core runner):**
```
request → interface registers tool (schema from octocode-core)
        → security wrapper (validate args/paths) → core execute*() runner
        → octocode-engine native ops (search/minify/LSP) + GitHub/FS I/O
        → output sanitizer (secret masking) → YAML/JSON response (paginated)
```

**MCP startup** (`octocode-mcp/src/index.ts`): `initialize → configureSecurity → initializeProviders → loadToolContent → initializeSession → register tools → stdio connect`. See its [ARCHITECTURE.md](packages/octocode-mcp/ARCHITECTURE.md).

**CLI:** `main() → runCLI() → [tool runner | management command] | interactive menu`. Tools auto-discovered from core — adding a tool needs no CLI change.

**Clone → local → LSP:** `ghCloneRepo` (with `ENABLE_CLONE`) pulls a repo/subtree into `~/.octocode/`, then local + LSP tools analyze it. See [Clone Workflow](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CLONE_WORKFLOW.md).

## Working in this repo

**Methodology:** Plan → TDD (failing test → `yarn test` → fix) → `yarn lint` → verify. Prefer `octocode-local` MCP tools for research (LSP → local search → GitHub). Use Linux commands (`mv`/`cp`/`sed`) and batch file edits.

**Commands** (run from repo root; canonical list in the [Development Guide](https://github.com/bgauryy/octocode/blob/main/docs/DEVELOPMENT_GUIDE.md)):

| Task | Command |
|---|---|
| Build all | `yarn build` |
| Test / Lint / Typecheck (all workspaces) | `yarn test` · `yarn lint` · `yarn typecheck` |
| Full verify | `yarn verify` |
| Native (Rust) build | `yarn build:native:all` · `yarn platforms:check` |
| Per-package | `yarn workspace <pkg> <script>` |

Coverage target **90%** (Vitest + v8). Engine is tested with `cargo test`.

**Access control:**

| Path | Access |
|---|---|
| `packages/*/src/`, `packages/*/tests/`, `docs/` | ✅ auto |
| `*.json`, `*.config.*`, `Cargo.toml`, `scripts/` | ⚠️ ask |
| `.env*`, `node_modules/`, `dist/`, `out/`, `coverage/`, `target/` | ❌ never |

**Adding a tool:** define schema + description in `octocode-core`, the `execute*` runner in `octocode-tools-core`, and a thin `register*` in `octocode-mcp`. The CLI picks it up automatically.

**Engine changes** must preserve secret-redaction and path/command-validation contracts; keep TS wrappers thin and platform package names aligned with `octocode-engine` optionalDependencies.

## Local dev (build + drive the CLI)

The fastest way to exercise the whole stack end-to-end is the built CLI — it runs every tool through the same `octocode-tools-core` runners the MCP server uses.

**1. Build all packages** (from repo root): `yarn build`
(includes the Rust `octocode-engine` if native artifacts are missing; for just the native layer use `yarn build:native:all`.) Rebuild after editing any source.

**2. Run the built CLI directly** — no install needed:

```bash
node packages/octocode/out/octocode.js --help          # full surface + AGENT_INSTRUCTIONS
```

The CLI offers **three ways in**, increasingly raw:

- **Quick commands** — smart shortcuts that auto-route a *local path* vs an *`owner/repo`* ref (see `src/cli/routing.ts`). Add `--json` for the raw envelope.
  ```bash
  node packages/octocode/out/octocode.js ls   ./packages/octocode/src/cli   # local dir tree / symbol outline
  node packages/octocode/out/octocode.js cat  facebook/react/README.md      # GitHub file (auto-routed)
  node packages/octocode/out/octocode.js grep resolveRef ./packages/octocode # text/AST search
  ```
  Full set: `ls · cat · grep · find · lsp · repo · pr · history · pkg · binary · unzip · clone`.

- **Raw tools** — schema-exact, all 13 tools. **Always read the schema first; never guess fields** (e.g. `localSearchCode.keywords` is a *string*, not an array):
  ```bash
  node packages/octocode/out/octocode.js tools                              # list tools
  node packages/octocode/out/octocode.js tools localSearchCode --scheme     # read input schema
  node packages/octocode/out/octocode.js tools localSearchCode \
    --queries '{"path":"./packages/octocode/src/cli","keywords":"resolveRef","mode":"discovery"}' --compact
  ```
  `--queries` takes one object, an array of ≤5, or `{"queries":[...]}`. Metadata fields (`id`, `researchGoal`, `reasoning`, `mainResearchGoal`) are auto-filled.

- **`context [--full]`** — prints the full protocol + system prompt + tool descriptions for deeper research.

**Management:** `install --ide <client>` · `login` · `logout` · `status [--sync]`. (Note: `token`/`skills`/`auth status` were removed from the CLI surface.)

**Global flags:** `--json` (raw envelope) · `--compact` (leanest) · `--no-color`. **Exit codes:** `0` ok · `2` bad-input · `3` not-found · `4` auth · `5` tool-error · `7` rate-limited. Agents pass `GITHUB_TOKEN`/`OCTOCODE_TOKEN`/`GH_TOKEN` via env. Full surface: [CLI REFERENCE](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md).

## Documentation

All monorepo docs live in [`docs/`](docs) (no per-package `docs/`). **Documentation links must use absolute GitHub URLs**, base `https://github.com/bgauryy/octocode/blob/main/` — never relative paths.

**Index:** [docs/README.md](https://github.com/bgauryy/octocode/blob/main/docs/README.md)

| Doc | Read for |
|---|---|
| [DEVELOPMENT_GUIDE](https://github.com/bgauryy/octocode/blob/main/docs/DEVELOPMENT_GUIDE.md) | Setup, commands, testing standards, Linux/file ops |
| [SKILLS_GUIDE](https://github.com/bgauryy/octocode/blob/main/docs/SKILLS_GUIDE.md) | Install/build/browse skills marketplace |
| [PI_SETUP_GUIDE](https://github.com/bgauryy/octocode/blob/main/docs/PI_SETUP_GUIDE.md) | Octocode inside earendil-works/pi |
| **MCP:** [README](https://github.com/bgauryy/octocode/blob/main/docs/mcp/README.md) · [CONFIGURATION](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CONFIGURATION.md) · [AUTHENTICATION](https://github.com/bgauryy/octocode/blob/main/docs/mcp/AUTHENTICATION.md) · [CREDENTIALS](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CREDENTIALS.md) · [SESSION](https://github.com/bgauryy/octocode/blob/main/docs/mcp/SESSION.md) · [CLONE_WORKFLOW](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CLONE_WORKFLOW.md) · [TOOL_VERIFICATION](https://github.com/bgauryy/octocode/blob/main/docs/mcp/TOOL_VERIFICATION.md) | Configure, auth, sessions, verification |
| **MCP tools:** [GITHUB](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/GITHUB_TOOLS.md) · [LOCAL](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md) · [BINARY](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/BINARY_TOOLS.md) · [LSP](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LSP_TOOLS.md) · [TOOL_BEHAVIOR](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/TOOL_BEHAVIOR.md) | Per-tool inputs, behavior, tradeoffs |
| **CLI:** [README](https://github.com/bgauryy/octocode/blob/main/docs/cli/README.md) · [REFERENCE](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md) | All commands, flags, tool runner |
| **Release:** [release/RELEASE_GUIDE](https://github.com/bgauryy/octocode/blob/main/release/RELEASE_GUIDE.md) | Versioning + publish |
