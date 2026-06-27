import { MockCompleteResponse, Prompt, PromptStatus } from '../types';
import { config } from '../config';
import { TokenBucket } from '../limiters/tokenBucket';

export class MockAiClient {
  private readonly rateLimiter: TokenBucket;

  constructor(private readonly baseUrl: string) {
    this.rateLimiter = new TokenBucket(
      config.maxRequestsPerSecond,
      config.maxRequestsPerSecond,
    );
  }

  async completeOnce(prompt: Prompt): Promise<MockCompleteResponse> {
    await this.rateLimiter.acquire();
    return this.callWithTimeout(prompt);
  }

  private async callWithTimeout(prompt: Prompt): Promise<MockCompleteResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/mock/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prompt.id, prompt: prompt.text }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new RetryableError('Rate limit exceeded', 'rate_limited');
      }

      if (response.status === 503) {
        throw new RetryableError('Service unavailable', 'error');
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new FatalError(body.error ?? `HTTP ${response.status}`, 'error');
      }

      return (await response.json()) as MockCompleteResponse;
    } catch (error) {
      if (error instanceof RetryableError || error instanceof FatalError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FatalError('Request timed out', 'timeout');
      }
      throw new FatalError(
        error instanceof Error ? error.message : 'Request failed',
        'error',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly status: PromptStatus,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class FatalError extends Error {
  constructor(
    message: string,
    readonly status: PromptStatus,
  ) {
    super(message);
    this.name = 'FatalError';
  }
}

export function parseClientError(error: unknown): {
  message: string;
  status: PromptStatus;
  retryable: boolean;
} {
  if (error instanceof RetryableError) {
    return { message: error.message, status: error.status, retryable: true };
  }
  if (error instanceof FatalError) {
    return { message: error.message, status: error.status, retryable: false };
  }
  return {
    message: error instanceof Error ? error.message : 'Unknown error',
    status: 'error',
    retryable: false,
  };
}
