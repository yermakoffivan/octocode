import type { CLICommand, ParsedArgs } from './types.js';
import { findStaticCommandHelp } from './command-help-specs.js';
import { c, bold, dim } from '../utils/colors.js';

// Flags accepted on every command, regardless of its own option list.
const GLOBAL_FLAGS = new Set([
  'json',
  'compact',
  'no-color',
  'help',
  'version',
]);

/**
 * The set of option names a command legitimately accepts: its own declared
 * options ∪ the static help spec options ∪ the always-on global flags.
 * Unioning both sources guarantees we never reject a flag a handler reads.
 */
export function getAllowedOptionNames(command: CLICommand): Set<string> {
  const names = new Set<string>(GLOBAL_FLAGS);
  for (const opt of command.options ?? []) {
    names.add(opt.name);
  }
  const spec = findStaticCommandHelp(command.name);
  for (const opt of spec?.options ?? []) {
    names.add(opt.name);
  }
  return names;
}

export function findUnknownOptions(
  command: CLICommand,
  args: ParsedArgs
): string[] {
  const allowed = getAllowedOptionNames(command);
  return Object.keys(args.options).filter(key => !allowed.has(key));
}

/** Levenshtein distance — used for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0)
  );
  for (let i = 0; i < rows; i++) dist[i][0] = i;
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + cost
      );
    }
  }
  return dist[a.length][b.length];
}

function suggestFlag(
  unknown: string,
  allowed: Set<string>
): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const name of allowed) {
    const score = editDistance(unknown, name);
    if (score < bestScore) {
      bestScore = score;
      best = name;
    }
  }
  // Only suggest a near-miss (typo), not an unrelated flag.
  return best && bestScore <= Math.max(2, Math.ceil(unknown.length / 3))
    ? best
    : undefined;
}

/**
 * Print an actionable error for unknown flags: name the offenders, suggest the
 * nearest valid flag, then list every flag the command accepts. Sets no exit
 * code — the caller owns that.
 */
export function printUnknownOptionError(
  command: CLICommand,
  unknown: string[]
): void {
  const allowed = getAllowedOptionNames(command);
  // List the command's own flags (not the always-implicit globals) for the menu.
  const ownFlags = [...allowed].filter(name => !GLOBAL_FLAGS.has(name)).sort();

  console.log();
  for (const flag of unknown) {
    const hint = suggestFlag(flag, allowed);
    const suffix = hint ? `  ${dim(`(did you mean --${hint}?)`)}` : '';
    console.log(
      `  ${c('red', '✗')} Unknown flag ${c('yellow', `--${flag}`)} for '${command.name}'${suffix}`
    );
  }
  console.log();
  console.log(`  ${bold(`Valid flags for ${command.name}:`)}`);
  console.log(`    ${ownFlags.map(name => c('cyan', `--${name}`)).join(' ')}`);
  console.log(`    ${dim('--json --compact --no-color')} ${dim('(global)')}`);
  console.log();
  console.log(
    `  ${dim('Run')} ${c('cyan', `${command.name} --help`)} ${dim('for full usage. For raw tool access:')} ${c('cyan', 'tools <name> --scheme')}`
  );
  console.log();
}
