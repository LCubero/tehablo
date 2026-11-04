import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Settings of the Pi settings window, kept in tehablo-settings.json at the project root (gitignored).
export const ACTIONS = ['power', 'auto', 'play', 'pause', 'stop', 'settings', 'copied'] as const;
export type Action = typeof ACTIONS[number];
export const MODELS = ['phonon', 'spanish', 'spanish_24l'];
export const SPEEDS = [1, 1.1, 1.15, 1.25, 1.5];
/** downloaded is null when unknown (server off and never seen). */
export interface VoiceRow { name: string; voice: string; model: string; kind: string; note: string; downloaded: boolean | null }
export interface Settings {
  /** Empty model/voice means "use the server default". */
  model: string; voice: string; volume: number; speed: number; auto: boolean;
  shortcutsOn: boolean; shortcuts: Partial<Record<Action, string>>;
  /** Last voice table seen from the server, shown while it is off. */
  voices: VoiceRow[];
}
export const DEFAULTS: Settings = {model: '', voice: '', volume: 1, speed: 1, auto: false, shortcutsOn: false, shortcuts: {}, voices: []};

const FILE = 'tehablo-settings.json';
const isRow = (v: any): v is VoiceRow => v && ['name', 'voice', 'model', 'kind', 'note'].every(k => typeof v[k] === 'string')
  && (typeof v.downloaded === 'boolean' || v.downloaded === null);

export function loadSettings(root: string): Settings {
  let raw: any = {};
  try { if (existsSync(join(root, FILE))) raw = JSON.parse(readFileSync(join(root, FILE), 'utf8')); } catch { raw = {}; }
  if (!raw || typeof raw !== 'object') raw = {};
  const s: Settings = {...DEFAULTS, shortcuts: {}, voices: []};
  if (typeof raw.model === 'string' && MODELS.includes(raw.model)) s.model = raw.model;
  if (typeof raw.voice === 'string') s.voice = raw.voice;
  if (typeof raw.volume === 'number' && raw.volume >= 0.1 && raw.volume <= 1.5) s.volume = raw.volume;
  if (SPEEDS.includes(raw.speed)) s.speed = raw.speed;
  if (typeof raw.auto === 'boolean') s.auto = raw.auto;
  if (typeof raw.shortcutsOn === 'boolean') s.shortcutsOn = raw.shortcutsOn;
  if (raw.shortcuts && typeof raw.shortcuts === 'object')
    for (const action of ACTIONS) if (typeof raw.shortcuts[action] === 'string') s.shortcuts[action] = raw.shortcuts[action];
  if (Array.isArray(raw.voices)) s.voices = raw.voices.filter(isRow);
  return s;
}

export function saveSettings(root: string, settings: Settings): void {
  writeFileSync(join(root, FILE), JSON.stringify(settings, null, 2) + '\n');
}
