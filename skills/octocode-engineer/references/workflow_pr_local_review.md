# Review Workflow — PR, Local Changes, and History

Use this when the user asks to review a pull request, review local/staged changes, check whether a PR is safe to merge, or inspect file/repo history. The main engineering contract, gates, and artifact rules remain in `../SKILL.md`.

## 1. Target detection

| User input | Mode | Primary tools |
|---|---|---|
| PR URL, `owner/repo#N`, “review PR N” | Remote PR | `ghHistoryResearch(type:"prs")`, optional clone for local AST/LSP |
| “review my changes”, “staged”, “local diff” | Local changes | shell `git status`/`git diff`, then local octocode tools |
| “who changed this file”, “file history”, “commit archaeology” | History | `ghHistoryResearch(type:"commits")` → PR deep read |
| Specific local file path | Local file scope | `localFindFiles`/`localViewStructure` → `localGetFileContent` → LSP references/callers |
| Ambiguous | Ask | “Review a PR, local changes, or commit history?” |

## 2. Guidelines gateway

Before reviewing, check for project rules:

- Local: `localFindFiles` for `.octocode/pr-guidelines.md`, `.octocode/context/context.md`, `CONTRIBUTING.md`, `AGENTS.md`.
- Remote: `ghSearchCode(match:"path")` for `pr-guidelines`, `CONTRIBUTING`, `AGENTS`.
- Read found files with `localGetFileContent` / `ghGetFileContent`.
- Ask the user if they have additional review guidelines or focus areas.

Precedence:
1. User-provided guidelines.
2. `.octocode/pr-guidelines.md`.
3. `.octocode/context/context.md`, `CONTRIBUTING.md`, `AGENTS.md`.
4. Default review domains in `checklist_review_domains.md`.

## 3. Remote PR workflow

```text
ghHistoryResearch(type:"prs", prNumber:N, content:{metadata:true, changedFiles:true, reviews:true})
→ ghHistoryResearch(... content:{comments:{discussion:true, reviewInline:true, includeBots:false}})
→ classify files: HIGH risk (auth/API/data/logic/contracts) vs LOW risk (docs/CSS/config)
→ ghHistoryResearch(... patches:{mode:"selected", files:[highRiskFiles]})
→ paginate patches/comments from contentPagination/hints; never compute offsets
→ clone repo/subtree if AST/LSP proof is needed
→ analyze only changed lines and directly affected context
→ dedupe against existing PR comments
```

Rules:
- Fetch metadata + changed files before patches.
- Use `patches.mode:"selected"` first; use `all` only for small PRs.
- Existing PR comments are a dedupe guard: do not repeat them; verify unresolved comments were fixed or re-flag as unresolved.
- Large PR (>500 lines or >15 files): recommend splitting or focus review on high-risk areas.

## 4. Local changes workflow

```text
git status
→ git diff --staged / git diff / git diff HEAD based on requested scope
→ git branch --show-current + git log --oneline -10
→ localViewStructure on changed parent dirs
→ localGetFileContent(matchString=changedFunctionName, minify:"none")
→ localSearchCode for exact symbols → lspGetSemantics(references/callers/callHierarchy)
→ localSearchCode(mode:"structural") for smell/security/perf patterns
→ report only changed-code issues plus direct blast-radius risks
```

Rules:
- Shell `git` is allowed for diff/status/log. Use octocode local tools for code reading/searching.
- If no changes are detected, stop and tell the user.
- If diff is too large, ask to scope to staged/unstaged/specific files.

## 5. Flow impact recipes

- Changed function signature → `localSearchCode(symbol)` → `lspGetSemantics(type:"callers", format:"compact")`.
- Changed type/interface → `lspGetSemantics(type:"references", groupByFile:true, includeDeclaration:false)`.
- Changed behavior with outgoing dependencies → `lspGetSemantics(type:"callees")`.
- High-risk flow → `lspGetSemantics(type:"callHierarchy", depth:2|3, format:"compact")`.
- Remote-only PR without clone → `ghSearchCode` for imports/callers → `ghGetFileContent(matchString)` for proof; mark confidence lower than local LSP.

## 6. Checkpoint and finalization

After context fetch, present a short checkpoint:

```text
Scope: <PR/local/history>, <files/lines>, risk areas
High-risk files: <list>
Existing comments/guidelines: <summary>
Question: Full review or focus on specific areas?
```

Before final report:
- Deduplicate by root cause and file line.
- Keep only HIGH/MED confidence findings; mark uncertainty explicitly.
- Cap at ~5–7 key issues.
- Every finding needs exact `file:line`, severity, confidence, and actionable fix.
- Never label findings as `#1`, `#2`, `#N`; GitHub auto-links those. Use `1.` or `[SEC-1]`.
