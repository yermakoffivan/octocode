import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('toolMetadata/proxies', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('TOOL_NAMES proxy', () => {
    it('should return tool names from metadata', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(TOOL_NAMES.GITHUB_SEARCH_CODE).toBe('ghSearchCode');
    });

    it('should fallback to static names when not initialized', async () => {
      const { _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();

      expect(typeof TOOL_NAMES.GITHUB_SEARCH_CODE).toBe('string');
    });

    it('should support Object.keys enumeration', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      const keys = Object.keys(TOOL_NAMES);
      expect(keys).toContain('GITHUB_SEARCH_CODE');
    });

    it('should support getOwnPropertyDescriptor', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      const descriptor = Object.getOwnPropertyDescriptor(
        TOOL_NAMES,
        'GITHUB_SEARCH_CODE'
      );
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
    });

    it('should return undefined for unknown tools', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { TOOL_NAMES } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      const descriptor = Object.getOwnPropertyDescriptor(
        TOOL_NAMES,
        'UNKNOWN_TOOL'
      );
      expect(descriptor).toBeUndefined();
    });
  });

  describe('BASE_SCHEMA proxy', () => {
    it('should return schema fields after init', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { BASE_SCHEMA } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(typeof BASE_SCHEMA.mainResearchGoal).toBe('string');
      expect(BASE_SCHEMA.mainResearchGoal.length).toBeGreaterThan(0);
      expect(typeof BASE_SCHEMA.researchGoal).toBe('string');
      expect(BASE_SCHEMA.researchGoal.length).toBeGreaterThan(0);
    });

    it('should read base schema from completeMetadata when state is reset', async () => {
      const { _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { BASE_SCHEMA } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();

      expect(typeof BASE_SCHEMA.mainResearchGoal).toBe('string');
      expect(BASE_SCHEMA.mainResearchGoal.length).toBeGreaterThan(0);
    });
  });

  describe('DESCRIPTIONS proxy', () => {
    it('should return tool description', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(typeof DESCRIPTIONS['ghSearchCode']).toBe('string');
      expect(DESCRIPTIONS['ghSearchCode'].length).toBeGreaterThan(0);
    });

    it('should return empty string for unknown tool', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { DESCRIPTIONS } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(DESCRIPTIONS['unknownTool']).toBe('');
    });
  });

  describe('isToolInMetadata', () => {
    it('should return true for existing tool', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { isToolInMetadata } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(isToolInMetadata('ghSearchCode')).toBe(true);
    });

    it('should return false for non-existent tool', async () => {
      const { initializeToolMetadata, _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { isToolInMetadata } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();
      await initializeToolMetadata();

      expect(isToolInMetadata('unknownTool')).toBe(false);
    });

    it('should use completeMetadata.tools when state is reset', async () => {
      const { _resetMetadataState } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/state.js');
      const { isToolInMetadata } =
        await import('../../../../octocode-tools-core/src/tools/toolMetadata/proxies.js');
      _resetMetadataState();

      expect(isToolInMetadata('ghSearchCode')).toBe(true);
    });
  });
});
