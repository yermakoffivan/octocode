# Research External — GitHub, npm, Cross-Repo Checks

Use this when code is not local yet, when starting from an npm package, when comparing implementations across repos, or when history/PR rationale matters.

## GitHub/npm CLI ↔ MCP map

| Job | CLI | MCP | Notes |
|---|---|---|---|
| npm package → repo | `octocode pkg <package>` | `npmSearch` | Best start for packages; returns repo and monorepo directory |
| Discover repos | `octocode repo <keywords>` | `ghSearchRepos` | Use `concise:true` first for lean owner/repo list |
| Map repo tree | `octocode ls <owner/repo>` | `ghViewRepoStructure` | Start `maxDepth:1`, then drill into source/subpackage |
| GitHub code/path search | `octocode grep <kw> <owner/repo>` | `ghSearchCode` | Discovery only; snippets are not proof |
| Fetch GitHub file | `octocode cat <owner/repo/path>` | `ghGetFileContent` | Use `symbols`, `matchString`, line ranges |
| PR review/history | `octocode pr <owner/repo[#N]>` | `ghHistoryResearch(type:"prs")` | List/search/deep-read PRs, comments, patches, reviews |
| Commit history | `octocode history <owner/repo[/path]>` | `ghHistoryResearch(type:"commits")` | File/dir/repo archaeology; extract PR numbers |
| Clone for local proof | `octocode clone <owner/repo[/path]>` | `ghCloneRepo` | Required for AST/LSP/deep multi-file analysis |

## Starting points

### Package name

```text
npmSearch(packageName)
→ if repositoryDirectory exists: ghViewRepoStructure(path:repositoryDirectory)
→ ghGetFileContent(minify:"symbols")
→ ghGetFileContent(matchString, minify:"none") for proof
→ clone if >3 files or AST/LSP needed
```

### Concept / unknown repo

```text
ghSearchRepos(keywords, language, stars, concise:true)
→ choose owner/repo
→ ghViewRepoStructure(maxDepth:1)
→ ghSearchCode(match:"path") for likely files
→ ghGetFileContent(symbols/matchString)
```

### Known owner/repo

```text
ghViewRepoStructure(maxDepth:1)
→ drill into src/package dir
→ ghSearchCode(concise:true or match:"path")
→ ghGetFileContent
```

## GitHub search rules

- `ghSearchCode` is discovery. `matchIndices` are character offsets in snippets, not line numbers.
- Use `concise:true` for lean path lists.
- Use `match:"path"` to confirm file existence without snippets.
- Use `match:"file"` for content snippets, then re-anchor with `ghGetFileContent(matchString)`.
- GitHub code search indexes default branch and has result caps; empty ≠ absent.
- Keywords are ANDed; alternatives belong in separate batched queries.

## GitHub fetch/read proof

Use `ghGetFileContent` as the remote proof tool:

- `minify:"symbols"` — orient on source file skeleton.
- `matchString` — returns `matchRanges[].start` real line numbers.
- `minify:"none"` — exact quote/diff evidence.
- `startLine/endLine` — known range read.
- `fullContent` — small files only.

If the investigation needs semantic identity, clone and switch to local LSP. Remote GitHub fetch cannot do LSP by itself.

## History and PR archaeology

### Find why code exists

```text
ghHistoryResearch(type:"commits", owner, repo, path)
→ inspect messageHeadline for (#PR)
→ ghHistoryResearch(type:"prs", prNumber, content:{body:true, changedFiles:true, patches:{mode:"selected"}})
```

### Review a PR remotely

```text
ghHistoryResearch(type:"prs", prNumber, content:{metadata:true, changedFiles:true, reviews:true})
→ ghHistoryResearch(... comments:{discussion:true, reviewInline:true})
→ ghHistoryResearch(... patches:{mode:"selected", files:[highRiskFiles]})
→ paginate from contentPagination/hints
```

Rules:
- Fetch changed file list before patches.
- Prefer selected patches over all patches.
- Fetch existing comments before producing findings to avoid duplicates.

## Cross-repo comparison

```text
ghSearchRepos / npmSearch for candidates
→ ghViewRepoStructure each repo/subdir
→ ghSearchCode(match:"path" or concise:true) for equivalent files
→ ghGetFileContent(minify:"symbols") for outlines
→ ghGetFileContent(matchString) for exact implementations
→ compare with file:line citations
```

For serious comparison, clone candidates and use local tools:

```text
ghCloneRepo(owner/repo/path)
→ localViewStructure
→ localSearchCode / AST
→ localGetFileContent(symbols/matchString)
→ lspGetSemantics
```

## Remote → local handoff triggers

Clone when:
- analysis spans more than ~3 files in one repo;
- AST structural search is needed;
- LSP definition/references/call hierarchy is needed;
- you need to inspect generated/local package relationships;
- GitHub search is capped/noisy/empty but structure suggests code exists.
