import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import { fetchContent } from './fetchContent.js';
import {
  LocalFetchContentQuerySchema,
  type FetchContentQuery,
} from './scheme.js';
import { safeParseOrError } from '../utils.js';
import { executeWithToolBoundary } from '../executionGuard.js';
import type { ToolExecutionArgs } from '../../types/execution.js';
export { finalizeFetchContentResult } from './fetchContent.js';

export async function executeFetchContent(
  args: ToolExecutionArgs<FetchContentQuery>
): Promise<CallToolResult> {
  const { queries } = args;

  return executeBulkOperation(
    queries || [],
    async (query: FetchContentQuery) =>
      executeWithToolBoundary({
        toolName: TOOL_NAMES.LOCAL_FETCH_CONTENT,
        query,
        contextMessage: 'localGetFileContent execution failed',
        execute: async () => {
          const parsed = safeParseOrError<FetchContentQuery>(
            LocalFetchContentQuerySchema,
            query
          );
          if (parsed.ok === false) {
            return parsed.error;
          }
          const result = await fetchContent(parsed.data);
          return result;
        },
      }),
    {
      toolName: TOOL_NAMES.LOCAL_FETCH_CONTENT,
      peerHints: true,
    },
    args
  );
}
