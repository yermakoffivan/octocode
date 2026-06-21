import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from 'octokit';

// logRateLimit is best-effort; mock it so we can assert it is called and so we
// can make it reject to prove the call site swallows rejections.
const logRateLimitMock = vi.fn();
vi.mock('../../src/session.js', () => ({
  logRateLimit: (...args: unknown[]) => logRateLimitMock(...args),
}));

import { handleGitHubAPIError } from '../../src/github/errors.js';

function makeRequestError(
  status: number,
  message: string,
  headers: Record<string, unknown>,
  data: unknown = {}
): RequestError {
  return new RequestError(message, status, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/x',
      headers: headers as never,
      data,
    },
  });
}

describe('handleGitHubAPIError - 403 rate-limit header parsing', () => {
  beforeEach(() => {
    logRateLimitMock.mockReset();
    logRateLimitMock.mockResolvedValue(undefined);
  });

  it('treats string "0" remaining as a primary rate limit', () => {
    const result = handleGitHubAPIError(
      makeRequestError(403, 'forbidden', {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      })
    );

    expect(result.error).toContain('rate limit exceeded');
    expect(result.rateLimitRemaining).toBe(0);
  });

  it('treats numeric 0 remaining as a primary rate limit (not a permission error)', () => {
    const result = handleGitHubAPIError(
      makeRequestError(403, 'forbidden', {
        'x-ratelimit-remaining': 0,
        'x-ratelimit-reset': Math.floor(Date.now() / 1000) + 60,
      })
    );

    expect(result.error).toContain('rate limit exceeded');
    expect(result.rateLimitRemaining).toBe(0);
  });

  it('treats nonzero remaining as a permission error', () => {
    const result = handleGitHubAPIError(
      makeRequestError(403, 'forbidden', {
        'x-ratelimit-remaining': 42,
      })
    );

    expect(result.error).toContain('Access forbidden');
  });
});

describe('handleGitHubAPIError - rate-limit logging is best-effort', () => {
  beforeEach(() => {
    logRateLimitMock.mockReset();
    logRateLimitMock.mockResolvedValue(undefined);
  });

  it('does not throw or reject when logRateLimit rejects (429 primary)', async () => {
    logRateLimitMock.mockRejectedValue(new Error('logging down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);

    expect(() =>
      handleGitHubAPIError(
        makeRequestError(429, 'too many', {
          'retry-after': '30',
        })
      )
    ).not.toThrow();
    expect(logRateLimitMock).toHaveBeenCalledTimes(1);

    // Allow any pending microtasks / rejections to surface.
    await new Promise(resolve => setTimeout(resolve, 0));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toHaveLength(0);
  });

  it('does not throw when logRateLimit rejects (403 secondary)', async () => {
    logRateLimitMock.mockRejectedValue(new Error('logging down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);

    expect(() =>
      handleGitHubAPIError(
        makeRequestError(403, 'You have exceeded a secondary rate limit', {
          'retry-after': '30',
        })
      )
    ).not.toThrow();

    await new Promise(resolve => setTimeout(resolve, 0));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toHaveLength(0);
  });
});
