import { describe, it, expect } from 'vitest';

import { createErrorResult } from '../../../octocode-tools-core/src/utils/response/error.js';
import { ToolError } from '../../../octocode-tools-core/src/errors/ToolError.js';
import { LOCAL_TOOL_ERROR_CODES } from '../../../octocode-tools-core/src/errors/localToolErrors.js';

const baseQuery = {
  researchGoal: 'test',
  reasoning: 'test',
};

describe('createErrorResult - branch coverage', () => {
  describe('isGitHubApiError detection', () => {
    it('should detect GitHubAPIError with "type" field', () => {
      const apiError = { error: 'Not Found', type: 'NOT_FOUND' };
      const result = createErrorResult(apiError, baseQuery);
      expect(result.error).toBe(apiError);
      // No 'API Error' echo hint — raw error string is not re-emitted as a hint
    });

    it('should detect GitHubAPIError with "status" field', () => {
      const apiError = { error: 'Rate limited', status: 429 };
      const result = createErrorResult(apiError, baseQuery);
      expect(result.error).toBe(apiError);
    });

    it('should detect GitHubAPIError with "scopesSuggestion" field', () => {
      const apiError = {
        error: 'Forbidden',
        scopesSuggestion: 'Add repo scope',
      };
      const result = createErrorResult(apiError, baseQuery);
      expect(result.error).toBe(apiError);
    });
  });

  describe('unknown error type (else branch)', () => {
    it('should handle non-Error non-string non-object error', () => {
      const result = createErrorResult(42, baseQuery);
      expect(result.error).toBe('Unknown error occurred');
    });

    it('should handle null error', () => {
      const result = createErrorResult(null, baseQuery);
      expect(result.error).toBe('Unknown error occurred');
    });

    it('should handle boolean error', () => {
      const result = createErrorResult(false, baseQuery);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('extra fields merging', () => {
    it('should spread extra fields into result', () => {
      const result = createErrorResult('some error', baseQuery, {
        extra: { cwd: '/test', resolvedPath: '/test/file.ts' },
      });
      expect(result.cwd).toBe('/test');
      expect(result.resolvedPath).toBe('/test/file.ts');
    });
  });

  describe('Error instance handling', () => {
    it('should convert plain Error to ToolError with hints', () => {
      const error = new Error('Something failed');
      const result = createErrorResult(error, baseQuery, {
        toolName: 'LOCAL_FETCH_CONTENT',
      });
      expect(result.error).toBe('Something failed');
      expect(result.errorCode).toBeDefined();
    });

    it('should skip tool hints when toolName is empty (line 105 false branch)', () => {
      const error = new Error('Something failed');
      const result = createErrorResult(error, baseQuery, {
        toolName: '',
      });
      expect(result.error).toBe('Something failed');
    });

    it('should skip tool hints when ToolError is passed with empty toolName (line 105 ToolError false branch)', () => {
      const toolError = new ToolError(
        LOCAL_TOOL_ERROR_CODES.COMMAND_EXECUTION_FAILED,
        'Tool failed'
      );
      const result = createErrorResult(toolError, baseQuery, {
        toolName: '',
      });
      expect(result.error).toBe('Tool failed');
    });
  });
});
