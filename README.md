# Prompt Batch Processor

A Node.js + TypeScript + Express backend that reads AI prompts from a JSON file, processes them concurrently against a mock rate-limited API, and returns aggregated results.

Built for batch workloads where you need:

- **Immediate acknowledgement** while processing continues in the background
- **Bounded concurrency** so prompts run in parallel without overwhelming the API
- **Rate limiting and retry/backoff** when the mock API returns HTTP 429

---

## Prerequisites

- **Node.js** 20 or later
- **npm** 9+

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/ParepalliTejaswini/promptsProcessor.git
cd promptsProcessor
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure prompts (optional)

Edit `prompts.json` in the project root:

```json
{
  "prompts": [
    { "id": "prompt-1", "text": "What is TypeScript?" },
    { "id": "prompt-2", "text": "Explain async/await." }
  ]
}
```

Each prompt must have a unique `id` and a `text` field.

### 4. Build (production)

```bash
npm run build
```

---

## Running the service

### Development (with hot reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

The server starts on `http://localhost:3000` by default.

---

## Usage

### Submit a batch

Reads `prompts.json` and returns immediately with `202 Accepted`:

```bash
curl -X POST http://localhost:3000/batches
```

Example response:

```json
{
  "batchId": "8cfa297c-91b8-458c-bfc6-4636208bb9e8",
  "status": "accepted",
  "promptCount": 8,
  "source": "/path/to/promptsProcessor/prompts.json",
  "message": "Batch accepted for processing"
}
```

### Poll for status and results

```bash
curl http://localhost:3000/batches/<batchId>
```

Batch status transitions: `pending` → `running` → `completed` (or `failed`).

When `completed`, the response includes an aggregated `result` object with per-prompt outcomes and summary counts.

### CLI (submit + poll until done)

Requires the server to be running:

```bash
npm run process
```

### Run tests

```bash
npm test
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/batches` | Ingest prompts from file; return acknowledgement immediately |
| `GET` | `/batches/:batchId` | Poll batch status and aggregated results |
| `POST` | `/mock/complete` | Mock rate-limited AI endpoint (internal) |

---

## Concurrency model design

Processing prompts one at a time is simple but slow for large batches. Unbounded parallelism (firing every prompt at once) can overload the external API and trigger excessive HTTP 429 responses. This project uses a **bounded worker pool** with separate **rate limiting** and **retry/backoff** layers.

### Design goals

1. **Throughput** — process many prompts faster than sequential execution
2. **Safety** — cap in-flight work so the API is not flooded
3. **Resilience** — retry on 429 with backoff instead of dropping prompts
4. **Isolation** — one prompt failing does not abort the entire batch

### Architecture overview

```
POST /batches
    │
    ├─► Read prompts.json
    ├─► Return 202 acknowledgement (immediate)
    └─► Background processing
            │
            ▼
        PromptProcessor.processBatch()
            │
            ├─► ConcurrencyPool (max 5 workers)
            │       │
            │       └─► MockAiClient.complete()  [per prompt]
            │               │
            │               ├─► TokenBucket (client rate limit)
            │               ├─► fetch → POST /mock/complete
            │               └─► Retry loop on 429/503 with backoff
            │
            └─► ResultAggregator → store on BatchJob
```

### Layer 1: Task scheduling (`PromptProcessor`)

When a batch is accepted, `PromptProcessor` creates **one async task per prompt** and schedules them through the pool:

```typescript
const tasks = prompts.map((prompt) =>
  this.pool.run(() => this.client.complete(prompt)),
);
const settled = await Promise.allSettled(tasks);
```

- Every prompt is scheduled up front — nothing is skipped
- `Promise.allSettled` ensures one failure does not reject the whole batch
- Each task goes through `ConcurrencyPool.run()` before calling the mock API

### Layer 2: Bounded worker pool (`ConcurrencyPool`)

The pool is a **semaphore** that limits how many prompts run at the same time (default: **5 workers**).

```
8 prompts, MAX_CONCURRENCY=5:

  Active:  [p1] [p2] [p3] [p4] [p5]
  Queued:  [p6] [p7] [p8]

  p1 finishes → p6 starts
  p2 finishes → p7 starts
  ...
```

Implementation (`src/limiters/concurrencyPool.ts`):

| State | Purpose |
|-------|---------|
| `active` | Count of workers currently running |
| `queue` | FIFO queue of tasks waiting for a slot |
| `acquire()` | Take a slot immediately, or enqueue and wait |
| `release()` | Free a slot and wake the next queued task |

This is **concurrency**, not strict sequential processing. Up to 5 prompts make outbound API calls simultaneously; the rest wait their turn.

**Why a pool instead of unbounded `Promise.all`?**

- Prevents opening hundreds of simultaneous HTTP connections
- Keeps memory and socket usage predictable
- Reduces 429 storms from the mock/real API

### Layer 3: Client-side rate limiting (`TokenBucket`)

Concurrency and rate limiting are **separate controls**:

| Control | Default | What it limits |
|---------|---------|----------------|
| `MAX_CONCURRENCY` | 5 | How many prompts run **in parallel** |
| `MAX_REQUESTS_PER_SECOND` | 3 | How many HTTP calls are sent **per second** |

Even with 5 active workers, the `TokenBucket` in `MockAiClient` throttles outbound requests. A worker must acquire a token before each API call; if the bucket is empty, the worker waits.

This mirrors real-world usage: you might allow 10 concurrent connections but only 5 requests per second to stay within an API quota.

### Layer 4: Retry with exponential backoff (`MockAiClient`)

The mock API returns HTTP **429** when its server-side rate limit is exceeded. Workers handle this with a retry loop:

```
Attempt 1 → 429 → sleep 1s
Attempt 2 → 429 → sleep 2s
Attempt 3 → 200 → success
```

- Retries on **429** and **503** (up to `MAX_RETRIES`, default 3)
- Backoff: `1s → 2s → 4s` (capped at 8s)
- After all retries are exhausted, the prompt is marked `rate_limited` or `error` — but it **still appears** in the aggregated batch result (never silently dropped)

### Layer 5: Aggregation (`ResultAggregator`)

Once all pool tasks settle, results are:

1. **Reordered** to match the original `prompts.json` input order
2. **Counted** (`succeeded`, `failed`, `rateLimited`)
3. **Summarized** (`avgLatencyMs` from successful prompts only)

### Example: 8 prompts with default settings

```
Time ──────────────────────────────────────────────►

Worker 1: [p1 ~400ms]──►[p6 ~900ms]
Worker 2: [p2 ~500ms]──►[p7 ~800ms]
Worker 3: [p3 ~600ms]──►[p8 ~700ms]
Worker 4: [p4 ~550ms]
Worker 5: [p5 ~450ms]

Total wall time: ~1.5s concurrent vs ~4s+ sequential
```

Actual timing depends on mock latency, rate limits, and any 429 retries.

### Tunable via environment variables

```bash
MAX_CONCURRENCY=10 MAX_REQUESTS_PER_SECOND=5 npm run dev
```

---

## Configuration

All settings are optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `PROMPTS_FILE` | `<project>/prompts.json` | Path to prompts JSON file |
| `MAX_CONCURRENCY` | `5` | Worker pool size (max parallel prompts) |
| `MAX_REQUESTS_PER_SECOND` | `3` | Client-side token bucket rate |
| `MOCK_SERVER_RATE_LIMIT` | `5` | Server-side mock endpoint limit (req/s) |
| `MAX_RETRIES` | `3` | Retry attempts on 429/503 |
| `REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |
| `MOCK_MIN_DELAY_MS` | `200` | Mock API minimum latency |
| `MOCK_MAX_DELAY_MS` | `600` | Mock API maximum latency |
| `MOCK_FAILURE_RATE` | `0.05` | Mock random 503 failure rate |

---

## Project structure

```
promptsProcessor/
├── prompts.json              # Batch input file
├── src/
│   ├── index.ts              # Express server & routes
│   ├── config.ts             # Environment configuration
│   ├── services/
│   │   └── batchService.ts   # Batch ingestion & background jobs
│   ├── processors/
│   │   └── promptProcessor.ts # Schedules prompts through worker pool
│   ├── limiters/
│   │   ├── concurrencyPool.ts # Bounded worker pool (semaphore)
│   │   └── tokenBucket.ts     # Client-side rate limiter
│   ├── clients/
│   │   └── mockAiClient.ts   # HTTP client with retry/backoff
│   ├── mock/
│   │   └── mockHandler.ts    # Mock AI endpoint (429 + delay)
│   ├── aggregators/
│   │   └── resultAggregator.ts
│   └── readers/
│       └── fileReader.ts
└── tests/                    # Unit tests (Vitest)
```

---

## License

MIT
