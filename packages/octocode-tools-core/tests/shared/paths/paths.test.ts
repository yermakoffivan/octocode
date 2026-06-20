import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

function mockPlatform(platform: string, home: string): void {
  vi.doMock('node:os', () => ({
    default: {
      platform: () => platform,
      homedir: () => home,
      arch: () => 'x64',
    },
    platform: () => platform,
    homedir: () => home,
    arch: () => 'x64',
  }));
}

describe('paths', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock('node:os');
  });

  it('uses ~/.octocode on macOS when OCTOCODE_HOME is not set', async () => {
    mockPlatform('darwin', '/Users/tester');
    delete process.env.OCTOCODE_HOME;
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.getDefaultOctocodeHome()).toBe('/Users/tester/.octocode');
    expect(mod.paths.home).toBe('/Users/tester/.octocode');
    expect(mod.paths.config).toBe('/Users/tester/.octocode/.octocoderc');
    expect(mod.paths.credentials).toBe(
      '/Users/tester/.octocode/credentials.json'
    );
    expect(mod.paths.repos).toBe('/Users/tester/.octocode/repos');
    expect(mod.paths.logs).toBe('/Users/tester/.octocode/logs');
    expect(mod.paths.unzip).toBe('/Users/tester/.octocode/unzip');
    expect(mod.paths.lspConfig).toBe(
      '/Users/tester/.octocode/lsp-servers.json'
    );
  });

  it('uses AppData on Windows when OCTOCODE_HOME is not set', async () => {
    mockPlatform('win32', 'C:\\Users\\TestUser');
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
    delete process.env.OCTOCODE_HOME;
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.paths.home.replaceAll('\\', '/')).toBe(
      'C:/Users/TestUser/AppData/Roaming/octocode'
    );
  });

  it('uses XDG_CONFIG_HOME on Linux when available', async () => {
    mockPlatform('linux', '/home/tester');
    process.env.XDG_CONFIG_HOME = '/xdg/config';
    delete process.env.OCTOCODE_HOME;
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.paths.home).toBe('/xdg/config/octocode');
  });

  it('uses ~/.config/octocode on Linux when XDG_CONFIG_HOME is unset', async () => {
    mockPlatform('linux', '/home/tester');
    delete process.env.OCTOCODE_HOME;
    delete process.env.XDG_CONFIG_HOME;
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.paths.home).toBe('/home/tester/.config/octocode');
  });

  it('respects OCTOCODE_HOME override', async () => {
    mockPlatform('linux', '/home/tester');
    process.env.OCTOCODE_HOME = '/tmp/custom-octocode-home';
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.paths.home).toBe('/tmp/custom-octocode-home');
    expect(mod.getOctocodeHome()).toBe('/tmp/custom-octocode-home');
    expect(mod.paths.config).toBe('/tmp/custom-octocode-home/.octocoderc');
    expect(mod.paths.cliConfig).toBe('/tmp/custom-octocode-home/config.json');
  });

  it('ignores blank OCTOCODE_HOME override', async () => {
    mockPlatform('darwin', '/Users/tester');
    process.env.OCTOCODE_HOME = ' ';
    const mod = await import('../../../src/shared/paths.js');

    expect(mod.paths.home).toBe('/Users/tester/.octocode');
  });

  it('ensureHome creates home with 0o700', async () => {
    const mod = await import('../../../src/shared/paths.js');
    mod.ensureHome();

    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.home, {
      recursive: true,
      mode: 0o700,
    });
  });

  it('ensureRepos creates repos with 0o700', async () => {
    const mod = await import('../../../src/shared/paths.js');
    mod.ensureRepos();

    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.home, {
      recursive: true,
      mode: 0o700,
    });
    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.repos, {
      recursive: true,
      mode: 0o700,
    });
  });

  it('ensureLogs creates logs with 0o700', async () => {
    const mod = await import('../../../src/shared/paths.js');
    mod.ensureLogs();

    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.home, {
      recursive: true,
      mode: 0o700,
    });
    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.logs, {
      recursive: true,
      mode: 0o700,
    });
  });

  it('ensureHome does NOT call mkdirSync when directory already exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const mod = await import('../../../src/shared/paths.js');
    mod.ensureHome();

    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('ensureHome DOES call mkdirSync when directory does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mod = await import('../../../src/shared/paths.js');
    mod.ensureHome();

    expect(mkdirSync).toHaveBeenCalledWith(mod.paths.home, {
      recursive: true,
      mode: 0o700,
    });
  });
});
