import type { LocalSearchCodeFile } from '@octocodeai/octocode-core/types';
import type { LocalSearchCodeToolResult } from '@octocodeai/octocode-core/extra-types';
import type { StructuralSearchFileResult } from '@octocodeai/octocode-engine';

import { contextUtils } from '../../utils/contextUtils.js';
import {
  validateToolPath,
  createErrorResult,
} from '../../utils/file/toolHelpers.js';
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import type { SearchStats } from '../../utils/core/types.js';
import { buildSearchResult } from './ripgrepResultBuilder.js';
import type { RipgrepQuery } from './scheme.js';

// No directories excluded by default — structural search must not silently
// skip node_modules/build/dist either. Pass `excludeDir` to trim a search.
const DEFAULT_STRUCTURAL_EXCLUDE_DIRS: string[] = [];

const DEFAULT_MAX_STRUCTURAL_FILES = 2000;
const MAX_STRUCTURAL_FILE_BYTES = 1_000_000;

/**
 * Native structural search filters candidate files by `include` globs (or scans
 * every supported extension when none are given). `langType` is the ergonomic
 * the regex path uses, so map it to `*.ext` include globs here — otherwise
 * `mode:"structural", langType:"ts"` would also parse HTML/CSS/Scala/etc.
 */
const LANG_TYPE_EXTENSIONS: Record<string, string[]> = {
  ts: ['ts', 'tsx', 'mts', 'cts'],
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  tsx: ['tsx'],
  js: ['js', 'jsx', 'mjs', 'cjs'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  jsx: ['jsx'],
  py: ['py', 'pyi'],
  python: ['py', 'pyi'],
  go: ['go'],
  rs: ['rs'],
  rust: ['rs'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cpp', 'hpp', 'cc', 'cxx', 'hh', 'hxx'],
  'c++': ['cpp', 'hpp', 'cc', 'cxx', 'hh', 'hxx'],
  cs: ['cs'],
  csharp: ['cs'],
  sh: ['sh', 'bash', 'zsh'],
  bash: ['sh', 'bash', 'zsh'],
  shell: ['sh', 'bash', 'zsh'],
  html: ['html', 'htm'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  scala: ['scala', 'sc', 'sbt'],
  json: ['json', 'jsonc'],
  yaml: ['yaml', 'yml'],
  yml: ['yaml', 'yml'],
  toml: ['toml'],
};

function includeGlobsForLangType(langType?: string): string[] | undefined {
  if (!langType) return undefined;
  const key = langType.trim().toLowerCase();
  const exts = LANG_TYPE_EXTENSIONS[key] ?? [key.replace(/^[.*]+/, '')];
  return exts.filter(Boolean).map(ext => `*.${ext}`);
}

/**
 * mode:"structural" execution path. Path validation and result shaping stay in
 * TypeScript with the rest of localSearchCode; filesystem traversal, file reads,
 * pre-filtering, parsing, and Octocode AST matching run in native Rust.
 */
export async function searchContentStructural(
  query: RipgrepQuery
): Promise<LocalSearchCodeToolResult> {
  const pathValidation = validateToolPath(query, TOOL_NAMES.LOCAL_RIPGREP);
  if (!pathValidation.isValid) {
    return pathValidation.errorResult as LocalSearchCodeToolResult;
  }

  let nativeResult: ReturnType<typeof contextUtils.structuralSearchFiles>;
  try {
    nativeResult = contextUtils.structuralSearchFiles({
      path: pathValidation.sanitizedPath,
      pattern: query.pattern,
      rule: query.rule,
      // Honor langType by scoping to its extensions when no explicit include was
      // given; explicit include globs always win.
      include: query.include?.length
        ? query.include
        : includeGlobsForLangType(query.langType),
      excludeDir: query.excludeDir?.length
        ? query.excludeDir
        : DEFAULT_STRUCTURAL_EXCLUDE_DIRS,
      maxFiles: query.maxFiles ?? DEFAULT_MAX_STRUCTURAL_FILES,
      maxFileBytes: MAX_STRUCTURAL_FILE_BYTES,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResult(
      new Error(
        `Invalid structural ${query.rule ? 'rule' : 'pattern'}: ${message}`
      ),
      query,
      {
        toolName: TOOL_NAMES.LOCAL_RIPGREP,
        customHints: [
          query.rule
            ? 'Check the YAML rule shape. Relational sub-rules (inside/has) need `stopBy: end` to walk all ancestors/descendants, else they silently match nothing.'
            : 'Check the pattern syntax. Use $X for a single node, $$$ARGS for a list. The pattern must be a complete code fragment for the target language.',
        ],
      }
    ) as LocalSearchCodeToolResult;
  }

  const files: LocalSearchCodeFile[] = nativeResult.files.map(
    (file: StructuralSearchFileResult) => ({
      path: file.path,
      matchCount: file.matches.length,
      matches: file.matches.map(match => ({
        line: match.startLine,
        endLine: match.endLine,
        value: match.text.split('\n', 1)[0],
        column: match.startCol,
        endColumn: match.endCol,
        metavars: match.metavars,
      })),
    })
  );

  const stats: SearchStats = { matchCount: nativeResult.totalMatches };
  const result = await buildSearchResult(
    files,
    query,
    'structural',
    nativeResult.warnings,
    stats
  );

  if (nativeResult.totalMatches > 0) {
    const hints = Array.isArray(result.hints) ? [...result.hints] : [];
    hints.push(
      'Structural matches include captured metavars when the pattern uses $X or $$$ARGS, and matches[].line can be passed as the lspGetSemantics lineHint.'
    );
    return { ...result, hints } as LocalSearchCodeToolResult;
  }

  return result;
}
