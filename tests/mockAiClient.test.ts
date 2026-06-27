import { afterEach, describe, expect, it, vi } from 'vitest';
import { FatalError, MockAiClient, RetryableError } from '../src/clients/mockAiClient';

vi.mock('../src/config', () => ({
  config: {
    maxRequestsPerSecond: 100,
    requestTimeoutMs: 30_000,
  },
}));

describe('MockAiClient single attempt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the mock response on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          id: 'prompt-1',
          output: 'Mock response for: hello',
          tokensUsed: 1,
        }),
      })),
    );

    const client = new MockAiClient('http://localhost:3000');
    const response = await client.completeOnce({ id: 'prompt-1', text: 'hello' });

    expect(response.output).toBe('Mock response for: hello');
  });

  it('throws RetryableError on 429 without retrying', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 429,
      ok: false,
      json: async () => ({ error: 'Rate limit exceeded' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new MockAiClient('http://localhost:3000');

    await expect(client.completeOnce({ id: 'prompt-1', text: 'hello' })).rejects.toThrow(
      RetryableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws FatalError on timeout without retrying', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }),
    );

    const client = new MockAiClient('http://localhost:3000');

    await expect(client.completeOnce({ id: 'prompt-1', text: 'hello' })).rejects.toThrow(
      FatalError,
    );
  });
});
