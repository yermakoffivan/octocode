import type { CLICommandSpec } from '../types.js';

export const COMMAND_SPECS: readonly CLICommandSpec[] = [
  {
    name: 'cat',
    description:
      'Read and minify file content for local paths and GitHub references',
    usage:
      'cat <path|github-ref> [--mode none|standard|symbols] [--branch <ref>] [--match-string <s>] [--match-regex] [--match-case-sensitive] [--start-line <n>] [--end-line <n>] [--context-lines <n>] [--page-size <n>] [--page <n>] [--char-offset <n>] [--char-length <n>] [--full-content] [--content-type file|directory] [--force-refresh] [--json]',
    scheme: [
      'arg[0] target: required string; local file path OR owner/repo/path GitHub ref.',
      'options: --mode enum(none|standard|symbols, default standard), --branch string, --content-type enum(file|directory).',
      'slice options: --match-string string, --match-regex boolean, --match-case-sensitive boolean, --start-line int, --end-line int, --context-lines int.',
      'page options: --page-size int chars, --page int, --char-offset int, --char-length int, --full-content boolean.',
      'runtime: local target -> localGetFileContent; GitHub target -> ghGetFileContent.',
      'output: YAML content by default; --json returns the raw tool envelope.',
    ],
    whenToUse: [
      'Use after ls/find/grep identifies a file or exact slice to read.',
      'Default mode is standard (strips comments/blanks, token-efficient). Use --mode symbols for a skeleton map; use --mode none only when comments or exact formatting are required.',
      'If output is paginated, continue only when the page hints say more content is needed; otherwise narrow with --match-string or line bounds.',
    ],
    examples: [
      'cat packages/octocode/src/cli/index.ts',
      'cat bgauryy/octocode-mcp/package.json --mode none',
      'cat src/index.ts --match-string "runCLI" --mode none',
    ],
    options: [
      {
        name: 'mode',
        hasValue: true,
        description:
          'Minification mode: standard for readable code, symbols for outline, none for exact text',
      },
      {
        name: 'branch',
        hasValue: true,
        description: 'Branch or ref for GitHub paths',
      },
      {
        name: 'match-string',
        hasValue: true,
        description: 'Return only sections matching this string',
      },
      { name: 'match-regex', description: 'Treat match-string as a regex' },
      {
        name: 'match-case-sensitive',
        description: 'Match string case-sensitively',
      },
      {
        name: 'start-line',
        hasValue: true,
        description: 'First line to return, 1-based',
      },
      {
        name: 'end-line',
        hasValue: true,
        description: 'Last line to return, 1-based',
      },
      {
        name: 'context-lines',
        hasValue: true,
        description: 'Context lines around match-string slices',
      },
      {
        name: 'page-size',
        hasValue: true,
        description: 'Characters per page',
      },
      {
        name: 'page',
        hasValue: true,
        description: 'Page number when using page-size',
      },
      { name: 'char-offset', hasValue: true, description: 'Character offset' },
      { name: 'char-length', hasValue: true, description: 'Character length' },
      {
        name: 'full-content',
        description: 'Return the whole file instead of a page or match slice',
      },
      {
        name: 'content-type',
        hasValue: true,
        description: 'GitHub content type: file or directory',
      },
      { name: 'force-refresh', description: 'Bypass GitHub cache' },
      { name: 'json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'ls',
    description:
      'View directory structure for local paths and GitHub repositories, with filtering and sorting',
    usage:
      'ls <path|github-ref> [--depth <n>] [--branch <ref>] [--pattern <glob>] [--ext <list>] [--sort name|size|time|extension] [--reverse] [--files-only] [--dirs-only] [--hidden] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
    scheme: [
      'arg[0] target: required string; local directory path OR owner/repo[/subpath] GitHub ref.',
      'shared options: --depth int (1 = top level; raise to descend), --branch string (GitHub), --limit int, --page int, --page-size int, --json boolean.',
      'local-only filters: --pattern glob/substring, --ext comma-list, --sort enum(name|size|time|extension), --reverse, --files-only, --dirs-only, --hidden. Rejected on GitHub refs.',
      'runtime: local target -> localViewStructure; GitHub target -> ghViewRepoStructure.',
      'output: YAML tree by default; --json returns the raw tool envelope.',
    ],
    whenToUse: [
      'Use first when the repository or directory layout is unknown.',
      'Locally, narrow with --pattern/--ext and --sort time to spot recent files, or --files-only/--dirs-only to focus.',
      'Follow with find/grep to locate specific paths, then cat for source.',
    ],
    examples: [
      'ls packages/octocode/src --depth 2',
      'ls src --ext ts --files-only --sort time',
      'ls bgauryy/octocode-mcp --depth 2',
    ],
    options: [
      {
        name: 'depth',
        hasValue: true,
        description: 'Recursion depth (1 = top level; raise to descend)',
      },
      {
        name: 'branch',
        hasValue: true,
        description: 'Branch or ref for GitHub paths',
      },
      {
        name: 'pattern',
        hasValue: true,
        description:
          'Name filter — glob or substring, e.g. "*.ts" (local only)',
      },
      {
        name: 'ext',
        hasValue: true,
        description: 'Extension whitelist, e.g. ts,tsx (local only)',
      },
      {
        name: 'sort',
        hasValue: true,
        description: 'Order: name, size, time, extension (local only)',
      },
      { name: 'reverse', description: 'Reverse the sort order (local only)' },
      { name: 'files-only', description: 'List files only (local only)' },
      { name: 'dirs-only', description: 'List directories only (local only)' },
      { name: 'hidden', description: 'Include hidden dot-files (local only)' },
      {
        name: 'limit',
        hasValue: true,
        description: 'Cap entries discovered before pagination',
      },
      { name: 'page', hasValue: true, description: 'Result page' },
      { name: 'page-size', hasValue: true, description: 'Entries per page' },
      { name: 'json', description: 'Output raw JSON structure' },
    ],
  },
  {
    name: 'grep',
    description:
      'Text/regex code search (ripgrep) across local paths and GitHub repositories. For AST shape queries use the ast command.',
    usage:
      'grep <keywords> <path|github-ref> [--type <ext>] [--mode paginated|discovery|detailed] [--concise] [--include <glob>] [--exclude <glob>] [--context-lines <n>] [--max-matches <n>] [--branch <ref>] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
    scheme: [
      'arg[0] keywords: text or regex (ripgrep). Required.',
      'arg[1] target: local path OR owner/repo[/path] GitHub ref. Defaults to "." for local.',
      'options: --type extension/language string, --mode enum(paginated|discovery|detailed, local only), --concise (paths only — GitHub flat "owner/repo:path", local = mode discovery), --include/--exclude globs (local), --context-lines int, --max-matches int, --branch string, --limit int, --page int, --page-size int, --json boolean.',
      'runtime: local -> localSearchCode; GitHub -> ghSearchCode.',
      'output: YAML search hits by default; snippets are discovery, then use cat for evidence.',
    ],
    whenToUse: [
      'Use when you know code text, a function name, an error string, or an import to find.',
      "For a CODE SHAPE regex can't express (call sites, specific AST forms), use the ast command instead.",
      'Search results are discovery; follow with cat --match-string or lsp when you need exact proof.',
    ],
    examples: [
      'grep "executeDirectTool" packages/octocode/src --type ts',
      'grep "useState" facebook/react --type tsx --limit 5',
      'grep "TODO" . --mode discovery',
    ],
    options: [
      {
        name: 'type',
        hasValue: true,
        description: 'Filter by language or extension, for example ts, py, go',
      },
      {
        name: 'mode',
        hasValue: true,
        description:
          'Local search mode: paginated (default), discovery (paths only), detailed (expanded context)',
      },
      {
        name: 'concise',
        description:
          'Paths only, no snippets (cheapest). GitHub: flat owner/repo:path list; local: = mode discovery',
      },
      {
        name: 'include',
        hasValue: true,
        description: 'Comma-separated include globs (local only)',
      },
      {
        name: 'exclude',
        hasValue: true,
        description: 'Comma-separated exclude globs (local only)',
      },
      {
        name: 'context-lines',
        hasValue: true,
        description: 'Lines of context around each match (local only)',
      },
      {
        name: 'max-matches',
        hasValue: true,
        description: 'Max matches returned per file (local only)',
      },
      {
        name: 'limit',
        hasValue: true,
        description: 'Max files to show in rendered output',
      },
      {
        name: 'page',
        hasValue: true,
        description: 'Result page to fetch from the underlying search tool',
      },
      {
        name: 'page-size',
        hasValue: true,
        description: 'Results per page passed to the underlying search tool',
      },
      {
        name: 'branch',
        hasValue: true,
        description: 'Branch or ref for GitHub paths',
      },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'ast',
    description:
      'Search code by AST shape (ast-grep) — structure-aware, so comments/strings never false-match. Local paths only.',
    usage:
      'ast <pattern> [path] | ast [path] --rule <yaml> [--type <lang>] [--context-lines <n>] [--max-matches <n>] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
    scheme: [
      'arg[0] pattern: ast-grep code shape. Metavars $X = one node, $$$ARGS = a list, e.g. "eval($X)". When --pattern/--rule is given, arg[0] is the path instead.',
      'arg[1] target (or arg[0] with a flag): local path. Defaults to ".". GitHub refs are rejected — clone first.',
      '--pattern: AST shape (alternative to the positional). --rule: YAML relational/composite blob (not/inside/has/all/any) for what --pattern can\'t express; relational sub-rules need "stopBy: end". Mutually exclusive.',
      'options: --type language/extension, --context-lines int, --max-matches int, --limit int, --page int, --page-size int, --json boolean.',
      'runtime: localSearchCode mode:"structural" (no GitHub).',
      'output: YAML node-range hits; matches[].line still feeds lspGetSemantics lineHint.',
    ],
    whenToUse: [
      "Use for a CODE SHAPE regex can't express — call sites, specific syntactic forms, excluding comments/strings.",
      'Use --rule for relational queries (a node inside/has another). Remember "stopBy: end" on relational sub-rules.',
      'For plain text/keyword search use grep; for symbol identity use lsp.',
    ],
    examples: [
      'ast "eval($X)" packages/octocode/src',
      "ast 'console.log($$$)' src --type ts",
      'ast src --pattern "oldApi.$M($$$)"',
    ],
    options: [
      {
        name: 'pattern',
        hasValue: true,
        description:
          'ast-grep AST shape (alternative to the positional pattern). Metavars $X (one node), $$$ARGS (a list).',
      },
      {
        name: 'rule',
        hasValue: true,
        description:
          'ast-grep YAML rule for not/inside/has/all/any. Mutually exclusive with a pattern.',
      },
      {
        name: 'type',
        hasValue: true,
        description: 'Filter by language or extension, for example ts, py, go',
      },
      {
        name: 'context-lines',
        hasValue: true,
        description: 'Lines of context around each match',
      },
      {
        name: 'max-matches',
        hasValue: true,
        description: 'Max matches returned per file',
      },
      {
        name: 'limit',
        hasValue: true,
        description: 'Max files to show in rendered output',
      },
      { name: 'page', hasValue: true, description: 'Result page to fetch' },
      {
        name: 'page-size',
        hasValue: true,
        description: 'Results per page',
      },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'find',
    description:
      'Find file paths and content matches across local paths and GitHub repositories',
    usage:
      'find <query> [path|owner/repo] [--owner <owner> --repo <repo>] [--source auto|local|github] [--search path|content|both] [--ext <list>] [--path <subpath>] [--limit <n>] [--page <n>] [--concise] [--json]',
    scheme: [
      'arg[0] query: required string; filename/path fragment or content term.',
      'arg[1] target: optional local path OR owner/repo; may be replaced by --owner and --repo for GitHub.',
      'source options: --source enum(auto|local|github, default auto), --search enum(path|content|both, default path), --ext comma-list, --path subpath/root.',
      'GitHub filters: --owner string, --repo string, --filename string, --concise (GitHub only: flat "owner/repo:path" list, no snippets), --branch not supported here.',
      'local path filters: --name, --path-pattern, --regex, --entry enum(f|d), --min-depth int, --max-depth int, size/time/permission flags.',
      'local content filters: --include/--exclude globs, --mode enum(paginated|discovery|detailed), rg booleans, context/count/page controls.',
      'full flag set (size/time/permission filters, rg booleans, sort, counts) — see tools localFindFiles --scheme / tools localSearchCode --scheme.',
      'runtime: path search -> localFindFiles or ghSearchCode(match:path); content search -> localSearchCode or ghSearchCode(match:file).',
      'output: YAML file hits by default; --json returns raw combined tool results.',
    ],
    whenToUse: [
      'Use when you know a filename, path fragment, extension, or broad content term.',
      'Use --search path for filename/path discovery, content for text matches, and both when unsure.',
      'Follow path hits with cat for exact source, or grep when you need line-level code matches.',
    ],
    examples: [
      'find "command-help" packages/octocode/src --search both --ext ts',
      'find "package.json" bgauryy/octocode-mcp --search path --source github',
      'find "parser" . --source local --search path --ext ts',
    ],
    options: [
      {
        name: 'source',
        hasValue: true,
        description: 'auto routes by target; local/github force a side',
      },
      {
        name: 'search',
        hasValue: true,
        description:
          'path = filenames/paths, content = text matches, both = run both',
      },
      {
        name: 'ext',
        hasValue: true,
        description:
          'Comma-separated extensions; GitHub expands into bulk queries',
      },
      {
        name: 'path',
        hasValue: true,
        description: 'Local search root override or GitHub repo subpath',
      },
      { name: 'owner', hasValue: true, description: 'GitHub owner' },
      { name: 'repo', hasValue: true, description: 'GitHub repository' },
      { name: 'name', hasValue: true, description: 'Local name pattern(s)' },
      { name: 'regex', hasValue: true, description: 'Local find regex' },
      {
        name: 'entry',
        hasValue: true,
        description: 'Local entry type: f or d',
      },
      { name: 'max-depth', hasValue: true, description: 'Local maximum depth' },
      {
        name: 'mode',
        hasValue: true,
        description: 'Local content mode: paginated, discovery, detailed',
      },
      {
        name: 'concise',
        description: 'GitHub: flat owner/repo:path list, no snippets',
      },
      {
        name: 'limit',
        hasValue: true,
        description: 'Max results per underlying tool call',
      },
      { name: 'page', hasValue: true, description: 'Result page' },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'pr',
    description:
      'Search and view pull requests; list with filters or deep-dive one PR',
    usage:
      'pr <owner/repo[#N] | PR-URL> [--pr <n>] [--state open|closed|merged] [--concise] [--patches] [--comments] [--commits] [--deep] [--file <path>] [--match-string <s>] [--json]',
    scheme: [
      'arg[0] target: required owner/repo, owner/repo#number, or GitHub PR URL.',
      'selection: --pr int selects one PR; #N or PR URL also selects one PR.',
      'list filters: --query string, --state enum(open|closed|merged), --author string, --label string, --base string, --limit int, --page int, --page-size int. --concise = flat "#number title" lines (cheapest triage).',
      'content flags: --patches (all diffs), --comments (discussion + inline review), --commits, --deep (all surfaces); --file path narrows patches to one file; --match-string narrows returned content.',
      'runtime: ghHistoryResearch; broad target lists PRs, selected PR fetches requested surfaces.',
      'output: YAML PR metadata/content by default; --json returns raw tool envelope.',
    ],
    whenToUse: [
      'Use to research change history, PR discussion, review comments, or diffs.',
      'List mode finds candidate PRs (add --concise for the leanest triage list); PR number or URL deep-dives one PR.',
      'Deep-read one PR: --comments for discussion, --patches (or --file) for the diff, --deep for everything.',
      'For large PRs, use --file or --match-string before paging broad patches/comments.',
    ],
    examples: [
      'pr facebook/react --state open --concise --limit 10',
      'pr bgauryy/octocode-mcp#123 --patches --comments',
      'pr https://github.com/bgauryy/octocode-mcp/pull/123 --deep',
    ],
    options: [
      { name: 'pr', hasValue: true, description: 'PR number to view' },
      {
        name: 'concise',
        description: 'List mode: flat "#number title" lines (cheapest triage)',
      },
      {
        name: 'query',
        hasValue: true,
        description: 'Keyword search in list mode',
      },
      { name: 'state', hasValue: true, description: 'Filter by state' },
      { name: 'author', hasValue: true, description: 'Filter by PR author' },
      { name: 'label', hasValue: true, description: 'Filter by label' },
      { name: 'base', hasValue: true, description: 'Filter by base branch' },
      { name: 'limit', hasValue: true, description: 'Max PRs to show' },
      { name: 'patches', description: 'Include unified diffs' },
      { name: 'file', hasValue: true, description: 'Show diff for one file' },
      { name: 'comments', description: 'Include comments' },
      { name: 'commits', description: 'Include commits' },
      {
        name: 'deep',
        description: 'Include patches, comments, commits, and reviews',
      },
      {
        name: 'match-string',
        hasValue: true,
        description: 'Narrow PR content',
      },
      { name: 'page', hasValue: true, description: 'Page number' },
      { name: 'page-size', hasValue: true, description: 'Results per page' },
      { name: 'json', description: 'Output raw JSON' },
    ],
  },
  {
    name: 'history',
    description:
      'Commit history for a GitHub repo, directory, or file — who changed what, when',
    usage:
      'history <owner/repo[/path][@branch]> [--since <iso>] [--until <iso>] [--author <name>] [--branch <ref>] [--diff] [--limit <n>] [--page <n>] [--json]',
    scheme: [
      'arg[0] target: required GitHub ref — owner/repo, owner/repo/path (file or dir; trailing "/" = subtree), or owner/repo@branch[/path]. Local paths rejected.',
      'options: --since/--until ISO 8601, --author string, --branch (or @branch), --diff (per-commit file diffs, larger), --limit int, --page int, --json.',
      'runtime: ghHistoryResearch type:"commits".',
      'output: commit list (sha, date, headline, author); a headline "(#NNN)" → deep-read with pr owner/repo#NNN.',
    ],
    whenToUse: [
      'Use to trace who changed a file/dir and when, or to find the PR that introduced a change.',
      'Scope with a path (file or dir subtree); narrow with --since/--until/--author before paging.',
      'A commit headline with "#NNN" embeds its PR — follow up with pr owner/repo#NNN for the full PR.',
    ],
    examples: [
      'history facebook/react/packages/react/src',
      'history bgauryy/octocode/README.md --diff',
      'history vercel/next.js --since 2024-06-01T00:00:00Z --author someone',
    ],
    options: [
      { name: 'since', hasValue: true, description: 'Start date (ISO 8601)' },
      { name: 'until', hasValue: true, description: 'End date (ISO 8601)' },
      {
        name: 'author',
        hasValue: true,
        description: 'Filter by commit author',
      },
      {
        name: 'branch',
        hasValue: true,
        description: 'Branch or SHA to walk (also from @branch)',
      },
      { name: 'diff', description: 'Include per-commit file diffs' },
      { name: 'limit', hasValue: true, description: 'Max commits to show' },
      { name: 'page', hasValue: true, description: 'Result page' },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'repo',
    description: 'Search GitHub repositories with research-oriented filters',
    usage:
      'repo <keywords...> [--topic <list>] [--language <lang>] [--owner <owner>] [--stars <range>] [--forks <range>] [--good-first-issues <range>] [--license <spdx>] [--created <range>] [--updated <range>] [--size <range>] [--match name,description,readme] [--sort stars|forks|help-wanted-issues|updated|best-match] [--archived true|false] [--visibility public|private] [--limit <n>] [--page <n>] [--concise] [--verbose] [--json]',
    scheme: [
      'args keywords: optional string list; AND-combined repository search keywords.',
      'discovery filters: --owner string, --topic comma-list, --language string, --license SPDX, --visibility enum(public|private).',
      'range filters: --stars, --forks, --good-first-issues, --created, --updated, --size use GitHub search range syntax.',
      'match/sort: --match comma-list(name|description|readme), --sort enum(stars|forks|help-wanted-issues|updated|best-match), --archived boolean string.',
      'pagination/output: --limit int, --page int, --concise boolean (flat owner/repo list), --verbose boolean, --json boolean.',
      'runtime: ghSearchRepos.',
      'output: YAML repo list by default; --concise = flat "owner/repo" names; verbose/json exposes richer repository fields.',
    ],
    whenToUse: [
      'Use before GitHub ls/find/grep when you need to discover the right repository.',
      'Use --concise to scan many candidate repos cheaply, then re-run without it (or ls) on the one you pick.',
      'Use --owner with no keywords to enumerate an organization.',
    ],
    examples: [
      'repo "mcp server" --language TypeScript --stars ">100"',
      'repo --owner bgauryy --limit 10',
      'repo "code search" --topic mcp --sort stars',
    ],
    options: [
      { name: 'topic', hasValue: true, description: 'Comma-separated topics' },
      { name: 'language', hasValue: true, description: 'Language filter' },
      { name: 'owner', hasValue: true, description: 'Owner or organization' },
      { name: 'stars', hasValue: true, description: 'Stars range' },
      { name: 'forks', hasValue: true, description: 'Forks range' },
      {
        name: 'good-first-issues',
        hasValue: true,
        description: 'Good-first-issues range',
      },
      { name: 'license', hasValue: true, description: 'SPDX license key' },
      { name: 'created', hasValue: true, description: 'Created date range' },
      { name: 'updated', hasValue: true, description: 'Pushed date range' },
      { name: 'size', hasValue: true, description: 'Repository size range' },
      {
        name: 'match',
        hasValue: true,
        description: 'Comma-separated scopes: name,description,readme',
      },
      {
        name: 'sort',
        hasValue: true,
        description:
          'Sort: stars, forks, help-wanted-issues, updated, best-match',
      },
      {
        name: 'archived',
        hasValue: true,
        description: 'Include only archived repos when true',
      },
      {
        name: 'visibility',
        hasValue: true,
        description: 'Visibility: public or private',
      },
      { name: 'limit', hasValue: true, description: 'Max repositories' },
      { name: 'page', hasValue: true, description: 'Result page' },
      {
        name: 'concise',
        description: 'Flat "owner/repo" list — cheapest scan',
      },
      { name: 'verbose', description: 'Return structured repository objects' },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'pkg',
    description: 'Research an npm package and its source repository',
    usage: 'pkg <package|keywords> [--mode lean|full] [--page <n>] [--json]',
    scheme: [
      'arg[0] package: required. Exact name (e.g. "react", "@octokit/rest") -> one rich result + repo handoff; a keyword query -> a lean candidate list.',
      'options: --mode enum(lean|full, default lean — lean is token-efficient), --page int (keyword queries), --json boolean.',
      'runtime: npmSearch.',
      'output: YAML package metadata; exact package includes repository handoff when available.',
    ],
    whenToUse: [
      'Use when the research starts from an npm package name, or to discover packages by keyword.',
      'Keep --mode lean (default) for orientation; use --mode full only when you need every metadata field.',
      'Follow source repository fields with repo/ls/find/cat for implementation evidence.',
    ],
    examples: [
      'pkg zod',
      'pkg "@modelcontextprotocol/sdk"',
      'pkg "react state management"',
    ],
    options: [
      {
        name: 'mode',
        hasValue: true,
        description: 'lean (default, token-efficient) or full (all fields)',
      },
      {
        name: 'page',
        hasValue: true,
        description: 'Result page for keyword-query searches',
      },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'binary',
    description:
      'Inspect archives, compressed files, and binaries — list/unzip entries, decompress, or read strings',
    usage:
      'binary <file> [--list | --strings | --decompress | --identify | --extract <entry>] [--match <s>] [--min-length <n>] [--max-entries <n>] [--format <fmt>] [--verbose] [--offsets] [--page <n>] [--json]',
    scheme: [
      'arg[0] file: required local path to an archive, compressed file, or binary.',
      'mode: auto-detected from extension (archive -> list, compressed -> decompress, binary -> strings, else identify). Override with --list/--strings/--decompress/--identify, or --extract <entry> for one archive member.',
      'options: --match string (filter extract/decompress lines), --min-length int (strings), --max-entries int (list), --format enum (decompress), --verbose (list sizes), --offsets (strings hex offsets), --page int.',
      'runtime: localBinaryInspect with the resolved mode.',
      'output: YAML inspection result by default; --json returns the raw tool envelope.',
    ],
    whenToUse: [
      'Use to look inside a .zip/.tar.*/.jar archive, decompress a .gz/.xz/.zst stream, or pull readable strings from a .so/.dylib/.node/.wasm binary.',
      'Run with no flags first — it picks the right mode by extension. List an archive before --extract; do not guess entry names.',
      'To search a binary for a term, use grep <pattern> <file>; binary --strings just lists readable runs.',
    ],
    examples: [
      'binary out/octocode.js --identify',
      'binary app.zip',
      'binary app.zip --extract package.json',
      'binary libssl.so --strings --min-length 12',
    ],
    options: [
      { name: 'list', description: 'List archive entries' },
      {
        name: 'extract',
        hasValue: true,
        description: 'Extract one archive entry by exact path',
      },
      { name: 'strings', description: 'Readable strings of a native binary' },
      {
        name: 'decompress',
        description: 'Decompress a single-stream compressed file',
      },
      {
        name: 'identify',
        description: 'Detect file type and magic bytes only',
      },
      {
        name: 'match',
        hasValue: true,
        description: 'Filter extracted/decompressed lines by string',
      },
      {
        name: 'min-length',
        hasValue: true,
        description: 'strings: shortest run to keep',
      },
      {
        name: 'max-entries',
        hasValue: true,
        description: 'list: cap number of entries returned',
      },
      {
        name: 'format',
        hasValue: true,
        description: 'decompress: force compression format',
      },
      { name: 'verbose', description: 'list: include entry size and mtime' },
      {
        name: 'offsets',
        description: 'strings: prefix each string with its hex byte offset',
      },
      { name: 'page', hasValue: true, description: 'Result page' },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'unzip',
    description:
      'Unpack an archive to a cached local directory, then research it with the local toolset',
    usage: 'unzip <archive> [--json]',
    scheme: [
      'arg[0] archive: required local path to a .zip/.jar/.tar.*/.7z/.deb/.dmg archive.',
      'runtime: localBinaryInspect mode:"unpack" — extracts ALL entries to ~/.octocode/archives/<name>__<hash>/ (cached; re-extracts when the archive changes).',
      'output: localPath of the unpacked tree + a hint to continue with ls/grep/find/cat.',
    ],
    whenToUse: [
      'Use to do multi-file work inside an archive — unpack once, then ls/grep/find/cat/ast/lsp the contents (binary --extract is for a single entry).',
      'For a single-stream file (.gz/.xz) use binary --decompress; for a native binary use binary --strings.',
    ],
    examples: [
      'unzip app.zip',
      'unzip release.tar.gz',
      'ls ~/.octocode/archives/app.zip__<hash>',
    ],
    options: [{ name: 'json', description: 'Output raw JSON results' }],
  },
  {
    name: 'clone',
    description: 'Clone a GitHub repository or subtree locally (sparse)',
    usage:
      'clone <owner/repo[/path][@branch]|url> [--branch <ref>] [--force-refresh] [--json]',
    scheme: [
      'arg[0] target: required GitHub ref — owner/repo, owner/repo/subpath, owner/repo@branch[/subpath], or a github.com tree/blob URL. Local paths are rejected.',
      'a subpath -> sparse clone (sparsePath); @branch or --branch picks the ref; --force-refresh re-clones past the 24h cache.',
      'runtime: ghCloneRepo (requires ENABLE_LOCAL + ENABLE_CLONE; otherwise use ls + cat).',
      'output: YAML clone result with the local path; --json returns the raw tool envelope.',
    ],
    whenToUse: [
      'Clone before deep multi-file work in one repo (>~3 files) — then run grep/ast/lsp/symbols/cat on the local clone instead of many GitHub round-trips.',
      'Use a subpath for large monorepos to sparse-clone only what you need.',
      'Verify the subpath exists first with ls owner/repo/subpath if unsure.',
    ],
    examples: [
      'clone facebook/react',
      'clone facebook/react/packages/react',
      'clone facebook/react@main/packages/react',
    ],
    options: [
      {
        name: 'branch',
        hasValue: true,
        description: 'Branch, tag, or SHA to clone (overrides @branch)',
      },
      {
        name: 'force-refresh',
        description: 'Re-clone from GitHub, bypassing the 24h cache',
      },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'lsp',
    description:
      'Run LSP semantic navigation for a local source file after you know the symbol and line',
    usage:
      'lsp <file> --type <type> --symbol <name> --line <n> [--workspace-root <path>] [--page <n>] [--page-size <n>] [--context-lines <n>] [--depth <n>] [--format structured|compact] [--json]',
    scheme: [
      'arg[0] file: required local source file path.',
      'required option: --type enum(definition|references|callers|callees|callHierarchy|hover|typeDefinition|implementation).',
      'symbol options: --symbol string and --line int are both required.',
      'context options: --workspace-root path, --page int, --page-size int, --context-lines int, --depth int, --format enum(structured|compact).',
      'runtime: lspGetSemantics with uri=file path.',
      'output: YAML semantic locations/content by default; --json returns raw tool envelope.',
    ],
    whenToUse: [
      'Use after grep or symbols gives a local file, exact symbol name, and line number.',
      'lsp answers symbol IDENTITY: references, definitions, hover, callers, callees, typeDefinition, implementation.',
      'For a file or directory OUTLINE, use the symbols command — lsp no longer exposes documentSymbols.',
      'If the line is unknown, run grep or symbols first; do not guess --line.',
    ],
    examples: [
      'lsp src/index.ts --type references --symbol runCLI --line 42',
      'lsp src/index.ts --type definition --symbol runCLI --line 42 --format compact',
      'lsp src/index.ts --type hover --symbol runCLI --line 42',
    ],
    options: [
      {
        name: 'type',
        hasValue: true,
        description:
          'Semantic query: definition, references, callers, callees, callHierarchy, hover, typeDefinition, implementation',
      },
      {
        name: 'symbol',
        hasValue: true,
        description: 'Symbol name (required)',
      },
      {
        name: 'line',
        hasValue: true,
        description: 'Line hint for the symbol (required)',
      },
      {
        name: 'workspace-root',
        hasValue: true,
        description: 'Workspace root for the language server',
      },
      { name: 'page', hasValue: true, description: 'Result page' },
      { name: 'page-size', hasValue: true, description: 'Results per page' },
      {
        name: 'context-lines',
        hasValue: true,
        description: 'Context lines around returned locations',
      },
      { name: 'depth', hasValue: true, description: 'Call hierarchy depth' },
      {
        name: 'format',
        hasValue: true,
        description: 'LSP output format: structured or compact',
      },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'symbols',
    description:
      'Show a semantic symbol outline for a local file or directory before deeper LSP navigation',
    usage:
      'symbols <file|path> [--ext <list>] [--kind <kind>] [--limit <n>] [--depth <n>] [--page-size <n>] [--json]',
    scheme: [
      'arg[0] target: required local source file or directory path.',
      'directory options: --ext comma-list, --limit int files, --depth int directory depth.',
      'render options: --kind string symbol kind filter, --page-size int symbols per file, --json boolean.',
      'runtime: file -> lspGetSemantics(documentSymbols); directory -> localFindFiles then batched documentSymbols.',
      'output: compact YAML-like outline by default; --json returns file list and raw LSP results.',
    ],
    whenToUse: [
      'Use first on local code to map classes, functions, methods, and exported shapes.',
      'This is the compact shortcut for LSP documentSymbols plus directory file discovery.',
      'Follow with lsp --type references/definition/hover when a specific symbol and line matter.',
    ],
    examples: [
      'symbols packages/octocode/src --ext ts --limit 10',
      'symbols packages/octocode/src/cli/commands/lsp.ts --kind function',
    ],
    options: [
      {
        name: 'ext',
        hasValue: true,
        description: 'Comma-separated source extensions for directory mode',
      },
      {
        name: 'kind',
        hasValue: true,
        description: 'Filter rendered symbols by kind',
      },
      {
        name: 'limit',
        hasValue: true,
        description: 'Maximum files to inspect in directory mode',
      },
      {
        name: 'depth',
        hasValue: true,
        description: 'Directory discovery depth',
      },
      { name: 'page-size', hasValue: true, description: 'Symbols per file' },
      { name: 'json', description: 'Output raw JSON results' },
    ],
  },
  {
    name: 'context',
    description:
      'Print the agent protocol, MCP system prompt, tool descriptions, and schemas',
    usage: 'context [--full]  OR  --context [--full]',
    scheme: [
      'args: none.',
      'top-level shortcut: --context prints the same agent target as the context command.',
      'options: --full boolean includes every full JSON input schema inline; omit it for compact schema summaries.',
      'output: CLI research protocol, MCP system prompt, smart command routing, tool descriptions, and schemas.',
    ],
    whenToUse: [
      'Use before autonomous research to see the exact operating prompt and tool routing rules.',
      'Use --full when an agent needs all JSON schemas in one target output.',
    ],
    examples: ['context', 'context --full', '--context --full'],
    options: [
      {
        name: 'full',
        description: 'Include every full JSON input schema inline',
      },
    ],
  },
  {
    name: 'install',
    description: 'Install octocode-mcp for an IDE',
    usage:
      'install --ide <ide> [--method npx] [--force] [--check] [--rollback] [--backup-path <path>] [--json]',
    scheme: [
      'args: none.',
      'required option: --ide supported client id.',
      'options: --method enum(npx, default npx), --force boolean, --check boolean, --rollback boolean, --backup-path path, --json boolean.',
      'runtime: writes or validates MCP client configuration for the selected IDE.',
      'output: install/check/rollback status; --json returns structured result.',
    ],
    options: [
      { name: 'ide', hasValue: true, description: 'IDE to configure' },
      {
        name: 'method',
        hasValue: true,
        description: 'Installation method (npx)',
        default: 'npx',
      },
      { name: 'force', description: 'Overwrite existing configuration' },
      { name: 'check', description: 'Pre-flight only' },
      { name: 'rollback', description: 'Restore the most recent backup' },
      {
        name: 'backup-path',
        hasValue: true,
        description: 'Backup file to restore',
      },
      { name: 'json', description: 'Output result as JSON' },
    ],
  },
  {
    name: 'auth',
    description: 'Manage GitHub authentication',
    usage:
      'auth [login|logout|status|token|refresh] [--hostname <host>] [--json]',
    scheme: [
      'arg[0] action: optional enum(login|logout|status|token|refresh); defaults to interactive/auth status flow.',
      'options: --hostname GitHub Enterprise host, --json boolean.',
      'runtime: delegates to auth storage, GitHub OAuth, token refresh, or status lookup.',
      'output: auth action result; --json returns structured status/result.',
    ],
    options: [
      {
        name: 'hostname',
        hasValue: true,
        description: 'GitHub Enterprise hostname',
      },
      { name: 'json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'login',
    description: 'Authenticate with GitHub',
    usage:
      'login [--hostname <host>] [--git-protocol <ssh|https>] [--force] [--json]',
    scheme: [
      'args: none.',
      'options: --hostname GitHub Enterprise host, --git-protocol enum(ssh|https), --force boolean, --json boolean.',
      'runtime: GitHub OAuth login and encrypted credential storage.',
      'output: login status; --json returns structured result.',
    ],
    options: [
      {
        name: 'hostname',
        hasValue: true,
        description: 'GitHub Enterprise hostname',
      },
      {
        name: 'git-protocol',
        hasValue: true,
        description: 'Git protocol: ssh or https',
      },
      {
        name: 'force',
        description: 'Re-authenticate even if already logged in',
      },
      { name: 'json', description: 'Output result as JSON' },
    ],
  },
  {
    name: 'logout',
    description: 'Sign out from GitHub',
    usage: 'logout [--hostname <host>] [--yes] [--json]',
    scheme: [
      'args: none.',
      'options: --hostname GitHub Enterprise host, --yes boolean skips confirmation, --json boolean.',
      'runtime: removes encrypted Octocode credentials for the host.',
      'output: logout status; --json returns structured result.',
    ],
    options: [
      {
        name: 'hostname',
        hasValue: true,
        description: 'GitHub Enterprise hostname',
      },
      { name: 'yes', description: 'Skip confirmation prompt' },
      { name: 'json', description: 'Output result as JSON' },
    ],
  },
  {
    name: 'skills',
    description:
      'Search, install, and manage Octocode skills across AI clients',
    usage:
      'skills [search|read|install|remove|list|sync] [--skill <name>] [--targets <list>] [--mode <copy|symlink>] [--json]',
    scheme: [
      'arg[0] action: optional enum(search|read|install|remove|list|sync).',
      'skill selectors: --skill name, --local path, --target single target, --targets comma-list.',
      'install options: --mode enum(copy|symlink), --force boolean, --dry-run boolean.',
      'search/read options: --limit int, --full boolean, --direct boolean, --install boolean.',
      'runtime: skills marketplace plus local skill target installation/removal/sync.',
      'output: skill search/list/read/install status; --json returns structured result.',
    ],
    options: [
      { name: 'force', description: 'Overwrite existing skills' },
      {
        name: 'query',
        hasValue: true,
        description: 'Search query (alternative to the positional argument)',
      },
      { name: 'skill', hasValue: true, description: 'Skill folder name' },
      {
        name: 'local',
        hasValue: true,
        description: 'Path to a local skill folder',
      },
      {
        name: 'targets',
        hasValue: true,
        description: 'Comma-separated targets',
      },
      {
        name: 'mode',
        hasValue: true,
        description: 'Install mode: copy or symlink',
      },
      { name: 'limit', hasValue: true, description: 'Max search results' },
      { name: 'full', description: 'Show full SKILL.md' },
      { name: 'direct', description: 'Search skills.sh directly' },
      {
        name: 'target',
        hasValue: true,
        description: 'Filter list to one target',
      },
      { name: 'install', description: 'Install the top search result' },
      { name: 'dry-run', description: 'Show plan without writing' },
      { name: 'json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'token',
    description: 'Print the GitHub token',
    usage:
      'token [--type <auto|octocode|gh>] [--hostname <host>] [--source] [--validate] [--reveal] [--json]',
    scheme: [
      'args: none.',
      'options: --type enum(auto|octocode|gh, default auto), --hostname GitHub Enterprise host, --source boolean, --validate boolean, --reveal boolean, --json boolean.',
      'runtime: resolves token from env -> Octocode encrypted storage -> gh CLI according to --type.',
      'output: redacted token by default; --reveal prints the full token; --json returns structured result.',
    ],
    options: [
      {
        name: 'type',
        hasValue: true,
        description: 'Token source: auto, octocode, gh',
      },
      {
        name: 'hostname',
        hasValue: true,
        description: 'GitHub Enterprise hostname',
      },
      { name: 'source', description: 'Show token source and user info' },
      { name: 'validate', description: 'Verify the token with GitHub API' },
      { name: 'reveal', description: 'Print the full token on screen' },
      { name: 'json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'status',
    description: 'Show Octocode health status',
    usage: 'status [--hostname <host>] [--sync] [--json]',
    scheme: [
      'args: none.',
      'options: --hostname GitHub Enterprise host, --sync boolean includes MCP sync analysis, --json boolean.',
      'runtime: checks auth, installation/cache health, and optional MCP sync state.',
      'output: health summary; --json returns structured status.',
    ],
    options: [
      {
        name: 'hostname',
        hasValue: true,
        description: 'GitHub Enterprise hostname',
      },
      { name: 'sync', description: 'Include MCP sync analysis' },
      { name: 'json', description: 'Output as JSON' },
    ],
  },
];

export function findCommandSpec(name: string): CLICommandSpec | undefined {
  return COMMAND_SPECS.find(command => command.name === name);
}
