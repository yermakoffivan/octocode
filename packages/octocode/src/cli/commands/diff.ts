import type { CLICommand } from '../types.js';
import { getBool, getString, nonNegIntOption } from '../options.js';
import { resolveRef, isGithubRef, refLabel, type Ref } from '../routing.js';
import { c, dim } from '../../utils/colors.js';
import { EXIT, classifyToolErrorText } from '../exit-codes.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';

type DirectToolResult = {
  readonly isError?: boolean;
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
  }[];
  readonly structuredContent?: unknown;
};

type DiffOp =
  | { kind: 'same'; text: string }
  | { kind: 'remove'; text: string }
  | { kind: 'add'; text: string };

function printError(message: string, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(`\n  ${c('red', 'x')} ${message}\n`);
  }
  process.exitCode = EXIT.USAGE;
}

function extractToolText(result: DirectToolResult): string {
  return (result.content ?? [])
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

function extractContent(result: DirectToolResult): string | undefined {
  const structured = result.structuredContent as
    | {
        readonly results?: readonly {
          readonly data?: { readonly content?: unknown };
        }[];
        readonly content?: unknown;
      }
    | undefined;
  const content =
    structured?.results?.[0]?.data?.content ?? structured?.content;
  return typeof content === 'string' ? content : undefined;
}

async function fetchContent(ref: Ref): Promise<string> {
  const toolName = isGithubRef(ref)
    ? 'ghGetFileContent'
    : 'localGetFileContent';
  const query = isGithubRef(ref)
    ? {
        owner: ref.owner,
        repo: ref.repo,
        path: ref.subpath || '.',
        branch: ref.branch,
        minify: 'none',
        fullContent: true,
        mainResearchGoal: 'Diff file content',
        researchGoal: `Read ${refLabel(ref)} for diff`,
        reasoning: 'CLI diff command',
      }
    : {
        path: ref.path,
        minify: 'none',
        fullContent: true,
        mainResearchGoal: 'Diff file content',
        researchGoal: `Read ${ref.path} for diff`,
        reasoning: 'CLI diff command',
      };

  const result = (await executeDirectTool(toolName, {
    queries: [query],
  })) as DirectToolResult;
  if (result.isError) {
    throw new Error(extractToolText(result) || 'content fetch failed');
  }
  const content = extractContent(result);
  if (content === undefined) {
    throw new Error(`No content returned for ${refLabel(ref)}.`);
  }
  return content;
}

function diffLines(left: string[], right: string[]): DiffOp[] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0)
  );

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        left[i] === right[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: 'same', text: left[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: 'remove', text: left[i]! });
      i++;
    } else {
      ops.push({ kind: 'add', text: right[j]! });
      j++;
    }
  }
  while (i < left.length) ops.push({ kind: 'remove', text: left[i++]! });
  while (j < right.length) ops.push({ kind: 'add', text: right[j++]! });
  return ops;
}

function renderDiff(
  leftLabel: string,
  rightLabel: string,
  leftContent: string,
  rightContent: string,
  contextLines: number
): string {
  if (leftContent === rightContent) return 'No differences.';

  const ops = diffLines(leftContent.split('\n'), rightContent.split('\n'));
  const changed = new Set<number>();
  ops.forEach((op, index) => {
    if (op.kind !== 'same') changed.add(index);
  });

  const keep = new Set<number>();
  for (const index of changed) {
    for (
      let i = Math.max(0, index - contextLines);
      i <= Math.min(ops.length - 1, index + contextLines);
      i++
    ) {
      keep.add(i);
    }
  }

  const lines = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  let skipped = false;
  ops.forEach((op, index) => {
    if (!keep.has(index)) {
      skipped = true;
      return;
    }
    if (skipped) {
      lines.push('...');
      skipped = false;
    }
    const prefix = op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' ';
    lines.push(`${prefix}${op.text}`);
  });
  return lines.join('\n');
}

export const diffCommand: CLICommand = {
  name: 'diff',
  description: 'Compare two files from local paths or GitHub refs',
  usage:
    'diff <left path|github-ref> <right path|github-ref> [--context-lines <n>] [--branch <ref>] [--json]',
  options: [
    {
      name: 'context-lines',
      hasValue: true,
      description: 'Unchanged lines to keep around changes (default: 3)',
    },
    {
      name: 'branch',
      hasValue: true,
      description: 'Branch/ref for GitHub refs that do not include @branch',
    },
    { name: 'json', description: 'Output structured JSON' },
  ],
  handler: async args => {
    const jsonOutput = getBool(args.options, 'json');
    const left = args.args[0];
    const right = args.args[1];
    if (!left || !right) {
      printError('Provide two file paths or GitHub file refs.', jsonOutput);
      return;
    }

    const contextLines =
      nonNegIntOption(getString(args.options, 'context-lines')) ?? 3;
    const branch = getString(args.options, 'branch') || undefined;
    const leftRef = resolveRef(left, branch);
    const rightRef = resolveRef(right, branch);

    if (!jsonOutput) {
      process.stderr.write(
        `  ${dim(`Diffing ${refLabel(leftRef)} -> ${refLabel(rightRef)} ...`)}\n`
      );
    }

    try {
      const [leftContent, rightContent] = await Promise.all([
        fetchContent(leftRef),
        fetchContent(rightRef),
      ]);
      const diff = renderDiff(
        refLabel(leftRef),
        refLabel(rightRef),
        leftContent,
        rightContent,
        contextLines
      );
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            {
              left: refLabel(leftRef),
              right: refLabel(rightRef),
              equal: leftContent === rightContent,
              diff,
            },
            null,
            2
          )
        );
        return;
      }
      console.log(`\n${diff}\n`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: message }));
      } else {
        console.error(`\n  ${c('red', 'x')} ${message}\n`);
      }
      process.exitCode = classifyToolErrorText(message);
    }
  },
};
