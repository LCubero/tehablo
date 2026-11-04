import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Hugging Face token stored as HF_TOKEN in the project .env (gitignored), read by the server at start.
// The value is never returned, logged or put in an error message.
const LINE = /^\s*HF_TOKEN\s*=(.*)$/;
const VALID = /^[A-Za-z0-9_-]+$/;
const INVALID = 'El token no es válido: copia el token completo de Hugging Face.';

const envPath = (root: string) => join(root, '.env');
const lines = (root: string) => existsSync(envPath(root)) ? readFileSync(envPath(root), 'utf8').split(/\r?\n/) : [];

/** Whether a non-empty HF_TOKEN is available to the server. */
export function hasToken(root: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.HF_TOKEN?.trim()) return true;
  return lines(root).some(line => {
    const match = LINE.exec(line);
    return !!match && match[1].trim().replace(/^["']|["']$/g, '').length > 0;
  });
}

/** Saves or replaces HF_TOKEN in .env, keeping every other line, with owner-only permissions. */
export function saveToken(root: string, value: string): void {
  const token = value.trim();
  if (!VALID.test(token)) throw new Error(INVALID);
  const current = lines(root);
  if (current.at(-1) === '') current.pop();
  const index = current.findIndex(line => LINE.test(line));
  if (index >= 0) current[index] = `HF_TOKEN=${token}`;
  else current.push(`HF_TOKEN=${token}`);
  writeFileSync(envPath(root), current.join('\n') + '\n', {mode: 0o600});
  try { chmodSync(envPath(root), 0o600); } catch { /* Not supported on every filesystem. */ }
}
