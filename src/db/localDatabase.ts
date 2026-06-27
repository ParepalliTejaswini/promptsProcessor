import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { BatchOutputDocument } from '../types';
import { config } from '../config';

let db: Database.Database | undefined;

export function initLocalDatabase(dbPath: string = config.databasePath): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(config.outputDir, { recursive: true });

  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      batch_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      total INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      rate_limited INTEGER NOT NULL,
      output_file TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      output TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
    );
  `);

  return db;
}

export function saveBatchOutput(
  document: BatchOutputDocument,
  options?: { databasePath?: string; outputDir?: string },
): string {
  const databasePath = options?.databasePath ?? config.databasePath;
  const outputDir = options?.outputDir ?? config.outputDir;
  const database = initLocalDatabase(databasePath);

  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${document.batchId}.json`);

  fs.writeFileSync(outputFile, JSON.stringify(document, null, 2), 'utf-8');

  const insertBatch = database.prepare(`
    INSERT INTO batches (
      batch_id, source, completed_at, total, succeeded, failed, rate_limited, output_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertInference = database.prepare(`
    INSERT INTO inferences (
      batch_id, prompt_id, prompt_text, output, latency_ms, attempt_count, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const persist = database.transaction(() => {
    insertBatch.run(
      document.batchId,
      document.source,
      document.completedAt,
      document.summary.total,
      document.summary.succeeded,
      document.summary.failed,
      document.summary.rateLimited,
      outputFile,
    );

    for (const inference of document.inferences) {
      insertInference.run(
        document.batchId,
        inference.promptId,
        inference.promptText,
        inference.output,
        inference.latencyMs,
        inference.attemptCount,
        inference.completedAt,
      );
    }
  });

  persist();

  return outputFile;
}

export function getBatchOutputDocument(
  batchId: string,
  outputDir: string = config.outputDir,
): BatchOutputDocument | undefined {
  const outputFile = path.join(outputDir, `${batchId}.json`);
  if (!fs.existsSync(outputFile)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(outputFile, 'utf-8')) as BatchOutputDocument;
}

export function closeLocalDatabase(): void {
  db?.close();
  db = undefined;
}

/** @internal Resets singleton — for tests only */
export function resetLocalDatabaseForTests(): void {
  closeLocalDatabase();
}
