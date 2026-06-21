# Release Guide

> Build, publish, and ship the Octocode packages — npm, native binaries, standalones, and Homebrew.

## Contents

- [Package Dependency Flows](#package-dependency-flows)
- [Native Binaries](#native-binaries)
- [Dev Workflow](#dev-workflow)
- [Build](#build)
- [Publish](#publish)
- [Standalone Binaries](#standalone-binaries)
- [Homebrew](#homebrew)

---

## Package Dependency Flows

Two interface packages ship to users independently:

```
npx octocode-mcp          →  octocode-mcp
npx octocode / Homebrew   →  octocode
```

Only these workspace packages are part of the monorepo:

| Directory | npm package | Role |
|---|---|---|
| `packages/octocode` | `octocode` | CLI/interface package: direct tool runner, auth, install, status, token, MCP marketplace, cache, and skills workflows. |
| `packages/octocode-mcp` | `octocode-mcp` | MCP server/interface package for AI assistants. |
| `packages/octocode-engine` | `@octocodeai/octocode-engine` | Rust-based native engine. |
| `packages/octocode-tools-core` | `@octocodeai/octocode-tools-core` | Core tool implementations and shared credentials/session/config/platform utilities. |
| `packages/octocode-vscode` | `octocode-mcp-vscode` | VS Code extension. |

### Dependency tree

```
octocode-mcp ──────────────────────────────────────────────────────────────────┐
octocode ──────────────────────────────────────────────────────────────────────┤
                                                                              │
    └─▶ @octocodeai/octocode-tools-core  (compiled; core tool implementations)
              ├─▶ @octocodeai/octocode-engine  (Rust .node native engine)
              └─▶ shared interfaces            (credentials/session/config/platform)
```

`octocode-mcp` adds `@modelcontextprotocol/sdk` and the MCP server layer on top. `octocode` skips the MCP layer and talks to `@octocodeai/octocode-tools-core` directly, so the CLI has no runtime dependency on `octocode-mcp`.

### What each package bundles vs. externalizes

| Package | Bundles (build output packs into dist/out) | Externalizes (npm installs separately) |
|---|---|---|
| `@octocodeai/octocode-engine` | TypeScript wrapper/build output | `zod`; ships its Rust `.node` via 6 platform `optionalDependencies` |
| `@octocodeai/octocode-tools-core` | Core tool implementation build output | `@modelcontextprotocol/sdk`, `@octocodeai/octocode-core`, `@octocodeai/octocode-engine`, `@octokit/*`, `@vscode/ripgrep`, `node-cache`, `octokit`, `zod` |
| `octocode-mcp` | MCP server build output | `@modelcontextprotocol/sdk`, `@octocodeai/octocode-tools-core` |
| `octocode` | CLI build output | `@inquirer/prompts`, `@octocodeai/octocode-tools-core`, `@octokit/*`, `open` |
| `octocode-mcp-vscode` | VS Code extension bundle | VS Code runtime APIs |

---

## Native Binaries

One workspace package compiles Rust to a `.node` native addon via [napi-rs](https://napi.rs/docs/deep-dive/release): `@octocodeai/octocode-engine`.

The engine owns the Rust-backed runtime work: security scanning/sanitization, path and command validation helpers, context minification, signature extraction, structural search helpers, ripgrep parsing, diff filtering, YAML serialization, pagination offsets, and LSP support.

### How it ships (napi-rs pattern)

The native package publishes one root package + 6 platform-specific packages:

```
@octocodeai/octocode-engine                 ← JS/TS loader only (no .node in tarball)
  optionalDependencies:
    @octocodeai/octocode-engine-darwin-arm64       ← contains .node for macOS Apple Silicon
    @octocodeai/octocode-engine-darwin-x64
    @octocodeai/octocode-engine-linux-arm64-gnu
    @octocodeai/octocode-engine-linux-x64-gnu
    @octocodeai/octocode-engine-linux-x64-musl     ← musl declares libc: ["musl"]
    @octocodeai/octocode-engine-win32-x64-msvc
```

At `npm install` time, npm checks `os` + `cpu` + `libc` on each platform package and installs only the match. The user gets exactly one `.node` file for the engine package.

### How users get the binary

Both interface packages deliver the same native engine through `@octocodeai/octocode-tools-core`:

```
npm install octocode-mcp            npm install octocode
  └─ @octocodeai/octocode-tools-core  └─ @octocodeai/octocode-tools-core
       └─ @octocodeai/octocode-engine      └─ @octocodeai/octocode-engine
            └─ one matching platform optionalDependency
```

### Runtime loader resolution order

The engine JS loader resolves the native binary through the package's runtime loader and platform `optionalDependencies`. Standalone binaries also place the engine `.node` under their bundled `dist/runtime/engine/` layout.

### Local development (Yarn workspaces)

The `packages/octocode-engine/npm/{platform}/` directories are declared as workspaces in the root `package.json`. Yarn resolves the exact-pinned `optionalDependencies` versions to the local workspace — no root-level `resolutions` needed.

---

## Dev Workflow

Day-to-day development loop for working across the Rust engine, core tool implementations, and interface packages that consume them.

### First-time setup

```bash
yarn install
```

This wires all workspace packages together. Because internal dependencies use `workspace:*`, Yarn links siblings directly — no npm publish needed to test changes locally.

If any `package.json` has a pinned version instead of `workspace:*` after a publish run, restore workspace refs:

```bash
node release/sync-packages-local.mjs --fix
yarn install
```

### Build the Rust engine for your platform

```bash
# macOS Apple Silicon
yarn workspace @octocodeai/octocode-engine run build:darwin-arm64

# macOS Intel
yarn workspace @octocodeai/octocode-engine run build:darwin-x64
```

The compiled `.node` is placed where the engine loader can resolve it for local development.

### Build TS packages

```bash
# From the package directory you changed:
yarn build:dev    # fast build when available
yarn build        # full package build

# Or rebuild everything from the repo root:
yarn workspaces foreach -pt run build:dev
```

Build order matters. Always build dependencies before consumers:

```
@octocodeai/octocode-engine → @octocodeai/octocode-tools-core → octocode-mcp / octocode / octocode-mcp-vscode
```

### Test

```bash
# From any package directory:
yarn test          # run package tests when available

# From the root (all packages):
yarn verify        # lint + typecheck + tests everywhere
```

### Keep versions in sync

When you bump the version in `packages/octocode-mcp/package.json`, align every other package:

```bash
node release/sync-packages-version.mjs
# → sets the same version on every package.json
# → converts any pinned internal dep back to workspace:*
```

To check that no package has accidentally lost its `workspace:*` ref:

```bash
node release/sync-packages-local.mjs
node release/sync-packages-local.mjs --verbose
```

### Typical change cycle

```
1. Edit source in packages/octocode-engine or packages/octocode-tools-core
2. yarn build:dev  (from the changed package)
3. yarn build:dev  (from octocode-tools-core if the engine changed)
4. yarn test       (from the affected package)
5. Test end-to-end from octocode-mcp or octocode
```

---

## Build

### Prerequisites

```bash
yarn install
```

### Build a package

```bash
# From the package directory:
yarn build
yarn build:dev    # when available
```

### Build native binaries (Rust)

```bash
# Build all 6 platforms for the native engine, then verify every platform .node exists:
yarn workspace @octocodeai/octocode-engine run build:all
yarn workspace @octocodeai/octocode-engine run platforms:check

# Or use the root aggregate scripts:
yarn build:native:all
yarn platforms:check

# Or one platform at a time:
yarn workspace @octocodeai/octocode-engine run build:darwin-arm64
```

The build scripts copy the compiled `.node` into `packages/octocode-engine/npm/{platform}/` automatically.

> ⚠️ A plain `yarn workspace @octocodeai/octocode-engine run build` compiles only the host platform and leaves the other five `npm/{platform}/` dirs empty. Always use `build:all` or per-target builds on matching CI runners before publishing, and let `platforms:check` confirm all six are present.

---

## Publish

### How users get binaries after `npm install`

When a user runs `npm install octocode-mcp` or `npm install octocode`, npm resolves the full dependency tree automatically:

```
npm install octocode-mcp  (or octocode)
  └─ @octocodeai/octocode-tools-core
       └─ @octocodeai/octocode-engine
            └─ optionalDependencies:
                 @octocodeai/octocode-engine-darwin-arm64   ← installed on macOS Apple Silicon
                 @octocodeai/octocode-engine-darwin-x64     ← installed on macOS Intel
                 @octocodeai/octocode-engine-linux-x64-gnu  ← installed on Linux x64
                 @octocodeai/octocode-engine-linux-x64-musl ← installed on Alpine/musl
                 @octocodeai/octocode-engine-linux-arm64-gnu
                 @octocodeai/octocode-engine-win32-x64-msvc
```

npm uses `os`, `cpu`, and `libc` fields on each platform package to install exactly one `.node` file — the one that matches the user's machine. No post-install scripts, no compilation on the user's machine.

### Pre-publish checks

> **Versioned independently** (engine `16.5.x`, tools-core `16.3.x`, octocode-mcp `16.2.x`). For an engine-only release, bump `packages/octocode-engine/package.json` and use the engine's `version:sync`. Do **not** run `release/sync-packages-version.mjs` — it forces every package to octocode-mcp's version and would downgrade the engine.

#### The engine is Rust → TS — verify both layers

| Layer | Produced by | Output | Guarded by |
|---|---|---|---|
| Rust native | `napi build` (×6 targets) | one `.node` per `npm/<platform>/` | `platforms:check` |
| JS/TS loader | `postbuild.cjs` restores `loader/{index.js,index.cjs,index.d.ts}` over the napi-generated files | root `index.*` (ESM `import` → `index.js`, CJS `require` → `index.cjs`) | `loader:check` |
| TS build | `tsc` | `dist/` (security + lsp) | `tsc` / `verify` |

The 6 `.npm` platform packages (`@octocodeai/octocode-engine-<platform>`) each carry exactly one `.node` and are exact-pinned in the root's `optionalDependencies`. The root tarball ships **no** `.node`.

#### Engine readiness (from repo root)

```bash
# 1. Bump packages/octocode-engine/package.json (16.5.0 is taken → 16.5.1+).
# 2. Propagate to Cargo + all 6 platform package.json. Run MANUALLY — the root is
#    published with --ignore-scripts, which skips the prepublishOnly hook.
yarn workspace @octocodeai/octocode-engine run version:sync

# 3. Rebuild all 6 native targets + TS (use matching CI runners for cross-compile):
yarn workspace @octocodeai/octocode-engine run build:all

# 4. Fast gate: version + loader entries + tarball purity + 6 binaries.
yarn workspace @octocodeai/octocode-engine run prepublish:verify

# 5. Full gate: cargo check/fmt/clippy/test/audit + tsc + vitest + benchmarks.
yarn workspace @octocodeai/octocode-engine run verify

# 6. Prove both entry points load on this host:
cd packages/octocode-engine
node --input-type=module -e "const m=await import('./index.js'); if(typeof m.applyContentViewMinification!=='function')throw Error('ESM broken'); console.log('ESM OK')"
node -e "if(typeof require('./index.cjs').applyContentViewMinification!=='function')throw Error('CJS broken'); console.log('CJS OK')"
cd ../..
```

#### What each check catches

| Check | Catches |
|---|---|
| `version:check` | Cargo / npm / 6-platform version drift |
| `loader:check` | CJS in the ESM entry (the 16.5.0 bug), napi auto-gen drift, `loader/` ↔ root mismatch |
| `pack:check` | a `.node` leaking into the root tarball |
| `platforms:check` | missing / empty / duplicate `.node` in any platform dir |
| `cargo clippy -D warnings`, `cargo fmt --check` | Rust lint / format (`cargo fmt --all` to fix) |
| `cargo check` / `cargo test` | Rust compile + behavior |
| ESM/CJS load (step 6) + post-publish smoke | entry points failing to import |

> Why this matters: 16.5.0 shipped an auto-gen **CJS** `index.js` under `"type": "module"`, so every ESM `import` threw `require is not defined in ES module scope`. `loader:check` (now in `verify` and `prepublish:verify`) fails the build if that recurs; the `loader/` canonical sources make it self-heal.

#### Monorepo ref hygiene (when releasing more than the engine)

```bash
rg '"workspace:|"file:' packages/*/package.json packages/*/npm/*/package.json
# → must be empty for whatever you publish. (CLI keeps a dev file: dep on
#   @octocodeai/octocode-core — pin it before publishing the CLI. Engine has none.)
yarn verify
```

### Publish order

Dependencies must exist on npm before dependents. Publish in this order:

```
1. @octocodeai/octocode-engine npm/{platform} × 6
2. @octocodeai/octocode-engine
3. @octocodeai/octocode-tools-core
4. octocode-mcp
5. octocode
6. octocode-mcp-vscode, when releasing the VS Code extension
7. Homebrew tap update for octocode
```

### Publish commands

> The engine root uses `--ignore-scripts` (no rebuild at publish), which also skips `prepublishOnly` — so `version:sync` + `prepublish:verify` must already have been run above.

```bash
npm whoami   # confirm auth

# Dry-run first:
for dir in packages/octocode-engine/npm/*; do
  npm publish "$dir" --access public --provenance --dry-run
done
npm publish packages/octocode-engine          --access public --provenance --ignore-scripts --dry-run
npm publish packages/octocode-tools-core      --access public --provenance --dry-run
npm publish packages/octocode-mcp             --access public --provenance --ignore-scripts --dry-run
npm publish packages/octocode                 --access public --provenance --dry-run

# Live publish (same commands, drop --dry-run):
for dir in packages/octocode-engine/npm/*; do
  npm publish "$dir" --access public --provenance
done
npm publish packages/octocode-engine          --access public --provenance --ignore-scripts
npm publish packages/octocode-tools-core      --access public --provenance
npm publish packages/octocode-mcp             --access public --provenance --ignore-scripts
npm publish packages/octocode                 --access public --provenance
```

### Restore workspace refs after publish

After publishing, internal deps are pinned to the exact version. Restore `workspace:*` so local development works again:

```bash
node release/sync-packages-version.mjs
yarn install
```

Or verify first, then fix:

```bash
node release/sync-packages-local.mjs
node release/sync-packages-local.mjs --fix
yarn install
```

### Smoke test after publish

```bash
tmp=$(mktemp -d) && cd "$tmp" && npm init -y >/dev/null
npm install octocode-mcp@X.Y.Z octocode@X.Y.Z
node --input-type=module -e "const e = await import('@octocodeai/octocode-engine'); console.log('engine:', typeof e.applyContentViewMinification === 'function')"
npx octocode-mcp --help
npx octocode --version
```

---

## Standalone Binaries

Standalone binaries bundle Bun + runtime assets (`rg`, `.node` files) into a single executable per platform. Used for the GitHub Release and Homebrew tap.

```bash
yarn workspace octocode-mcp run build:bin:darwin-arm64
yarn workspace octocode-mcp run build:bin:darwin-x64
yarn workspace octocode-mcp run build:bin:linux-arm64
yarn workspace octocode-mcp run build:bin:linux-x64
yarn workspace octocode-mcp run build:bin:linux-x64-musl
yarn workspace octocode-mcp run build:bin:windows-x64

cd packages/octocode-mcp/dist
shasum -a 256 octocode-mcp-* > checksums-sha256.txt
```

Upload the 6 binaries + `checksums-sha256.txt` to the GitHub Release for `vX.Y.Z`.

**Layout inside each standalone binary**:

```
dist/
  octocode-mcp-darwin-arm64
  runtime/
    rg/rg-darwin-arm64
    engine/octocode-engine.darwin-arm64.node
```

The loader checks bundled runtime paths before falling back to npm `optionalDependencies`, so standalone users need no npm install.

---

## Homebrew

**Tap repo:** [`bgauryy/homebrew-octocode`](https://github.com/bgauryy/homebrew-octocode)

The formula installs the published `octocode` npm tarball. Publish `octocode` first, then:

```bash
cd /Users/guybary/Documents/homebrew-octocode
./scripts/update-formula.sh X.Y.Z
brew style Formula/octocode.rb
brew audit --strict --online Formula/octocode.rb
brew uninstall octocode || true
brew install bgauryy/octocode/octocode
octocode --version && octocode tools
```

Homebrew users get native binaries through the same `optionalDependencies` chain: `octocode → @octocodeai/octocode-tools-core → @octocodeai/octocode-engine → platform .node`.

---

## References

- [napi-rs release docs](https://napi.rs/docs/deep-dive/release)
- [npm `os`/`cpu`/`libc` selectors](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [npm `optionalDependencies`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
