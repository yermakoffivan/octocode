#!/usr/bin/env node
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const rootReadme = join(rootDir, 'README.md');
const packagesDir = join(rootDir, 'packages');
const requestedTargets = process.argv.slice(2);

function packageDirsFromArgs(args) {
  if (args.length > 0) {
    return args.map((arg) => resolve(process.cwd(), arg));
  }

  return readdirSync(packagesDir)
    .map((packageDirName) => join(packagesDir, packageDirName))
    .filter((packageDir) => existsSync(join(packageDir, 'package.json')));
}

for (const packageDir of packageDirsFromArgs(requestedTargets).sort()) {
  const packageJsonPath = join(packageDir, 'package.json');

  if (!existsSync(packageJsonPath) || !statSync(packageDir).isDirectory()) {
    throw new Error(`Expected a package directory with package.json: ${packageDir}`);
  }

  copyFileSync(rootReadme, join(packageDir, 'README.md'));
  console.log(`✓ README.md synced to ${relative(rootDir, packageDir)}`);
}
