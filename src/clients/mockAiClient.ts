import { MockCompleteResponse, Prompt, PromptResult, PromptStatus } from '../types';
import { config } from '../config';
import { TokenBucket } from '../limiters/tokenBucket';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockAiClient {
  private readonly rateLimiter: TokenBucket;

  constructor(private readonly baseUrl: string) {
    this.rateLimiter = new TokenBucket(
      config.maxRequestsPerSecond,
      config.maxRequestsPerSecond,
    );
  }

  async complete(prompt: Prompt): Promise<PromptResult> {
    const start = Date.now();
    let attemptCount = 0;
    let lastError = 'Unknown error';
    let lastStatus: PromptStatus = 'error';

    while (attemptCount < config.maxRetries) {
      attemptCount += 1;

      try {
        await this.rateLimiter.acquire();
        const response = await this.callWithTimeout(prompt);
        return {
          id: prompt.id,
          status: 'success',
          output: response.output,
          latencyMs: Date.now() - start,
          attemptCount,
        };
      } catch (error) {
        const parsed = parseError(error);
        lastError = parsed.message;
        lastStatus = parsed.status;

        if (!parsed.retryable || attemptCount >= config.maxRetries) {
          break;
        }

        const backoffMs = Math.min(1000 * 2 ** (attemptCount - 1), 8000);
        await sleep(backoffMs);
      }
    }

    return {
      id: prompt.id,
      status: lastStatus,
      error: lastError,
      latencyMs: Date.now() - start,
      attemptCount,
    };
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

class RetryableError extends Error {
  constructor(
    message: string,
    readonly status: PromptStatus,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

class FatalError extends Error {
  constructor(
    message: string,
    readonly status: PromptStatus,
  ) {
    super(message);
    this.name = 'FatalError';
  }
}

function parseError(error: unknown): {
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
