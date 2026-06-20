import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { CLICommand } from '../types.js';
import { getBool, getString, posIntOption } from '../options.js';
import { resolveRef, isGithubRef, refLabel } from '../routing.js';
import { c, bold, dim } from '../../utils/colors.js';
import { EXIT, classifyToolErrorText } from '../exit-codes.js';
import { printCliError } from '../cli-error.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import { outlineSymbols } from './symbol-outline.js';

interface TreeEntry {
  dir?: string;
  files?: string[];
  folders?: string[];
  summary?: string;
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
  options: {
    pattern?: string;
    extensions?: string[];
    filesOnly?: boolean;
    directoriesOnly?: boolean;
  }
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

export const lsCommand: CLICommand = {
  name: 'ls',
  description:
    'Show structure at any zoom: a directory tree (local or GitHub), or a code symbol outline when the target is a file or you pass --symbols (local-only). One command for "what is in here" and "what does this file define".',
  usage:
    'ls <path|github-ref> [--symbols] [--kind <kind>] [--depth <n>] [--branch <ref>] [--pattern <glob>] [--ext <list>] [--sort name|size|time|extension] [--reverse] [--files-only] [--dirs-only] [--hidden] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
  options: [
    {
      name: 'symbols',
      description:
        'Show a semantic symbol outline (LSP) instead of a tree. Local-only. Auto-enabled when the target is a file. For a directory, outlines source files (filter with --ext, cap with --limit/--depth).',
    },
    {
      name: 'kind',
      hasValue: true,
      description:
        'Outline mode: filter symbols by kind, e.g. function, class, method',
    },
    {
      name: 'depth',
      hasValue: true,
      description: 'Recursion depth (1 = top level; raise to descend)',
    },
    {
      name: 'branch',
      hasValue: true,
      description: 'Branch / ref for GitHub paths',
    },
    {
      name: 'pattern',
      hasValue: true,
      description: 'Name filter — glob or substring, e.g. "*.ts" (local only)',
    },
    {
      name: 'ext',
      hasValue: true,
      description: 'Comma-separated extension whitelist, e.g. ts,tsx',
    },
    {
      name: 'sort',
      hasValue: true,
      description: 'Order: name (default), size, time, extension (local only)',
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
  handler: async args => {
    const { options } = args;
    const target = args.args[0] ?? '';
    const branchOverride = getString(options, 'branch');
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

    if (!target) {
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

    const ref = resolveRef(target, branchOverride || undefined);
    const label = refLabel(ref);
    const isGh = isGithubRef(ref);

    // ── Outline mode ─────────────────────────────────────────────────────────
    // --symbols (explicit) or a local file target (implicit zoom-in) shows a
    // semantic symbol outline instead of a tree. Local-only — LSP can't run on
    // GitHub.
    const wantSymbols = getBool(options, 'symbols');
    if (wantSymbols && isGh) {
      fail(
        '--symbols is local-only — an LSP outline cannot run on GitHub. Clone the repo first, then `ls <path> --symbols`.'
      );
      return;
    }
    if (!isGh) {
      const resolvedPath = path.resolve(ref.path);
      const isFile =
        existsSync(resolvedPath) && statSync(resolvedPath).isFile();
      if (wantSymbols || isFile) {
        if (!jsonOutput) {
          process.stderr.write(`  ${dim(`Outlining ${label} ...`)}\n`);
        }
        await outlineSymbols(ref.path, options);
        return;
      }
    }

    if (isGh) {
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

      if (isGh) {
        structured = await fetchGithubTree(
          ref.owner,
          ref.repo,
          ref.subpath,
          ref.branch,
          depthExplicit,
          posIntOption(getString(options, 'page')),
          posIntOption(getString(options, 'page-size'))
        );
      } else {
        structured = await fetchLocalTree(ref.path, {
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
      }

      if (jsonOutput) {
        console.log(JSON.stringify(structured, null, 2));
        return;
      }

      const data = filterTreeData(structured?.results?.[0]?.data, {
        pattern: getString(options, 'pattern') || undefined,
        extensions: listOpt(getString(options, 'ext')),
        filesOnly: getBool(options, 'files-only'),
        directoriesOnly: getBool(options, 'dirs-only'),
      });
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
