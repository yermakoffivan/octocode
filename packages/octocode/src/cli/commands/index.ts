import type { CLICommand } from '../types.js';
import { installCommand } from './install.js';
import { authCommand, loginCommand, logoutCommand } from './auth.js';
import { statusCommand } from './status.js';

type CommandLoader = () => Promise<CLICommand>;

const lightweightCommands: readonly CLICommand[] = [
  installCommand,
  authCommand,
  loginCommand,
  logoutCommand,
  statusCommand,
];

const commandLoaders: Record<string, CommandLoader> = {
  // Smart "quick" commands — Unix-style shortcuts that route local-or-GitHub.
  cat: async () => (await import('./cat.js')).catCommand,
  ls: async () => (await import('./ls.js')).lsCommand,
  find: async () => (await import('./find.js')).findFilesCommand,
  grep: async () => (await import('./grep.js')).grepCommand,
  pr: async () => (await import('./pr.js')).prCommand,
  history: async () => (await import('./history.js')).historyCommand,
  repo: async () => (await import('./repo.js')).repoCommand,
  pkg: async () => (await import('./pkg.js')).pkgCommand,
  lsp: async () => (await import('./lsp.js')).lspCommand,
  binary: async () => (await import('./binary.js')).binaryCommand,
  unzip: async () => (await import('./unzip.js')).unzipCommand,
  clone: async () => (await import('./clone.js')).cloneCommand,
  install: async () => (await import('./install.js')).installCommand,
  auth: async () => (await import('./auth.js')).authCommand,
  login: async () => (await import('./auth.js')).loginCommand,
  logout: async () => (await import('./auth.js')).logoutCommand,
  status: async () => (await import('./status.js')).statusCommand,
};

export function findCommand(name: string): CLICommand | undefined {
  return lightweightCommands.find(command => command.name === name);
}

export async function loadCommand(
  name: string
): Promise<CLICommand | undefined> {
  const lightweightCommand = findCommand(name);
  if (lightweightCommand) {
    return lightweightCommand;
  }

  const loader = commandLoaders[name];
  return loader ? loader() : undefined;
}

export {
  installCommand,
  authCommand,
  loginCommand,
  logoutCommand,
  statusCommand,
};
