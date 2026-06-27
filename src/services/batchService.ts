import { randomUUID } from 'crypto';
import { BatchAcknowledgement, BatchJob, Prompt } from '../types';
import { readPromptsFromFile } from '../readers/fileReader';
import { PromptProcessor } from '../processors/promptProcessor';
import { aggregateResults } from '../aggregators/resultAggregator';
import { config } from '../config';

const jobs = new Map<string, BatchJob>();

export async function ingestBatchFromFile(
  filePath: string,
  baseUrl: string,
): Promise<BatchAcknowledgement> {
  const prompts = await readPromptsFromFile(filePath);
  const batchId = randomUUID();
  const acceptedAt = new Date().toISOString();

  const job: BatchJob = {
    batchId,
    status: 'pending',
    source: filePath,
    promptCount: prompts.length,
    acceptedAt,
  };

  jobs.set(batchId, job);
  startBackgroundProcessing(batchId, prompts, baseUrl);

  return {
    batchId,
    status: 'accepted',
    promptCount: prompts.length,
    source: filePath,
    message: 'Batch accepted for processing',
  };
}

export function getBatchJob(batchId: string): BatchJob | undefined {
  return jobs.get(batchId);
}

function startBackgroundProcessing(
  batchId: string,
  prompts: Prompt[],
  baseUrl: string,
): void {
  void (async () => {
    const job = jobs.get(batchId);
    if (!job) {
      return;
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();

    try {
      const processor = new PromptProcessor(baseUrl);
      const results = await processor.processBatch(prompts);
      job.result = aggregateResults(prompts, results);
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Processing failed';
      job.completedAt = new Date().toISOString();
    }
  })();
}

export function ingestBatchFromDefaultFile(baseUrl: string): Promise<BatchAcknowledgement> {
  return ingestBatchFromFile(config.promptsFilePath, baseUrl);
}
