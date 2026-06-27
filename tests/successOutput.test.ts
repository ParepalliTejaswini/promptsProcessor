import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSuccessOutput } from '../src/aggregators/successOutputBuilder';
import {
  getBatchOutputDocument,
  initLocalDatabase,
  resetLocalDatabaseForTests,
  saveBatchOutput,
} from '../src/db/localDatabase';
import { AggregatedResult, Prompt } from '../src/types';

describe('buildSuccessOutput', () => {
  it('builds JSON output with only successful inferences', () => {
    const prompts: Prompt[] = [
      { id: 'p1', text: 'Hello' },
      { id: 'p2', text: 'Fail case' },
    ];

    const aggregated: AggregatedResult = {
      total: 2,
      succeeded: 1,
      failed: 1,
      rateLimited: 0,
      avgLatencyMs: 100,
      results: [
        {
          id: 'p1',
          status: 'success',
          output: 'Mock response for: Hello',
          latencyMs: 100,
          attemptCount: 1,
        },
        {
          id: 'p2',
          status: 'rate_limited',
          error: 'Rate limit exceeded',
          latencyMs: 3000,
          attemptCount: 3,
        },
      ],
    };

    const document = buildSuccessOutput(
      'batch-123',
      '/app/prompts.json',
      prompts,
      aggregated,
      '2026-06-27T12:00:00.000Z',
    );

    expect(document.batchId).toBe('batch-123');
    expect(document.summary.succeeded).toBe(1);
    expect(document.inferences).toHaveLength(1);
    expect(document.inferences[0]).toEqual({
      promptId: 'p1',
      promptText: 'Hello',
      output: 'Mock response for: Hello',
      latencyMs: 100,
      attemptCount: 1,
      completedAt: '2026-06-27T12:00:00.000Z',
    });
  });
});

describe('localDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-db-test-'));
  });

  afterEach(() => {
    resetLocalDatabaseForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves successful inferences to sqlite and a json file on batch completion', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const outputDir = path.join(tempDir, 'outputs');

    const document = buildSuccessOutput(
      'batch-456',
      '/app/prompts.json',
      [{ id: 'p1', text: 'Test prompt' }],
      {
        total: 1,
        succeeded: 1,
        failed: 0,
        rateLimited: 0,
        avgLatencyMs: 250,
        results: [
          {
            id: 'p1',
            status: 'success',
            output: 'Done',
            latencyMs: 250,
            attemptCount: 1,
          },
        ],
      },
      '2026-06-27T12:00:00.000Z',
    );

    const outputFile = saveBatchOutput(document, { databasePath: dbPath, outputDir });

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(getBatchOutputDocument('batch-456', outputDir)).toEqual(document);

    const database = initLocalDatabase(dbPath);
    const batchRow = database
      .prepare('SELECT batch_id, succeeded, output_file FROM batches WHERE batch_id = ?')
      .get('batch-456') as { batch_id: string; succeeded: number; output_file: string };

    const inferenceRows = database
      .prepare('SELECT prompt_id, output FROM inferences WHERE batch_id = ?')
      .all('batch-456') as Array<{ prompt_id: string; output: string }>;

    expect(batchRow.succeeded).toBe(1);
    expect(batchRow.output_file).toBe(outputFile);
    expect(inferenceRows).toEqual([{ prompt_id: 'p1', output: 'Done' }]);
  });
});
