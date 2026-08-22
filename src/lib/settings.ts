/**
 * Settings, persisted to localStorage. Display config only — nothing here is
 * ever written into a document file.
 */

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  docView: 'clean' | 'faithful';
  toolbar: 'contextual' | 'full';   // slim contextual toolbar (default) or the full ribbon
  highlightColor: string;           // active F11 color (Word highlight name)
  reader1Wpm: number;
  reader2Wpm: number;
  showReadChips: boolean;           // per-card read time chips (off by default)
  navDepth: 1 | 2 | 3 | 4;
  zoom: number;                     // percent
  speechSeconds: number;            // speech timer length
  seenTutorial: boolean;
}

export const DEFAULTS: Settings = {
  theme: 'system',
  docView: 'clean',
  toolbar: 'contextual',
  highlightColor: 'cyan',
  reader1Wpm: 270,
  reader2Wpm: 240,
  showReadChips: false,
  navDepth: 3,
  zoom: 100,
  speechSeconds: 480,
  seenTutorial: false,
};

const KEY = 'spread-settings';

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULTS };
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Apply theme to the document root (light/dark/system tri-state). */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
}
