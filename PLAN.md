# PLAN — grep snippet bounds (CORRECTED)

## Why the first attempt was wrong
My `truncateSnippet` helper was data-shaping in the interface layer (grep.ts / local-search-render.ts) — a direct violation of the golden rule ("interface packages only register, render, configure — never data-shape"). It also papered over a redundant `.slice(0,120)` already sitting in the render layer. Reverted.

## Root cause (proven in octocode-engine — the data layer)
The engine ALREADY bounds snippets correctly and is the single owner:

1. **Local path** — `octocode-engine/src/search/ripgrep_parser.rs:189`:
   `assemble_file()` calls `truncate_unicode(&joined, max_snippet)` where
   `max_snippet = opts.max_snippet_chars.unwrap_or(DEFAULT_MAX_SNIPPET_CHARS=500)`
   (`ripgrep_search.rs:38,501`). `truncate_unicode` (parser.rs:116) cuts at a
   Unicode scalar boundary and appends `...` — char-safe, never mid-codepoint.
   Surfaced to TS as `RipgrepSearchOptions.max_snippet_chars` (types.rs:128),
   wired through `ripgrepExecutor.ts` → `matchContentLength`, and to the CLI as
   `--match-length` (grep.ts:519). Tested: `ripgrep_parser.rs:439,482,492,497,504`
   + `ffi.test.ts:1045`.

2. **GitHub path** — `octocode-tools-core/src/tools/providerMappers.ts:239`:
   `value: m.context` — the minified fragment is assigned UNGUARDED. No
   `max_snippet_chars` applied. (m.context comes from codeSearch.ts:257,
   minified but not length-bounded.)

## The bug
The CLI render layer re-truncates the engine's already-bounded `value`:
- `local-search-render.ts:82,99,108` — `.slice(0, 120)` (UTF-8-UNSAFE, mid-token)
- `grep.ts:314` — `.slice(0, 120)` (GitHub render, also collapses `\n`→space)

Two faults stacked: (a) redundant (engine already bounded local snippets at 500),
(b) wrong (`.slice` cuts UTF-8 mid-codepoint and mid-word → orphaned `imp`/`reso`).

## Fix (data-layer only — no CLI shaping)
- **Local:** remove `.slice(0,120)` from all 3 sites in `local-search-render.ts`.
  The engine's `truncate_unicode` (default 500, `--match-length` tunable) is the
  sole bound. `--page` already paginates files; snippets within are complete.
- **GitHub:** add the bound at `providerMappers.ts:239` where `value` is shaped.
  The cleanest reuse: cap `m.context` to the same default (500 chars) with a
  JS port of the engine's char-boundary + `…` rule — OR, if GitHub fragments
  are already short, just drop the CLI `.slice(0,120)` and leave unbounded
  (the minifier already collapsed them). Decide by measuring real `context`
  length first.

## Decision: measure first
Before touching providerMappers, measure actual GitHub `value` lengths from a
real `repo`/`grep` call. If ≤200 chars typical → the CLI `.slice(0,120)` was the
only bound and removing it unleashes long fragments → must add engine-style
bound at providerMappers. If already short → just remove the CLI slice.

## Verify
- `cd packages/octocode-engine && cargo test` (truncate_unicode suite)
- `cd packages/octocode && yarn vitest run tests/cli/commands/grep.test.ts tests/cli/commands/local-search-render.test.ts`
- Manual: rerun `grep resolveRef ./packages/octocode/src/cli` — no orphaned
  tokens; snippets end in `...` when the engine truncated them.
