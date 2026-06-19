import type { LocalSearchCodeFile } from '@octocodeai/octocode-core/types';
import type { LocalSearchCodeToolResult } from '@octocodeai/octocode-core/extra-types';
import type { StructuralSearchFileResult } from '@octocodeai/octocode-context-utils';

import { contextUtils } from '../../utils/contextUtils.js';
import {
  validateToolPath,
  createErrorResult,
} from '../../utils/file/toolHelpers.js';
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import type { SearchStats } from '../../utils/core/types.js';
import { buildSearchResult } from './ripgrepResultBuilder.js';
import type { RipgrepQuery } from './scheme.js';

const DEFAULT_STRUCTURAL_EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'build',
  'coverage',
  '.next',
  'out',
  'target',
];

const DEFAULT_MAX_STRUCTURAL_FILES = 2000;
const MAX_STRUCTURAL_FILE_BYTES = 1_000_000;

/**
 * mode:"structural" execution path. Path validation and result shaping stay in
 * TypeScript with the rest of localSearchCode; filesystem traversal, file reads,
 * pre-filtering, parsing, and ast-grep matching run in native Rust.
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
      include: query.include,
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
        value: match.text.split('\n', 1)[0],
        column: match.startCol,
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
      'Structural matches return node ranges — pass matches[].line as the lspGetSemantics lineHint to navigate semantically.'
    );
    return { ...result, hints } as LocalSearchCodeToolResult;
  }

  return result;
}
