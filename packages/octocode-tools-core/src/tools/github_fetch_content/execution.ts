import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { z } from 'zod';
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import type { ToolExecutionArgs } from '../../types/execution.js';
import {
  handleCatchError,
  createSuccessResult,
  createErrorResult,
  safeParseOrError,
} from '../utils.js';
import { FileContentQueryLocalSchema } from './scheme.js';
import type { MinifyMode } from '../../scheme/fields.js';
import {
  fetchDirectoryContents,
  fetchFileContentToDisk,
} from '../../github/directoryFetch.js';
import { resolveDefaultBranch } from '../../github/client.js';
import { countSerializedChars } from '../../utils/response/charSavings.js';
import {
  mapFileContentProviderResult,
  mapFileContentToolQuery,
} from '../providerMappers.js';
import {
  createLazyProviderContext,
  createProviderExecutionContext,
  executeProviderOperation,
  providerSupports,
} from '../providerExecution.js';
import { buildGithubFetchContentFinalizer } from './finalizer.js';
import { getConfigSync } from '../../shared/index.js';

type FileContentInputQuery = z.input<typeof FileContentQueryLocalSchema>;

type PartialFileContentQuery = z.output<typeof FileContentQueryLocalSchema> & {
  minify: MinifyMode;
};

export async function fetchMultipleGitHubFileContents(
  args: ToolExecutionArgs<FileContentInputQuery>
): Promise<CallToolResult> {
  const { queries, authInfo } = args;
  const getProviderContext = createLazyProviderContext(authInfo);

  return executeBulkOperation(
    queries,
    async (query: FileContentInputQuery, _index: number) => {
      try {
        const parsed = safeParseOrError(FileContentQueryLocalSchema, query, {
          prefix: false,
        });
        if (parsed.ok === false) {
          return parsed.error;
        }

        const effectiveQuery = parsed.data as PartialFileContentQuery;
        const providerContext = getProviderContext();

        if (effectiveQuery.type === 'directory') {
          return handleDirectoryFetch(
            effectiveQuery,
            authInfo,
            providerContext
          );
        }

        return handleFileFetch(effectiveQuery, authInfo, providerContext);
      } catch (error) {
        return handleCatchError(
          error,
          query,
          undefined,
          TOOL_NAMES.GITHUB_FETCH_CONTENT
        );
      }
    },
    {
      toolName: TOOL_NAMES.GITHUB_FETCH_CONTENT,
      peerHints: true,
      finalize: buildGithubFetchContentFinalizer<FileContentInputQuery>(),
    },
    args
  );
}

async function handleDirectoryFetch(
  query: PartialFileContentQuery,
  authInfo: AuthInfo | undefined,
  providerContext: ReturnType<typeof createProviderExecutionContext>
) {
  const config = getConfigSync();
  if (!(config.local.enabled && config.local.enableClone)) {
    return createErrorResult(
      'Directory fetch requires local clone support. Set ENABLE_LOCAL=true and ENABLE_CLONE=true.',
      query,
      {
        customHints: [
          'File mode still works without clone support.',
          'For MCP directory materialization, enable clone support before using type="directory".',
        ],
      }
    );
  }

  if (!providerSupports(providerContext, 'fetchDirectoryToDisk')) {
    return handleCatchError(
      new Error(
        'Directory fetch (type: "directory") is only available with the GitHub provider. ' +
          'Use file mode (type: "file") instead.'
      ),
      query,
      'Provider not supported',
      TOOL_NAMES.GITHUB_FETCH_CONTENT
    );
  }

  if (!query.owner || !query.repo) {
    return createErrorResult(
      'Directory fetch requires both owner and repo.',
      query,
      {
        rawResponse: 0,
      }
    );
  }

  const branch =
    query.branch ??
    (await resolveDefaultBranch(query.owner, query.repo, authInfo));

  const result = await fetchDirectoryContents(
    query.owner,
    query.repo,
    String(query.path),
    branch,
    authInfo,
    Boolean(query.forceRefresh)
  );

  const resultData: Record<string, unknown> = {
    localPath: result.localPath,
    repoRoot: result.repoRoot,
    fileCount: result.fileCount,
    totalSize: result.totalSize,
    files: result.files,
    ...(result.cached ? { cached: true } : {}),
    ...(query.branch !== result.branch
      ? { resolvedBranch: result.branch }
      : {}),
  };

  return createSuccessResult(
    query,
    resultData,
    true,
    TOOL_NAMES.GITHUB_FETCH_CONTENT,
    {
      extraHints: [
        `Saved locally at absolute path "${result.localPath}". Use localViewStructure(path="${result.localPath}") to inspect the tree.`,
        `Use localSearchCode(path="${result.localPath}", keywords="<term>") or localFindFiles(path="${result.localPath}") to research it locally.`,
        `Use localGetFileContent(path="${result.localPath}/<file>") to read exact files, then lspGetSemantics(uri="<absolute-file>", lineHint=<line>) when project context is complete enough.`,
      ],
      rawResponse: result.totalSize ?? countSerializedChars(result),
    }
  );
}

async function handleFileFetch(
  query: PartialFileContentQuery,
  authInfo: AuthInfo | undefined,
  providerContext: ReturnType<typeof createProviderExecutionContext>
) {
  const providerResult = await executeProviderOperation(query, () =>
    providerContext.provider.getFileContent(mapFileContentToolQuery(query))
  );

  if (providerResult.ok === false) {
    return providerResult.result;
  }

  const providerHints = providerResult.response.hints ?? [];
  const materialized =
    query.fullContent === true && query.minify === 'none'
      ? await materializeExactFile(query, authInfo)
      : undefined;
  const materializationHints = materialized
    ? [
        `Saved locally at absolute path "${materialized.localPath}". Use localGetFileContent(path="${materialized.localPath}") to read it exactly.`,
        `Use localSearchCode(path="${materialized.localPath}", keywords="<term>") to search the saved file locally.`,
      ]
    : [];
  const hints = [...providerHints, ...materializationHints];

  const resultData = {
    ...mapFileContentProviderResult(providerResult.response.data, query),
    ...(materialized
      ? {
          localPath: materialized.localPath,
          repoRoot: materialized.repoRoot,
          cached: materialized.cached,
          ...(materialized.branch !== query.branch
            ? { resolvedBranch: materialized.branch }
            : {}),
        }
      : {}),
    ...(hints.length ? { hints } : {}),
  };

  const hasContent = Boolean(
    providerResult.response.data.matchNotFound === true ||
    (providerResult.response.data.content &&
      providerResult.response.data.content.length > 0)
  );

  return createSuccessResult(
    query,
    resultData,
    hasContent,
    TOOL_NAMES.GITHUB_FETCH_CONTENT,
    {
      rawResponse: providerResult.response.rawResponseChars,
      hintContext: {
        path: query.path,
        branch: query.branch,
        isPartial: providerResult.response.data.isPartial,
        endLine: providerResult.response.data.endLine,
      },
    }
  );
}

async function materializeExactFile(
  query: PartialFileContentQuery,
  authInfo: AuthInfo | undefined
) {
  if (!query.owner || !query.repo || typeof query.path !== 'string') {
    return undefined;
  }

  const branch =
    query.branch ??
    (await resolveDefaultBranch(query.owner, query.repo, authInfo));

  return fetchFileContentToDisk(
    query.owner,
    query.repo,
    query.path,
    branch,
    authInfo,
    Boolean(query.forceRefresh)
  );
}
