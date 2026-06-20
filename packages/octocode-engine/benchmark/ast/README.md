# AST benchmark

Proves every supported tree-sitter grammar works end-to-end through the shipped
`octocode-engine` binary — run over the **real** third-party files in
`samples/` (provenance in `manifest.json`). Grammar crates are pinned at mixed
versions (0.7 → 1.0) against tree-sitter core 0.26; an ABI mismatch fails at
*parse* time, not compile time, so only running each grammar catches it.

```bash
node benchmark/ast/check-ast.mjs      # or: yarn ast:check
```

Per grammar:

1. **PARSE** — `structuralSearch(<real sample>, "$$$")` yields nodes (`$$$`
   matches any node sequence, so `>0` proves the grammar loaded and parsed the
   real file).
2. **MATCH** — `structuralSearch(<canonical snippet>, <pattern>)` resolves the
   expected metavars (proves the ast-grep query engine, not just the parser).
3. **SIGNATURE** — signature-tier grammars must return a non-empty skeleton from
   `extractSignatures` on both the canonical snippet and the real sample.

A coverage pass asserts every extension in
`getSupportedStructuralExtensions()` is claimed by exactly one grammar entry, so
adding a grammar to the engine without a sample + proof here fails the check.

To add a grammar: fetch a real sample into `samples/`, add it to `manifest.json`
(with sha256 + source), and add a `GRAMMARS` entry to `check-ast.mjs`.
