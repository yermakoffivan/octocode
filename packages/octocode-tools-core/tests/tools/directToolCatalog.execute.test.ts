import { describe, expect, it } from 'vitest';

import { executeDirectTool } from '../../src/tools/directToolCatalog.js';
import { STATIC_TOOL_NAMES } from '../../src/tools/toolNames.js';

describe('executeDirectTool - invalid input handling (finding 3)', () => {
  it('returns a structured error result instead of throwing for invalid input', async () => {
    // A primitive is invalid for every tool's object input schema, so the
    // parse fails. It must surface as a structured CallToolResult error, not a
    // thrown exception (which diverges from the execution-error path).
    const result = await executeDirectTool(
      STATIC_TOOL_NAMES.LOCAL_FIND_FILES,
      'not-an-object'
    );

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as
      | { status?: string; tool?: string }
      | undefined;
    expect(structured?.status).toBe('error');
    expect(structured?.tool).toBe(STATIC_TOOL_NAMES.LOCAL_FIND_FILES);
  });

  it('still throws for an unknown tool name', async () => {
    await expect(
      executeDirectTool('definitely-not-a-real-tool', {})
    ).rejects.toThrow(/Unknown tool/);
  });
});
