import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create429ThenSuccessFetch } from './helpers/mockFetch';

vi.mock('../src/config', () => ({
  config: {
    maxConcurrency: 5,
    maxRetries: 3,
    maxRequestsPerSecond: 100,
    requestTimeoutMs: 30_000,
  },
}));

import { PromptProcessor } from '../src/processors/promptProcessor';

describe('PromptProcessor 429 retry and backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries after 429 and succeeds without marking the prompt failed', async () => {
    const fetchMock = create429ThenSuccessFetch(2, {
      id: 'prompt-1',
      output: 'Mock response for: hello',
      tokensUsed: 1,
    });
    vi.stubGlobal('fetch', fetchMock);

    const processor = new PromptProcessor('http://localhost:3000');
    const resultPromise = processor.processBatch([{ id: 'prompt-1', text: 'hello' }]);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const [result] = await resultPromise;

    expect(result.status).toBe('success');
    expect(result.output).toBe('Mock response for: hello');
    expect(result.attemptCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff sleeps between 429 retries', async () => {
    const fetchMock = create429ThenSuccessFetch(2, {
      id: 'prompt-1',
      output: 'ok',
      tokensUsed: 1,
    });
    vi.stubGlobal('fetch', fetchMock);

    const processor = new PromptProcessor('http://localhost:3000');
    const resultPromise = processor.processBatch([{ id: 'prompt-1', text: 'hello' }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [result] = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.attemptCount).toBe(3);
  });

  it('marks prompt rate_limited only after all retries are exhausted', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 429,
      ok: false,
      json: async () => ({ error: 'Rate limit exceeded' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const processor = new PromptProcessor('http://localhost:3000');
    const resultPromise = processor.processBatch([{ id: 'prompt-1', text: 'hello' }]);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);

    const [result] = await resultPromise;

    expect(result.status).toBe('rate_limited');
    expect(result.error).toBe('Rate limit exceeded');
    expect(result.attemptCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
