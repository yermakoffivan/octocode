#!/usr/bin/env node
// skill-sync — plan/symlink a local skill folder into vendor skill dirs.
// Default is dry-run. Writes require explicit --approve (human gate).
// Usage:
//   node skill-sync.mjs <skill-dir> [--platforms top|all|claude,cursor,...]
//   node skill-sync.mjs <skill-dir> --platforms top --approve
//   node skill-sync.mjs <skill-dir> --platforms top --approve --force
//   node skill-sync.mjs --list-vendors
// Exit: 0 ok, 1 usage/validation/write failure.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || process.env.USERPROFILE || homedir();
const isWin = process.platform === 'win32';

/** User-scope vendor skill roots (global). Project scope is out of band — pass --project-root. */
const VENDORS = {
  agents: {
    id: 'agents',
    label: 'shared agents / common',
    user: join(HOME, '.agents', 'skills'),
    project: '.agents/skills',
    notes: 'Codex default in Octocode CLI; shared cross-agent dir',
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    user: join(HOME, '.claude', 'skills'),
    project: '.claude/skills',
    notes: 'Claude Code skill frontmatter hooks run here',
  },
  'claude-desktop': {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    user: isWin
      ? join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'Claude Desktop', 'skills')
      : join(HOME, '.claude-desktop', 'skills'),
    project: null,
    notes: 'Desktop app; no project scope',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    user: join(HOME, '.cursor', 'skills'),
    project: '.cursor/skills',
    notes: 'Native Cursor skills; SKILL.md hooks frontmatter not executed',
  },
  codex: {
    id: 'codex',
    label: 'Codex (agents dir)',
    user: join(HOME, '.agents', 'skills'),
    project: '.agents/skills',
    notes: 'Octocode maps codex → ~/.agents/skills',
  },
  'codex-native': {
    id: 'codex-native',
    label: 'Codex native',
    user: join(HOME, '.codex', 'skills'),
    project: null,
    notes: 'Observed ~/.codex/skills on some hosts; include when that dir is used',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    user: isWin
      ? join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'opencode', 'skills')
      : join(HOME, '.config', 'opencode', 'skills'),
    project: '.opencode/skills',
    notes: '',
  },
  pi: {
    id: 'pi',
    label: 'Pi',
    user: join(HOME, '.pi', 'agent', 'skills'),
    project: '.pi/skills',
    notes: 'pi install /local/path may store a path reference instead of copying',
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    user: join(HOME, '.copilot', 'skills'),
    project: '.github/skills',
    notes: '',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    user: join(HOME, '.gemini', 'skills'),
    project: '.gemini/skills',
    notes: 'Also honors ~/.agents/skills on some setups',
  },
};

const TOP = ['claude', 'cursor', 'agents', 'codex-native'];
const ALL = Object.keys(VENDORS);

function usage() {
  return `skill-sync <skill-dir> [options]

Symlink a local skill folder into vendor skill directories.
Default is dry-run (plan only). Writes require --approve after human OK.

Options:
  --platforms <list>   top | all | comma ids (default: top)
                       top = claude,cursor,agents,codex-native
  --project-root <dir> also plan/write project-scope destinations under <dir>
  --name <skill-name>  override destination folder name (default: source folder)
  --approve            human approved — perform symlink writes
  --force              replace existing destination (only with --approve)
  --list-vendors       print vendor map and exit
  --json               machine-readable plan/result
  --help, -h           this help

Examples:
  node scripts/skill-sync.mjs ../octocode-skills
  node scripts/skill-sync.mjs ../octocode-skills --platforms top --approve
  node scripts/skill-sync.mjs . --platforms claude,cursor --approve --force
`;
}

function parseArgs(argv) {
  const out = {
    skillDir: null,
    platforms: 'top',
    projectRoot: null,
    name: null,
    approve: false,
    force: false,
    listVendors: false,
    json: false,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--approve') out.approve = true;
    else if (a === '--force') out.force = true;
    else if (a === '--list-vendors') out.listVendors = true;
    else if (a === '--json') out.json = true;
    else if (a === '--platforms') out.platforms = argv[++i] || '';
    else if (a === '--project-root') out.projectRoot = argv[++i] || '';
    else if (a === '--name') out.name = argv[++i] || '';
    else if (a.startsWith('-')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else rest.push(a);
  }
  out.skillDir = rest[0] || null;
  return out;
}

function resolvePlatformIds(spec) {
  const raw = String(spec || 'top').trim().toLowerCase();
  if (!raw || raw === 'top') return [...TOP];
  if (raw === 'all') return [...ALL];
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !VENDORS[id]);
  if (bad.length) {
    console.error(`Unknown platform(s): ${bad.join(', ')}. Valid: ${ALL.join(', ')}, top, all`);
    process.exit(1);
  }
  // de-dupe while preserving order; codex + agents share path — keep both labels but one write
  return [...new Set(ids)];
}

function readFrontmatterName(skillMdPath) {
  if (!existsSync(skillMdPath)) return null;
  const text = readFileSync(skillMdPath, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const name = m[1].match(/^name:\s*(.+)$/m);
  return name ? name[1].trim().replace(/^["']|["']$/g, '') : null;
}

function inspectDest(destPath) {
  if (!existsSync(destPath)) return { state: 'missing' };
  const st = lstatSync(destPath);
  if (st.isSymbolicLink()) {
    let target = null;
    try {
      target = readlinkSync(destPath);
    } catch {
      target = '(unreadable)';
    }
    let resolved = null;
    try {
      resolved = realpathSync(destPath);
    } catch {
      resolved = null;
    }
    return { state: 'symlink', target, resolved };
  }
  if (st.isDirectory()) return { state: 'directory' };
  return { state: 'other' };
}

function planRows(sourcePath, skillName, platformIds, projectRoot) {
  const rows = [];
  const seenDest = new Map(); // destPath -> first platform

  for (const id of platformIds) {
    const v = VENDORS[id];
    const scopes = [{ scope: 'user', destDir: v.user }];
    if (projectRoot && v.project) {
      scopes.push({ scope: 'project', destDir: join(resolve(projectRoot), v.project) });
    }
    for (const { scope, destDir } of scopes) {
      const destPath = join(destDir, skillName);
      const existing = inspectDest(destPath);
      const dupOf = seenDest.get(destPath);
      seenDest.set(destPath, seenDest.get(destPath) || id);
      let action = 'symlink';
      let reason = 'create symlink';
      if (dupOf && dupOf !== id) {
        action = 'skip-dup-path';
        reason = `same path as ${dupOf}`;
      } else if (existing.state === 'symlink') {
        const same =
          existing.resolved &&
          resolve(existing.resolved) === resolve(sourcePath);
        if (same) {
          action = 'ok';
          reason = 'already linked to source';
        } else {
          action = 'conflict-symlink';
          reason = `exists → ${existing.target}`;
        }
      } else if (existing.state === 'directory') {
        action = 'conflict-dir';
        reason = 'real directory present';
      } else if (existing.state === 'other') {
        action = 'conflict-other';
        reason = 'non-dir entry present';
      }
      rows.push({
        platform: id,
        label: v.label,
        scope,
        destDir,
        destPath,
        action,
        reason,
        existing,
      });
    }
  }
  return rows;
}

function ensureParent(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function atomicSymlink(sourcePath, destPath) {
  ensureParent(dirname(destPath));
  const tmp = `${destPath}.sync-tmp-${process.pid}`;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    // absolute source so the link stays valid regardless of cwd
    symlinkSync(sourcePath, tmp, isWin ? 'junction' : 'dir');
    renameSync(tmp, destPath);
  } catch (err) {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function applyRow(row, sourcePath, { force }) {
  if (row.action === 'ok' || row.action === 'skip-dup-path') {
    return { ...row, result: 'skipped', detail: row.reason };
  }
  if (row.action === 'symlink') {
    atomicSymlink(sourcePath, row.destPath);
    return { ...row, result: 'linked', detail: 'created' };
  }
  if (row.action.startsWith('conflict-')) {
    if (!force) {
      return { ...row, result: 'blocked', detail: `${row.reason} (pass --force with --approve)` };
    }
    rmSync(row.destPath, { recursive: true, force: true });
    atomicSymlink(sourcePath, row.destPath);
    return { ...row, result: 'replaced', detail: 'force replaced with symlink' };
  }
  return { ...row, result: 'skipped', detail: row.reason };
}

function printVendors(asJson) {
  const list = ALL.map((id) => {
    const v = VENDORS[id];
    return {
      id,
      label: v.label,
      user: v.user,
      project: v.project,
      notes: v.notes,
      top: TOP.includes(id),
    };
  });
  if (asJson) {
    console.log(JSON.stringify({ vendors: list, top: TOP }, null, 2));
    return;
  }
  console.log('Vendor skill locations (user scope):\n');
  for (const v of list) {
    const mark = v.top ? ' [top]' : '';
    console.log(`${v.id}${mark}`);
    console.log(`  ${v.label}`);
    console.log(`  user:    ${v.user}`);
    console.log(`  project: ${v.project ? `<repo>/${v.project}` : '(none)'}`);
    if (v.notes) console.log(`  notes:   ${v.notes}`);
    console.log('');
  }
  console.log(`top = ${TOP.join(',')}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.listVendors) {
    printVendors(args.json);
    process.exit(0);
  }
  if (!args.skillDir) {
    console.error('Missing <skill-dir>.\n');
    console.error(usage());
    process.exit(1);
  }
  if (args.force && !args.approve) {
    console.error('--force requires --approve (human gate).');
    process.exit(1);
  }

  const sourcePath = resolve(args.skillDir);
  const skillMd = join(sourcePath, 'SKILL.md');
  if (!existsSync(skillMd)) {
    console.error(`Not a skill folder (missing SKILL.md): ${sourcePath}`);
    process.exit(1);
  }

  const fmName = readFrontmatterName(skillMd);
  const skillName = (args.name || basename(sourcePath)).trim();
  if (!skillName || skillName.includes('/') || skillName.includes('\\') || skillName.includes('\0')) {
    console.error(`Unsafe skill name: ${skillName}`);
    process.exit(1);
  }

  const platformIds = resolvePlatformIds(args.platforms);
  const rows = planRows(sourcePath, skillName, platformIds, args.projectRoot);

  const plan = {
    mode: args.approve ? 'apply' : 'dry-run',
    sourcePath,
    skillName,
    frontmatterName: fmName,
    nameMismatch: fmName && fmName !== skillName ? true : false,
    platforms: platformIds,
    projectRoot: args.projectRoot ? resolve(args.projectRoot) : null,
    humanApprovalRequired: !args.approve,
    rows,
  };

  if (!args.approve) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...plan, hint: 'Re-run with --approve after human OK' }, null, 2));
    } else {
      console.log('DRY-RUN — no writes. Human must approve, then re-run with --approve.\n');
      console.log(`Source:  ${sourcePath}`);
      console.log(`Name:    ${skillName}${fmName && fmName !== skillName ? ` (frontmatter name: ${fmName})` : ''}`);
      console.log(`Targets: ${platformIds.join(', ')}`);
      if (plan.projectRoot) console.log(`Project: ${plan.projectRoot}`);
      console.log('');
      for (const r of rows) {
        console.log(`${r.action.padEnd(18)} ${r.platform}/${r.scope}`);
        console.log(`  → ${r.destPath}`);
        console.log(`  ${r.reason}`);
      }
      console.log('\nAfter human approval:');
      console.log(`  node ${join(HERE, 'skill-sync.mjs')} ${args.skillDir} --platforms ${args.platforms} --approve`);
    }
    process.exit(0);
  }

  // APPLY
  const results = [];
  let failed = 0;
  for (const row of rows) {
    try {
      results.push(applyRow(row, sourcePath, { force: args.force }));
    } catch (err) {
      failed++;
      results.push({ ...row, result: 'error', detail: err.message || String(err) });
    }
  }
  failed += results.filter((r) => r.result === 'error' || r.result === 'blocked').length;

  if (args.json) {
    console.log(JSON.stringify({ ok: failed === 0, mode: 'apply', sourcePath, skillName, results }, null, 2));
  } else {
    console.log(`APPLY — symlink sync for ${skillName}\n`);
    for (const r of results) {
      console.log(`${String(r.result).padEnd(10)} ${r.platform}/${r.scope}`);
      console.log(`  → ${r.destPath}`);
      console.log(`  ${r.detail}`);
    }
    const linked = results.filter((r) => r.result === 'linked' || r.result === 'replaced').length;
    const skipped = results.filter((r) => r.result === 'skipped').length;
    console.log(`\nlinked/replaced=${linked} skipped=${skipped} blocked/error=${failed}`);
  }
  process.exit(failed ? 1 : 0);
}

main();
