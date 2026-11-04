import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Hugging Face token is only needed to download an account voice the first time; once in the local
// cache the voice works without it. So it is never written to disk: the extension keeps it in memory and
// passes it to the server it starts. A HF_TOKEN already in the environment or in the project .env still counts
// (src/tehablo_tts.py: the environment wins, then the first assignment, quotes stripped).
// The value is never returned, logged or put in an error message.
const LINE = /^\s*HF_TOKEN\s*=(.*)$/;
const VALID = /^[A-Za-z0-9_-]+$/;
const INVALID = 'El token no es válido: copia el token completo de Hugging Face.';

const read = (root: string) => existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '';

/** Whether the server will see a non-empty HF_TOKEN from the environment or the project .env. */
export function hasToken(root: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.HF_TOKEN !== undefined) return env.HF_TOKEN.trim().length > 0;
  for (const line of read(root).split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match) return match[1].trim().replace(/^["']+|["']+$/g, '').length > 0;
  }
  return false;
}

/** Throws a message safe to show when the value is not a whole token. */
export function checkToken(value: string): void {
  if (!VALID.test(value)) throw new Error(INVALID);
}
