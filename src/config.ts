import path from 'path';

const projectRoot = path.join(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  promptsFilePath: process.env.PROMPTS_FILE ?? path.join(projectRoot, 'prompts.json'),
  maxConcurrency: Number(process.env.MAX_CONCURRENCY ?? 5),
  maxRequestsPerSecond: Number(process.env.MAX_REQUESTS_PER_SECOND ?? 3),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
  maxRetries: Number(process.env.MAX_RETRIES ?? 3),
  mockMinDelayMs: Number(process.env.MOCK_MIN_DELAY_MS ?? 200),
  mockMaxDelayMs: Number(process.env.MOCK_MAX_DELAY_MS ?? 600),
  mockFailureRate: Number(process.env.MOCK_FAILURE_RATE ?? 0.05),
  mockServerRateLimit: Number(process.env.MOCK_SERVER_RATE_LIMIT ?? 5),
};
