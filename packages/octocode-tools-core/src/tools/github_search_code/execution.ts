import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { GitHubCodeSearchQuerySchema } from '@octocodeai/octocode-core/schemas';
import type { GitHubSearchCodeData } from '@octocodeai/octocode-core/types';

type GitHubCodeSearchQuery = z.infer<typeof GitHubCodeSearchQuerySchema>;
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import type {
  ToolExecutionArgs,
  WithOptionalMeta,
} from '../../types/execution.js';
import {
  createErrorResult,
  createSuccessResult,
  handleCatchError,
} from '../utils.js';
import {
  mapCodeSearchProviderResult,
  mapCodeSearchToolQuery,
} from '../providerMappers.js';
import {
  createLazyProviderContext,
  executeProviderOperation,
} from '../providerExecution.js';
import { buildGhSearchCodeFinalizer } from './finalizer.js';

type PartialCodeSearchQuery = WithOptionalMeta<GitHubCodeSearchQuery>;

function hasValidCodeSearchParams(query: PartialCodeSearchQuery): boolean {
  const keywords = query.keywords ?? [];
  return Boolean(
    keywords.some(keyword => keyword.trim().length > 0) ||
    query.owner ||
    query.path ||
    query.extension ||
    query.filename
  );
}

function validateCodeSearchScope(
  query: PartialCodeSearchQuery
): { error: string } | undefined {
  if (query.repo && !query.owner) {
    return {
      error:
        'Repository scope requires owner. Provide both owner and repo, or omit repo for a broader search.',
    };
  }
  return undefined;
}

export async function searchMultipleGitHubCode(
  args: ToolExecutionArgs<PartialCodeSearchQuery>
): Promise<CallToolResult> {
  const { queries } = args;
  const getProviderContext = createLazyProviderContext(args.authInfo);

  return executeBulkOperation(
    queries,
    async (query: PartialCodeSearchQuery, _index: number) => {
      try {
        const scopeValidation = validateCodeSearchScope(query);
        if (scopeValidation) {
          return createErrorResult(scopeValidation.error, query);
        }

        if (!hasValidCodeSearchParams(query)) {
          return createErrorResult(
            'At least one search term or scope filter is required.',
            query
          );
        }
        const ctx = getProviderContext();
        const providerResult = await executeProviderOperation(query, () =>
          ctx.provider.searchCode(mapCodeSearchToolQuery(query))
        );

        if (providerResult.ok === false) {
          return providerResult.result;
        }

        const flat = mapCodeSearchProviderResult(
          providerResult.response.data,
          query
        );

        return createSuccessResult(
          query,
          flat as GitHubSearchCodeData,
          flat.results.length > 0,
          TOOL_NAMES.GITHUB_SEARCH_CODE,
          {
            rawResponse: providerResult.response.rawResponseChars,
          }
        );
      } catch (error) {
        return handleCatchError(
          error,
          query,
          undefined,
          TOOL_NAMES.GITHUB_SEARCH_CODE
        );
      }
    },
    {
      toolName: TOOL_NAMES.GITHUB_SEARCH_CODE,
      finalize: buildGhSearchCodeFinalizer<PartialCodeSearchQuery>(),
    },
    args
  );
}
