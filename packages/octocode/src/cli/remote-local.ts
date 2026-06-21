import path from 'node:path';
import { executeDirectTool } from '@octocodeai/octocode-tools-core/direct';
import {
  resolveRef,
  isGithubRef,
  refLabel,
  type GithubRef,
} from './routing.js';

type DirectToolResult = {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
  }[];
};

type CloneResultData = {
  readonly localPath?: string;
  readonly resolvedBranch?: string;
  readonly cached?: boolean;
  readonly hints?: readonly string[];
};

type CloneStructuredContent = {
  readonly results?: readonly { readonly data?: CloneResultData }[];
  readonly hints?: readonly string[];
};

type FetchFileData = {
  readonly localPath?: string;
  readonly repoRoot?: string;
  readonly resolvedBranch?: string;
  readonly cached?: boolean;
};

type FetchDirectoryData = {
  readonly localPath?: string;
  readonly repoRoot?: string;
  readonly resolvedBranch?: string;
  readonly cached?: boolean;
};

type FetchStructuredContent = {
  readonly results?: readonly {
    readonly files?: readonly FetchFileData[];
    readonly directories?: readonly FetchDirectoryData[];
  }[];
  readonly hints?: readonly string[];
};

export type RemoteMaterializationKind = 'file' | 'tree' | 'repo';

export type RemoteMaterialization = {
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string;
  readonly requestedPath: string;
  readonly localPath: string;
  readonly repoRoot: string;
  readonly source: 'clone' | 'tree';
  readonly complete: boolean;
  readonly cached: boolean;
  readonly hints: readonly string[];
};

type HintableToolResult = {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
  }[];
};

export type RemoteMaterializationRequest = {
  readonly repoRef: string;
  readonly path?: string;
  readonly branch?: string;
  readonly forceRefresh?: boolean;
  readonly kind: RemoteMaterializationKind;
};

function directToolText(result: DirectToolResult): string {
  const text = (result.content ?? [])
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
  if (text.length > 0) return text;
  return JSON.stringify(result.structuredContent ?? result, null, 2);
}

function parseCloneResult(result: DirectToolResult): CloneResultData {
  const structured = result.structuredContent as
    | CloneStructuredContent
    | undefined;
  return structured?.results?.[0]?.data ?? {};
}

function parseFetchResult(
  result: DirectToolResult,
  kind: Extract<RemoteMaterializationKind, 'file' | 'tree'>
): FetchFileData | FetchDirectoryData {
  const structured = result.structuredContent as
    | FetchStructuredContent
    | undefined;
  const first = structured?.results?.[0];
  if (kind === 'file') return first?.files?.[0] ?? {};
  return first?.directories?.[0] ?? {};
}

function structuredHints(result: DirectToolResult): string[] {
  const structured = result.structuredContent as
    | { readonly hints?: readonly unknown[] }
    | undefined;
  return (structured?.hints ?? []).filter(
    (hint): hint is string => typeof hint === 'string'
  );
}

function normalizeRepoPath(...parts: readonly (string | undefined)[]): string {
  const joined = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part && part !== '.'))
    .join('/');
  if (!joined) return '';
  if (path.posix.isAbsolute(joined)) {
    throw new Error('Remote path must be repository-relative.');
  }
  if (joined.split('/').some(segment => segment === '..')) {
    throw new Error('Remote path cannot contain path traversal segments.');
  }

  const normalized = path.posix.normalize(joined);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Remote path cannot contain path traversal segments.');
  }
  return normalized === '.' ? '' : normalized;
}

function cloneSparsePathFor(
  requestedPath: string,
  kind: RemoteMaterializationKind
): string | undefined {
  if (!requestedPath) return undefined;
  if (kind !== 'file') return requestedPath;
  const parent = path.posix.dirname(requestedPath);
  return parent === '.' ? undefined : parent;
}

function resolveRepoOption(repoRef: string, branch?: string): GithubRef {
  const ref = resolveRef(repoRef, branch || undefined);
  if (!isGithubRef(ref)) {
    throw new Error(`--repo must be a GitHub ref, got "${repoRef}".`);
  }
  return ref;
}

export function localResearchHints(args: {
  readonly localPath: string;
  readonly repoRoot: string;
  readonly kind: RemoteMaterializationKind;
}): string[] {
  const { localPath, repoRoot, kind } = args;
  const rootHint =
    kind === 'file'
      ? `Saved locally at absolute path "${localPath}". Use localGetFileContent(path="${localPath}") to read it exactly.`
      : `Saved locally at absolute path "${localPath}". Use localViewStructure(path="${localPath}") to inspect the tree.`;

  const hints = [
    rootHint,
    `Use localSearchCode(path="${localPath}", keywords="<term>") to search the saved content locally.`,
    `Repo root is "${repoRoot}". When project context is complete enough, use lspGetSemantics(uri="<absolute-file>", workspaceRoot="${repoRoot}", lineHint=<line>).`,
  ];
  if (kind !== 'file') {
    hints.splice(
      2,
      0,
      `Use localFindFiles(path="${localPath}", names=["<glob>"]) to discover files in the saved content.`
    );
  }
  return hints;
}

function quotedPathAfter(hint: string, marker: string): string | undefined {
  const index = hint.indexOf(marker);
  if (index < 0) return undefined;
  const rest = hint.slice(index + marker.length);
  return rest.slice(0, rest.indexOf('"')) || undefined;
}

function hintFingerprints(hint: string): string[] {
  if (
    hint.startsWith('Saved ') ||
    hint.startsWith('Saved locally ') ||
    (hint.startsWith('Directory ') &&
      hint.includes(' saved locally at absolute path "'))
  ) {
    return [`saved:${quotedPathAfter(hint, 'absolute path "') ?? hint}`];
  }
  if (hint.startsWith('Use localSearchCode(')) {
    const searchKey = `search:${quotedPathAfter(hint, 'path="') ?? hint}`;
    if (hint.includes('localFindFiles(')) {
      const findKey = `research:${quotedPathAfter(hint, 'path="') ?? hint}`;
      return [searchKey, findKey];
    }
    return [searchKey];
  }
  if (hint.startsWith('Use localGetFileContent(')) {
    return [`read:${quotedPathAfter(hint, 'path="') ?? hint}`];
  }
  if (hint.startsWith('Use localFindFiles(')) {
    return [`research:${quotedPathAfter(hint, 'path="') ?? hint}`];
  }
  if (hint.startsWith('Repo root is "')) {
    return [`repoRoot:${quotedPathAfter(hint, 'Repo root is "') ?? hint}`];
  }
  return [hint];
}

function mergeMaterializationHints(
  ...groups: readonly (readonly string[] | undefined)[]
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const hint of groups.flatMap(group => group ?? [])) {
    const keys = hintFingerprints(hint);
    if (keys.some(key => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    merged.push(hint);
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function remoteLocalPayload(
  materialized: RemoteMaterialization
): Record<string, unknown> {
  return {
    source: materialized.source,
    owner: materialized.owner,
    repo: materialized.repo,
    ...(materialized.branch ? { branch: materialized.branch } : {}),
    requestedPath: materialized.requestedPath,
    localPath: materialized.localPath,
    repoRoot: materialized.repoRoot,
    cached: materialized.cached,
    hints: materialized.hints,
  };
}

export function formatMaterializationHints(
  materialized: RemoteMaterialization
): string {
  return [
    'remoteLocal:',
    `  localPath: ${JSON.stringify(materialized.localPath)}`,
    `  repoRoot: ${JSON.stringify(materialized.repoRoot)}`,
    `  requestedPath: ${JSON.stringify(materialized.requestedPath)}`,
    '  hints:',
    ...materialized.hints.map(hint => `    - ${JSON.stringify(hint)}`),
  ].join('\n');
}

export function withMaterializationHints<T extends HintableToolResult>(
  result: T,
  materialized: RemoteMaterialization
): T {
  const structuredRecord = isRecord(result.structuredContent)
    ? result.structuredContent
    : { data: result.structuredContent };
  const existingHints = Array.isArray(structuredRecord.hints)
    ? structuredRecord.hints.filter(
        (hint): hint is string => typeof hint === 'string'
      )
    : [];
  const structuredContent = {
    ...structuredRecord,
    remoteLocal: remoteLocalPayload(materialized),
    hints: [...new Set([...existingHints, ...materialized.hints])],
  };
  const hintBlock = formatMaterializationHints(materialized);
  const content = result.content?.map(item =>
    item.type === 'text' && typeof item.text === 'string'
      ? { ...item, text: `${item.text.trimEnd()}\n${hintBlock}` }
      : item
  );

  return {
    ...result,
    structuredContent,
    ...(content ? { content } : {}),
  };
}

export async function materializeRemoteForCli(
  request: RemoteMaterializationRequest
): Promise<RemoteMaterialization> {
  const repo = resolveRepoOption(request.repoRef, request.branch);
  const requestedPath = normalizeRepoPath(repo.subpath, request.path);
  if (request.kind === 'file' && !requestedPath) {
    throw new Error(
      'File materialization requires a repository-relative path.'
    );
  }

  if (request.kind === 'repo') {
    return materializeCloneForCli(repo, requestedPath, request);
  }

  return materializeTreeForCli(repo, requestedPath, request);
}

async function materializeCloneForCli(
  repo: GithubRef,
  requestedPath: string,
  request: RemoteMaterializationRequest
): Promise<RemoteMaterialization> {
  const cloneSparsePath = cloneSparsePathFor(requestedPath, request.kind);

  const result = (await executeDirectTool('ghCloneRepo', {
    queries: [
      {
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        sparsePath: cloneSparsePath,
        forceRefresh: request.forceRefresh || undefined,
        mainResearchGoal: 'Materialize GitHub content for local CLI research',
        researchGoal: `Save ${refLabel(repo)}${requestedPath ? `/${requestedPath}` : ''} locally`,
        reasoning: 'CLI remote-as-local materialization',
      },
    ],
  })) as DirectToolResult;

  if (result.isError) {
    throw new Error(directToolText(result));
  }

  const data = parseCloneResult(result);
  if (!data.localPath) {
    throw new Error('ghCloneRepo did not return a localPath.');
  }

  const repoRoot = path.resolve(data.localPath);
  const localPath = requestedPath
    ? path.resolve(repoRoot, ...requestedPath.split('/'))
    : repoRoot;
  const hints = localResearchHints({
    localPath,
    repoRoot,
    kind: request.kind,
  });

  return {
    owner: repo.owner,
    repo: repo.repo,
    ...(data.resolvedBranch || repo.branch
      ? { branch: data.resolvedBranch ?? repo.branch }
      : {}),
    requestedPath,
    localPath,
    repoRoot,
    source: 'clone',
    complete: true,
    cached: Boolean(data.cached),
    hints: mergeMaterializationHints(data.hints, hints),
  };
}

async function materializeTreeForCli(
  repo: GithubRef,
  requestedPath: string,
  request: RemoteMaterializationRequest
): Promise<RemoteMaterialization> {
  const kind = request.kind as Extract<
    RemoteMaterializationKind,
    'file' | 'tree'
  >;
  const result = (await executeDirectTool('ghGetFileContent', {
    queries: [
      {
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        path: requestedPath,
        type: kind === 'file' ? 'file' : 'directory',
        forceRefresh: request.forceRefresh || undefined,
        ...(kind === 'file'
          ? { fullContent: true, contextLines: 0, minify: 'none' }
          : {}),
        mainResearchGoal: 'Materialize GitHub content for local CLI research',
        researchGoal: `Save ${refLabel(repo)}${requestedPath ? `/${requestedPath}` : ''} locally`,
        reasoning: 'CLI remote-as-local materialization',
      },
    ],
  })) as DirectToolResult;

  if (result.isError) {
    throw new Error(directToolText(result));
  }

  const data = parseFetchResult(result, kind);
  if (!data.localPath) {
    throw new Error('ghGetFileContent did not return a localPath.');
  }

  const localPath = path.resolve(data.localPath);
  const repoRoot = path.resolve(data.repoRoot ?? data.localPath);
  const hints = localResearchHints({
    localPath,
    repoRoot,
    kind: request.kind,
  });

  return {
    owner: repo.owner,
    repo: repo.repo,
    ...(data.resolvedBranch || repo.branch
      ? { branch: data.resolvedBranch ?? repo.branch }
      : {}),
    requestedPath,
    localPath,
    repoRoot,
    source: 'tree',
    complete: true,
    cached: Boolean(data.cached),
    hints: mergeMaterializationHints(structuredHints(result), hints),
  };
}

export function isFullRepoOption(options: {
  readonly repo?: string;
  readonly owner?: string;
}): boolean {
  return Boolean(
    options.repo?.includes('/') || (!options.owner && options.repo)
  );
}
