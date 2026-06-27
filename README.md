# Prompt Batch Processor

A Node.js + TypeScript + Express service that reads AI prompts from a JSON file, processes them **concurrently** against a mock rate-limited endpoint, and returns aggregated results.

## Setup

```bash
npm install
```

## Run

Start the server:

```bash
npm run dev
```

Submit a batch (returns immediately with `202 Accepted`):

```bash
curl -X POST http://localhost:3000/batches
```

Poll for status and results:

```bash
curl http://localhost:3000/batches/<batchId>
```

Or use the CLI (submits, then polls until complete):

```bash
npm run process
```

## Prompts file

Edit `prompts.json` in the project root:

```json
{
  "prompts": [
    { "id": "prompt-1", "text": "Your prompt here" }
  ]
}
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/batches` | Read `prompts.json`, return acknowledgement immediately (`202`), process in background |
| GET | `/batches/:batchId` | Poll batch status; includes aggregated results when `completed` |
| POST | `/mock/complete` | Mock rate-limited AI endpoint |

### Batch ingestion flow

1. `POST /batches` reads `prompts.json` and responds immediately:

```json
{
  "batchId": "uuid",
  "status": "accepted",
  "promptCount": 8,
  "source": "/workspaces/promptsProcessor/prompts.json",
  "message": "Batch accepted for processing"
}
```

2. Processing runs concurrently in the background.

3. `GET /batches/:batchId` returns `pending` → `running` → `completed` (with results) or `failed`.

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `PROMPTS_FILE` | `./prompts.json` | Path to prompts JSON file |
| `MAX_CONCURRENCY` | `5` | Max prompts processed in parallel |
| `MAX_REQUESTS_PER_SECOND` | `3` | Client-side token bucket rate limit |
| `MOCK_SERVER_RATE_LIMIT` | `5` | Server-side mock endpoint limit (req/s) |
| `MAX_RETRIES` | `3` | Retries on 429/503 |
| `REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |

## Architecture

```
POST /batches → FileReader → 202 acknowledgement (immediate)
                    ↓
              Background: PromptProcessor (concurrency pool)
                    ↓
              TokenBucket (client rate limit)
                    ↓
              POST /mock/complete (server rate limit + delay)
                    ↓
              ResultAggregator → stored on batch job
                    ↓
GET /batches/:id → poll status + results
```
