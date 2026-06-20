# octocode-engine — full format support

> **Generated** by `yarn matrix:check --write` (benchmark/check-matrix.mjs). Every cell
> is probed live against the shipped napi binary — do not edit by hand. Run
> `yarn matrix:check` to re-verify, or `yarn benchmark` for the full suite.

**143 extensions** known to the engine — 38 with structural AST, 25 with a
signature outline, 33 with an LSP server, 105 minify-only.

## Rich formats — AST + signature + LSP

Extensions with a wired tree-sitter grammar (and, where configured, a language
server). The minify column is the configured strategy.

| Extension | Minify | Structural AST | Signature outline | LSP (server → language-id) |
|-----------|--------|:--------------:|-------------------|----------------------------|
| `.bash` | `conservative` | ✅ | ✅ tree-sitter | `bash-language-server` → `shellscript` |
| `.c` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `c` |
| `.cc` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.cjs` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascript` |
| `.cpp` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.cs` | `conservative` | ✅ | ✅ tree-sitter | `csharp-ls` → `csharp` |
| `.css` | `aggressive` | ✅ | — | `vscode-css-language-server` → `css` |
| `.cts` | — | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.cxx` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.go` | `conservative` | ✅ | ✅ tree-sitter | `gopls` → `go` |
| `.h` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `c` |
| `.hh` | — | ✅ | ✅ tree-sitter | — |
| `.hpp` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.htm` | `aggressive` | ✅ | — | `vscode-html-language-server` → `html` |
| `.html` | `aggressive` | ✅ | — | `vscode-html-language-server` → `html` |
| `.hxx` | — | ✅ | ✅ tree-sitter | — |
| `.java` | `conservative` | ✅ | ✅ tree-sitter | `jdtls` → `java` |
| `.js` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascript` |
| `.json` | `json` | ✅ | — | `vscode-json-language-server` → `json` |
| `.jsonc` | `json` | ✅ | — | `vscode-json-language-server` → `json` |
| `.jsx` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascriptreact` |
| `.less` | `aggressive` | ✅ | — | `vscode-css-language-server` → `less` |
| `.mjs` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascript` |
| `.mts` | — | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.py` | `conservative` | ✅ | ✅ tree-sitter | `pylsp` → `python` |
| `.pyi` | — | ✅ | ✅ tree-sitter | `pylsp` → `python` |
| `.rs` | `conservative` | ✅ | ✅ tree-sitter | `rust-analyzer` → `rust` |
| `.sbt` | — | ✅ | — | — |
| `.sc` | — | ✅ | — | — |
| `.scala` | `conservative` | ✅ | — | — |
| `.scss` | `aggressive` | ✅ | — | `vscode-css-language-server` → `scss` |
| `.sh` | `conservative` | ✅ | ✅ tree-sitter | `bash-language-server` → `shellscript` |
| `.toml` | `conservative` | ✅ | — | `taplo` → `toml` |
| `.ts` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.tsx` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescriptreact` |
| `.yaml` | `conservative` | ✅ | — | `yaml-language-server` → `yaml` |
| `.yml` | `conservative` | ✅ | — | `yaml-language-server` → `yaml` |
| `.zsh` | `conservative` | ✅ | ✅ tree-sitter | `bash-language-server` → `shellscript` |

Notes:
- **Signature outline is tree-sitter only** — markup/style/config grammars
  (HTML/CSS/SCSS/LESS/Scala/JSON/YAML/TOML) parse for structural `rule` queries
  but have no function body, so no skeleton. There is **no** regex/heuristic
  fallback.
- **`.jsx`** resolves the LSP server as `javascriptreact` (to enable JSX) even
  though its tree-sitter grammar registry id is `javascript` (shared JS
  grammar). `.tsx` has its own grammar, so both ids are `typescriptreact`.
- **`.hh` / `.hxx`** have the C++ grammar + signatures but **no clangd server
  config** (only `.cpp/.cc/.cxx/.hpp` are mapped). `.mts/.cts/.pyi` have grammar
  + LSP but no dedicated minify strategy.
- **C/C++**: structural `rule` queries (e.g. `kind: call_expression`) work fully;
  a bare call-shaped `pattern` can hit tree-sitter's declaration-vs-call
  ambiguity — prefer a `rule` with `kind`. JS/TS also have a native (oxc)
  symbol/in-file-reference path that needs **no server installed**.

## Minify-only formats

Native comment/whitespace stripping; no AST/LSP. (105 extensions, grouped by strategy.)

**`aggressive`** (24): `clj` `cljs` `ejs` `erb` `erl` `ex` `exs` `handlebars` `hbs` `hrl` `jinja` `jinja2` `lua` `mustache` `pl` `pm` `r` `svelte` `svg` `twig` `vue` `xml` `xsl` `xslt`

**`conservative`** (76): `adb` `ads` `asm` `awk` `bzl` `cfg` `cmake` `coffee` `conf` `config` `csv` `dart` `dockerignore` `elm` `env` `f` `f03` `f08` `f90` `f95` `fish` `for` `fs` `fsx` `gitignore` `gql` `gradle` `graphql` `groovy` `haml` `hs` `ini` `jade` `jl` `kotlin` `kt` `lhs` `lisp` `lsp` `mm` `nasm` `nim` `nix` `pas` `perl` `php` `plsql` `pp` `properties` `proto` `ps1` `psd1` `psm1` `pug` `rb` `rkt` `rst` `rust` `sass` `scm` `slim` `sql` `star` `styl` `swift` `tf` `tfvars` `tsql` `v` `vb` `vbs` `vhd` `vhdl` `wast` `wat` `zig`

**`general`** (2): `log` `txt`

**`json`** (1): `json5`

**`markdown`** (2): `markdown` `md`

## Verify

```bash
yarn matrix:check     # this matrix, live
yarn ast:check        # structural search + signatures on real samples
yarn lsp:check        # language-id + server resolution + native semantics
yarn lsp:live         # spawn a real server, exercise every LSP operation type
yarn minify:check     # minifier over every configured format
yarn benchmark        # all of the above
```
