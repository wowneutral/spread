/**
 * Settings, persisted to localStorage. Display config only — nothing here is
 * ever written into a document file.
 */

/** Display-only per-style size overrides (pt). Empty = the file's own size. */
export interface StyleSizes {
  normal?: number; pocket?: number; hat?: number; block?: number; tag?: number;
  analytic?: number; undertag?: number; cite?: number; underline?: number; emphasis?: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  docView: 'clean' | 'faithful';
  docFollowsTheme: boolean;         // dark mode darkens the document too (off = paper stays white)
  bodyFont: string;                 // '' = the file's own font
  styleSizes: StyleSizes;           // display-only pt overrides per style
  analyticColor: string;            // display color for Analytic text
  undertagColor: string;            // display color for Undertag text
  maxWidthOn: boolean;              // cap the text column width
  maxWidthPx: number;
  autosave: boolean;                // autosave to the opened file (FSA)
  prefixPresets: boolean;           // Save As presets prepend the prefixes below
  sendPrefix: string;
  readPrefix: string;
  condenseOnPaste: boolean;         // run condense on F2-pasted text
  spellcheck: boolean;              // browser spellcheck in the editor (off: evidence trips it)
  highlightColor: string;           // active F11 color (Word highlight name)
  shadeHex: string;                 // Mod-F11 background shading fill (RRGGBB)
  condenseIntegrity: boolean;       // F3 keeps paragraph breaks
  condensePilcrows: boolean;        // ...marked with small ¶ when merging
  shrinkProtections: string;        // comma-separated strings Shrink keeps full-size
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
  docView: 'faithful',
  docFollowsTheme: false,
  bodyFont: '',
  styleSizes: {},
  analyticColor: '#1F3864',
  undertagColor: '#385623',
  maxWidthOn: false,
  maxWidthPx: 900,
  autosave: true,
  prefixPresets: true,
  sendPrefix: 'SEND_',
  readPrefix: 'READ_',
  condenseOnPaste: false,
  spellcheck: false,
  highlightColor: 'cyan',
  shadeHex: 'FFE9A8',
  condenseIntegrity: true,
  condensePilcrows: true,
  shrinkProtections: '',
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
