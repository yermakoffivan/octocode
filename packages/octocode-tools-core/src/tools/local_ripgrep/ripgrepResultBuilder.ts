import type { LocalSearchCodeFile } from '@octocodeai/octocode-core/types';
import type { LocalSearchCodeToolResult } from '@octocodeai/octocode-core/extra-types';

import type { SearchStats } from '../../utils/core/types.js';
import { RESOURCE_LIMITS } from '../../utils/core/constants.js';
import type { RipgrepQuery } from './scheme.js';

export type LocalSearchEngine = 'rg' | 'grep' | 'structural';

type NextToolName =
  | 'localGetFileContent'
  | 'lspGetSemantics'
  | 'localSearchCode';

type NextConfidence = 'exact' | 'heuristic';

type SearchNextCall = {
  tool: NextToolName;
  query: Record<string, unknown>;
  why: string;
  confidence?: NextConfidence;
};

type SearchNextMap = {
  fetchExact?: SearchNextCall;
  fetchStandard?: SearchNextCall;
  fetchSymbols?: SearchNextCall;
  lspDefinition?: SearchNextCall;
  lspReferences?: SearchNextCall;
  nextPage?: SearchNextCall;
  nextMatchPage?: SearchNextCall;
};

type LocalSearchResultWithNext = LocalSearchCodeToolResult & {
  next?: SearchNextMap;
};

type FlowMatch = {
  line?: number;
  endLine?: number;
  value?: string;
  metavars?: Record<string, string[]>;
};

type FlowFile = {
  path?: string;
  matches?: FlowMatch[];
  pagination?: { hasMore?: boolean };
};

const FETCH_CONTEXT_LINES = 8;
const RESERVED_SYMBOL_WORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'def',
  'do',
  'else',
  'enum',
  'export',
  'for',
  'function',
  'if',
  'import',
  'interface',
  'let',
  'match',
  'return',
  'struct',
  'switch',
  'type',
  'var',
  'while',
]);

export async function buildSearchResult(
  parsedFiles: LocalSearchCodeFile[],
  configuredQuery: RipgrepQuery,
  searchEngine: LocalSearchEngine,
  warnings: string[],
  stats?: SearchStats
): Promise<LocalSearchCodeToolResult> {
  const filesWithMetadata = parsedFiles;

  filesWithMetadata.sort((a, b) =>
    compareRipgrepFilesByRelevance(a, b, configuredQuery)
  );

  let limitedFiles = filesWithMetadata;
  let wasLimited = false;
  if (
    configuredQuery.maxFiles &&
    filesWithMetadata.length > configuredQuery.maxFiles
  ) {
    limitedFiles = filesWithMetadata.slice(0, configuredQuery.maxFiles);
    wasLimited = true;
  }

  const totalFiles = limitedFiles.length;
  const isPathListMode = Boolean(
    configuredQuery.filesOnly || configuredQuery.filesWithoutMatch
  );
  const isCountMode = Boolean(
    configuredQuery.countLinesPerFile || configuredQuery.countMatchesPerFile
  );
  const isFileListMode = isPathListMode || isCountMode;
  const summedMatches = limitedFiles.reduce(
    (sum: number, f: LocalSearchCodeFile & { modified?: string }) =>
      sum + (f.matchCount ?? 0),
    0
  );
  const totalMatches = isFileListMode
    ? (stats?.matchCount ?? summedMatches)
    : summedMatches;

  const aligned = configuredQuery as {
    itemsPerPage?: number;
    maxMatchesPerFile?: number;
    matchPage?: number;
    page?: number;
  };
  const filesPerPage =
    aligned.itemsPerPage || RESOURCE_LIMITS.DEFAULT_FILES_PER_PAGE;
  const currentPage = aligned.page || 1;
  const totalFilePages = Math.ceil(totalFiles / filesPerPage);
  const startIdx = (currentPage - 1) * filesPerPage;
  const endIdx = Math.min(startIdx + filesPerPage, totalFiles);
  const paginatedFiles = limitedFiles.slice(startIdx, endIdx);

  const matchesPerPage =
    aligned.maxMatchesPerFile || RESOURCE_LIMITS.DEFAULT_MATCHES_PER_PAGE;

  const finalFiles: LocalSearchCodeFile[] = paginatedFiles.map(
    (file: LocalSearchCodeFile) => {
      const totalFileMatches = file.matches?.length ?? 0;
      const totalMatchPages = Math.ceil(totalFileMatches / matchesPerPage);
      const matchPage = Math.max(1, aligned.matchPage || 1);
      const matchStartIdx = (matchPage - 1) * matchesPerPage;
      const matchEndIdx = Math.min(
        matchStartIdx + matchesPerPage,
        totalFileMatches
      );
      const paginatedMatches = isFileListMode
        ? undefined
        : file.matches?.slice(matchStartIdx, matchEndIdx);

      const result = {
        path: file.path,
        ...(isPathListMode
          ? {}
          : {
              matchCount: isCountMode ? file.matchCount || 1 : totalFileMatches,
            }),
        ...(paginatedMatches !== undefined && { matches: paginatedMatches }),
        pagination:
          !isFileListMode && totalFileMatches > matchesPerPage
            ? {
                currentPage: matchPage,
                totalPages: totalMatchPages,
                matchesPerPage,
                totalMatches: totalFileMatches,
                hasMore: matchPage < totalMatchPages,
              }
            : undefined,
      } as LocalSearchCodeFile;
      return result;
    }
  );

  const paginationHints: string[] =
    currentPage < totalFilePages
      ? [
          `Page ${currentPage}/${totalFilePages} (${finalFiles.length} of ${totalFiles} files${isPathListMode ? '' : `, ${totalMatches} matches`}). Next: page=${currentPage + 1}`,
        ]
      : totalFilePages > 0 && currentPage > totalFilePages
        ? [
            `Page ${currentPage} is outside range (1–${totalFilePages}). Use page=${totalFilePages}.`,
          ]
        : [];

  if (wasLimited) {
    paginationHints.push(
      `Results limited to ${configuredQuery.maxFiles} files (found ${filesWithMetadata.length} matching)`
    );
  }

  const filesWithMoreMatches = finalFiles.filter(f => f.pagination?.hasMore);
  if (filesWithMoreMatches.length > 0) {
    paginationHints.push(
      `Note: ${filesWithMoreMatches.length} file(s) have more matches — use matchPage=${(aligned.matchPage || 1) + 1} with maxMatchesPerFile to continue matches inside those files`
    );
  }

  const refinementHints = _getStructuredResultSizeHints(
    finalFiles,
    configuredQuery,
    totalMatches
  );

  const q = configuredQuery as Record<string, unknown>;
  const activeFilters: string[] = [];
  const includeGlobs = q.include as string[] | undefined;
  if (Array.isArray(includeGlobs) && includeGlobs.length > 0) {
    activeFilters.push(`include: ${includeGlobs.join(', ')}`);
  }
  const excludeGlobs = q.exclude as string[] | undefined;
  if (Array.isArray(excludeGlobs) && excludeGlobs.length > 0) {
    activeFilters.push(`exclude: ${excludeGlobs.join(', ')}`);
  }
  const excludeDir = q.excludeDir as string[] | undefined;
  if (Array.isArray(excludeDir) && excludeDir.length > 0) {
    activeFilters.push(`excludeDir: ${excludeDir.join(', ')}`);
  }
  const fileType = q.langType as string | undefined;
  if (fileType) activeFilters.push(`langType: ${fileType}`);
  if (q.caseSensitive) activeFilters.push('case-sensitive');
  if (q.wholeWord) activeFilters.push('whole-word');
  if (activeFilters.length > 0) {
    refinementHints.unshift(`Active filters — ${activeFilters.join(' | ')}`);
  }

  const next = buildSearchNextMap(finalFiles, configuredQuery, searchEngine, {
    isFileListMode,
    currentPage,
    totalFilePages,
    matchPage: aligned.matchPage || 1,
    matchesPerPage,
    hasFileWithMoreMatches: filesWithMoreMatches.length > 0,
  });

  const fullResult: LocalSearchResultWithNext = {
    searchEngine,
    files: finalFiles,
    pagination: {
      currentPage,
      totalPages: totalFilePages,
      filesPerPage,
      totalFiles,
      ...(isPathListMode ? {} : { totalMatches }),
      hasMore: currentPage < totalFilePages,
      ...(wasLimited ? { totalFilesFound: filesWithMetadata.length } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    hints: [
      ...(totalFiles > 0 && !isFileListMode
        ? [
            'Use localGetFileContent with the full path (prepend base to each returned path) and line numbers to read surrounding code.',
            'Pass line numbers as lineHint to lspGetSemantics for definitions, references, or call flow.',
          ]
        : []),
      ...(totalFiles > 0 && isFileListMode
        ? [
            'Use localGetFileContent to read listed files, or rerun localSearchCode without filesOnly/count mode for matched snippets.',
          ]
        : []),
      ...(Object.keys(next).length > 0
        ? [
            'Response includes next.* query objects for localGetFileContent, lspGetSemantics, or localSearchCode follow-ups.',
          ]
        : []),
      ...paginationHints,
      ...refinementHints,
    ],
    ...(Object.keys(next).length > 0 ? { next } : {}),
  };

  return finalizeRipgrepResult(fullResult, configuredQuery, {
    totalMatches,
    totalFiles,
  });
}

export function finalizeRipgrepResult(
  result: LocalSearchCodeToolResult,
  _query: RipgrepQuery,
  _totals: { totalMatches: number; totalFiles: number }
): LocalSearchCodeToolResult {
  return result;
}

function buildSearchNextMap(
  files: LocalSearchCodeFile[],
  query: RipgrepQuery,
  searchEngine: LocalSearchEngine,
  options: {
    isFileListMode: boolean;
    currentPage: number;
    totalFilePages: number;
    matchPage: number;
    matchesPerPage: number;
    hasFileWithMoreMatches: boolean;
  }
): SearchNextMap {
  const firstFile = (files as FlowFile[]).find(file => file.path);
  const firstMatch = firstFile?.matches?.find(match => match.line);
  const next: SearchNextMap = {};

  if (firstFile?.path) {
    if (firstMatch?.line) {
      const range = lineRangeAroundMatch(firstMatch);
      next.fetchExact = {
        tool: 'localGetFileContent',
        query: withoutUndefined({
          path: firstFile.path,
          startLine: range.startLine,
          endLine: range.endLine,
          minify: 'none',
        }),
        why: 'Read exact source around the first grep match before editing, quoting, or validating comments/tests.',
        confidence: 'exact',
      };
      next.fetchStandard = {
        tool: 'localGetFileContent',
        query: withoutUndefined({
          path: firstFile.path,
          startLine: range.startLine,
          endLine: range.endLine,
          minify: 'standard',
        }),
        why: 'Read a token-efficient source slice around the first grep match.',
        confidence: 'exact',
      };
    } else if (options.isFileListMode) {
      next.fetchStandard = {
        tool: 'localGetFileContent',
        query: { path: firstFile.path, minify: 'standard' },
        why: 'Read the first matched file from file-list/count mode.',
        confidence: 'heuristic',
      };
    }

    next.fetchSymbols = {
      tool: 'localGetFileContent',
      query: { path: firstFile.path, minify: 'symbols' },
      why: 'Get a symbol skeleton for fast orientation before opening large bodies.',
      confidence: 'exact',
    };

    const symbolName = inferLspSymbolName(firstMatch, query, searchEngine);
    if (symbolName && firstMatch?.line) {
      const lspBase = {
        uri: firstFile.path,
        symbolName,
        lineHint: firstMatch.line,
      };
      next.lspDefinition = {
        tool: 'lspGetSemantics',
        query: { ...lspBase, type: 'definition' },
        why: 'Use the grep line as an LSP lineHint to resolve the symbol definition.',
        confidence: 'heuristic',
      };
      next.lspReferences = {
        tool: 'lspGetSemantics',
        query: { ...lspBase, type: 'references' },
        why: 'Use the grep line as an LSP lineHint to inspect semantic usages.',
        confidence: 'heuristic',
      };
    }
  }

  if (options.currentPage < options.totalFilePages) {
    next.nextPage = {
      tool: 'localSearchCode',
      query: withoutUndefined({
        ...query,
        page: options.currentPage + 1,
      }),
      why: 'Continue to the next page of matched files.',
      confidence: 'exact',
    };
  }

  if (options.hasFileWithMoreMatches) {
    next.nextMatchPage = {
      tool: 'localSearchCode',
      query: withoutUndefined({
        ...query,
        maxMatchesPerFile: options.matchesPerPage,
        matchPage: options.matchPage + 1,
      }),
      why: 'Continue within files that have more matches than this response returned.',
      confidence: 'exact',
    };
  }

  return next;
}

function lineRangeAroundMatch(match: FlowMatch): {
  startLine: number;
  endLine: number;
} {
  const line = Math.max(1, match.line ?? 1);
  const endLine = Math.max(line, match.endLine ?? line);
  return {
    startLine: Math.max(1, line - FETCH_CONTEXT_LINES),
    endLine: endLine + FETCH_CONTEXT_LINES,
  };
}

function inferLspSymbolName(
  match: FlowMatch | undefined,
  query: RipgrepQuery,
  searchEngine: LocalSearchEngine
): string | undefined {
  const fromMetavar = firstIdentifierFromMetavars(match?.metavars);
  if (fromMetavar) return fromMetavar;

  if (searchEngine === 'structural') {
    return undefined;
  }

  const keywordSymbol = identifierFromSearchQuery(query.keywords);
  if (keywordSymbol) return keywordSymbol;

  return identifierFromText(match?.value);
}

function firstIdentifierFromMetavars(
  metavars: Record<string, string[]> | undefined
): string | undefined {
  if (!metavars) return undefined;
  for (const values of Object.values(metavars)) {
    for (const value of values) {
      const symbol = identifierFromText(value);
      if (symbol) return symbol;
    }
  }
  return undefined;
}

function identifierFromText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const candidates = trimmed.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return candidates.find(candidate => !RESERVED_SYMBOL_WORDS.has(candidate));
}

function identifierFromSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const first = value.trim().match(/[A-Za-z_$][\w$]*/)?.[0];
  if (!first || RESERVED_SYMBOL_WORDS.has(first)) return undefined;
  return first;
}

function withoutUndefined(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

function _getStructuredResultSizeHints(
  files: LocalSearchCodeFile[],
  query: RipgrepQuery,
  totalMatches: number
): string[] {
  const hints: string[] = [];

  if (totalMatches > 100 || files.length > 20) {
    const recoveries: string[] = [];
    if (!query.langType && !query.include)
      recoveries.push('add langType or include');
    if (!query.excludeDir?.length) recoveries.push('add excludeDir');
    if ((query.keywords?.length ?? 0) < 5) recoveries.push('lengthen pattern');
    if (recoveries.length > 0) {
      hints.push(
        `Large result set (${totalMatches} matches in ${files.length} files). Narrow: ${recoveries.join(', ')}.`
      );
    }
  }

  return hints;
}

function compareRipgrepFilesByRelevance(
  a: LocalSearchCodeFile,
  b: LocalSearchCodeFile,
  _query: RipgrepQuery
): number {
  const matchDelta = (b.matchCount ?? 0) - (a.matchCount ?? 0);
  if (matchDelta !== 0) return matchDelta;

  return a.path.localeCompare(b.path);
}
