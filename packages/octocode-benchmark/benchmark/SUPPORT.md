# octocode-engine — full format support

> **Generated** by `yarn matrix:check --write` (benchmark/check-matrix.mjs). Every cell
> is probed live against the shipped napi binary — do not edit by hand. Run
> `yarn matrix:check` to re-verify, or `yarn benchmark` for the full suite.

**150 extensions** known to the engine — 61 with structural AST, 40 with a
signature outline, 56 with an LSP server, 89 minify-only.

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
| `.cts` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.cxx` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.erl` | `aggressive` | ✅ | ✅ tree-sitter | `erlang-ls` → `erlang` |
| `.ex` | `aggressive` | ✅ | ✅ tree-sitter | `elixir-ls` → `elixir` |
| `.exs` | `aggressive` | ✅ | ✅ tree-sitter | `elixir-ls` → `elixir` |
| `.gemspec` | — | ✅ | ✅ tree-sitter | `ruby-lsp` → `ruby` |
| `.go` | `conservative` | ✅ | ✅ tree-sitter | `gopls` → `go` |
| `.h` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `c` |
| `.hcl` | — | ✅ | — | `terraform-ls` → `terraform` |
| `.hh` | `conservative` | ✅ | ✅ tree-sitter | — |
| `.hpp` | `conservative` | ✅ | ✅ tree-sitter | `clangd` → `cpp` |
| `.hrl` | `aggressive` | ✅ | ✅ tree-sitter | `erlang-ls` → `erlang` |
| `.htm` | `aggressive` | ✅ | — | `vscode-html-language-server` → `html` |
| `.html` | `aggressive` | ✅ | — | `vscode-html-language-server` → `html` |
| `.hxx` | `conservative` | ✅ | ✅ tree-sitter | — |
| `.java` | `conservative` | ✅ | ✅ tree-sitter | `jdtls` → `java` |
| `.jl` | `conservative` | ✅ | — | `julia` → `julia` |
| `.js` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascript` |
| `.json` | `json` | ✅ | — | `vscode-json-language-server` → `json` |
| `.jsonc` | `json` | ✅ | — | `vscode-json-language-server` → `json` |
| `.jsx` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascriptreact` |
| `.kt` | `conservative` | ✅ | ✅ tree-sitter | `kotlin-language-server` → `kotlin` |
| `.kts` | — | ✅ | ✅ tree-sitter | `kotlin-language-server` → `kotlin` |
| `.less` | `aggressive` | ✅ | — | `vscode-css-language-server` → `less` |
| `.lua` | `aggressive` | ✅ | ✅ tree-sitter | `lua-language-server` → `lua` |
| `.mjs` | `terser` | ✅ | ✅ tree-sitter | `typescript-language-server` → `javascript` |
| `.ml` | — | ✅ | — | `ocamllsp` → `ocaml` |
| `.mli` | — | ✅ | — | `ocamllsp` → `ocaml` |
| `.mts` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.php` | `conservative` | ✅ | ✅ tree-sitter | `intelephense` → `php` |
| `.proto` | `conservative` | ✅ | — | `protols` → `proto` |
| `.py` | `conservative` | ✅ | ✅ tree-sitter | `pylsp` → `python` |
| `.pyi` | `conservative` | ✅ | ✅ tree-sitter | `pylsp` → `python` |
| `.r` | `aggressive` | ✅ | ✅ tree-sitter | `r-languageserver` → `r` |
| `.rake` | — | ✅ | ✅ tree-sitter | `ruby-lsp` → `ruby` |
| `.rb` | `conservative` | ✅ | ✅ tree-sitter | `ruby-lsp` → `ruby` |
| `.rs` | `conservative` | ✅ | ✅ tree-sitter | `rust-analyzer` → `rust` |
| `.ru` | — | ✅ | ✅ tree-sitter | `ruby-lsp` → `ruby` |
| `.sbt` | — | ✅ | — | — |
| `.sc` | — | ✅ | — | — |
| `.scala` | `conservative` | ✅ | — | — |
| `.scss` | `aggressive` | ✅ | — | `vscode-css-language-server` → `scss` |
| `.sh` | `conservative` | ✅ | ✅ tree-sitter | `bash-language-server` → `shellscript` |
| `.sql` | `conservative` | ✅ | — | `sqls` → `sql` |
| `.swift` | `conservative` | ✅ | ✅ tree-sitter | `sourcekit-lsp` → `swift` |
| `.tf` | `conservative` | ✅ | — | `terraform-ls` → `terraform` |
| `.tfvars` | `conservative` | ✅ | — | `terraform-ls` → `terraform` |
| `.toml` | `conservative` | ✅ | — | `taplo` → `toml` |
| `.ts` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescript` |
| `.tsx` | `conservative` | ✅ | ✅ tree-sitter | `typescript-language-server` → `typescriptreact` |
| `.yaml` | `conservative` | ✅ | — | `yaml-language-server` → `yaml` |
| `.yml` | `conservative` | ✅ | — | `yaml-language-server` → `yaml` |
| `.zig` | `conservative` | ✅ | ✅ tree-sitter | `zls` → `zig` |
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
  config** (only `.cpp/.cc/.cxx/.hpp` are mapped).
- **C/C++**: structural `rule` queries (e.g. `kind: call_expression`) work fully;
  a bare call-shaped `pattern` can hit tree-sitter's declaration-vs-call
  ambiguity — prefer a `rule` with `kind`. JS/TS also have a native (oxc)
  symbol/in-file-reference path that needs **no server installed**.

## Minify-only formats

Native comment/whitespace stripping; no AST/LSP. (89 extensions, grouped by strategy.)

**`aggressive`** (18): `clj` `cljs` `ejs` `erb` `handlebars` `hbs` `jinja` `jinja2` `mustache` `pl` `pm` `svelte` `svg` `twig` `vue` `xml` `xsl` `xslt`

**`conservative`** (66): `adb` `ads` `asm` `awk` `bzl` `cfg` `cmake` `coffee` `conf` `config` `csv` `dart` `dockerignore` `elm` `env` `f` `f03` `f08` `f90` `f95` `fish` `for` `fs` `fsx` `gitignore` `gql` `gradle` `graphql` `groovy` `haml` `hs` `ini` `jade` `kotlin` `lhs` `lisp` `lsp` `mm` `nasm` `nim` `nix` `pas` `perl` `plsql` `pp` `properties` `ps1` `psd1` `psm1` `pug` `rkt` `rst` `rust` `sass` `scm` `slim` `star` `styl` `tsql` `v` `vb` `vbs` `vhd` `vhdl` `wast` `wat`

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
