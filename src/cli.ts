import { config } from './config';

const baseUrl = process.env.MOCK_BASE_URL ?? `http://localhost:${config.port}`;
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1000);

async function main(): Promise<void> {
  const submitResponse = await fetch(`${baseUrl}/batches`, { method: 'POST' });

  if (!submitResponse.ok) {
    const body = (await submitResponse.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Submit failed with HTTP ${submitResponse.status}`);
  }

  const acknowledgement = (await submitResponse.json()) as {
    batchId: string;
    promptCount: number;
    source: string;
    message: string;
  };

  console.log('Batch accepted:', acknowledgement);

  while (true) {
    await sleep(pollIntervalMs);

    const statusResponse = await fetch(`${baseUrl}/batches/${acknowledgement.batchId}`);
    const job = (await statusResponse.json()) as {
      status: string;
      result?: unknown;
      error?: string;
    };

    console.log(`Status: ${job.status}`);

    if (job.status === 'completed') {
      console.log(JSON.stringify(job.result, null, 2));
      return;
    }

    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Batch processing failed');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
