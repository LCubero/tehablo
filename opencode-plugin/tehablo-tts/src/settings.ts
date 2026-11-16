import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Shared user settings in ~/.tehablo/settings.json, compatible with the Pi extension and TUI.
export const ACTIONS = ['power', 'auto', 'play', 'pause', 'stop', 'settings', 'copied'] as const;
export type Action = typeof ACTIONS[number];
export const MODELS = ['phonon', 'spanish', 'spanish_24l'];
/** 0.50x to 1.50x in 0.05x steps (written as hundredths so 1.1 and 1.15 stay exact). */
export const SPEEDS = Array.from({length: 21}, (_, i) => (50 + 5 * i) / 100);
export const RHYTHMS = [-1, -0.5, 0, 0.5, 1];
/** downloaded is null when unknown (server off and never seen). */
export interface VoiceRow { name: string; voice: string; model: string; kind: string; note: string; downloaded: boolean | null; needsToken?: boolean; style?: string }
export interface Settings {
  /** Empty model/voice means "use the server default". */
  model: string; voice: string; volume: number; speed: number; rhythm: number; auto: boolean;
  toolbar: boolean;
  indicator: boolean;
  icons: 'symbols' | 'text';
  audio: 'local' | 'ssh';
  sshListo: boolean;
  device: string;
  policy: 'stop' | 'wait';
  dict: Record<string, boolean>;
  favorites: string[];
  shortcutsOn: boolean; shortcuts: Partial<Record<Action, string>>;
  voices: VoiceRow[];
}
export const DEFAULTS: Settings = {model: '', voice: '', volume: 0.5, speed: 1, rhythm: 0, auto: false, toolbar: true, indicator: true, icons: 'symbols', audio: 'local', sshListo: false, device: '', policy: 'stop', shortcutsOn: false, shortcuts: {}, voices: [], dict: {}, favorites: []};

const FILE = 'settings.json';
const OLD_FILE = 'tehablo-settings.json';
/** The user folder for tehablo settings. */
export const settingsDir = () => join(homedir(), '.tehablo');
const isRow = (v: any): v is VoiceRow => v && ['name', 'voice', 'model', 'kind', 'note'].every(k => typeof v[k] === 'string')
  && (typeof v.downloaded === 'boolean' || v.downloaded === null);

export function loadSettings(dir: string, project?: string, fallback: Settings = DEFAULTS): Settings {
  let raw: any = {};
  const file = existsSync(join(dir, FILE)) || !project ? join(dir, FILE) : join(project, OLD_FILE);
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return structuredClone(fallback); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(fallback);
  const s: Settings = {...DEFAULTS, shortcuts: {}, voices: [], dict: {}, favorites: []};
  if (typeof raw.model === 'string' && MODELS.includes(raw.model)) s.model = raw.model;
  if (typeof raw.voice === 'string') s.voice = raw.voice;
  if (typeof raw.volume === 'number' && raw.volume >= 0.1 && raw.volume <= 1.5) s.volume = raw.volume;
  if (SPEEDS.includes(raw.speed)) s.speed = raw.speed;
  if (RHYTHMS.includes(raw.rhythm)) s.rhythm = raw.rhythm;
  if (typeof raw.toolbar === 'boolean') s.toolbar = raw.toolbar;
  if (typeof raw.indicator === 'boolean') s.indicator = raw.indicator;
  if (typeof raw.sshListo === 'boolean') s.sshListo = raw.sshListo;
  if (typeof raw.device === 'string') s.device = raw.device;
  if (raw.audio === 'local' || raw.audio === 'ssh') s.audio = raw.audio;
  if (raw.icons === 'text' || raw.icons === 'symbols') s.icons = raw.icons;
  if (raw.policy === 'wait' || raw.policy === 'stop') s.policy = raw.policy;
  if (typeof raw.shortcutsOn === 'boolean') s.shortcutsOn = raw.shortcutsOn;
  if (raw.shortcuts && typeof raw.shortcuts === 'object')
    for (const action of ACTIONS) if (typeof raw.shortcuts[action] === 'string') s.shortcuts[action] = raw.shortcuts[action];
  if (raw.dict && typeof raw.dict === 'object' && !Array.isArray(raw.dict))
    s.dict = Object.fromEntries(Object.entries(raw.dict).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>;
  if (Array.isArray(raw.favorites)) s.favorites = [...new Set<string>(raw.favorites.filter((v: unknown) => typeof v === 'string'))];
  if (Array.isArray(raw.voices)) s.voices = raw.voices.filter(isRow);
  return s;
}

