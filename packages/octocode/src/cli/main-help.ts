import { c, bold, dim, underline } from '../utils/colors.js';
import { getAuthStatus } from '../features/github-oauth.js';
import {
  DIRECT_TOOL_CATEGORIES,
  DIRECT_TOOL_DEFINITIONS,
  getDirectToolCategory,
  getDirectToolDisplayFields,
  sortDirectToolNames,
} from '@octocodeai/octocode-tools-core/direct';

const LSP_TOOL = 'lspGetSemantics';

/** Brief [required*, optional?] summary for the --help tool list (top-level fields only). */
function formatBriefFields(toolName: string): string {
  if (toolName === LSP_TOOL) return '[uri*, type, symbolName?, lineHint?]';
  const fields = getDirectToolDisplayFields(toolName).filter(
    f => !f.name.includes('.')
  );
  const required = fields.filter(f => f.required).map(f => `${f.name}*`);
  const optional = fields.filter(f => !f.required);
  if (required.length > 0) {
    const optHint = optional.slice(0, 2).map(f => `${f.name}?`);
    return `[${[...required, ...optHint].join(', ')}]`;
  }
  return `[${optional
    .slice(0, 3)
    .map(f => `${f.name}?`)
    .join(', ')}]`;
}

function buildToolBlock(): string[] {
  const lines: string[] = [];
  const allNames = sortDirectToolNames(
    DIRECT_TOOL_DEFINITIONS.map(t => t.name)
  );

  for (const category of DIRECT_TOOL_CATEGORIES) {
    const names = allNames.filter(n => getDirectToolCategory(n) === category);
    if (names.length === 0) continue;

    lines.push(`    ${dim(category)}`);
    for (const name of names) {
      const namePad = name.padEnd(28);
      lines.push(`      ${c('cyan', namePad)} ${dim(formatBriefFields(name))}`);
      if (name === LSP_TOOL) {
        const indent = ''.padEnd(34);
        lines.push(
          `      ${dim(indent)} ${dim('type: definition | references | callers | callees | callHierarchy | hover | documentSymbols | typeDefinition | implementation')}`
        );
        lines.push(
          `      ${dim(indent)} ${dim('! run localSearchCode first → get uri + lineHint')}`
        );
      }
    }
  }

  return lines;
}

/** One aligned `name <args>  description` line for the QUICK COMMANDS block. */
function quick(name: string, argHint: string, description: string): string {
  return `    ${c('cyan', name.padEnd(8))} ${dim(argHint.padEnd(28))}  ${dim(description)}`;
}

export function showHelp(): void {
  const toolCount = DIRECT_TOOL_DEFINITIONS.length;
  const toolLines = buildToolBlock();

  let isAuthenticated = false;
  try {
    isAuthenticated = getAuthStatus().authenticated;
  } catch {
    // ignore — treat as unauthenticated
  }

  const authBanner: string[] = isAuthenticated
    ? []
    : [
        `  ${c('red', '─'.repeat(62))}`,
        `  ${c('red', bold('  ⚠  NOT AUTHENTICATED'))}  ${c('red', 'GitHub token required for tool calls.')}`,
        `  ${c('red', '     Run: ')}${c('yellow', bold('login'))}`,
        `  ${c('red', '─'.repeat(62))}`,
        '',
      ];

  const lines = [
    '',
    ...authBanner,
    `  ${c('magenta', bold('🔍🐙 Octocode'))}  ${dim('Code research CLI — for humans and agents')}`,
    '',

    // ── Agent instructions — concise, tag-delimited so agents can parse it ──
    `  ${dim('<AGENT_INSTRUCTIONS>')}`,
    `  ${dim('One toolset for LOCAL files and EXTERNAL GitHub/npm research.')}`,
    `  ${dim('1. QUICK COMMANDS for simple work; raw')} ${c('yellow', 'tools <name> --scheme')} ${dim('then')} ${c('yellow', "tools <name> --queries '<json>'")} ${dim('for full control — never guess fields.')}`,
    `  ${dim('2. Flow: locate → search → read the smallest slice → prove (see PLAYBOOK).')}`,
    `  ${dim('3.')} ${c('red', bold('Do NOT hallucinate'))} ${dim('paths, lines, or fields — verify with tools.')}`,
    `  ${dim('Auth: humans run')} ${c('yellow', 'login')}${dim('; agents pass GITHUB_TOKEN / OCTOCODE_TOKEN / GH_TOKEN via env. Deeper protocol:')} ${c('cyan', 'context')}${dim('.')}`,
    `  ${dim('Docs:')} ${underline('https://github.com/bgauryy/octocode/tree/main/docs')}  ${dim('· Skill:')} ${c('yellow', 'skills install --skill octocode')}`,
    `  ${dim('</AGENT_INSTRUCTIONS>')}`,
    '',

    // ── Quick commands FIRST — the friendly, human-first surface ────────────
    `  ${c('green', bold('QUICK COMMANDS'))}  ${dim('smart shortcuts — auto-route local path vs owner/repo. Add --json for raw output.')}`,
    quick('ls', '<path|owner/repo>', 'directory structure'),
    quick(
      'cat',
      '<path|owner/repo/path>',
      'read + minify a file (--mode none|standard|symbols)'
    ),
    quick(
      'grep',
      '<keywords> <path|owner/repo>',
      'text/regex search → file + line'
    ),
    quick(
      'find',
      '<query> [path|owner/repo]',
      'find files by name/path/content'
    ),
    quick('ast', '<pattern> [path]', 'code-shape search (ast-grep, local)'),
    quick('symbols', '<file|dir>', 'outline of a file/dir (local)'),
    quick(
      'lsp',
      '<file> --type <type> --symbol <s> --line <n>',
      'identity: defs, refs, callers, hover (local)'
    ),
    quick('repo', '<keywords...>', 'discover GitHub repositories'),
    quick('pr', '<owner/repo[#N]|PR-URL>', 'list PRs or deep-read one PR'),
    quick(
      'history',
      '<owner/repo[/path]>',
      'commit history (who/when) → #PR deep-read'
    ),
    quick('pkg', '<package>', 'npm package + source repo'),
    quick(
      'binary',
      '<file>',
      'list, decompress, or strings (archives & binaries)'
    ),
    quick(
      'unzip',
      '<archive>',
      'unpack archive → ~/.octocode/archives, then grep/ls/cat it'
    ),
    quick(
      'clone',
      '<owner/repo[/path][@branch]>',
      'clone a repo or subtree → ~/.octocode/repos'
    ),
    '',

    // ── Raw execution — every tool, including ones without a quick command ──
    `  ${bold(`TOOLS (${toolCount})`)}  ${dim('raw execution — schema-exact, all tools incl. clone, binary inspect, AST')}`,
    `    ${c('yellow', 'tools'.padEnd(28))} ${dim('list all tools')}`,
    `    ${c('yellow', 'tools <name> --scheme'.padEnd(28))} ${dim('read schema (never guess fields)')}`,
    `    ${c('yellow', "tools <name> --queries '<json>'".padEnd(28))} ${dim('run a tool (1 object or array of ≤5)')}`,
    `    ${c('yellow', 'context [--full]'.padEnd(28))} ${dim('optional — protocol + system prompt + descriptions (deeper research)')}`,
    ...toolLines,
    '',

    // ── Playbook (distilled from the system prompt) ─────────────────────────
    `  ${c('green', bold('PLAYBOOK'))}  ${dim('cheapest tool first · smallest slice · narrow before paging')}`,
    `    ${c('cyan', 'orient cheap')}    ${dim('concise:true (string list) · localSearchCode mode:discovery (paths) · ls then drill')}`,
    `    ${c('cyan', 'minify by goal')}  ${dim('symbols=skeleton (orient unknown) · standard=read (default) · none=exact quote/diff')}`,
    `    ${c('cyan', 'prove')}           ${dim('snippets are discovery, not proof — re-read exact text · search→lineHint→lsp · pkg→owner/repo')}`,
    '',

    // ── Management (users) ─────────────────────────────────────────────────
    `  ${bold('MANAGEMENT')}`,
    `    ${c('cyan', 'install')} ${dim('--ide <cursor|claude-desktop|windsurf|...>')}  ${dim('configure IDE')}`,
    `    ${c('cyan', 'auth')}    ${dim('<login|logout|status|token>')}                 ${dim('GitHub authentication')}`,
    `    ${c('cyan', 'skills')}  ${dim('<install|remove|list|sync>')}                  ${dim('skills marketplace')}`,
    `    ${c('cyan', 'status')}  ${dim('[--sync]')}                                    ${dim('auth + cache status')}`,
    '',

    // ── Flags + exit codes (one line each) ─────────────────────────────────
    `  ${bold('FLAGS')}  ${c('cyan', '--json')} raw envelope  ${c('cyan', '--compact')} leanest  ${c('cyan', '--no-color')} no ANSI`,
    `  ${bold('EXIT')}   0=ok  2=bad-input  3=not-found  4=auth  5=tool-error  7=rate-limited`,
    `  ${bold('DOCS')}   ${underline('https://github.com/bgauryy/octocode/tree/main/docs')}  ${dim('· per-command:')} ${c('cyan', '<command> --help')}`,
    '',

    c('magenta', `  ─── 🔍🐙 ${bold('https://octocode.ai')} ───`),
    '',
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}
