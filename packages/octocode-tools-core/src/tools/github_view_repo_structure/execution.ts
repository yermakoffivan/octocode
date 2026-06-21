import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { GitHubViewRepoStructureQuerySchema } from '@octocodeai/octocode-core/schemas';
import type {
  GitHubViewRepoStructureToolResult,
  GitHubRepoStructureDirectoryEntry,
} from '@octocodeai/octocode-core/extra-types';

type GitHubViewRepoStructureQuery = z.infer<
  typeof GitHubViewRepoStructureQuerySchema
>;
import type { WithOptionalMeta } from '../../types/execution.js';

type PartialRepoStructureQuery = WithOptionalMeta<GitHubViewRepoStructureQuery>;
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import type { ToolExecutionArgs } from '../../types/execution.js';
import { shouldIgnoreFile, shouldIgnoreDir } from '../../utils/file/filters.js';
import { handleCatchError, createSuccessResult } from '../utils.js';
import type { ProcessedBulkResult } from '../../types/toolResults.js';
import {
  mapRepoStructureProviderResult,
  mapRepoStructureToolQuery,
} from '../providerMappers.js';
import {
  createLazyProviderContext,
  executeProviderOperation,
} from '../providerExecution.js';

function normalizeStructureErrorResult(
  result: ProcessedBulkResult,
  query: PartialRepoStructureQuery
): ProcessedBulkResult {
  const rawError = result.error;
  const apiError =
    typeof rawError === 'object' && rawError !== null
      ? (rawError as { error?: unknown; status?: unknown; type?: unknown })
      : undefined;

  return {
    status: 'error',
    owner: query.owner,
    repo: query.repo,
    path: query.path,
    branch: query.branch,
    error:
      typeof apiError?.error === 'string'
        ? apiError.error
        : typeof rawError === 'string'
          ? rawError
          : 'Failed to explore repository structure',
    ...(typeof apiError?.status === 'number'
      ? { statusCode: apiError.status }
      : {}),
    ...(typeof apiError?.type === 'string' ? { errorType: apiError.type } : {}),
    ...(Array.isArray(result.hints) ? { hints: result.hints } : {}),
  };
}

export function filterStructure(
  structure: Record<string, GitHubRepoStructureDirectoryEntry>
): Record<string, GitHubRepoStructureDirectoryEntry> {
  const filtered: Record<string, GitHubRepoStructureDirectoryEntry> = {};

  for (const [dirPath, entry] of Object.entries(structure)) {
    // Skip top-level entries for directories that should be ignored
    const dirName = dirPath.split('/').pop() ?? dirPath;
    if (dirPath !== '' && dirPath !== '.' && shouldIgnoreDir(dirName)) {
      continue;
    }

    const filteredFiles = entry.files.filter(
      fileName => !shouldIgnoreFile(fileName)
    );
    const filteredFolders = entry.folders.filter(
      folderName => !shouldIgnoreDir(folderName)
    );

    if (filteredFiles.length > 0 || filteredFolders.length > 0) {
      filtered[dirPath] = {
        files: filteredFiles,
        folders: filteredFolders,
      };
    }
  }

  return filtered;
}

export async function exploreMultipleRepositoryStructures(
  args: ToolExecutionArgs<PartialRepoStructureQuery>
): Promise<CallToolResult> {
  const { queries, authInfo } = args;
  const getProviderContext = createLazyProviderContext(authInfo);

  return executeBulkOperation(
    queries,
    async (query: PartialRepoStructureQuery, _index: number) => {
      try {
        const currentProviderContext = getProviderContext();
        const projectId = `${query.owner}/${query.repo}`;
        const resolvedBranch =
          query.branch ??
          (await currentProviderContext.provider.resolveDefaultBranch(
            projectId
          ));

        const providerResult = await executeProviderOperation(query, () =>
          currentProviderContext.provider.getRepoStructure(
            mapRepoStructureToolQuery(query, resolvedBranch)
          )
        );

        if (providerResult.ok === false) {
          return normalizeStructureErrorResult(providerResult.result, query);
        }

        const originalHasContent =
          Object.keys(providerResult.response.data.structure ?? {}).length > 0;
        const filteredStructure = filterStructure(
          providerResult.response.data.structure
        );
        const hasContent = Object.keys(filteredStructure).length > 0;
        const wasFilteredToEmpty = originalHasContent && !hasContent;
        const wasTruncated = Boolean(
          providerResult.response.data.summary?.truncated
        );
        const resultData = mapRepoStructureProviderResult(
          providerResult.response.data,
          query,
          filteredStructure,
          resolvedBranch
        );

        const branchFallback =
          'branchFallback' in resultData
            ? resultData.branchFallback
            : undefined;
        const apiHints = providerResult.response.data.hints || [];
        const branchHints: string[] = branchFallback
          ? [
              `WARNING: Branch '${String((branchFallback as { requestedBranch: string }).requestedBranch)}' not found. Showing '${String((branchFallback as { actualBranch: string }).actualBranch)}' (default branch). Re-query with the correct branch name if branch-specific results are required.`,
            ]
          : [];
        const entryCount = Object.values(filteredStructure).reduce(
          (sum, entry) => sum + entry.files.length + entry.folders.length,
          0
        );

        // Successful structure results carry their evidence in structured
        // fields (incl. the `pagination` object); per-call pagination/next-step
        // hints are redundant token waste on success and are dropped centrally
        // by createSuccessResult. Provider `apiHints` are forwarded as recovery
        // aids and remain gated on the success path.
        const shaped = buildRepoStructureOutput(
          {
            data: resultData as Record<string, unknown>,
            entryCount,
            wasTruncated,
            extraHints: apiHints,
          },
          query
        );

        return createSuccessResult(
          query,
          shaped.data,
          hasContent,
          TOOL_NAMES.GITHUB_VIEW_REPO_STRUCTURE,
          {
            hintContext: {
              entryCount,
              path: query.path,
              depth: query.maxDepth,
              branch: query.branch,
              wasFilteredToEmpty,
              flagFiles: Object.values(filteredStructure).flatMap(entry =>
                entry.files.filter(f =>
                  /(Mode|Config|Flag|Feature)\.[A-Za-z0-9]+$/.test(f)
                )
              ),
            },
            prefixHints: branchHints,
            extraHints: shaped.extraHints,
            rawResponse: providerResult.response.rawResponseChars,
          }
        );
      } catch (error) {
        return handleCatchError(
          error,
          query,
          'Failed to explore repository structure',
          TOOL_NAMES.GITHUB_VIEW_REPO_STRUCTURE
        );
      }
    },
    {
      toolName: TOOL_NAMES.GITHUB_VIEW_REPO_STRUCTURE,
      keysPriority: [
        'resolvedBranch',
        'branchFallback',
        'summary',
        'pagination',
        'structure',
        'error',
      ] satisfies Array<keyof GitHubViewRepoStructureToolResult>,
      peerHints: true,
    },
    args
  );
}

export function buildRepoStructureOutput(
  input: {
    data: Record<string, unknown>;
    entryCount: number;
    wasTruncated: boolean;
    extraHints: string[];
  },
  _query: PartialRepoStructureQuery
): { data: Record<string, unknown>; extraHints: string[] } {
  // Next-path / navigation hints on the success path are redundant token waste
  // (the structure itself lists the paths) and are dropped centrally by
  // createSuccessResult. Forward only the caller-supplied (provider) hints.
  return {
    data: input.data,
    extraHints: input.extraHints,
  };
}
