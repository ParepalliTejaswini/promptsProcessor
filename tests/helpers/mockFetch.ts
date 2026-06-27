import { vi } from 'vitest';

export interface FetchResponseSpec {
  status: number;
  body?: Record<string, unknown>;
}

export function create429ThenSuccessFetch(
  failuresBeforeSuccess: number,
  successBody: Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  let callCount = 0;

  return vi.fn(async () => {
    callCount += 1;

    if (callCount <= failuresBeforeSuccess) {
      return {
        status: 429,
        ok: false,
        json: async () => ({ error: 'Rate limit exceeded' }),
      };
    }

    return {
      status: 200,
      ok: true,
      json: async () => successBody,
    };
  });
}

export function createPerPrompt429Fetch(
  failuresBeforeSuccess: number,
): ReturnType<typeof vi.fn> {
  const callCounts = new Map<string, number>();

  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: string; prompt: string };
    const attempt = (callCounts.get(body.id) ?? 0) + 1;
    callCounts.set(body.id, attempt);

    if (attempt <= failuresBeforeSuccess) {
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
        output: `Mock response for: ${body.prompt}`,
        tokensUsed: 1,
      }),
    };
  });
}
