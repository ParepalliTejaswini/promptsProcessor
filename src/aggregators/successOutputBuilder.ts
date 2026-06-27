import { AggregatedResult, BatchOutputDocument, Prompt, SuccessfulInference } from '../types';

export function buildSuccessOutput(
  batchId: string,
  source: string,
  prompts: Prompt[],
  aggregated: AggregatedResult,
  completedAt: string,
): BatchOutputDocument {
  const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  const inferences: SuccessfulInference[] = aggregated.results
    .filter((result) => result.status === 'success' && result.output !== undefined)
    .map((result) => ({
      promptId: result.id,
      promptText: promptById.get(result.id)?.text ?? '',
      output: result.output!,
      latencyMs: result.latencyMs,
      attemptCount: result.attemptCount,
      completedAt,
    }));

  return {
    batchId,
    completedAt,
    source,
    summary: {
      total: aggregated.total,
      succeeded: aggregated.succeeded,
      failed: aggregated.failed,
      rateLimited: aggregated.rateLimited,
      avgLatencyMs: aggregated.avgLatencyMs,
    },
    inferences,
  };
}
