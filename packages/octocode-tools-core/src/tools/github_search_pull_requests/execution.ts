import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { GitHubSearchPullRequestsToolResult } from '@octocodeai/octocode-core/extra-types';
import { GitHubPullRequestSearchQueryLocalSchema } from './scheme.js';

type GitHubPullRequestSearchQuery = z.infer<
  typeof GitHubPullRequestSearchQueryLocalSchema
>;
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import type {
  ToolExecutionArgs,
  WithOptionalMeta,
} from '../../types/execution.js';

type GitHubPullRequestSearchInput = z.input<
  typeof GitHubPullRequestSearchQueryLocalSchema
>;
type PartialPRQuery = WithOptionalMeta<GitHubPullRequestSearchQuery>;
import {
  handleCatchError,
  createSuccessResult,
  createErrorResult,
  safeParseOrError,
} from '../utils.js';
import {
  mapPullRequestProviderResultData,
  mapPullRequestToolQuery,
} from '../providerMappers.js';
import {
  createLazyProviderContext,
  executeProviderOperation,
} from '../providerExecution.js';
import {
  hasExpensiveContentRequest,
  normalizePullRequestContentRequest,
} from './contentRequest.js';
import { shapePullRequestForContent } from './contentResponse.js';
import { fetchHistory } from '../../github/history.js';
import { isGitHubAPIError } from '../../github/githubAPI.js';

export async function searchMultipleGitHubPullRequests(
  args: ToolExecutionArgs<GitHubPullRequestSearchInput>
): Promise<CallToolResult> {
  const { queries, authInfo } = args;
  const getProviderContext = createLazyProviderContext(authInfo);

  return executeBulkOperation(
    queries,
    async (query: GitHubPullRequestSearchInput, _index: number) => {
      try {
        const parsed = safeParseOrError(
          GitHubPullRequestSearchQueryLocalSchema,
          query
        );
        if (parsed.ok === false) {
          return parsed.error;
        }

        // --- commits mode: route to commit history API ---
        if ((parsed.data as { type?: string }).type === 'commits') {
          const q = parsed.data as {
            type?: string;
            owner?: string;
            repo?: string;
            path?: string;
            branch?: string;
            author?: string;
            since?: string;
            until?: string;
            page?: number;
            perPage?: number;
            includeDiff?: boolean;
            charLength?: number;
          };

          if (!q.owner || !q.repo) {
            return createErrorResult(
              'owner and repo are required for commits mode.',
              query
            );
          }

          const path = q.path;
          // A path ending in '/' is a directory prefix → repo mode; a specific file path → file mode
          const historyType = path && !path.endsWith('/') ? 'file' : 'repo';

          if (historyType === 'file' && !path) {
            return createErrorResult(
              'path is required when querying a specific file in commits mode.',
              query
            );
          }

          const result = await fetchHistory(
            {
              type: historyType,
              owner: q.owner,
              repo: q.repo,
              path,
              branch: q.branch,
              since: q.since,
              until: q.until,
              author: q.author,
              page: Number(q.page) || 1,
              perPage: Number(q.perPage) || 30,
              includeDiff: Boolean(q.includeDiff),
              charLength:
                typeof q.charLength === 'number' ? q.charLength : undefined,
            },
            authInfo
          );

          if (isGitHubAPIError(result)) {
            const isRateLimited =
              result.status === 429 ||
              result.error?.toString().toLowerCase().includes('rate limit') ||
              false;
            return createErrorResult(result, query, {
              toolName: TOOL_NAMES.GITHUB_SEARCH_PULL_REQUESTS,
              hintContext: {
                type: 'commits',
                path,
                isRateLimited,
                status: result.status,
                retryAfter: result.retryAfter,
              },
              hintSourceError: result,
            });
          }

          const { commits, pagination } = result.data;
          const hasContent = commits.length > 0;

          // Success-path navigation hints (next-page / merge-commit PR refs)
          // are dropped centrally by createSuccessResult; the evidence lives in
          // the structured commits + pagination fields. Empty-path recovery
          // hints come from getHints('empty') via hintContext below.
          return createSuccessResult(
            query,
            result.data as unknown as Record<string, unknown>,
            hasContent,
            TOOL_NAMES.GITHUB_SEARCH_PULL_REQUESTS,
            {
              hintContext: {
                type: 'commits',
                path,
                matchCount: commits.length,
                hasMorePages: pagination.hasMore,
              },
              rawResponse: result.rawResponseChars,
            }
          );
        }
        // --- end commits mode ---

        const currentProviderContext = getProviderContext();
        const effectiveQuery: PartialPRQuery = { ...parsed.data };
        const contentRequest = normalizePullRequestContentRequest(
          effectiveQuery as never
        );
        const downgradeHints: string[] = [];
        const hasPrNumber = effectiveQuery.prNumber !== undefined;

        if (!hasPrNumber && hasExpensiveContentRequest(contentRequest)) {
          downgradeHints.push(
            'Broad PR search returns metadata only. Re-call with prNumber and content selectors (body, changedFiles, patches, comments, commits) or reviewMode="full" to fetch PR content.'
          );
        }

        if (!hasPrNumber) {
          (effectiveQuery as { content?: unknown }).content = undefined;
          (effectiveQuery as { reviewMode?: unknown }).reviewMode = undefined;
        }

        const hasTextQuery =
          !hasPrNumber &&
          ((effectiveQuery.keywordsToSearch?.length ?? 0) > 0 ||
            Boolean(effectiveQuery.query));
        const looksLikeArchaeology =
          hasTextQuery &&
          !effectiveQuery.created &&
          (effectiveQuery.state === 'merged' ||
            (effectiveQuery as { merged?: boolean }).merged === true);
        if (
          looksLikeArchaeology &&
          !effectiveQuery.sort &&
          !effectiveQuery.order
        ) {
          downgradeHints.push(
            'To find the PR that first introduced a feature: sort:"created" order:"asc". Use match:["title"] for title-only and query:\'"exact phrase"\' for phrase matching.'
          );
        } else if (
          hasTextQuery &&
          !effectiveQuery.created &&
          !effectiveQuery.sort &&
          !effectiveQuery.order
        ) {
          downgradeHints.push(
            'Archaeology tip: add state:"merged" sort:"created" order:"asc" to find the oldest matching merged PR. Use match:["title"] for title-only matching.'
          );
        }

        const hasValidParams =
          effectiveQuery.keywordsToSearch?.length ||
          effectiveQuery.owner ||
          effectiveQuery.repo ||
          effectiveQuery.author ||
          effectiveQuery.assignee ||
          (effectiveQuery.prNumber &&
            effectiveQuery.owner &&
            effectiveQuery.repo);

        if (!hasValidParams) {
          return createErrorResult(
            'At least one valid search parameter, filter, or PR number is required.',
            query
          );
        }

        const providerResult = await executeProviderOperation(
          effectiveQuery,
          () =>
            currentProviderContext.provider.searchPullRequests(
              mapPullRequestToolQuery(effectiveQuery)
            )
        );

        if (providerResult.ok === false) {
          return providerResult.result;
        }

        const includeFileChanges = hasPrNumber
          ? contentRequest.changedFiles ||
            contentRequest.patches.mode !== 'none'
          : false;
        const { pullRequests, resultData } = mapPullRequestProviderResultData(
          providerResult.response.data,
          {
            includeFileChanges,
          }
        );

        if (effectiveQuery.prNumber !== undefined) {
          delete (resultData as Record<string, unknown>).pagination;
        }

        const shouldLeanBroadShape =
          !hasPrNumber &&
          (Boolean((query as { content?: unknown }).content) ||
            Boolean((query as { reviewMode?: unknown }).reviewMode));
        const leanRequest = {
          ...contentRequest,
          body: false,
          changedFiles: false,
          patches: { mode: 'none' as const },
          comments: false as const,
          commits: false as const,
        };
        const shouldMinify =
          (effectiveQuery as { minify?: string }).minify === 'standard';
        const showContentMap = hasPrNumber;
        const shapedPullRequests = pullRequests.map(pr =>
          shapePullRequestForContent(
            pr,
            effectiveQuery as never,
            shouldLeanBroadShape ? leanRequest : contentRequest,
            shouldMinify,
            showContentMap
          )
        );
        resultData.pull_requests = shapedPullRequests;

        if (
          !hasPrNumber &&
          (effectiveQuery as { concise?: boolean }).concise === true
        ) {
          resultData.pull_requests = shapedPullRequests.map(pr => {
            const p = pr as { number?: unknown; title?: unknown };
            return `#${p.number} ${p.title}`;
          }) as unknown as typeof resultData.pull_requests;
        }

        const hasContent = shapedPullRequests.length > 0;

        // Per-call result/file-change/matchString hints were computed only from
        // populated results and dropped centrally by createSuccessResult on the
        // success path; they are removed as dead code. downgradeHints are
        // query-shape guidance that still flow on the empty-recovery path.
        const shaped = buildPRSearchOutput(
          {
            data: resultData,
            pullRequests,
            extraHints: [...downgradeHints],
          },
          effectiveQuery as PartialPRQuery
        );

        return createSuccessResult(
          effectiveQuery,
          shaped.data,
          hasContent,
          TOOL_NAMES.GITHUB_SEARCH_PULL_REQUESTS,
          {
            hintContext: {
              matchCount: shapedPullRequests.length,
              state: effectiveQuery.state,
              owner: effectiveQuery.owner,
              repo: effectiveQuery.repo,
              author: effectiveQuery.author,
              keywords: effectiveQuery.keywordsToSearch,
              prNumber: effectiveQuery.prNumber,
              prMatch: effectiveQuery.match,
            },
            extraHints: shaped.extraHints,
            rawResponse: providerResult.response.rawResponseChars,
          }
        );
      } catch (error) {
        return handleCatchError(
          error,
          query,
          undefined,
          TOOL_NAMES.GITHUB_SEARCH_PULL_REQUESTS
        );
      }
    },
    {
      toolName: TOOL_NAMES.GITHUB_SEARCH_PULL_REQUESTS,
      keysPriority: [
        'pull_requests',
        'pagination',
        'total_count',
        'error',
      ] satisfies Array<keyof GitHubSearchPullRequestsToolResult>,
      peerHints: true,
    },
    args
  );
}

export function buildPRSearchOutput(
  input: {
    data: Record<string, unknown>;
    pullRequests: Array<Record<string, unknown>>;
    extraHints: string[];
  },
  _query: PartialPRQuery
): { data: Record<string, unknown>; extraHints: string[] } {
  return { data: input.data, extraHints: input.extraHints };
}
