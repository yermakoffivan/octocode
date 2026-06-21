# Octocode Evals

Release-readiness benchmark for Octocode CLI commands, raw MCP tools, feature
checks, and cross-tool flows. Scores rate eval coverage, not product quality.

Scale: `10` full (dispatch + execute + envelope + behavior + pagination +
negative + cross-flow) · `8-9` core + one of pagination/negative/cross-flow,
env-gated gap · `6-7` smoke only (side-effectful/interactive) · `<6` not
release-ready.

## Coverage Summary — `9.1/10`

| Feature Area | Rating |
|---|---:|
| CLI discovery/help/context | 10 |
| Raw tool schema discipline | 10 |
| Local structure/find/read | 10 |
| Text search | 10 |
| Structural search | 9 |
| GitHub code/repo/content/tree | 9 |
| PR/history archaeology | 8.5 |
| npm/package lookup | 8 |
| LSP semantics | 8 |
| Pagination | 9.5 |
| Minification/content views | 9 |
| Binary inspect/strings | 9 |
| Archive list/extract/decompress | 9.5 |
| Clone/cache remote-as-local | 9 |
| Output contract | 9.5 |
| Error/gate behavior | 8.5 |
| Management commands | 7 |

## CLI Commands

| Surface | Rating |
|---|---:|
| global help | 10 |
| context | 10 |
| tools list | 10 |
| tools --scheme | 10 |
| tools <name> --queries | 10 |
| ls local | 10 |
| ls symbols | 9 |
| ls remote | 9 |
| cat local exact | 10 |
| cat minification | 9 |
| cat local slice | 10 |
| cat pagination | 9 |
| cat remote | 9 |
| grep text | 10 |
| grep regex/options | 9 |
| grep pagination | 9 |
| grep structural | 9 |
| grep remote text | 8.5 |
| grep --repo | 9 |
| find local | 10 |
| find remote | 8.5 |
| diff | 9 |
| lsp | 8 |
| repo | 8.5 |
| pr list | 8.5 |
| pr detail | 8 |
| history | 8.5 |
| pkg | 8 |
| binary inspect | 9 |
| binary strings | 9 |
| binary list | 10 |
| binary extract | 9.5 |
| binary decompress | 9.5 |
| unzip | 9.5 |
| clone | 9 |
| cache fetch | 9.5 |
| cache status | 9 |
| cache clear | 7 |
| status | 8 |
| install | 6.5 |
| login | 6 |
| logout | 6.5 |

## Raw Tools

| Tool | Rating |
|---|---:|
| ghSearchCode | 9 |
| ghSearchRepos | 8.5 |
| ghHistoryResearch | 8.5 |
| ghGetFileContent | 9.5 |
| ghViewRepoStructure | 9 |
| ghCloneRepo | 9 |
| localSearchCode | 10 |
| localFindFiles | 10 |
| localGetFileContent | 10 |
| localViewStructure | 10 |
| localBinaryInspect | 9.5 |
| lspGetSemantics | 8 |
| npmSearch | 8 |

## Feature Checks

| Check | Rating |
|---|---:|
| Pagination | 9.5 |
| Minification/content views | 9 |
| Binary & archive handling | 9.5 |
| Output contract | 9.5 |

## Cross-Flows

| Flow | Rating |
|---|---:|
| local search → exact read | 10 |
| structural search → LSP | 8.5 |
| remote → local cache | 9.5 |
| archive → local tools | 9.5 |
| package → source repo | 8 |
| PR archaeology | 8 |
| binary extraction → content | 9 |

## Status Labels

`pass` · `pass-empty` · `blocked:auth` · `blocked:native` · `blocked:lsp` ·
`blocked:artifact` · `skip:side-effect` · `fail`
