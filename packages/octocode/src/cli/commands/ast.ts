import type { CLICommand } from '../types.js';
import { getBool, getString, nonNegIntOption } from '../options.js';
import { resolveRef, isGithubRef, refLabel } from '../routing.js';
import { dim } from '../../utils/colors.js';
import { EXIT } from '../exit-codes.js';
import { printCliError } from '../cli-error.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  renderLocalResults,
  type LocalSearchResult,
} from './local-search-render.js';

interface AstOpts {
  typeFilter?: string;
  contextLines?: number;
  maxMatchesPerFile?: number;
  page?: number;
  pageSize?: number;
  // `pattern` is a code-shaped query ($X / $$$ARGS); `rule` is a YAML rule blob.
  pattern?: string;
  rule?: string;
}

async function searchAst(
  dirPath: string,
  opts: AstOpts
): Promise<LocalSearchResult> {
  const shape = opts.pattern ?? opts.rule ?? '';
  const result = await executeDirectTool('localSearchCode', {
    queries: [
      {
        path: dirPath,
        mode: 'structural' as const,
        ...(opts.pattern ? { pattern: opts.pattern } : { rule: opts.rule }),
        langType: opts.typeFilter,
        contextLines: opts.contextLines,
        maxMatchesPerFile: opts.maxMatchesPerFile,
        page: opts.page,
        itemsPerPage: opts.pageSize,
        mainResearchGoal: 'Search local codebase by AST shape',
        researchGoal: `Find AST shape "${shape}" in ${dirPath}`,
        reasoning: 'CLI ast command',
      },
    ],
  });

  if (result.isError) {
    const errText =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    throw new Error(`AST search error: ${errText}`);
  }

  return result.structuredContent as LocalSearchResult;
}

export const astCommand: CLICommand = {
  name: 'ast',
  description:
    'Search code by AST shape (ast-grep) — structure-aware, so comments/strings never false-match. Local paths only; for text/regex use grep.',
  usage:
    'ast <pattern> [path] | ast [path] --rule <yaml> [--type <lang>] [--context-lines <n>] [--max-matches <n>] [--limit <n>] [--page <n>] [--page-size <n>] [--json]',
  options: [
    {
      name: 'pattern',
      hasValue: true,
      description:
        'AST shape (alternative to the positional pattern). Metavars: $X = one node, $$$ARGS = a list. E.g. "eval($X)", "console.log($$$)".',
    },
    {
      name: 'rule',
      hasValue: true,
      description:
        'AST relational rule (YAML) for what --pattern can\'t express — not/inside/has/all/any. Relational sub-rules need "stopBy: end". Mutually exclusive with a pattern.',
    },
    {
      name: 'type',
      hasValue: true,
      description: 'Filter by language / extension (e.g. ts, py, go)',
    },
    {
      name: 'context-lines',
      hasValue: true,
      description: 'Lines of context around each match (default: 0)',
    },
    {
      name: 'max-matches',
      hasValue: true,
      description: 'Max matches returned per file',
    },
    {
      name: 'limit',
      hasValue: true,
      description: 'Max files to show in rendered output (default: 10)',
    },
    { name: 'page', hasValue: true, description: 'Result page to fetch' },
    {
      name: 'page-size',
      hasValue: true,
      description: 'Results per page (default: server default)',
    },
    { name: 'json', description: 'Output raw JSON results' },
  ],
  handler: async args => {
    const { options } = args;
    const jsonOutput = getBool(options, 'json');
    const ruleOpt = getString(options, 'rule') || undefined;
    const patternOpt = getString(options, 'pattern') || undefined;

    // Resolve pattern + path. A flag (--pattern/--rule) means arg[0] is the
    // path; otherwise the first positional IS the pattern and arg[1] the path.
    let pattern = patternOpt;
    let target: string;
    if (ruleOpt || patternOpt) {
      target = args.args[0] || '.';
    } else {
      pattern = args.args[0];
      target = args.args[1] || '.';
    }

    if (patternOpt && ruleOpt) {
      const err = 'Provide either --pattern or --rule, not both.';
      if (jsonOutput)
        console.log(JSON.stringify({ success: false, error: err }));
      else printCliError(err);
      process.exitCode = EXIT.USAGE;
      return;
    }

    if (!pattern && !ruleOpt) {
      const err = 'Provide an AST pattern (or --rule <yaml>).';
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: err }));
      } else {
        printCliError(err);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    ast "eval($X)" src/\n` +
            `    ast "console.log($$$)" src --type ts\n` +
            `    ast src --pattern "oldApi.$M($$$)"\n` +
            `    ast src --rule 'rule:\\n  pattern: await $C\\n  inside:\\n    kind: for_statement\\n    stopBy: end'\n`
        );
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    const ref = resolveRef(target);
    if (isGithubRef(ref)) {
      const err =
        'AST search is local-only (ast-grep cannot run on GitHub). Clone the repo first, or use grep for GitHub text search.';
      if (jsonOutput)
        console.log(JSON.stringify({ success: false, error: err }));
      else printCliError(err);
      process.exitCode = EXIT.USAGE;
      return;
    }

    const rawLimit = getString(options, 'limit');
    const limit = rawLimit ? parseInt(rawLimit, 10) : 10;
    const shape = pattern ?? ruleOpt ?? '';

    if (!jsonOutput) {
      process.stderr.write(
        `  ${dim(`Searching AST "${shape}" in ${refLabel(ref)} ...`)}\n`
      );
    }

    try {
      const sc = await searchAst(ref.path, {
        pattern,
        rule: ruleOpt,
        typeFilter: getString(options, 'type') || undefined,
        contextLines: nonNegIntOption(getString(options, 'context-lines')),
        maxMatchesPerFile: nonNegIntOption(getString(options, 'max-matches')),
        page: nonNegIntOption(getString(options, 'page')),
        pageSize: nonNegIntOption(getString(options, 'page-size')),
      });
      if (jsonOutput) {
        console.log(JSON.stringify(sc, null, 2));
        return;
      }
      console.log('\n' + renderLocalResults(sc, limit) + '\n');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonOutput)
        console.log(JSON.stringify({ success: false, error: msg }));
      else printCliError(msg);
      process.exitCode = EXIT.TOOL;
    }
  },
};
