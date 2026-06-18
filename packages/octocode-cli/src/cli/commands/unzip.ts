import type { CLICommand } from '../types.js';
import { getBool, getString } from '../options.js';
import { c, dim } from '../../utils/colors.js';
import { EXIT } from '../exit-codes.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  markDirectToolFailure,
  printDirectToolResult,
} from './direct-tool-output.js';

export const unzipCommand: CLICommand = {
  name: 'unzip',
  description:
    'Unpack an archive to a local directory (cached), then run grep/find/ls/cat/ast/lsp on the contents',
  usage: 'unzip <archive> [--json]',
  options: [{ name: 'json', description: 'Output raw JSON results' }],
  handler: async args => {
    const file = args.args[0] ?? '';
    const jsonOutput = getBool(args.options, 'json');

    if (!file) {
      const error = 'Provide an archive path to unpack.';
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error }));
      } else {
        console.error(`\n  ${c('red', 'x')} ${error}`);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    unzip app.zip\n` +
            `    unzip release.tar.gz\n` +
            `    ${dim('# then work on the unpacked tree:')}\n` +
            `    ls ~/.octocode/archives/app.zip__<hash>\n` +
            `    grep "apiKey" ~/.octocode/archives/app.zip__<hash>\n`
        );
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    if (!jsonOutput) {
      process.stderr.write(`  ${dim(`Unpacking ${file} ...`)}\n`);
    }

    try {
      const result = await executeDirectTool('localBinaryInspect', {
        queries: [
          {
            path: file,
            mode: 'unpack',
            mainResearchGoal: 'Unpack an archive for local research',
            researchGoal: `Extract ${file} to a local directory`,
            reasoning: 'CLI unzip command',
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
          `\n  ${c('red', 'x')} Octocode tool runtime failed: ${message}\n`
        );
      }
      process.exitCode = EXIT.TOOL;
    }
  },
};
