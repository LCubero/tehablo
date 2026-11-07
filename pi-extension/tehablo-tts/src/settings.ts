import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Settings of the Pi settings window, kept per user in ~/.tehablo/settings.json, so each user and each
// system of a dual boot has its own. The old project file (tehablo-settings.json) is only read as a start.
export const ACTIONS = ['power', 'auto', 'play', 'pause', 'stop', 'settings', 'copied'] as const;
export type Action = typeof ACTIONS[number];
export const MODELS = ['phonon', 'spanish', 'spanish_24l'];
export const SPEEDS = [1, 1.1, 1.15, 1.25, 1.5];
/** downloaded is null when unknown (server off and never seen). */
export interface VoiceRow { name: string; voice: string; model: string; kind: string; note: string; downloaded: boolean | null }
export interface Settings {
  /** Empty model/voice means "use the server default". */
  model: string; voice: string; volume: number; speed: number; auto: boolean;
  /** The bar stays hidden on the next start when /tts toolbar hid it. */
  toolbar: boolean;
  /** The status indicator stays hidden when /tts indicator hid it. */
  indicator: boolean;
  icons: 'symbols' | 'text';
  audio: 'local' | 'ssh';
  sshListo: boolean;
  device: string;
  policy: 'stop' | 'wait';
  dict: Record<string, boolean>;
  shortcutsOn: boolean; shortcuts: Partial<Record<Action, string>>;
  /** Last voice table seen from the server, shown while it is off. */
  voices: VoiceRow[];
}
export const DEFAULTS: Settings = {model: '', voice: '', volume: 1, speed: 1, auto: false, toolbar: true, indicator: true, icons: 'symbols', audio: 'local', sshListo: false, device: '', policy: 'stop', shortcutsOn: false, shortcuts: {}, voices: [], dict: {}};

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
  const s: Settings = {...DEFAULTS, shortcuts: {}, voices: [], dict: {}};
  if (typeof raw.model === 'string' && MODELS.includes(raw.model)) s.model = raw.model;
  if (typeof raw.voice === 'string') s.voice = raw.voice;
  if (typeof raw.volume === 'number' && raw.volume >= 0.1 && raw.volume <= 1.5) s.volume = raw.volume;
  if (SPEEDS.includes(raw.speed)) s.speed = raw.speed;
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
  if (Array.isArray(raw.voices)) s.voices = raw.voices.filter(isRow);
  return s;
}

/** Merge only this session's edits into the latest file; voice and model form one choice. */
export function saveSettings(dir: string, settings: Settings, previous?: Settings): void {
  const merged = previous ? loadSettings(dir, undefined, previous) : structuredClone(settings);
  if (previous) {
    for (const key of ['volume', 'speed', 'toolbar', 'indicator', 'icons', 'audio', 'sshListo', 'device', 'policy', 'shortcutsOn', 'voices'] as const)
      if (JSON.stringify(settings[key]) !== JSON.stringify(previous[key])) (merged as any)[key] = settings[key];
    if (settings.model !== previous.model || settings.voice !== previous.voice) {
      merged.model = settings.model; merged.voice = settings.voice;
    }
    for (const key of ['dict', 'shortcuts'] as const) {
      const before = previous[key], after = settings[key];
      for (const entry of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if ((before as any)[entry] === (after as any)[entry]) continue;
        if (Object.hasOwn(after, entry)) (merged[key] as any)[entry] = (after as any)[entry];
        else delete (merged[key] as any)[entry];
      }
    }
  }
  const {auto: _auto, ...shared} = merged;
  mkdirSync(dir, {recursive: true, mode: 0o700});
  const temporary = join(dir, `${FILE}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(shared, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    renameSync(temporary, join(dir, FILE));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
