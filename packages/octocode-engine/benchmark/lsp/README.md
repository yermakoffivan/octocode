# LSP benchmark

Proves the `octocode-engine` LSP layer is wired correctly for every language
with a configured language server (`src/lsp/config.rs`) — run over the **real**
files in `samples/` (provenance in `manifest.json`).

```bash
node benchmark/lsp/check-lsp.mjs      # or: yarn lsp:check
```

Verified **without** needing the external servers installed:

1. **LANGUAGE-ID** — `detectLanguageId(<sample>)` equals the expected LSP
   language id.
2. **SERVER** — `getLanguageServerForFile(<sample>)` resolves a non-empty
   command and the expected `languageId` (spec → invocation resolution).
3. **NATIVE SEMANTICS** — in-process, no server required:
   - boundary-capable languages: `getSemanticBoundaryOffsets > 0` (tree-sitter).
   - JS/TS family: `extractJsSymbols` returns symbols (oxc native).

**Server availability** is reported (`isCommandAvailable`) but never fails the
check — the external servers are optional and installed per developer. Real
server-backed navigation (cross-file references, go-to-definition) is exercised
by the integration tests, not this benchmark.

Scala has a grammar but **no configured server**, so it is intentionally absent
here (present in `../ast` instead).
