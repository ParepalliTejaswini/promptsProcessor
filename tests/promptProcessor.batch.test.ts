import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerPrompt429Fetch } from './helpers/mockFetch';
import { aggregateResults } from '../src/aggregators/resultAggregator';

vi.mock('../src/config', () => ({
  config: {
    maxConcurrency: 3,
    maxRetries: 3,
    maxRequestsPerSecond: 100,
    requestTimeoutMs: 30_000,
  },
}));

import { PromptProcessor } from '../src/processors/promptProcessor';

describe('PromptProcessor batch resilience on 429', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('completes the full batch when prompts recover after 429 backoff', async () => {
    const fetchMock = createPerPrompt429Fetch(1);
    vi.stubGlobal('fetch', fetchMock);

    const prompts = [
      { id: 'prompt-1', text: 'First prompt' },
      { id: 'prompt-2', text: 'Second prompt' },
      { id: 'prompt-3', text: 'Third prompt' },
    ];

    const processor = new PromptProcessor('http://localhost:3000');
    const batchPromise = processor.processBatch(prompts);

    await vi.advanceTimersByTimeAsync(5_000);

    const results = await batchPromise;
    const aggregated = aggregateResults(prompts, results);

    expect(results).toHaveLength(3);
    expect(aggregated.total).toBe(3);
    expect(aggregated.succeeded).toBe(3);
    expect(aggregated.failed).toBe(0);
    expect(aggregated.rateLimited).toBe(0);
    expect(aggregated.results.every((result) => result.status === 'success')).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
  });

  it('does not drop prompts from the batch when some hit repeated 429s', async () => {
    const fetchMock = createPerPrompt429Fetch(1);
    vi.stubGlobal('fetch', fetchMock);

    const prompts = [
      { id: 'prompt-1', text: 'Always recovers' },
      { id: 'prompt-2', text: 'Always recovers' },
    ];

    const processor = new PromptProcessor('http://localhost:3000');
    const batchPromise = processor.processBatch(prompts);

    await vi.advanceTimersByTimeAsync(5_000);

    const results = await batchPromise;
    const aggregated = aggregateResults(prompts, results);

    expect(aggregated.results.map((result) => result.id)).toEqual(['prompt-1', 'prompt-2']);
    expect(aggregated.results.every((result) => result.id && result.status)).toBe(true);
    expect(aggregated.total).toBe(prompts.length);
  });

  it('returns a result entry for every prompt even when retries are exhausted', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: string };

      if (body.id === 'prompt-fail') {
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: 'Rate limit exceeded' }),
        };
      }

      return {
        status: 200,
        ok: true,
        json: async () => ({
          id: body.id,
          output: 'ok',
          tokensUsed: 1,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const prompts = [
      { id: 'prompt-ok', text: 'Succeeds immediately' },
      { id: 'prompt-fail', text: 'Never succeeds' },
    ];

    const processor = new PromptProcessor('http://localhost:3000');
    const batchPromise = processor.processBatch(prompts);

    await vi.advanceTimersByTimeAsync(10_000);

    const results = await batchPromise;
    const aggregated = aggregateResults(prompts, results);

    expect(results).toHaveLength(2);
    expect(aggregated.total).toBe(2);
    expect(aggregated.succeeded).toBe(1);
    expect(aggregated.rateLimited).toBe(1);
    expect(aggregated.results.find((result) => result.id === 'prompt-fail')?.status).toBe(
      'rate_limited',
    );
    expect(aggregated.results.find((result) => result.id === 'prompt-ok')?.status).toBe(
      'success',
    );
  });
});
