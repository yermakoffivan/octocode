// Single source of truth: the CLI command-spec shape lives in octocode-core.
import type { CLICommandSpec, CLIOption } from '@octocodeai/octocode-core/cli';
export type { CLICommandSpec, CLIOption };

export interface ParsedArgs {
  command: string | null;
  args: string[];
  options: Record<string, string | boolean>;
}

// A runnable command is behavior, not documentation: it carries only its name,
// the option list used for flag validation, and a handler. ALL human-facing
// spec content (description/usage/scheme/whenToUse/examples) is sourced from
// octocode-core via findStaticCommandHelp — the single source of truth — so it
// is intentionally NOT duplicated here.
export interface CLICommand {
  name: string;
  options?: CLIOption[];
  handler: (args: ParsedArgs) => Promise<void> | void;
}
