import { beforeEach, describe, expect, it, vi } from 'vitest';

const logSessionErrorMock = vi.fn();
vi.mock('../../src/session.js', () => ({
  logSessionError: (...args: unknown[]) => logSessionErrorMock(...args),
}));

import { handleCatchError } from '../../src/tools/utils.js';

describe('handleCatchError - toolName routing (finding 4)', () => {
  beforeEach(() => {
    logSessionErrorMock.mockReset();
    logSessionErrorMock.mockResolvedValue(undefined);
  });

  it('logs the session error under the provided toolName', () => {
    handleCatchError(new Error('boom'), {}, undefined, 'githubSearchCode');
    expect(logSessionErrorMock).toHaveBeenCalledTimes(1);
    expect(logSessionErrorMock.mock.calls[0]?.[0]).toBe('githubSearchCode');
  });

  it('falls back to "unknown_tool" when no toolName or contextMessage is given', () => {
    handleCatchError(new Error('boom'), {});
    expect(logSessionErrorMock).toHaveBeenCalledTimes(1);
    expect(logSessionErrorMock.mock.calls[0]?.[0]).toBe('unknown_tool');
  });
});
