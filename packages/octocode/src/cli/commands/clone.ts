import type { CLICommand } from '../types.js';
import { getBool, getString } from '../options.js';
import { resolveRef, isGithubRef, refLabel } from '../routing.js';
import { c, dim } from '../../utils/colors.js';
import { EXIT } from '../exit-codes.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  markDirectToolFailure,
  printDirectToolResult,
} from './direct-tool-output.js';

export const cloneCommand: CLICommand = {
  name: 'clone',
  description:
    'Clone a GitHub repository or subtree locally (sparse) for repeated local search, reads, and LSP',
  usage:
    'clone <owner/repo[/path][@branch]|url> [--branch <ref>] [--force-refresh] [--json]',
  options: [
    {
      name: 'branch',
      hasValue: true,
      description:
        'Branch, tag, or SHA to clone (overrides @branch in the ref)',
    },
    {
      name: 'force-refresh',
      description: 'Re-clone from GitHub, bypassing the 24h cache',
    },
    { name: 'json', description: 'Output raw JSON results' },
  ],
  handler: async args => {
    const target = args.args[0] ?? '';
    const jsonOutput = getBool(args.options, 'json');
    const branchOverride = getString(args.options, 'branch');

    const reportUsage = (message: string): void => {
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error: message }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${message}`);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    clone facebook/react\n` +
            `    clone facebook/react/packages/react        ${dim('# sparse subtree')}\n` +
            `    clone facebook/react@main/packages/react\n` +
            `    clone https://github.com/owner/repo/tree/main/src\n`
        );
      }
      process.exitCode = EXIT.USAGE;
    };

    if (!target) {
      reportUsage('Provide a GitHub ref: owner/repo[/path][@branch] or a URL.');
      return;
    }

    const ref = resolveRef(target, branchOverride || undefined);
    if (!isGithubRef(ref)) {
      reportUsage(
        `Not a GitHub ref: "${target}". Provide owner/repo[/path][@branch] or a github.com URL.`
      );
      return;
    }

    if (!jsonOutput) {
      process.stderr.write(`  ${dim(`Cloning ${refLabel(ref)} ...`)}\n`);
    }

    try {
      const result = await executeDirectTool('ghCloneRepo', {
        queries: [
          {
            owner: ref.owner,
            repo: ref.repo,
            branch: ref.branch,
            sparsePath: ref.subpath || undefined,
            forceRefresh: getBool(args.options, 'force-refresh') || undefined,
            mainResearchGoal: 'Clone a GitHub repository for local research',
            researchGoal: `Clone ${refLabel(ref)} for local search and LSP`,
            reasoning: 'CLI clone command',
          },
        ],
      });

      printDirectToolResult(result, jsonOutput);
      markDirectToolFailure(result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            error: `Octocode tool runtime failed: ${message}`,
          })
        );
      } else {
        console.error(
          `\n  ${c('red', '✗')} Octocode tool runtime failed: ${message}\n`
        );
      }
      process.exitCode = EXIT.TOOL;
    }
  },
};
