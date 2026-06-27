export interface Prompt {
  id: string;
  text: string;
}

export interface PromptsFile {
  prompts: Prompt[];
}

export type PromptStatus = 'success' | 'error' | 'rate_limited' | 'timeout';

export interface PromptResult {
  id: string;
  status: PromptStatus;
  output?: string;
  error?: string;
  latencyMs: number;
  attemptCount: number;
}

export interface AggregatedResult {
  total: number;
  succeeded: number;
  failed: number;
  rateLimited: number;
  avgLatencyMs: number;
  results: PromptResult[];
}

export type BatchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BatchJob {
  batchId: string;
  status: BatchStatus;
  source: string;
  promptCount: number;
  acceptedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: AggregatedResult;
}

export interface BatchAcknowledgement {
  batchId: string;
  status: 'accepted';
  promptCount: number;
  source: string;
  message: string;
}

export interface MockCompleteRequest {
  id: string;
  prompt: string;
}

export interface MockCompleteResponse {
  id: string;
  output: string;
  tokensUsed: number;
}
