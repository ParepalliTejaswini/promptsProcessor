import express from 'express';
import { config } from './config';
import { ingestBatchFromDefaultFile, getBatchJob } from './services/batchService';
import { mockCompleteHandler } from './mock/mockHandler';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/mock/complete', (req, res) => {
  void mockCompleteHandler(req, res);
});

app.post('/batches', async (_req, res) => {
  try {
    const baseUrl = `http://localhost:${config.port}`;
    const acknowledgement = await ingestBatchFromDefaultFile(baseUrl);
    res.status(202).json(acknowledgement);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch ingestion failed';
    res.status(500).json({ error: message });
  }
});

app.get('/batches/:batchId', (req, res) => {
  const job = getBatchJob(req.params.batchId);

  if (!job) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }

  res.json(job);
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
  console.log(`Prompts file: ${config.promptsFilePath}`);
  console.log(`Max concurrency: ${config.maxConcurrency}`);
  console.log(`Client rate limit: ${config.maxRequestsPerSecond} req/s`);
});
