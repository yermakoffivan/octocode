import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, getAppDataPath, isMac, isWindows } from './platform/index.js';

const DIR_NAME = '.octocode';
const DIR_MODE = 0o700;

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Octocode's home directory. Fixed per platform — there is no override env var:
 *   - macOS:   `~/.octocode`
 *   - Linux:   `${XDG_CONFIG_HOME:-~/.config}/.octocode`
 *   - Windows: `%APPDATA%\.octocode`
 */
export function getDefaultOctocodeHome(): string {
  if (isWindows) {
    return join(getAppDataPath(), DIR_NAME);
  }

  if (isMac) {
    return join(HOME, DIR_NAME);
  }

  return join(
    readNonEmptyEnv('XDG_CONFIG_HOME') ?? join(HOME, '.config'),
    DIR_NAME
  );
}

export const OCTOCODE_HOME = getDefaultOctocodeHome();

export const paths = {
  home: OCTOCODE_HOME,
  config: join(OCTOCODE_HOME, '.octocoderc'),
  credentials: join(OCTOCODE_HOME, 'credentials.json'),
  key: join(OCTOCODE_HOME, '.key'),
  session: join(OCTOCODE_HOME, 'session.json'),
  stats: join(OCTOCODE_HOME, 'stats.json'),
  repos: join(OCTOCODE_HOME, 'repos'),
  logs: join(OCTOCODE_HOME, 'logs'),
  unzip: join(OCTOCODE_HOME, 'unzip'),
  cliConfig: join(OCTOCODE_HOME, 'config.json'),
  lspConfig: join(OCTOCODE_HOME, 'lsp-servers.json'),
} as const;

export function ensureHome(): void {
  if (!existsSync(paths.home)) {
    mkdirSync(paths.home, { recursive: true, mode: DIR_MODE });
  }
}

export function ensureRepos(): void {
  ensureHome();
  if (!existsSync(paths.repos)) {
    mkdirSync(paths.repos, { recursive: true, mode: DIR_MODE });
  }
}

export function ensureLogs(): void {
  ensureHome();
  if (!existsSync(paths.logs)) {
    mkdirSync(paths.logs, { recursive: true, mode: DIR_MODE });
  }
}

export function ensureUnzip(): void {
  ensureHome();
  if (!existsSync(paths.unzip)) {
    mkdirSync(paths.unzip, { recursive: true, mode: DIR_MODE });
  }
}
