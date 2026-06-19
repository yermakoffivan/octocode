import type { GitHubAPIError } from '../../github/githubAPI.js';
import {
  toToolError,
  isToolError,
  type ToolError,
} from '../../errors/ToolError.js';
import { getHints } from '../../hints/index.js';
import type { BaseQueryLocal } from '@octocodeai/octocode-core/extra-types';
import { attachRawResponseChars } from './charSavings.js';

type PartialBaseQuery = Partial<BaseQueryLocal>;

export interface UnifiedErrorResult {
  status: 'error';

  error?: string | GitHubAPIError;

  errorCode?: string;

  hints?: string[];

  [key: string]: unknown;
}

interface CreateErrorResultOptions {
  toolName?: string;

  hintContext?: Record<string, unknown>;

  extra?: Record<string, unknown>;

  customHints?: string[];

  hintSourceError?: GitHubAPIError;

  rawResponse?: unknown;
}

function extractProviderApiHints(apiError: GitHubAPIError): string[] {
  const hints: string[] = [];

  if (apiError.scopesSuggestion) {
    hints.push(apiError.scopesSuggestion);
  }

  if (
    apiError.rateLimitRemaining !== undefined &&
    apiError.rateLimitReset !== undefined
  ) {
    const resetMs = apiError.rateLimitReset;
    if (!isNaN(resetMs)) {
      const resetDate = new Date(resetMs);
      hints.push(
        `Rate limit: ${apiError.rateLimitRemaining} remaining, resets at ${resetDate.toISOString()}`
      );
    }
  }

  if (apiError.retryAfter !== undefined) {
    hints.push(`Retry after ${apiError.retryAfter} seconds`);
  }

  return hints;
}

function isGitHubApiError(error: unknown): error is GitHubAPIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof (error as GitHubAPIError).error === 'string' &&
    ('type' in error || 'status' in error || 'scopesSuggestion' in error)
  );
}

export function createErrorResult(
  error: unknown,
  _query: PartialBaseQuery,
  options: CreateErrorResultOptions = {}
): UnifiedErrorResult {
  const { toolName, hintContext, extra, customHints, hintSourceError } =
    options;

  const result: UnifiedErrorResult = {
    status: 'error',
  };

  const hints: string[] = [];

  if (hintSourceError) {
    hints.push(...extractProviderApiHints(hintSourceError));
  }

  if (isGitHubApiError(error)) {
    result.error = error;
    if (!hintSourceError) {
      hints.push(...extractProviderApiHints(error));
    }
  } else if (isToolError(error)) {
    result.error = error.message;
    result.errorCode = error.errorCode;

    if (toolName) {
      const toolHints = getHints(toolName, 'error', {
        originalError: error.message,
        errorType: getErrorTypeFromToolError(error),
        ...hintContext,
      });
      hints.push(...toolHints);
    }
  } else if (typeof error === 'string') {
    result.error = error;
  } else if (error instanceof Error) {
    const toolError = toToolError(error);
    result.error = toolError.message;
    result.errorCode = toolError.errorCode;

    if (toolName) {
      const toolHints = getHints(toolName, 'error', {
        originalError: toolError.message,
        ...hintContext,
      });
      hints.push(...toolHints);
    }
  } else {
    result.error = 'Unknown error occurred';
  }

  if (customHints && customHints.length > 0) {
    hints.push(...customHints);
  }

  if (extra?.hints && Array.isArray(extra.hints)) {
    hints.push(...(extra.hints as string[]));
  }

  const filteredHints = hints.filter(
    h => typeof h === 'string' && h.trim().length > 0
  );
  if (filteredHints.length > 0) {
    result.hints = filteredHints;
  }

  if (extra) {
    const { hints: _hints, ...restExtra } = extra;
    void _hints;
    Object.assign(result, restExtra);
  }

  return options.rawResponse === undefined
    ? result
    : attachRawResponseChars(result, options.rawResponse);
}

/**
 * Minimal shape of the parts of a Zod schema this helper relies on, kept
 * version-agnostic so it does not couple to a specific Zod release.
 */
interface SafeParseableSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T; error?: never }
    | {
        success: false;
        data?: never;
        error: { issues: Array<{ message: string }> };
      };
}

export type SafeParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: UnifiedErrorResult };

/**
 * Validate `input` against `schema`, returning either the parsed data or a
 * structured {@link UnifiedErrorResult} built via {@link createErrorResult}.
 *
 * Replaces the per-tool `safeParse → issues.map(...).join('; ') →
 * createErrorResult('Validation error: …')` block. Pass `prefix: false` to
 * omit the "Validation error: " prefix (github_fetch_content parity).
 */
export function safeParseOrError<T>(
  schema: SafeParseableSchema<T>,
  query: PartialBaseQuery,
  options: { toolName?: string; prefix?: boolean } = {}
): SafeParseOutcome<T> {
  const result = schema.safeParse(query);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const messages = result.error.issues.map(i => i.message).join('; ');
  const text =
    options.prefix === false ? messages : `Validation error: ${messages}`;

  return {
    ok: false,
    error: createErrorResult(text, query, { toolName: options.toolName }),
  };
}

function getErrorTypeFromToolError(
  error: ToolError
): 'size_limit' | 'not_found' | 'directory' | 'permission' | undefined {
  switch (error.errorCode) {
    case 'fileTooLarge':
    case 'outputTooLarge':
      return 'size_limit';
    case 'fileAccessFailed':
    case 'fileReadFailed':
      return isDirectoryToolError(error) ? 'directory' : 'not_found';
    case 'pathValidationFailed':
      return 'permission';
    default:
      return undefined;
  }
}

function isDirectoryToolError(error: ToolError): boolean {
  if (error.context?.errorCode === 'EISDIR') return true;
  const cause = (error as Error & { cause?: unknown }).cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: string }).code === 'EISDIR'
  );
}
