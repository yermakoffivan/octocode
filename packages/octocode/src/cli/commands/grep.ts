import type { CLICommand } from '../types.js';
import { getBool, getString } from '../options.js';
import { resolveRef, isGithubRef, refLabel } from '../routing.js';
import { c, bold, dim } from '../../utils/colors.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  renderLocalResults,
  type LocalSearchResult,
} from './local-search-render.js';

interface GithubPagination {
  totalMatches?: number;
  uniqueFileCount?: number;
  currentPage?: number;
  totalPages?: number;
}

interface GithubFile {
  owner?: string;
  repo?: string;
  path?: string;
  matchCount?: number;
  matches?: Array<{ value?: string; line?: number }>;
}

interface GithubCodeResult {
  // ghSearchCode nests hits under results[].data.files[] (same shape as the
  // local renderer), not results[].matches — render off that. With concise:true
  // each file is a flat "owner/repo:path" string instead of an object.
  results?: Array<{
    data?: {
      files?: Array<string | GithubFile>;
      pagination?: GithubPagination;
    };
  }>;
  hints?: string[];
  emptyQueries?: Array<{ id?: string }>;
}

interface LocalSearchOpts {
  typeFilter?: string;
  mode?: string;
  include?: string[];
  exclude?: string[];
  contextLines?: number;
  maxMatchesPerFile?: number;
  page?: number;
  pageSize?: number;
}

async function searchLocal(
  keywords: string,
  dirPath: string,
  opts: LocalSearchOpts = {}
): Promise<LocalSearchResult> {
  const result = await executeDirectTool('localSearchCode', {
    queries: [
      {
        keywords,
        path: dirPath,
        langType: opts.typeFilter,
        mode: opts.mode as 'paginated' | 'discovery' | 'detailed' | undefined,
        include: opts.include,
        exclude: opts.exclude,
        contextLines: opts.contextLines,
        maxMatchesPerFile: opts.maxMatchesPerFile,
        page: opts.page,
        itemsPerPage: opts.pageSize,
        mainResearchGoal: 'Search local codebase',
        researchGoal: `Find "${keywords}" in ${dirPath}`,
        reasoning: 'CLI grep command',
      },
    ],
  });

  if (result.isError) {
    const errText =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    throw new Error(`Search error: ${errText}`);
  }

  return result.structuredContent as LocalSearchResult;
}

async function searchGithub(
  pattern: string,
  owner: string,
  repo: string,
  typeFilter?: string,
  subpath?: string,
  page?: number,
  pageSize?: number,
  concise?: boolean
): Promise<GithubCodeResult> {
  const result = await executeDirectTool('ghSearchCode', {
    queries: [
      {
        keywordsToSearch: [pattern],
        owner,
        repo,
        extension: typeFilter,
        path: subpath || undefined,
        page,
        limit: pageSize,
        concise: concise || undefined,
        mainResearchGoal: 'Search GitHub codebase',
        researchGoal: `Find "${pattern}" in ${owner}/${repo}`,
        reasoning: 'CLI grep command',
      },
    ],
  });

  if (result.isError) {
    const errText =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    if (/401|403|auth/i.test(errText)) {
      throw new Error(
        `GitHub auth error: ${errText}. Set GITHUB_TOKEN, OCTOCODE_TOKEN, or GH_TOKEN.`
      );
    }
    throw new Error(`GitHub search error: ${errText}`);
  }

  return result.structuredContent as GithubCodeResult;
}

function renderGithubResults(
  sc: GithubCodeResult,
  limit: number,
  owner?: string,
  repo?: string
): string {
  const data = sc?.results?.[0]?.data;
  const files = data?.files ?? [];
  const pagination = data?.pagination;
  const totalFiles = pagination?.uniqueFileCount ?? files.length;
  const lines: string[] = [];
  let shown = 0;

  for (const file of files) {
    if (shown >= limit) break;
    // concise:true → each entry is a flat "owner/repo:path" string.
    if (typeof file === 'string') {
      lines.push(`  ${c('cyan', file)}`);
      shown++;
      continue;
    }
    const repoLabel = `${file.owner ?? owner ?? ''}/${file.repo ?? repo ?? ''}`;
    lines.push(`  ${c('cyan', bold(file.path ?? ''))}  ${dim(repoLabel)}`);
    for (const m of (file.matches ?? []).slice(0, 5)) {
      const snippet = (m.value ?? '').trim().replace(/\n/g, ' ').slice(0, 120);
      if (snippet) lines.push(`    ${c('yellow', '›')} ${snippet}`);
    }
    shown++;
  }

  if (totalFiles > shown)
    lines.push(`\n  ${dim(`… ${totalFiles - shown} more files`)}`);
  if (pagination?.totalPages && pagination.totalPages > 1) {
    lines.push(
      `\n  ${dim(`Page ${pagination.currentPage ?? 1}/${pagination.totalPages} — use --page <n> to navigate`)}`
    );
  }

  if (lines.length === 0) {
    lines.push(`  ${dim('No matches found.')}`);

    const toolHints = sc?.hints ?? [];
    const indexingHint = toolHints.find(h =>
      /not be indexed|may not be indexed|zero here isn't proof/i.test(h)
    );
    if (indexingHint) {
      lines.push('');
      lines.push(`  ${c('yellow', '→')} ${indexingHint}`);
    }

    const repoRef = owner && repo ? `${owner}/${repo}` : '<owner>/<repo>';
    lines.push('');
    lines.push(
      `  ${c('yellow', '→')} GitHub code search may not index this repo. Alternatives:`
    );
    lines.push(
      `     ${bold('ls ' + repoRef)}  — browse structure, then target a file`
    );
    lines.push(
      `     ${bold('cat ' + repoRef + '/<file> --match-string <pattern> --mode symbols')}  — search inside a known file (efficient)`
    );
  }

  return lines.join('\n');
}

export const grepCommand: CLICommand = {
  name: 'grep',
  description:
    'Search code by text or regex (ripgrep) across local paths and GitHub repositories. For AST shape queries use the `ast` command.',
  usage:
    'grep <keywords> <path|github-ref> [--type <ext>] [--mode paginated|discovery|detailed] [--concise] [--include <glob>] [--exclude <glob>] [--context-lines <n>] [--max-matches <n>] [--branch <ref>] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
  options: [
    {
      name: 'type',
      hasValue: true,
      description: 'Filter by language / extension (e.g. ts, py, go)',
    },
    {
      name: 'mode',
      hasValue: true,
      description:
        'Search mode (local only): paginated (default) · discovery (file paths only, ~80% fewer tokens) · detailed (expanded context)',
    },
    {
      name: 'concise',
      description:
        'Paths only, no snippets — cheapest orientation. GitHub: flat "owner/repo:path" list; local: same as --mode discovery.',
    },
    {
      name: 'include',
      hasValue: true,
      description:
        'Comma-separated glob patterns to include (local only, e.g. "*.ts,*.tsx")',
    },
    {
      name: 'exclude',
      hasValue: true,
      description:
        'Comma-separated glob patterns to exclude (local only, e.g. "*.min.js,dist/**")',
    },
    {
      name: 'context-lines',
      hasValue: true,
      description:
        'Lines of context around each match (local only, default: 0)',
    },
    {
      name: 'max-matches',
      hasValue: true,
      description: 'Max matches returned per file (local only)',
    },
    {
      name: 'limit',
      hasValue: true,
      description: 'Max files to show in rendered output (default: 10)',
    },
    {
      name: 'page',
      hasValue: true,
      description: 'Result page to fetch (default: 1)',
    },
    {
      name: 'page-size',
      hasValue: true,
      description: 'Results per page (default: server default)',
    },
    {
      name: 'branch',
      hasValue: true,
      description: 'Branch / ref for GitHub paths',
    },
    {
      name: 'json',
      description: 'Output raw JSON results',
    },
  ],
  handler: async args => {
    const { options } = args;
    const pattern = args.args[0] ?? '';
    const target = args.args[1] ?? '.';
    const typeFilter = getString(options, 'type');
    const branchOverride = getString(options, 'branch');
    const rawLimit = getString(options, 'limit');
    const limit = rawLimit ? parseInt(rawLimit, 10) : 10;
    const rawPage = getString(options, 'page');
    const rawPageSize = getString(options, 'page-size');
    const rawContextLines = getString(options, 'context-lines');
    const rawMaxMatches = getString(options, 'max-matches');
    const page = rawPage ? parseInt(rawPage, 10) : undefined;
    const pageSize = rawPageSize ? parseInt(rawPageSize, 10) : undefined;
    const contextLines = rawContextLines
      ? parseInt(rawContextLines, 10)
      : undefined;
    const maxMatchesPerFile = rawMaxMatches
      ? parseInt(rawMaxMatches, 10)
      : undefined;
    const concise = getBool(options, 'concise');
    // Local has no `concise`; discovery mode is the paths-only equivalent.
    const modeOpt =
      getString(options, 'mode') || (concise ? 'discovery' : undefined);
    const includeOpt = getString(options, 'include');
    const excludeOpt = getString(options, 'exclude');
    const include = includeOpt
      ? includeOpt.split(',').map(s => s.trim())
      : undefined;
    const exclude = excludeOpt
      ? excludeOpt.split(',').map(s => s.trim())
      : undefined;
    const jsonOutput = getBool(options, 'json');

    if (!pattern) {
      const err = 'Provide a search query (<keywords>).';
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: err }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${err}`);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    grep "useState" src/\n` +
            `    grep "executeDirectTool" bgauryy/octocode-mcp\n` +
            `    grep "TODO" . --type ts\n` +
            `    ${dim('# for AST shape queries (local), use the ast command:')}\n` +
            `    ast "eval($X)" src\n`
        );
      }
      process.exitCode = 1;
      return;
    }

    const ref = resolveRef(target, branchOverride || undefined);
    const label = refLabel(ref);

    if (!jsonOutput) {
      process.stderr.write(
        `  ${dim(`Searching "${pattern}" in ${label} ...`)}\n`
      );
    }

    try {
      if (isGithubRef(ref)) {
        const sc = await searchGithub(
          pattern,
          ref.owner,
          ref.repo,
          typeFilter || undefined,
          ref.subpath || undefined,
          page,
          pageSize,
          concise
        );
        if (jsonOutput) {
          console.log(JSON.stringify(sc, null, 2));
          return;
        }
        console.log(
          '\n' + renderGithubResults(sc, limit, ref.owner, ref.repo) + '\n'
        );
      } else {
        const sc = await searchLocal(pattern, ref.path, {
          typeFilter: typeFilter || undefined,
          mode: modeOpt,
          include,
          exclude,
          contextLines,
          maxMatchesPerFile,
          page,
          pageSize,
        });
        if (jsonOutput) {
          console.log(JSON.stringify(sc, null, 2));
          return;
        }
        console.log('\n' + renderLocalResults(sc, limit) + '\n');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: msg }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${msg}\n`);
      }
      process.exitCode = 1;
    }
  },
};
