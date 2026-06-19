import type { CLICommand } from '../types.js';
import { getBool, getString } from '../options.js';
import { resolveRef, isGithubRef, refLabel } from '../routing.js';
import { c, bold, dim } from '../../utils/colors.js';
import { EXIT } from '../exit-codes.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';

interface CommitAuthor {
  login?: string;
  name?: string;
}

interface DiffPreview {
  lines: string[];
  moreCount: number;
}

interface Commit {
  sha?: string;
  message?: string;
  messageHeadline?: string;
  date?: string;
  author?: CommitAuthor | string;
  // populated when includeDiff (--diff) is set
  additions?: number;
  deletions?: number;
  patch?: string;
  diff?: DiffPreview; // render-ready diff lines + truncated count (built in core)
}

interface CommitsResult {
  results?: Array<{
    data?: {
      commits?: Commit[];
      pagination?: { hasMore?: boolean; nextPage?: number; page?: number };
    };
  }>;
}

interface HistoryOpts {
  path?: string;
  branch?: string;
  since?: string;
  until?: string;
  author?: string;
  includeDiff?: boolean;
  page?: number;
  pageSize?: number;
}

function authorName(a: CommitAuthor | string | undefined): string {
  if (!a) return '?';
  if (typeof a === 'string') return a;
  return a.login ?? a.name ?? '?';
}

function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toISOString().slice(0, 10);
}

/** PR refs like "(#421)" embedded in a headline — the canonical commit→PR chain. */
function prRefs(commits: Commit[]): string[] {
  const refs = new Set<string>();
  for (const cm of commits) {
    const m = (cm.messageHeadline ?? cm.message ?? '').match(/#(\d+)/g);
    if (m) m.forEach(r => refs.add(r));
  }
  return [...refs];
}

async function fetchCommits(
  owner: string,
  repo: string,
  opts: HistoryOpts
): Promise<CommitsResult> {
  const result = await executeDirectTool('ghHistoryResearch', {
    queries: [
      {
        type: 'commits',
        owner,
        repo,
        path: opts.path || undefined,
        branch: opts.branch,
        since: opts.since,
        until: opts.until,
        author: opts.author,
        includeDiff: opts.includeDiff || undefined,
        page: opts.page ?? 1,
        perPage: opts.pageSize,
        mainResearchGoal: 'Research commit history',
        researchGoal: `Commit history for ${owner}/${repo}${opts.path ? '/' + opts.path : ''}`,
        reasoning: 'CLI history command',
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
    throw new Error(`GitHub commit history error: ${errText}`);
  }

  return result.structuredContent as CommitsResult;
}

function renderCommits(
  sc: CommitsResult,
  limit: number,
  owner: string,
  repo: string,
  showDiff: boolean
): string {
  const data = sc?.results?.[0]?.data;
  const commits = data?.commits ?? [];
  if (commits.length === 0) return `  ${dim('No commits found.')}`;

  const lines: string[] = [];
  for (const cm of commits.slice(0, limit)) {
    const sha = c('yellow', (cm.sha ?? '').slice(0, 7));
    const when = dim((relativeTime(cm.date) || '').padEnd(10));
    const who = dim(`by ${authorName(cm.author)}`);
    const head = (cm.messageHeadline ?? cm.message ?? '').split('\n')[0];
    lines.push(`  ${sha}  ${when} ${head}  ${who}`);
    if (showDiff) {
      const add = cm.additions != null ? c('green', `+${cm.additions}`) : '';
      const del = cm.deletions != null ? c('red', `-${cm.deletions}`) : '';
      if (add || del) lines.push(`      ${add} ${del}`);
      if (cm.diff) {
        cm.diff.lines.forEach(l => {
          if (l.startsWith('+')) lines.push(`      ${c('green', l)}`);
          else if (l.startsWith('-')) lines.push(`      ${c('red', l)}`);
          else if (l.startsWith('@@')) lines.push(`      ${c('cyan', l)}`);
          else lines.push(`      ${dim(l)}`);
        });
        if (cm.diff.moreCount > 0)
          lines.push(`      ${dim(`… ${cm.diff.moreCount} more diff lines`)}`);
      }
    }
  }

  if (commits.length > limit) {
    lines.push(`\n  ${dim(`… ${commits.length - limit} more in this page`)}`);
  }

  const refs = prRefs(commits.slice(0, limit));
  if (refs.length > 0) {
    lines.push(
      `\n  ${c('yellow', '→')} ${refs.length} commit(s) reference PRs — deep-read e.g. ${bold(`pr ${owner}/${repo}${refs[0]}`)}`
    );
  }

  if (data?.pagination?.hasMore) {
    lines.push(
      `  ${dim(`More history — use --page ${data.pagination.nextPage ?? 2}`)}`
    );
  }

  return lines.join('\n');
}

export const historyCommand: CLICommand = {
  name: 'history',
  description:
    'Commit history for a GitHub repo, directory, or file — who changed what, when (with the #PR → deep-read chain)',
  usage:
    'history <owner/repo[/path][@branch]> [--since <iso>] [--until <iso>] [--author <name>] [--branch <ref>] [--diff] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
  options: [
    {
      name: 'since',
      hasValue: true,
      description: 'Start date (ISO 8601), e.g. 2024-01-01T00:00:00Z',
    },
    {
      name: 'until',
      hasValue: true,
      description: 'End date (ISO 8601)',
    },
    {
      name: 'author',
      hasValue: true,
      description: 'Filter by commit author',
    },
    {
      name: 'branch',
      hasValue: true,
      description: 'Branch or SHA to walk history from (also from @branch)',
    },
    {
      name: 'diff',
      description:
        'Include per-commit file diffs (larger output — use sparingly)',
    },
    {
      name: 'limit',
      hasValue: true,
      description: 'Max commits to return/show (default: 20)',
    },
    {
      name: 'page',
      hasValue: true,
      description: 'Result page (default: 1)',
    },
    {
      name: 'page-size',
      hasValue: true,
      description: 'Results per page (defaults to --limit)',
    },
    { name: 'json', description: 'Output raw JSON results' },
  ],
  handler: async args => {
    const { options } = args;
    const target = args.args[0] ?? '';
    const jsonOutput = getBool(options, 'json');
    const branchOverride = getString(options, 'branch');

    if (!target) {
      const err = 'Provide a GitHub repo, directory, or file ref.';
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: err }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${err}`);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    history facebook/react\n` +
            `    history facebook/react/packages/react/src        ${dim('# dir subtree')}\n` +
            `    history bgauryy/octocode/README.md --diff\n` +
            `    history vercel/next.js --since 2024-06-01T00:00:00Z\n`
        );
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    const ref = resolveRef(target, branchOverride || undefined);
    if (!isGithubRef(ref)) {
      const err = `Not a GitHub ref: "${target}". Provide owner/repo[/path][@branch].`;
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: err }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${err}\n`);
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    const rawLimit = getString(options, 'limit');
    const limit = rawLimit ? parseInt(rawLimit, 10) : 20;
    const rawPage = getString(options, 'page');
    const rawPageSize = getString(options, 'page-size');
    const page = rawPage ? parseInt(rawPage, 10) : undefined;
    const pageSize = rawPageSize ? parseInt(rawPageSize, 10) : limit;
    const showDiff = getBool(options, 'diff');

    if (!jsonOutput) {
      process.stderr.write(
        `  ${dim(`Loading commit history for ${refLabel(ref)} ...`)}\n`
      );
    }

    try {
      const sc = await fetchCommits(ref.owner, ref.repo, {
        path: ref.subpath || undefined,
        branch: ref.branch,
        since: getString(options, 'since') || undefined,
        until: getString(options, 'until') || undefined,
        author: getString(options, 'author') || undefined,
        includeDiff: showDiff,
        page,
        pageSize,
      });
      if (jsonOutput) {
        console.log(JSON.stringify(sc, null, 2));
        return;
      }
      console.log(
        '\n' + renderCommits(sc, limit, ref.owner, ref.repo, showDiff) + '\n'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: msg }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${msg}\n`);
      }
      process.exitCode = EXIT.TOOL;
    }
  },
};
