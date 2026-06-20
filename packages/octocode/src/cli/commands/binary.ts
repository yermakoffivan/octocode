import type { CLICommand } from '../types.js';
import { getBool, getString, posIntOption } from '../options.js';
import { c, dim } from '../../utils/colors.js';
import { EXIT } from '../exit-codes.js';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  markDirectToolFailure,
  printDirectToolResult,
} from './direct-tool-output.js';

type BinaryMode = 'inspect' | 'list' | 'extract' | 'decompress' | 'strings';

// Multi-entry archives → list. Checked before single-stream compression so
// that .tar.gz/.tgz route to "list", not "decompress".
const ARCHIVE_RE =
  /\.(zip|jar|war|ear|7z|deb|dmg|rpm|apk|nupkg|whl|gem|ar|a)$|\.tar(\.(gz|bz2|xz|zst|zstd|lz4|br|lzfse))?$|\.t(gz|bz2?|xz|zst)$/i;
// Single-stream compressed payloads → decompress.
const COMPRESSED_RE = /\.(gz|bz2|xz|lzma|zst|zstd|lz4|br|lzfse)$/i;

/** Auto-pick the inspection mode from the file extension. */
function detectMode(file: string): BinaryMode {
  if (ARCHIVE_RE.test(file)) return 'list';
  if (COMPRESSED_RE.test(file)) return 'decompress';
  // Native binaries (.so/.dylib/.node/.exe/.wasm/…) and anything unrecognized
  // default to the smart inspect: it returns identity (type + magic) for any
  // file and structural detail for recognized executables. `strings` stays an
  // explicit opt-in.
  return 'inspect';
}

/** Explicit flag overrides win over auto-detection; --extract implies extract. */
function resolveMode(
  file: string,
  options: Record<string, string | boolean>
): { mode: BinaryMode; auto: boolean } {
  if (getString(options, 'extract')) return { mode: 'extract', auto: false };
  if (getBool(options, 'list')) return { mode: 'list', auto: false };
  if (getBool(options, 'strings')) return { mode: 'strings', auto: false };
  if (getBool(options, 'decompress'))
    return { mode: 'decompress', auto: false };
  if (getBool(options, 'inspect')) return { mode: 'inspect', auto: false };
  return { mode: detectMode(file), auto: true };
}

export const binaryCommand: CLICommand = {
  name: 'binary',
  description:
    'Inspect archives, compressed files, and binaries — inspect structure, list/unzip entries, decompress, or read strings',
  usage:
    'binary <file> [--inspect | --list | --strings | --decompress | --extract <entry>] [--match <s>] [--min-length <n>] [--max-entries <n>] [--format <fmt>] [--verbose] [--offsets] [--page <n>] [--json]',
  options: [
    { name: 'list', description: 'List archive entries (.zip/.tar.*/.jar/…)' },
    {
      name: 'extract',
      hasValue: true,
      description: 'Extract one archive entry by exact path (run --list first)',
    },
    {
      name: 'inspect',
      description:
        'Structure of a native binary: format, arch, symbols, imports, exports, sections, deps',
    },
    {
      name: 'strings',
      description: 'Readable strings of a native binary (.so/.dylib/.node/…)',
    },
    {
      name: 'decompress',
      description: 'Decompress a single-stream file (.gz/.xz/.zst/…)',
    },
    {
      name: 'match',
      hasValue: true,
      description:
        'Keep only extracted/decompressed lines matching this string (search in content)',
    },
    {
      name: 'min-length',
      hasValue: true,
      description: 'strings: shortest run to keep (raise to ~12 for symbols)',
    },
    {
      name: 'max-entries',
      hasValue: true,
      description: 'list: cap number of entries returned',
    },
    {
      name: 'format',
      hasValue: true,
      description:
        'decompress: force format (gzip|bzip2|xz|lzma|zstd|lz4|brotli|lzfse)',
    },
    { name: 'verbose', description: 'list: include entry size and mtime' },
    {
      name: 'offsets',
      description: 'strings: prefix each string with its hex byte offset',
    },
    {
      name: 'char-offset',
      hasValue: true,
      description:
        'strings/decompress/extract: char offset to read from (follow the charOffset=N hint to page)',
    },
    {
      name: 'char-length',
      hasValue: true,
      description:
        'strings/decompress/extract: characters per page window (default: server default)',
    },
    { name: 'page', hasValue: true, description: 'Result page (list mode)' },
    { name: 'json', description: 'Output raw JSON results' },
  ],
  handler: async args => {
    const { options } = args;
    const file = args.args[0] ?? '';
    const jsonOutput = getBool(options, 'json');

    if (!file) {
      const error = 'Provide a file path to inspect.';
      if (jsonOutput) {
        console.log(JSON.stringify({ success: false, error }));
      } else {
        console.error(`\n  ${c('red', '✗')} ${error}`);
        console.error(
          `\n  ${dim('Examples:')}\n` +
            `    binary app.zip                 ${dim('# list entries')}\n` +
            `    binary app.zip --extract README.md\n` +
            `    binary libssl.so               ${dim('# inspect: format, symbols, deps')}\n` +
            `    binary libssl.so --strings     ${dim('# readable strings')}\n` +
            `    binary data.json.gz            ${dim('# decompress')}\n`
        );
      }
      process.exitCode = EXIT.USAGE;
      return;
    }

    const { mode, auto } = resolveMode(file, options);
    const match = getString(options, 'match') || undefined;

    const query: Record<string, unknown> = {
      path: file,
      mode,
      mainResearchGoal: `Inspect ${file}`,
      researchGoal: `Run localBinaryInspect mode "${mode}" on ${file}`,
      reasoning: 'CLI binary command',
    };

    if (mode === 'list') {
      if (getBool(options, 'verbose')) query.verbose = true;
      const maxEntries = posIntOption(getString(options, 'max-entries'));
      if (maxEntries) query.maxEntries = maxEntries;
    } else if (mode === 'extract') {
      query.archiveFile = getString(options, 'extract');
      if (match) query.matchString = match;
    } else if (mode === 'decompress') {
      const format = getString(options, 'format') || undefined;
      if (format) query.format = format;
      if (match) query.matchString = match;
    } else if (mode === 'strings') {
      const minLength = posIntOption(getString(options, 'min-length'));
      if (minLength) query.minLength = minLength;
      if (getBool(options, 'offsets')) query.includeOffsets = true;
    }

    // Char-window pagination for the text-producing modes (strings/decompress/
    // extract); agents follow the charOffset=N hint to page losslessly.
    if (mode === 'strings' || mode === 'decompress' || mode === 'extract') {
      const charOffsetRaw = getString(options, 'char-offset');
      const charOffset =
        charOffsetRaw && /^\d+$/.test(charOffsetRaw)
          ? parseInt(charOffsetRaw, 10)
          : undefined;
      const charLength = posIntOption(getString(options, 'char-length'));
      if (charOffset !== undefined) query.charOffset = charOffset;
      if (charLength) query.charLength = charLength;
    }

    const page = posIntOption(getString(options, 'page'));
    if (page) query.page = page;

    if (!jsonOutput) {
      const how = auto ? ` ${dim(`(auto: ${mode})`)}` : '';
      process.stderr.write(
        `  ${dim(`Inspecting ${file}`)}${how}${dim(' ...')}\n`
      );
    }

    try {
      const result = await executeDirectTool('localBinaryInspect', {
        queries: [query],
      });

      printDirectToolResult(result, jsonOutput);
      markDirectToolFailure(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
