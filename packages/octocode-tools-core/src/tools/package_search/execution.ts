import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { NpmPackageQuerySchema } from '@octocodeai/octocode-core/schemas';

type NpmSearchQuery = z.input<typeof NpmPackageQuerySchema>;
import { searchPackage } from '../../utils/package/common.js';
import type {
  NpmSearchAPIResult,
  NpmSearchError,
  PackageResult,
  NpmPackageResult,
} from '../../utils/package/common.js';
import { executeBulkOperation } from '../../utils/response/bulk.js';
import { createSuccessResult, createErrorResult } from '../utils.js';
import { TOOL_NAMES } from '../toolMetadata/proxies.js';
import type { ToolExecutionArgs } from '../../types/execution.js';

function isNpmSearchError(
  result: NpmSearchAPIResult | NpmSearchError
): result is NpmSearchError {
  return 'error' in result;
}

function isNpm(pkg: PackageResult): pkg is NpmPackageResult {
  return 'npmUrl' in pkg;
}

function getPackageName(pkg: PackageResult): string {
  return isNpm(pkg) && pkg.path ? pkg.path : pkg.name;
}

function getPackageRepo(pkg: PackageResult): string | null {
  return isNpm(pkg) ? pkg.repoUrl : pkg.repository;
}

function cleanRelativePath(
  path: string | null | undefined
): string | undefined {
  if (!path) return undefined;
  const clean = path.replace(/^\.\//, '').replace(/^\//, '');
  return clean.length > 0 ? clean : undefined;
}

type PackageData = {
  name: string;
  version?: string;
  description?: string;
  license?: string;
  weeklyDownloads?: number;
  repository?: string;
  repositoryDirectory?: string;
};

function formatPackageData(pkg: PackageResult): PackageData {
  const name = getPackageName(pkg);
  const url = getPackageRepo(pkg);
  const data: PackageData = { name };
  if (isNpm(pkg)) {
    if (pkg.version && pkg.version !== 'unknown') data.version = pkg.version;
    if (pkg.description) data.description = pkg.description;
    if (pkg.license) data.license = pkg.license;
    if (typeof pkg.weeklyDownloads === 'number')
      data.weeklyDownloads = pkg.weeklyDownloads;
  }
  if (url) data.repository = url;
  const root = cleanRelativePath(
    isNpm(pkg) ? pkg.repositoryDirectory : undefined
  );
  if (root) data.repositoryDirectory = root;
  return data;
}

type PackagePagination = {
  currentPage: number;
  totalPages: number;
  perPage: number;
  totalFound: number;
  returned: number;
  hasMore: boolean;
  nextPage?: number;
};

function buildPackagePagination(
  query: NpmSearchQuery,
  totalFound: number,
  returned: number,
  isKeyword: boolean
): PackagePagination {
  const currentPage = Math.max(1, (query as { page?: number }).page ?? 1);
  const perPage = isKeyword ? 10 : 1;
  const totalPages = Math.max(1, Math.ceil(totalFound / perPage));
  const hasMore = currentPage < totalPages;
  return {
    currentPage,
    totalPages,
    perPage,
    totalFound,
    returned,
    hasMore,
    ...(hasMore ? { nextPage: currentPage + 1 } : {}),
  };
}

export async function searchPackages(
  args: ToolExecutionArgs<NpmSearchQuery>
): Promise<CallToolResult> {
  return executeBulkOperation(
    args.queries,
    async (query: NpmSearchQuery) => {
      try {
        if (!query.packageName) {
          return createErrorResult(
            'Package name is required for package search',
            query
          );
        }

        const apiResult = await searchPackage({
          name: query.packageName,
          page: (query as { page?: number }).page,
          itemsPerPage: (query as { itemsPerPage?: number }).itemsPerPage,
          mainResearchGoal: (query as { mainResearchGoal?: string })
            .mainResearchGoal,
          researchGoal: (query as { researchGoal?: string }).researchGoal,
          reasoning: (query as { reasoning?: string }).reasoning,
        });

        if (isNpmSearchError(apiResult)) {
          return createErrorResult(apiResult.error, query, {
            rawResponse: apiResult,
          });
        }

        const raw = apiResult.packages as PackageResult[];
        const packages = raw.map(formatPackageData);
        const hasContent = packages.length > 0;

        const isKeyword = raw.length > 1 || apiResult.totalFound > 1;
        const pagination = buildPackagePagination(
          query,
          apiResult.totalFound,
          packages.length,
          isKeyword
        );

        const data = {
          packages,
          pagination,
        };

        return createSuccessResult(
          query,
          data,
          hasContent,
          TOOL_NAMES.PACKAGE_SEARCH,
          {
            rawResponse: apiResult.rawResponseChars ?? apiResult,
          }
        );
      } catch (error) {
        return createErrorResult(error, query, {
          toolName: TOOL_NAMES.PACKAGE_SEARCH,
        });
      }
    },
    {
      toolName: TOOL_NAMES.PACKAGE_SEARCH,
      keysPriority: ['packages', 'pagination', 'error'],
    },
    args
  );
}
