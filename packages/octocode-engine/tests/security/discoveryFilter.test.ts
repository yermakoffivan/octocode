import { describe, expect, it } from 'vitest';

import {
  getDiscoveryExtension,
  shouldIgnoreDiscoveryDir,
  shouldIgnoreDiscoveryFile,
} from '../../src/security/discoveryFilter.js';

describe('discoveryFilter', () => {
  it('filters discovery-noise directories without using security path blocking', () => {
    expect(shouldIgnoreDiscoveryDir('node_modules')).toBe(true);
    expect(shouldIgnoreDiscoveryDir('packages/node_modules')).toBe(true);
    expect(shouldIgnoreDiscoveryDir('src')).toBe(false);
  });

  it('filters discovery-noise file names, extensions, and path segments', () => {
    expect(shouldIgnoreDiscoveryFile('src/app.ts')).toBe(false);
    expect(shouldIgnoreDiscoveryFile('package-lock.json')).toBe(true);
    expect(shouldIgnoreDiscoveryFile('dist/app.js')).toBe(true);
    expect(shouldIgnoreDiscoveryFile('bundle.min.js')).toBe(true);
    expect(shouldIgnoreDiscoveryFile('secrets.json')).toBe(true);
  });

  it('extracts extensions with dotfile and leading-dot options', () => {
    expect(getDiscoveryExtension('Foo.TS', { lowercase: true })).toBe('ts');
    expect(getDiscoveryExtension('.gitignore', { lowercase: true })).toBe(
      'gitignore'
    );
    expect(
      getDiscoveryExtension('assets/archive.tar.gz', {
        lowercase: true,
        leadingDot: true,
      })
    ).toBe('.gz');
    expect(getDiscoveryExtension('Makefile', { fallback: 'txt' })).toBe('txt');
  });
});
