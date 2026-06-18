#!/usr/bin/env node
/**
 * Publish guard: fails if any dependency that ships in the published package
 * still uses the `workspace:` protocol.
 *
 * npm does not understand `workspace:` (yarn/pnpm-only) and aborts install with
 * `EUNSUPPORTEDPROTOCOL`. Yarn berry rewrites the protocol to a real version
 * during `yarn npm publish`, but a plain `npm publish` (or a missed pin step)
 * leaks it into the tarball and breaks every npm consumer. This guard runs on
 * prepack/prepublish so the leak is caught before the artifact is built.
 *
 * Only checks dependency sections that are actually published. devDependencies
 * are stripped from the tarball, so a `workspace:` there is harmless.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

const PUBLISHED_DEP_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
];

const offenders = [];
for (const field of PUBLISHED_DEP_FIELDS) {
  const deps = pkg[field];
  if (!deps || typeof deps !== 'object') continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('workspace:')) {
      offenders.push(`  ${field}.${name}: "${spec}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `\n✗ ${pkg.name}@${pkg.version}: workspace: protocol must not ship to the registry.\n` +
      `  npm cannot install it (EUNSUPPORTEDPROTOCOL). Pin to a real version before publishing.\n\n` +
      offenders.join('\n') +
      `\n\n  Run \`yarn sync:version:publish\` (or set an explicit semver) and retry.\n`
  );
  process.exit(1);
}

console.log(`✓ ${pkg.name}@${pkg.version}: no workspace: protocol in published deps.`);
