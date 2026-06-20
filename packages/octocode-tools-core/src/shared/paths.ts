import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, getAppDataPath, isMac, isWindows } from './platform/index.js';

const APP_DIR_NAME = 'octocode';
const LEGACY_DOT_DIR_NAME = '.octocode';
const DIR_MODE = 0o700;

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function getDefaultOctocodeHome(): string {
  if (isWindows) {
    return join(getAppDataPath(), APP_DIR_NAME);
  }

  if (isMac) {
    return join(HOME, LEGACY_DOT_DIR_NAME);
  }

  return join(
    readNonEmptyEnv('XDG_CONFIG_HOME') ?? join(HOME, '.config'),
    APP_DIR_NAME
  );
}

export function getOctocodeHome(): string {
  return readNonEmptyEnv('OCTOCODE_HOME') ?? getDefaultOctocodeHome();
}

export const OCTOCODE_HOME = getOctocodeHome();

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
