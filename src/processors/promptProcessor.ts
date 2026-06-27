import { Prompt, PromptResult } from '../types';
import { config } from '../config';
import { ConcurrencyPool } from '../limiters/concurrencyPool';
import { MockAiClient } from '../clients/mockAiClient';

export class PromptProcessor {
  private readonly pool: ConcurrencyPool;
  private readonly client: MockAiClient;

  constructor(baseUrl: string) {
    this.pool = new ConcurrencyPool(config.maxConcurrency);
    this.client = new MockAiClient(baseUrl);
  }

  async processBatch(prompts: Prompt[]): Promise<PromptResult[]> {
    const tasks = prompts.map((prompt) =>
      this.pool.run(() => this.client.complete(prompt)),
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
}
