import fs from 'fs/promises';
import { Prompt, PromptsFile } from '../types';

export async function readPromptsFromFile(filePath: string): Promise<Prompt[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as PromptsFile;

  if (!Array.isArray(parsed.prompts)) {
    throw new Error('Invalid prompts file: expected a "prompts" array');
  }

  for (const prompt of parsed.prompts) {
    if (!prompt.id || !prompt.text) {
      throw new Error('Each prompt must have "id" and "text" fields');
    }
  }

  return parsed.prompts;
}
