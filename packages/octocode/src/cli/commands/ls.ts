import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { CLICommand } from '../types.js';
import { getBool, getString, posIntOption } from '../options.js';
import {
  resolveRef,
  isGithubRef,
  isLocalRef,
  refLabel,
  cloneCommandFor,
} from '../routing.js';
import { c, bold, dim } from '../../utils/colors.js';
import { EXIT, classifyToolErrorText } from '../exit-codes.js';
import { printCliError } from '../cli-error.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import { outlineSymbols } from './symbol-outline.js';
import {
  formatMaterializationHints,
  materializeRemoteForCli,
  withMaterializationHints,
} from '../remote-local.js';

interface TreeEntry {
  dir?: string;
  files?: string[];
  folders?: string[];
  summary?: string;
}

interface TreeFilterOptions {
  pattern?: string;
  extensions?: string[];
  filesOnly?: boolean;
  directoriesOnly?: boolean;
}

interface StructureResult {
  results?: Array<{
    data?: {
      path?: string;
      files?: string[];
      folders?: string[];
      summary?: string;
      structure?: Record<string, TreeEntry> | TreeEntry[];
    };
  }>;
}

type LocalStructureResult = StructureResult;
type GithubStructureResult = StructureResult;

const SORT_VALUES = new Set(['name', 'size', 'time', 'extension']);

// Filters localViewStructure supports but ghViewRepoStructure does not.
const LOCAL_ONLY = ['hidden', 'sort', 'reverse'] as const;

interface LocalTreeOpts {
  depth?: number;
  pattern?: string;
  extensions?: string[];
  hidden?: boolean;
  sortBy?: string;
  reverse?: boolean;
  filesOnly?: boolean;
  directoriesOnly?: boolean;
  limit?: number;
  page?: number;
  itemsPerPage?: number;
}

async function fetchLocalTree(
  dirPath: string,
  opts: LocalTreeOpts
): Promise<LocalStructureResult> {
  const result = await executeDirectTool('localViewStructure', {
    queries: [
      {
        path: dirPath,
        // Going deep needs recursive:true; maxDepth caps the descent cost.
        ...(opts.depth != null
          ? { recursive: opts.depth > 1, maxDepth: opts.depth }
          : {}),
        pattern: opts.pattern,
        extensions: opts.extensions,
        hidden: opts.hidden || undefined,
        sortBy: opts.sortBy,
        reverse: opts.reverse || undefined,
        filesOnly: opts.filesOnly || undefined,
        directoriesOnly: opts.directoriesOnly || undefined,
        limit: opts.limit,
        page: opts.page,
        itemsPerPage: opts.itemsPerPage,
        mainResearchGoal: 'View directory structure',
        researchGoal: 'Get local directory tree',
        reasoning: 'CLI ls command',
      },
    ],
  });

  if (result.isError) {
    const errText =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    throw new Error(`Local structure error: ${errText}`);
  }

  return result.structuredContent as LocalStructureResult;
}

async function fetchGithubTree(
  owner: string,
  repo: string,
  subpath: string,
  branch?: string,
  maxDepth?: number,
  page?: number,
  itemsPerPage?: number
): Promise<GithubStructureResult> {
  const result = await executeDirectTool('ghViewRepoStructure', {
    queries: [
      {
        owner,
        repo,
        path: subpath || '',
        branch,
        maxDepth,
        page,
        itemsPerPage,
        mainResearchGoal: 'View repository structure',
        researchGoal: 'Get GitHub directory tree',
        reasoning: 'CLI ls command',
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
    if (/404|not found/i.test(errText)) {
      throw new Error(`Not found on GitHub: ${owner}/${repo}/${subpath}`);
    }
    throw new Error(`GitHub API error: ${errText}`);
  }

  return result.structuredContent as GithubStructureResult;
}

function renderTree(data: Record<string, unknown> | undefined): string {
  if (!data) return '(empty)';
  const lines: string[] = [];

  if ('structure' in data && data.structure) {
    const structure = data.structure as Record<string, TreeEntry> | TreeEntry[];
    // GitHub returns an array of { dir, folders, files }; local-style callers
    // may pass a dirPath-keyed map. Normalize both to [label, entry] pairs.
    const entries: Array<[string, TreeEntry]> = Array.isArray(structure)
      ? structure.map((entry, i) => [entry.dir ?? String(i), entry])
      : Object.entries(structure);
    for (const [dirPath, entry] of entries) {
      lines.push(bold(dirPath) + '/');
      (entry.folders ?? []).forEach(f =>
        lines.push(`  ${c('cyan', '📁')} ${f}/`)
      );
      (entry.files ?? []).forEach(f => lines.push(`  ${c('green', '·')} ${f}`));
    }
    return lines.join('\n');
  }

  if ('path' in data && data.path) lines.push(bold(data.path as string) + '/');
  ((data.folders as string[] | undefined) ?? []).forEach(f =>
    lines.push(`  ${c('cyan', '📁')} ${f}/`)
  );
  ((data.files as string[] | undefined) ?? []).forEach(f =>
    lines.push(`  ${c('green', '·')} ${f}`)
  );
  if ('summary' in data && data.summary)
    lines.push(`\n  ${dim(data.summary as string)}`);
  return lines.join('\n');
}

function listOpt(value: string): string[] | undefined {
  const list = value
    .split(',')
    .map(s =>
      s
        .trim()
        .replace(/^\*?\./, '')
        .toLowerCase()
    )
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesNameFilters(
  name: string,
  pattern: string | undefined,
  extensions: string[] | undefined
): boolean {
  if (extensions && extensions.length > 0) {
    const ext = name.split('.').pop()?.toLowerCase();
    if (!ext || !extensions.includes(ext)) return false;
  }
  if (!pattern) return true;
  return pattern.includes('*') || pattern.includes('?')
    ? globToRegExp(pattern).test(name)
    : name.toLowerCase().includes(pattern.toLowerCase());
}

function filterTreeData(
  data: Record<string, unknown> | undefined,
  options: TreeFilterOptions
): Record<string, unknown> | undefined {
  if (!data) return data;
  const filterEntry = (entry: TreeEntry): TreeEntry => ({
    ...entry,
    folders: options.filesOnly
      ? []
      : (entry.folders ?? []).filter(name =>
          matchesNameFilters(name, options.pattern, undefined)
        ),
    files: options.directoriesOnly
      ? []
      : (entry.files ?? []).filter(name =>
          matchesNameFilters(name, options.pattern, options.extensions)
        ),
  });

  if (Array.isArray(data.structure)) {
    return {
      ...data,
      structure: data.structure.map(entry => filterEntry(entry as TreeEntry)),
    };
  }
  if (
    data.structure &&
    typeof data.structure === 'object' &&
    !Array.isArray(data.structure)
  ) {
    return {
      ...data,
      structure: Object.fromEntries(
        Object.entries(data.structure as Record<string, TreeEntry>).map(
          ([key, entry]) => [key, filterEntry(entry)]
        )
      ),
    };
  }

  return filterEntry(data as TreeEntry) as Record<string, unknown>;
}

function filterStructureResult(
  structured: LocalStructureResult | GithubStructureResult,
  options: TreeFilterOptions
): LocalStructureResult | GithubStructureResult {
  return {
    ...structured,
    results: structured.results?.map(result => ({
      ...result,
      data: filterTreeData(
        result.data as Record<string, unknown> | undefined,
        options
      ) as typeof result.data,
    })),
  };
}

export const lsCommand: CLICommand = {
  name: 'ls',
  options: [
    { name: 'symbols' },
    { name: 'kind', hasValue: true },
    { name: 'depth', hasValue: true },
    { name: 'branch', hasValue: true },
    { name: 'repo', hasValue: true },
    { name: 'force-refresh' },
    { name: 'pattern', hasValue: true },
    { name: 'ext', hasValue: true },
    { name: 'sort', hasValue: true },
    { name: 'reverse' },
    { name: 'files-only' },
    { name: 'dirs-only' },
    { name: 'hidden' },
    { name: 'limit', hasValue: true },
    { name: 'page', hasValue: true },
    { name: 'page-size', hasValue: true },
    { name: 'json' },
  ],
  handler: async args => {
    const { options } = args;
    const target = args.args[0] ?? '';
    const branchOverride = getString(options, 'branch');
    const repoOption = getString(options, 'repo');
    const rawDepth = getString(options, 'depth');
    const depthExplicit = rawDepth ? parseInt(rawDepth, 10) : undefined;
    const jsonOutput = getBool(options, 'json');
    const sortBy = getString(options, 'sort') || undefined;

    const fail = (msg: string): void => {
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: msg }));
      } else {
        printCliError(msg);
      }
      process.exitCode = EXIT.USAGE;
    };

    if (!target && !repoOption) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            error: 'Provide a path or GitHub reference.',
          })
        );
      } else {
        printCliError('Provide a path or GitHub reference.');
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    ls src/\n` +
            `    ls src --ext ts --files-only --sort time\n` +
            `    ls bgauryy/octocode-mcp/packages --depth 2\n`
        );
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    if (sortBy && !SORT_VALUES.has(sortBy)) {
      fail('Invalid --sort. Use name, size, time, or extension.');
      return;
    }
    if (getBool(options, 'files-only') && getBool(options, 'dirs-only')) {
      fail('--files-only and --dirs-only are mutually exclusive.');
      return;
    }

    const ref = repoOption
      ? undefined
      : resolveRef(target, branchOverride || undefined);
    const githubRef = ref && isGithubRef(ref) ? ref : undefined;
    const localRef = ref && isLocalRef(ref) ? ref : undefined;
    const label = repoOption
      ? `${repoOption}${target ? `/${target}` : ''}`
      : ref
        ? refLabel(ref)
        : (repoOption ?? '');

    // ── Outline mode ─────────────────────────────────────────────────────────
    // --symbols (explicit) or a local file target (implicit zoom-in) shows a
    // semantic symbol outline instead of a tree. Local-only — LSP can't run on
    // GitHub.
    const wantSymbols = getBool(options, 'symbols');
    if (wantSymbols && githubRef) {
      fail(
        '--symbols is local-only — an LSP outline cannot run on GitHub. ' +
          `Clone first: \`${cloneCommandFor(githubRef)}\`, then \`ls <local-path> --symbols\`.`
      );
      return;
    }
    if (repoOption) {
      try {
        const materialized = await materializeRemoteForCli({
          repoRef: repoOption,
          path: target || undefined,
          branch: branchOverride || undefined,
          forceRefresh: getBool(options, 'force-refresh') || undefined,
          kind: target ? (wantSymbols ? 'file' : 'tree') : 'repo',
        });
        if (wantSymbols) {
          if (!jsonOutput) {
            process.stderr.write(
              `  ${dim(`Outlining ${materialized.localPath} ...`)}\n`
            );
          }
          await outlineSymbols(materialized.localPath, options, {
            structured: withMaterializationHints(
              { structuredContent: {} },
              materialized
            ).structuredContent as Record<string, unknown>,
            text: formatMaterializationHints(materialized),
          });
          return;
        }

        if (!jsonOutput) {
          process.stderr.write(
            `  ${dim(`Loading ${materialized.localPath} ...`)}\n`
          );
        }
        const structured = await fetchLocalTree(materialized.localPath, {
          depth: depthExplicit,
          pattern: getString(options, 'pattern') || undefined,
          extensions: listOpt(getString(options, 'ext')),
          hidden: getBool(options, 'hidden'),
          sortBy,
          reverse: getBool(options, 'reverse'),
          filesOnly: getBool(options, 'files-only'),
          directoriesOnly: getBool(options, 'dirs-only'),
          limit: posIntOption(getString(options, 'limit')),
          page: posIntOption(getString(options, 'page')),
          itemsPerPage: posIntOption(getString(options, 'page-size')),
        });
        const treeFilters: TreeFilterOptions = {
          pattern: getString(options, 'pattern') || undefined,
          extensions: listOpt(getString(options, 'ext')),
          filesOnly: getBool(options, 'files-only'),
          directoriesOnly: getBool(options, 'dirs-only'),
        };
        const filteredStructured = filterStructureResult(
          structured,
          treeFilters
        );
        if (jsonOutput) {
          console.log(
            JSON.stringify(
              withMaterializationHints(
                { structuredContent: filteredStructured },
                materialized
              ).structuredContent,
              null,
              2
            )
          );
          return;
        }

        const data = filteredStructured?.results?.[0]?.data as
          | Record<string, unknown>
          | undefined;
        console.log(
          '\n' +
            renderTree(data) +
            '\n' +
            formatMaterializationHints(materialized) +
            '\n'
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (jsonOutput) {
          console.log(JSON.stringify({ success: false, error: msg }));
        } else {
          printCliError(msg);
        }
        process.exitCode = classifyToolErrorText(msg);
      }
      return;
    }
    if (localRef) {
      const resolvedPath = path.resolve(localRef.path);
      const isFile =
        existsSync(resolvedPath) && statSync(resolvedPath).isFile();
      if (wantSymbols || isFile) {
        if (!jsonOutput) {
          process.stderr.write(`  ${dim(`Outlining ${label} ...`)}\n`);
        }
        await outlineSymbols(localRef.path, options);
        return;
      }
    }

    if (githubRef) {
      const localOnly = LOCAL_ONLY.find(name => options[name] !== undefined);
      if (localOnly) {
        fail(
          `--${localOnly} is local-only; GitHub structure supports --depth, --branch, --pattern, --ext, --files-only, and --dirs-only.`
        );
        return;
      }
    }

    if (!jsonOutput) {
      process.stderr.write(`  ${dim(`Loading ${label} ...`)}\n`);
    }

    try {
      let structured: LocalStructureResult | GithubStructureResult;

      if (githubRef) {
        structured = await fetchGithubTree(
          githubRef.owner,
          githubRef.repo,
          githubRef.subpath,
          githubRef.branch,
          depthExplicit,
          posIntOption(getString(options, 'page')),
          posIntOption(getString(options, 'page-size'))
        );
      } else if (localRef) {
        structured = await fetchLocalTree(localRef.path, {
          depth: depthExplicit,
          pattern: getString(options, 'pattern') || undefined,
          extensions: listOpt(getString(options, 'ext')),
          hidden: getBool(options, 'hidden'),
          sortBy,
          reverse: getBool(options, 'reverse'),
          filesOnly: getBool(options, 'files-only'),
          directoriesOnly: getBool(options, 'dirs-only'),
          limit: posIntOption(getString(options, 'limit')),
          page: posIntOption(getString(options, 'page')),
          itemsPerPage: posIntOption(getString(options, 'page-size')),
        });
      } else {
        fail('Provide a path or GitHub reference.');
        return;
      }

      const treeFilters: TreeFilterOptions = {
        pattern: getString(options, 'pattern') || undefined,
        extensions: listOpt(getString(options, 'ext')),
        filesOnly: getBool(options, 'files-only'),
        directoriesOnly: getBool(options, 'dirs-only'),
      };
      const filteredStructured = filterStructureResult(structured, treeFilters);

      if (jsonOutput) {
        console.log(JSON.stringify(filteredStructured, null, 2));
        return;
      }

      const data = filteredStructured?.results?.[0]?.data as
        | Record<string, unknown>
        | undefined;
      console.log('\n' + renderTree(data) + '\n');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: msg }));
      } else {
        printCliError(msg);
      }
      process.exitCode = classifyToolErrorText(msg);
    }
  },
};
