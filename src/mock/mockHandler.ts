import { Request, Response } from 'express';
import { MockCompleteRequest, MockCompleteResponse } from '../types';
import { config } from '../config';

const requestTimestamps: number[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): number {
  const { mockMinDelayMs, mockMaxDelayMs } = config;
  return mockMinDelayMs + Math.random() * (mockMaxDelayMs - mockMinDelayMs);
}

function isRateLimited(): boolean {
  const now = Date.now();
  const windowStart = now - 1000;

  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= config.mockServerRateLimit) {
    return true;
  }

  requestTimestamps.push(now);
  return false;
}

export async function mockCompleteHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (isRateLimited()) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  const body = req.body as MockCompleteRequest;
  if (!body?.id || !body?.prompt) {
    res.status(400).json({ error: 'Request body must include "id" and "prompt"' });
    return;
  }

  await sleep(randomDelay());

  if (Math.random() < config.mockFailureRate) {
    res.status(503).json({ error: 'Mock service temporarily unavailable' });
    return;
  }

  const response: MockCompleteResponse = {
    id: body.id,
    output: `Mock response for: ${body.prompt.slice(0, 80)}`,
    tokensUsed: Math.ceil(body.prompt.length / 4),
  };

  res.json(response);
}
