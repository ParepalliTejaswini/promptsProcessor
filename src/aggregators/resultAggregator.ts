import { AggregatedResult, Prompt, PromptResult } from '../types';

export function aggregateResults(
  prompts: Prompt[],
  results: PromptResult[],
): AggregatedResult {
  const resultById = new Map(results.map((result) => [result.id, result]));
  const orderedResults = prompts.map(
    (prompt) =>
      resultById.get(prompt.id) ?? {
        id: prompt.id,
        status: 'error' as const,
        error: 'Missing result',
        latencyMs: 0,
        attemptCount: 0,
      },
  );

  const succeeded = orderedResults.filter((r) => r.status === 'success').length;
  const rateLimited = orderedResults.filter((r) => r.status === 'rate_limited').length;
  const failed = orderedResults.length - succeeded;

  const latencies = orderedResults
    .filter((r) => r.status === 'success')
    .map((r) => r.latencyMs);

  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : 0;

  return {
    total: orderedResults.length,
    succeeded,
    failed,
    rateLimited,
    avgLatencyMs,
    results: orderedResults,
  };
}
