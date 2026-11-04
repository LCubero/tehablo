import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Hugging Face token stored as HF_TOKEN in the project .env (gitignored), read by the server at start
// (src/tehablo_tts.py: the environment wins, then the first assignment, quotes stripped).
// The value is never returned, logged or put in an error message.
const LINE = /^\s*HF_TOKEN\s*=(.*)$/;
const VALID = /^[A-Za-z0-9_-]+$/;
const INVALID = 'El token no es válido: copia el token completo de Hugging Face.';
const LINKED = 'No se guardó el token: .env es un enlace; reemplázalo por un archivo normal.';

const envPath = (root: string) => join(root, '.env');
const read = (root: string) => existsSync(envPath(root)) ? readFileSync(envPath(root), 'utf8') : '';

/** Whether the server will see a non-empty HF_TOKEN. */
export function hasToken(root: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.HF_TOKEN !== undefined) return env.HF_TOKEN.trim().length > 0;
  for (const line of read(root).split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match) return match[1].trim().replace(/^["']+|["']+$/g, '').length > 0;
  }
  return false;
}

/** Saves or replaces HF_TOKEN in .env, keeping every other line and its line endings, owner-only. */
export function saveToken(root: string, value: string): void {
  if (!VALID.test(value)) throw new Error(INVALID);
  const file = envPath(root);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(LINKED);
  const text = read(root);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const index = lines.findIndex(line => LINE.test(line));
  if (index >= 0) lines[index] = `HF_TOKEN=${value}`;
  else lines.push(`HF_TOKEN=${value}`);
  // Write a private temporary file first, so the token is never readable under looser permissions.
  const temporary = `${file}.tehablo-tmp`;
  try {
    writeFileSync(temporary, lines.join(eol) + eol, {mode: 0o600, flag: 'w'});
    try { chmodSync(temporary, 0o600); } catch { /* Filesystems without POSIX permissions (e.g. NTFS). */ }
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, {force: true});
  }
}
