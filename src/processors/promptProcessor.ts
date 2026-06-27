import { Prompt, PromptResult, PromptStatus } from '../types';
import { config } from '../config';
import { ConcurrencyPool } from '../limiters/concurrencyPool';
import { MockAiClient, parseClientError } from '../clients/mockAiClient';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PromptProcessor {
  private readonly pool: ConcurrencyPool;
  private readonly client: MockAiClient;

  constructor(baseUrl: string) {
    this.pool = new ConcurrencyPool(config.maxConcurrency);
    this.client = new MockAiClient(baseUrl);
  }

  async processBatch(prompts: Prompt[]): Promise<PromptResult[]> {
    const tasks = prompts.map((prompt) =>
      this.pool.run(() => this.processPrompt(prompt)),
    );

    const settled = await Promise.allSettled(tasks);

    return settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        id: prompts[index].id,
        status: 'error' as const,
        error: result.reason instanceof Error ? result.reason.message : 'Processing failed',
        latencyMs: 0,
        attemptCount: 0,
      };
    });
  }

  private async processPrompt(prompt: Prompt): Promise<PromptResult> {
    const start = Date.now();
    let attemptCount = 0;
    let lastError = 'Unknown error';
    let lastStatus: PromptStatus = 'error';

    while (attemptCount < config.maxRetries) {
      attemptCount += 1;

      try {
        const response = await this.client.completeOnce(prompt);
        return {
          id: prompt.id,
          status: 'success',
          output: response.output,
          latencyMs: Date.now() - start,
          attemptCount,
        };
      } catch (error) {
        const parsed = parseClientError(error);
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
}
