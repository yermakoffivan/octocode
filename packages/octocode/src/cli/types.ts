// Single source of truth: the CLI command-spec shape lives in octocode-core.
import type { CLICommandSpec, CLIOption } from '@octocodeai/octocode-core/cli';
export type { CLICommandSpec, CLIOption };

export interface ParsedArgs {
  command: string | null;
  args: string[];
  options: Record<string, string | boolean>;
}

export interface CLICommand extends CLICommandSpec {
  handler: (args: ParsedArgs) => Promise<void> | void;
}
