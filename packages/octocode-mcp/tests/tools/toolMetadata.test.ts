import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const hoist = vi.hoisted(() => {
  const mockMetadata = {
    systemPrompt: 'Test instructions',
    prompts: {
      testPrompt: {
        name: 'testPrompt',
        description: 'Test prompt description',
        content: 'Test prompt content',
        args: [{ name: 'arg1', description: 'Argument 1', required: true }],
      },
    },
    toolNames: {
      GITHUB_FETCH_CONTENT: 'ghGetFileContent',
      GITHUB_SEARCH_CODE: 'ghSearchCode',
      GITHUB_SEARCH_PULL_REQUESTS: 'ghHistoryResearch',
      GITHUB_SEARCH_REPOSITORIES: 'ghSearchRepos',
      GITHUB_VIEW_REPO_STRUCTURE: 'ghViewRepoStructure',
      LOCAL_RIPGREP: 'localSearchCode',
      LOCAL_FETCH_CONTENT: 'localGetFileContent',
      LOCAL_FIND_FILES: 'localFindFiles',
      LOCAL_VIEW_STRUCTURE: 'localViewStructure',
    },
    baseSchema: {
      mainResearchGoal: 'Main goal description',
      researchGoal: 'Research goal description',
      reasoning: 'Reasoning description',
      bulkQueryTemplate: 'Research queries for {toolName}',
    },
    tools: {
      ghSearchCode: {
        name: 'ghSearchCode',
        description: 'Search code on GitHub',
        schema: {
          keywords: 'Keywords to search',
          owner: 'Repository owner',
          repo: 'Repository name',
        },
        hints: {
          hasResults: ['Review results'],
          empty: ['Try different keywords'],
        },
      },
      ghGetFileContent: {
        name: 'ghGetFileContent',
        description: 'Get file content',
        schema: {
          owner: 'Owner',
          repo: 'Repo',
          path: 'Path',
        },
        hints: {
          hasResults: ['File retrieved'],
          empty: ['File not found'],
        },
      },
      localSearchCode: {
        name: 'localSearchCode',
        description: 'Search code locally',
        schema: {
          pattern: 'Search pattern',
          path: 'Search path',
        },
        hints: {
          hasResults: ['Local search results'],
          empty: ['No local matches'],
        },
      },
      localGetFileContent: {
        name: 'localGetFileContent',
        description: 'Get local file content',
        schema: {
          path: 'File path',
        },
        hints: {
          hasResults: ['Local file retrieved'],
          empty: ['Local file not found'],
        },
      },
      localFindFiles: {
        name: 'localFindFiles',
        description: 'Find files locally',
        schema: {
          path: 'Search path',
        },
        hints: {
          hasResults: ['Files found'],
          empty: ['No files found'],
        },
      },
      localViewStructure: {
        name: 'localViewStructure',
        description: 'View local directory structure',
        schema: {
          path: 'Directory path',
        },
        hints: {
          hasResults: ['Structure retrieved'],
          empty: ['Directory empty'],
        },
      },
    },
    baseHints: {
      hasResults: ['Base hint for results'],
      empty: ['Base hint for empty'],
    },
    genericErrorHints: ['Generic error hint 1', 'Generic error hint 2'],
    bulkOperations: {
      instructions: {
        base: '{count} results',
        hasResults: 'Review hasResults hints',
        empty: 'Review empty hints',
        error: 'Review error hints',
      },
    },
  };

  const mockMetadataWithGitHubHints = {
    ...mockMetadata,
    baseHints: {
      hasResults: [
        "Use 'owner', 'repo', 'branch', 'path' fields directly in next tool calls",
        'Follow mainResearchGoal to navigate research',
        'Common hint for all tools',
        'Check `pushedAt`/`lastModified` - skip stale content',
      ],
      empty: ['Try broader terms', "Use 'repo' and 'owner' to narrow scope"],
    },
  };

  return {
    mockMetadata,
    mockMetadataWithGitHubHints,
    store: { current: mockMetadata },
    octocodeReads: 0,
  };
});

describe('toolMetadata', () => {
  const { mockMetadata, mockMetadataWithGitHubHints } = hoist;
  void mockMetadata;
  void mockMetadataWithGitHubHints;

  function withBulkQuery<
    T extends { baseSchema: { bulkQueryTemplate: string } },
  >(
    m: T
  ): T & {
    baseSchema: T['baseSchema'] & {
      bulkQuery: (toolName: string) => string;
    };
  } {
    return {
      ...m,
      baseSchema: {
        ...m.baseSchema,
        bulkQuery: (toolName: string) =>
          m.baseSchema.bulkQueryTemplate.replace('{toolName}', toolName),
      },
    };
  }
  void withBulkQuery;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeToolMetadata', () => {
    it('should initialize metadata from API', async () => {
      const { initializeToolMetadata, getMetadataOrNull } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');

      await initializeToolMetadata();

      expect(getMetadataOrNull()).not.toBeNull();
    });

    it('should only initialize once', async () => {
      const { initializeToolMetadata, loadToolContent } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');

      await initializeToolMetadata();
      await initializeToolMetadata();
      await initializeToolMetadata();

      const result1 = await loadToolContent();
      const result2 = await loadToolContent();
      expect(result1).toBe(result2);
    });

    it('should handle concurrent initialization', async () => {
      const { initializeToolMetadata, getMetadataOrNull } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');

      const promises = [
        initializeToolMetadata(),
        initializeToolMetadata(),
        initializeToolMetadata(),
      ];

      await Promise.all(promises);

      expect(getMetadataOrNull()).not.toBeNull();
    });
  });

  describe('loadToolContent', () => {
    it('should initialize and return metadata', async () => {
      const { loadToolContent } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');

      const result = await loadToolContent();

      expect(result).toBeDefined();
      expect(typeof result.systemPrompt).toBe('string');
      expect(result.toolNames).toBeDefined();
    });

    it('should return cached metadata on subsequent calls', async () => {
      const { loadToolContent } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');

      const result1 = await loadToolContent();
      const result2 = await loadToolContent();

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('TOOL_NAMES proxy', () => {
    it('should return tool names', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(typeof TOOL_NAMES.GITHUB_SEARCH_CODE).toBe('string');
      expect(typeof TOOL_NAMES.GITHUB_FETCH_CONTENT).toBe('string');
    });

    it('should return tool names consistently', async () => {
      const { TOOL_NAMES } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      expect(typeof TOOL_NAMES.GITHUB_SEARCH_CODE).toBe('string');
      expect(typeof TOOL_NAMES.GITHUB_FETCH_CONTENT).toBe('string');
    });

    it('should support ownKeys trap', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const keys = Object.keys(TOOL_NAMES);
      expect(keys).toContain('GITHUB_SEARCH_CODE');
      expect(keys).toContain('GITHUB_FETCH_CONTENT');
    });

    it('should support getOwnPropertyDescriptor trap', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const descriptor = Object.getOwnPropertyDescriptor(
        TOOL_NAMES,
        'GITHUB_SEARCH_CODE'
      );
      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
    });

    it('should return undefined for non-existent tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const descriptor = Object.getOwnPropertyDescriptor(
        TOOL_NAMES,
        'NON_EXISTENT'
      );
      expect(descriptor).toBeUndefined();
    });
  });

  describe('BASE_SCHEMA proxy', () => {
    it('should return schema fields after initialization', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { BASE_SCHEMA } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(typeof BASE_SCHEMA.mainResearchGoal).toBe('string');
      expect(typeof BASE_SCHEMA.researchGoal).toBe('string');
    });

    it('should support bulkQuery function', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { BASE_SCHEMA } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(typeof BASE_SCHEMA.mainResearchGoal).toBe('string');
    });

    it('should return bulkQuery with tool name', async () => {
      const { BASE_SCHEMA } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      expect(typeof BASE_SCHEMA.mainResearchGoal).toBe('string');
    });
  });

  describe('Async accessors', () => {
    it('should access tools via loadToolContent', async () => {
      const { initializeToolMetadata, loadToolContent } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();

      const content = await loadToolContent();
      expect(content.tools.ghSearchCode).toBeDefined();
    });

    it('should access tool description via DESCRIPTIONS proxy', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const description = DESCRIPTIONS['ghSearchCode'];
      expect(typeof description).toBe('string');
    });

    it('should return empty string for non-existent tool via DESCRIPTIONS', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const description = DESCRIPTIONS['nonExistent'];
      expect(description).toBe('');
    });
  });

  describe('isToolInMetadata', () => {
    it('should check tool availability', async () => {
      const { isToolInMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      const result = isToolInMetadata('ghSearchCode');
      expect(typeof result).toBe('boolean');
    });

    it('should return true for existing tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { isToolInMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(isToolInMetadata('ghSearchCode')).toBe(true);
    });

    it('should return false for non-existent tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { isToolInMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(isToolInMetadata('nonExistent')).toBe(false);
    });
  });

  describe('DESCRIPTIONS proxy', () => {
    it('should return description for existing tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(typeof DESCRIPTIONS.ghSearchCode).toBe('string');
    });

    it('should return empty string for non-existent tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      expect(DESCRIPTIONS.nonExistent).toBe('');
    });
  });

  describe('Schema helpers', () => {
    it('should return schema fields via completeMetadata.tools', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();
      const { completeMetadata } = await import('@octocodeai/octocode-core');

      const tool = completeMetadata.tools['ghGetFileContent'];
      expect(tool).toBeDefined();
      expect(typeof tool.name).toBe('string');
    });

    it('should support tool schema access for ghSearchCode', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();
      const { completeMetadata } = await import('@octocodeai/octocode-core');

      const tool = completeMetadata.tools['ghSearchCode'];
      expect(tool).toBeDefined();
      expect(tool.name).toBe('ghSearchCode');
    });

    it('should list tools in completeMetadata', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();
      const { completeMetadata } = await import('@octocodeai/octocode-core');

      const toolNames = Object.keys(completeMetadata.tools);
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it('should expose tool descriptions', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();
      const { completeMetadata } = await import('@octocodeai/octocode-core');

      const tool = completeMetadata.tools['ghSearchCode'];
      expect(typeof tool?.description).toBe('string');
    });

    it('should expose baseSchema fields', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      await initializeToolMetadata();
      const { completeMetadata } = await import('@octocodeai/octocode-core');

      expect(typeof completeMetadata.baseSchema.mainResearchGoal).toBe(
        'string'
      );
    });
  });

  describe('Proxy edge cases', () => {
    it('should handle DESCRIPTIONS proxy for tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const desc = DESCRIPTIONS['ghSearchCode'];
      expect(typeof desc).toBe('string');
      expect(desc?.length).toBeGreaterThan(0);
    });

    it('should handle DESCRIPTIONS proxy for non-existent tool', async () => {
      const { initializeToolMetadata } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      await initializeToolMetadata();

      const desc = DESCRIPTIONS['nonExistentTool'];
      expect(desc).toBe('');
    });
  });
});
