/**
 * Spread — application shell.
 * Free, MIT-licensed debate card-cutting editor. Reads/writes Verbatim .docx.
 *
 * Layout: topbar (tabs) · full ribbon (every command, always visible) ·
 * outline | editor | speech pane · status bar. Home screen for open/new/
 * recents. Command palette (Mod-K) reaches every command by name.
 * The document renders with the opened file's own styles (see stylesheet.ts).
 */
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo as undoCmd, redo as redoCmd } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { Fragment, type Node as PMNode } from 'prosemirror-model';

import { schema } from './editor/schema';
import { buildKeymap } from './editor/keymap';
import {
  commands, toggleHighlight, toggleShade, selectCard, toggleMarker, cardBodyRange,
  setFontSize, stepFontSize, standardizeHighlights, removeAllOf,
  highlightToBackground, backgroundToHighlight, condenseCmd,
} from './editor/commands';
import { modelToPM, pmToModel, type EditorSession } from './editor/convert';
import { importDocx } from './docx/import';
import { exportDocx } from './docx/export';
import { newDocumentParts } from './docx/template';
import { parseStylesheet, stylesheetCSS } from './docx/stylesheet';
import { setDocFontInStyles } from './docx/fonts';
import { partText, setPartText, type PartMap } from './docx/zip';
import { STYLE, type DocModel, type Paragraph } from './model/types';
import {
  openViaPicker, saveFile, saveAs, addRecent, listRecents, clearRecents,
  openRecent, hasFSA, type RecentEntry,
} from './lib/fsa';
import { readableWords, readableWordsInSelection, secondsAt, fmtTime } from './lib/readtime';
import { getSettings, updateSettings, onSettingsChange, applyTheme, type Settings } from './lib/settings';
import { tutorialModel } from './tutorial';
import { startTour } from './tour';
import {
  type Flow, type FlowEvent, FLOW_COLUMNS, newFlow, insertRow, deleteRow,
  rowIsEmpty, loadFlows, saveFlows, exportFlowJSON, importFlowJSON, appendToColumn,
} from './flow';

// ---------------------------------------------------------------------------
// tiny DOM helper
// ---------------------------------------------------------------------------
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) (node as any)[k.toLowerCase()] = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(kid));
  }
  return node;
}

/** Word's full 15-color highlight palette (F11 order: brights, then darks). */
const HL_COLORS = ['yellow', 'cyan', 'green', 'magenta', 'blue', 'red',
  'darkYellow', 'darkCyan', 'darkGreen', 'darkMagenta', 'darkBlue', 'darkRed',
  'darkGray', 'lightGray', 'black'];
const SHADE_HEXES = ['FFFF00', 'FFE9A8', 'C7F0FF', 'D8F5C9', 'FFD9DE', 'E8DAFF', 'D9D9D9', 'BFBFBF'];
const FONT_HEXES = ['auto', 'FF0000', 'C00000', '0070C0', '00B050', '7030A0', 'ED7D31', '808080'];
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 26];
const BODY_FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Helvetica'];

/** Display-only overrides from Settings, layered over the file's stylesheet. */
function userCSS(s: Settings): string {
  const rules: string[] = [];
  if (s.bodyFont) {
    rules.push(`.docwrap:not(.clean) #docmount .ProseMirror{font-family:"${s.bodyFont}",Arial,sans-serif !important}`);
  }
  if (s.maxWidthOn) {
    rules.push(`#docmount .ProseMirror{max-width:${Math.max(400, s.maxWidthPx)}px;margin:0 auto}`);
  }
  const sz = s.styleSizes;
  const size = (sel: string, pt?: number) => {
    if (pt && pt > 0) rules.push(`.docwrap:not(.clean) #docmount ${sel}{font-size:${pt}pt !important}`);
  };
  size('.cs-p', sz.normal); size('.cs-h1', sz.pocket); size('.cs-h2', sz.hat);
  size('.cs-h3', sz.block); size('.cs-h4', sz.tag); size('.cs-analytic', sz.analytic);
  size('.cs-undertag', sz.undertag); size('.m-cite', sz.cite);
  size('.m-ustyle', sz.underline); size('.m-emph', sz.emphasis);
  rules.push(`.docwrap .cs-analytic{color:${s.analyticColor}}`);
  rules.push(`.docwrap .cs-undertag{color:${s.undertagColor}}`);
  return rules.join('\n');
}

function applyUserStyles(): void {
  document.getElementById('userstyles')?.remove();
  const el = document.createElement('style');
  el.id = 'userstyles';
  el.textContent = userCSS(getSettings());
  document.head.append(el);
}

const REPO = 'https://github.com/wowneutral/spread';

/** The browser tab reads as the open document, like any editor. */
function updateTitle(): void {
  const s = activeSession();
  document.title = showingHome || !s ? 'Spread' : `${s.name.replace(/\.docx$/i, '')} — Spread`;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
interface Session {
  id: number;
  name: string;
  handle: FileSystemFileHandle | null;
  parts: PartMap;
  es: EditorSession;
  state: EditorState;
  css: string;             // per-document stylesheet from the file's styles.xml
  originalStyles: string | null;  // styles.xml as opened, for Restore fonts
  dirty: boolean;
  isSpeech: boolean;
}

let sessions: Session[] = [];
let activeId: number | null = null;
let nextSessionId = 1;
let view: EditorView | null = null;
let showingHome = true;
let showingFlow = false;
let autosaveTimer: number | undefined;
let readMode = false;
let plainPasteArmed = false;

/** Dropzone shelf: parked card fragments (in-memory, this session). */
const dropzone: { label: string; json: any }[] = [];

function activeSession(): Session | null {
  return sessions.find((s) => s.id === activeId) ?? null;
}
function speechSession(): Session | null {
  return sessions.find((s) => s.isSpeech) ?? null;
}

function condenseModeFromSettings(): 'merge' | 'pilcrows' | 'whitespace' {
  const s = getSettings();
  if (!s.condenseIntegrity) return 'merge';
  return s.condensePilcrows ? 'pilcrows' : 'whitespace';
}

function shrinkProtectionList(): string[] {
  return getSettings().shrinkProtections.split(',').map((x) => x.trim()).filter(Boolean);
}

function nowShort(): string {
  const d = new Date();
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function makeState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      keymap({
        F2: () => { void pastePlain(); return true; },
        'Mod-Shift-d': (state, dispatch) => toggleMarker(nowShort)(state, dispatch),
        '`': () => sendToSpeech('cursor'),
        'Alt-`': () => sendToSpeech('end'),
        'Mod-`': () => sendToDropzone(),
      }),
      buildKeymap({
        getHighlightColor: () => getSettings().highlightColor,
        getShadeHex: () => getSettings().shadeHex,
        getCondenseMode: condenseModeFromSettings,
        getShrinkProtections: shrinkProtectionList,
      }),
      history(),
      keymap(baseKeymap),
    ],
  });
}

function docCss(parts: PartMap): string {
  return stylesheetCSS(
    parseStylesheet(partText(parts, 'word/styles.xml'), partText(parts, 'word/theme/theme1.xml')),
    '#docmount');
}

function newSession(name: string, model: DocModel, parts: PartMap, handle: FileSystemFileHandle | null): Session {
  const { doc, session: es } = modelToPM(model);
  const s: Session = {
    id: nextSessionId++, name, handle, parts, es,
    state: makeState(doc), css: docCss(parts),
    originalStyles: partText(parts, 'word/styles.xml'),
    dirty: false, isSpeech: false,
  };
  sessions.push(s);
  return s;
}

function sessionBytes(s: Session, transform?: (m: DocModel) => DocModel): Uint8Array {
  const state = s.id === activeId && view ? view.state : s.state;
  let model = pmToModel(state.doc, s.es);
  if (transform) model = transform(model);
  return exportDocx(model, s.parts);
}

// ---------------------------------------------------------------------------
// file operations
// ---------------------------------------------------------------------------
async function openFile(): Promise<void> {
  const opened = await openViaPicker();
  if (!opened) return;
  loadOpened(opened.name, opened.bytes, opened.handle);
}

function loadOpened(name: string, bytes: Uint8Array, handle: FileSystemFileHandle | null): void {
  let model: DocModel, parts: PartMap;
  try {
    const imported = importDocx(bytes);
    model = imported.model; parts = imported.parts;
  } catch (e) {
    toast(`Couldn't open ${name}: ${(e as Error).message}`);
    return;
  }
  const s = newSession(name, model, parts, handle);
  activeId = s.id;
  showingHome = false;
  if (handle) void addRecent({ name, openedAt: Date.now(), handle });
  renderAll();
  toast(`Opened ${name}`);
}

function newDocument(asSpeech = false): void {
  const parts = newDocumentParts();
  const model: DocModel = { blocks: [], rels: new Map() };
  const s = newSession(asSpeech ? 'Speech.docx' : 'Untitled.docx', model, parts, null);
  if (asSpeech) { for (const o of sessions) o.isSpeech = false; s.isSpeech = true; }
  activeId = s.id;
  showingHome = false;
  renderAll();
}

async function doSave(s: Session | null = activeSession()): Promise<void> {
  if (!s) return;
  syncActiveState();
  try {
    const bytes = sessionBytes(s);
    const handle = await saveFile(bytes, s.name, s.handle);
    if (handle) {
      s.handle = handle;
      s.name = handle.name ?? s.name;
      void addRecent({ name: s.name, openedAt: Date.now(), handle });
    }
    s.dirty = false;
    renderTopbar(); renderStatus(); updateTitle();
    toast(s.handle ? `Saved ${s.name}` : `Downloaded ${s.name}`);
  } catch (e) {
    toast(`Save failed: ${(e as Error).message}`);
  }
}

async function doSaveAs(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  syncActiveState();
  openSaveAsModal(s);
}

function syncActiveState(): void {
  const s = activeSession();
  if (s && view) s.state = view.state;
}

function scheduleAutosave(): void {
  const s = activeSession();
  if (!s?.handle || !getSettings().autosave) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    const cur = activeSession();
    if (cur?.dirty && cur.handle) void doSave(cur);
  }, 5000);
}

async function pastePlain(): Promise<void> {
  if (!view) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      if (getSettings().condenseOnPaste) {
        condenseCmd(condenseModeFromSettings())(view.state, view.dispatch);
      }
      view.focus();
      return;
    }
  } catch { /* clipboard permission refused — arm instead */ }
  plainPasteArmed = true;
  toast('Plain paste armed — your next paste lands as plain text.');
}

/**
 * Change the document's font for real: rewrites the file's styles so Word,
 * Verbatim, and CardMirror all see the new face. Run-level font overrides in
 * the original file are dropped so the switch actually takes everywhere.
 */
function setDocumentFont(font: string): void {
  const s = activeSession();
  if (!s) return;
  const styles = partText(s.parts, 'word/styles.xml');
  if (!styles) return;
  setPartText(s.parts, 'word/styles.xml', setDocFontInStyles(styles, font));
  // Strip per-run rFonts pass-throughs — they would override the new font.
  for (let i = 0; i < s.es.rawRPrs.length; i++) {
    s.es.rawRPrs[i] = s.es.rawRPrs[i].filter((n) => !('w:rFonts' in n));
  }
  s.css = docCss(s.parts);
  const styleEl = document.getElementById('docstyles');
  if (styleEl) styleEl.textContent = s.css;
  s.dirty = true;
  renderTopbar(); renderStatus();
  toast(`Document font: ${font}. Saving writes it into the file.`);
}

function restoreDocumentFonts(): void {
  const s = activeSession();
  if (!s?.originalStyles) return;
  setPartText(s.parts, 'word/styles.xml', s.originalStyles);
  s.css = docCss(s.parts);
  const styleEl = document.getElementById('docstyles');
  if (styleEl) styleEl.textContent = s.css;
  s.dirty = true;
  renderTopbar(); renderStatus();
  toast(`Restored the file's original fonts.`);
}

/** Save As presets — transforms applied to the model on the way out. */
function stripForSendDoc(model: DocModel): DocModel {
  const keep = (p: Paragraph) => p.styleId !== STYLE.ANALYTIC && p.styleId !== STYLE.UNDERTAG;
  return { ...model, blocks: model.blocks.filter((b) => b.type !== 'p' || keep(b.para)) };
}

function stripForReadDoc(model: DocModel): DocModel {
  const blocks: DocModel['blocks'] = [];
  for (const b of model.blocks) {
    if (b.type !== 'p') { blocks.push(b); continue; }
    const p = b.para;
    if (p.kind === 'heading' || p.styleId === STYLE.ANALYTIC) { blocks.push(b); continue; }
    if (p.styleId === STYLE.UNDERTAG) continue;
    const runs = p.runs.filter((r) =>
      (r.marks.highlight && r.marks.highlight !== 'none') || r.marks.charStyle === STYLE.CITE);
    if (runs.length > 0) blocks.push({ type: 'p', para: { ...p, runs } });
  }
  return { ...model, blocks };
}

// ---------------------------------------------------------------------------
// send to speech + dropzone
// ---------------------------------------------------------------------------
function currentCardSlice(): { fragment: Fragment; label: string } | null {
  if (!view) return null;
  let state = view.state;
  if (state.selection.empty) {
    selectCard(state, (tr) => { view!.dispatch(tr); });
    state = view.state;
  }
  const slice = state.selection.content();
  if (slice.content.size === 0) return null;
  let label = '';
  slice.content.forEach((n) => { if (!label && n.textContent) label = n.textContent.slice(0, 80); });
  return { fragment: slice.content, label: label || '(card)' };
}

function sendToSpeech(where: 'cursor' | 'end'): boolean {
  const from = activeSession();
  const to = speechSession();
  if (!from || !view) return false;
  if (!to) { toast('No speech doc yet — mark a tab as the speech doc (palette: "Mark as speech doc").'); return true; }
  if (to.id === from.id) { toast('This tab IS the speech doc'); return true; }
  const card = currentCardSlice();
  if (!card) return true;
  const end = to.state.doc.content.size;
  const pos = where === 'cursor'
    ? Math.min(to.state.selection.head ?? end, end)
    : end;
  const tr = to.state.tr.insert(pos, card.fragment);
  to.state = to.state.apply(tr);
  to.dirty = true;
  renderSpeech();
  toast(where === 'end' ? 'Appended to speech doc' : 'Sent to speech doc');
  return true;
}

function sendToDropzone(): boolean {
  const card = currentCardSlice();
  if (!card) return true;
  dropzone.push({ label: card.label, json: card.fragment.toJSON() });
  renderSpeech();
  toast('Parked in the dropzone');
  return true;
}

function insertFromDropzone(i: number): void {
  const item = dropzone[i];
  if (!item || !view) return;
  const frag = Fragment.fromJSON(schema, item.json);
  const pos = view.state.selection.head;
  view.dispatch(view.state.tr.insert(pos, frag).scrollIntoView());
  view.focus();
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const root = () => document.getElementById('app')!;

function renderAll(): void {
  const settings = getSettings();
  applyTheme(settings);
  const editing = !showingHome && !showingFlow;
  root().replaceChildren(
    renderTopbarEl(),
    ...(editing ? [renderRibbon()] : []),
    showingHome ? renderHome() : showingFlow ? renderFlowView() : renderShell(),
    renderStatusEl(),
    h('div', { class: 'toasts', id: 'toasts' }),
  );
  if (editing) mountEditor();
  renderStatus();
  updateTitle();
}

// --- topbar ---
function renderTopbarEl(): HTMLElement {
  const bar = h('div', { class: 'topbar', id: 'topbar' },
    h('div', {
      class: 'wordmark', role: 'button', tabindex: '0', title: 'Home',
      onclick: () => { syncActiveState(); showingHome = true; showingFlow = false; renderAll(); },
    }, 'Sp', h('span', { class: 'swipe' }, h('span', {}, 'read'))),
    h('div', { class: 'doctabs', role: 'tablist' },
      ...sessions.map((sess) => h('button', {
        class: 'doctab', role: 'tab',
        'aria-selected': sess.id === activeId && !showingHome && !showingFlow ? 'true' : 'false',
        onclick: () => { syncActiveState(); activeId = sess.id; showingHome = false; showingFlow = false; renderAll(); },
      },
        h('span', { class: `dot${sess.dirty ? ' dirty' : ''}` }),
        sess.name,
        sess.isSpeech ? h('span', { class: 'mod' }, 'speech') : null,
        h('span', {
          class: 'close', title: 'Close',
          onclick: (e: Event) => { e.stopPropagation(); closeSession(sess.id); },
        }, '×'),
      )),
    ),
    h('div', { class: 'topbar-right' },
      h('button', {
        class: `chip-btn${showingFlow ? ' active' : ''}`, title: 'The flow — keyboard-first flowing',
        onclick: () => openFlow(),
      }, 'Flow'),
      h('a', {
        class: 'icon-btn', title: 'Spread on GitHub', 'aria-label': 'GitHub repository',
        href: REPO, target: '_blank', rel: 'noopener',
      }, iconGitHub()),
      h('button', { class: 'chip-btn', onclick: () => openPalette() },
        'Commands ', h('kbd', {}, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')),
      h('button', {
        class: 'icon-btn', title: 'Switch theme', 'aria-label': 'Switch theme',
        onclick: () => {
          const cur = getSettings();
          const dark = cur.theme === 'dark' || (cur.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
          updateSettings({ theme: dark ? 'light' : 'dark' });
        },
      }, iconMoon()),
    ),
  );
  return bar;
}
function renderTopbar(): void {
  document.getElementById('topbar')?.replaceWith(renderTopbarEl());
}

function closeSession(id: number): void {
  const sess = sessions.find((x) => x.id === id);
  if (sess?.dirty && !confirm(`${sess.name} has unsaved changes. Close anyway?`)) return;
  sessions = sessions.filter((x) => x.id !== id);
  if (activeId === id) {
    activeId = sessions[0]?.id ?? null;
    if (activeId === null) showingHome = true;
  }
  renderAll();
}

// --- home (split layout: actions left, recents as the main surface) ---
function renderHome(): HTMLElement {
  const recentsList = h('div', { class: 'h2-recents', id: 'recents' }, h('div', { class: 'empty' }, 'Loading…'));
  void (async () => {
    const recents = await listRecents(14);
    recentsList.replaceChildren(
      ...(recents.length === 0
        ? [h('div', { class: 'empty' }, hasFSA
            ? 'Files you open land here. Spread asks your browser for permission before reading or editing anything.'
            : 'Recents need the File System Access API (Chrome/Edge). You can still open and download files.')]
        : recents.map((r) => renderRecent(r))),
    );
  })();
  const action = (title: string, sub: string, kbd: string | null, run: () => void, primary = false) =>
    h('button', { class: `h2-action${primary ? ' primary' : ''}`, onclick: run },
      h('span', { class: 'h2-a-main' }, h('b', {}, title), h('span', {}, sub)),
      kbd ? h('kbd', {}, kbd) : null);
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  return h('section', { class: 'home2' },
    h('div', { class: 'h2-left' },
      h('h1', {}, 'Sp', h('span', { class: 'swipe' }, h('span', {}, 'read'))),
      h('p', { class: 'h2-sub' }, 'Cut cards. Save real Verbatim files. Nothing leaves your machine.'),
      h('div', { class: 'h2-actions' },
        action('New document', 'A fresh Verbatim-styled file', null, () => newDocument(false), true),
        action('New speech document', 'Starts marked as the speech doc', null, () => newDocument(true)),
        action('Open…', 'Any Verbatim or Word .docx', `${mod} O`, () => void openFile()),
      ),
      h('div', { class: 'h2-links' },
        h('button', { onclick: () => openFlow() }, 'The flow'),
        h('span', { class: 'sep' }, '·'),
        h('button', { onclick: () => openTutorial() }, 'Take the tour'),
        h('span', { class: 'sep' }, '·'),
        h('button', { onclick: () => toggleTimerPanel() }, 'Timer'),
        h('span', { class: 'sep' }, '·'),
        h('button', { onclick: () => openWpmTest() }, 'Test your WPM'),
        h('span', { class: 'sep' }, '·'),
        h('button', { onclick: () => { openSettings('shortcuts'); } }, 'Shortcuts'),
      ),
      h('div', { class: 'h2-foot' },
        h('span', {}, 'Made by Armaan Seth'),
        '·',
        h('a', { href: `${REPO}/blob/main/MANUAL.md`, target: '_blank', rel: 'noopener' }, 'User Manual'),
        '·',
        h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub'),
        '·',
        h('a', { href: `${REPO}/releases`, target: '_blank', rel: 'noopener' }, 'Mac & Windows apps'),
        '·',
        h('a', { href: `${REPO}/issues`, target: '_blank', rel: 'noopener', title: 'Bug reports and feature requests — or email hello@mitez.org' }, 'Issues & suggestions'),
        '·',
        h('a', { href: 'mailto:hello@mitez.org' }, 'hello@mitez.org'),
        '·',
        h('a', { href: `${REPO}/blob/main/PRIVACY.md`, target: '_blank', rel: 'noopener' }, 'Privacy'),
        '·',
        h('a', { href: `${REPO}/blob/main/TERMS.md`, target: '_blank', rel: 'noopener' }, 'Terms'),
      ),
    ),
    h('div', { class: 'h2-right' },
      h('div', { class: 'h2-r-head' },
        h('span', { class: 'home-label' }, 'RECENT'),
        h('button', { class: 'home-clear', onclick: async () => { await clearRecents(); renderAll(); } }, 'Clear'),
      ),
      recentsList,
    ),
  );
}

function renderRecent(r: RecentEntry): HTMLElement {
  const when = timeAgo(r.openedAt);
  return h('button', {
    class: 'recent',
    onclick: async () => {
      const opened = await openRecent(r);
      if (!opened) { toast('Permission was not granted — use Open… instead.'); return; }
      loadOpened(opened.name, opened.bytes, opened.handle);
    },
  }, h('span', { class: 'ft' }, 'DOCX'), r.name, h('span', { class: 'when' }, when));
}

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// --- editor shell ---
function docwrapClass(s: Settings): string {
  return `docwrap${s.docFollowsTheme ? '' : ' paper'}${readMode ? ' readmode' : ''}`;
}

function renderShell(): HTMLElement {
  const s = getSettings();
  return h('div', { class: 'shell' },
    h('nav', { class: 'outline', 'aria-label': 'Document outline', id: 'outline' }),
    h('main', { class: docwrapClass(s), id: 'docwrap' },
      h('div', { id: 'docmount', class: 'doczoom' }),
    ),
    h('aside', { class: 'speech', 'aria-label': 'Speech document', id: 'speechpane' }),
  );
}

function mountEditor(): void {
  const mount = document.getElementById('docmount');
  const s = activeSession();
  if (!mount || !s) return;
  view?.destroy();
  document.getElementById('docstyles')?.remove();
  const styleEl = document.createElement('style');
  styleEl.id = 'docstyles';
  styleEl.textContent = s.css;
  document.head.append(styleEl);
  view = new EditorView(mount, {
    state: s.state,
    editable: () => !readMode,
    attributes: () => ({ spellcheck: String(getSettings().spellcheck) }),
    handlePaste(v, event) {
      if (!plainPasteArmed) return false;
      plainPasteArmed = false;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text) v.dispatch(v.state.tr.insertText(text).scrollIntoView());
      return true;
    },
    dispatchTransaction(tr) {
      if (!view) return;
      const newState = view.state.apply(tr);
      view.updateState(newState);
      const sess = activeSession();
      if (sess) {
        sess.state = newState;
        if (tr.docChanged) { sess.dirty = true; scheduleAutosave(); renderOutline(); }
      }
      renderStatus();
      updateRibbonState();
      renderTopbarDirtyDots();
    },
  });
  applyZoom();
  renderOutline();
  renderSpeech();
  updateRibbonState();
}

function renderTopbarDirtyDots(): void {
  renderTopbar();
}

function applyZoom(): void {
  const mount = document.getElementById('docmount') as HTMLElement | null;
  if (mount) (mount.style as any).zoom = `${getSettings().zoom}%`;
}

function zoomBy(delta: number): void {
  updateSettings({ zoom: Math.max(50, Math.min(300, getSettings().zoom + delta)) });
  applyZoom(); renderStatus();
}

// --- outline ---
function renderOutline(): void {
  const el = document.getElementById('outline');
  const s = activeSession();
  if (!el || !s) return;
  const depth = getSettings().navDepth;
  const state = view?.state ?? s.state;
  const items: { level: number; text: string; pos: number; analytic?: boolean }[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type === schema.nodes.heading && node.attrs.level <= depth) {
      items.push({ level: node.attrs.level, text: node.textContent || '(untitled)', pos: offset });
    } else if (node.type === schema.nodes.paragraph && node.attrs.kind === 'analytic' && depth >= 4) {
      items.push({ level: 4, text: node.textContent || '(analytic)', pos: offset, analytic: true });
    }
  });
  const selHead = state.selection.head;
  let activePos = -1;
  for (const item of items) if (item.pos < selHead) activePos = item.pos;
  el.replaceChildren(
    h('div', { class: 'rail-top' },
      h('span', { class: 'rail-label' }, 'OUTLINE'),
      h('div', { class: 'depth', title: 'Outline depth' },
        ...[1, 2, 3, 4].map((d) => h('button', {
          class: d === depth ? 'on' : '',
          onclick: () => { updateSettings({ navDepth: d as 1 | 2 | 3 | 4 }); renderOutline(); },
        }, String(d))),
      ),
    ),
    h('div', { class: 'tree' },
      ...(items.length === 0
        ? [h('div', { class: 'empty' }, 'Headings appear here. F4 makes a Pocket, F5 a Hat, F6 a Block, F7 a Tag.')]
        : items.map((item) => h('button', {
            class: `l${item.level}${item.analytic ? ' an' : ''}${item.pos === activePos ? ' active-mark' : ''}`,
            onclick: () => {
              if (!view) return;
              const pos = item.pos + 1;
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
              view.focus();
            },
          },
            h('span', { class: 'lvl' }, item.analytic ? 'A' : ['', 'P', 'H', 'B', 'T'][item.level]),
            h('span', {}, item.text),
          ))),
    ),
  );
}

// --- the flow ---
const flowStore = loadFlows();
let flowSaveTimer: number | undefined;

function activeFlow(): Flow | null {
  return flowStore.flows.find((f) => f.id === flowStore.activeId) ?? null;
}

function scheduleFlowSave(): void {
  clearTimeout(flowSaveTimer);
  flowSaveTimer = window.setTimeout(() => saveFlows(flowStore), 400);
}

function openFlow(): void {
  syncActiveState();
  showingHome = false;
  showingFlow = true;
  renderAll();
}

function addFlow(name: string, event: FlowEvent): void {
  const f = newFlow(name || `${event} flow`, event);
  flowStore.flows.push(f);
  flowStore.activeId = f.id;
  saveFlows(flowStore);
  renderAll();
}

function focusFlowCell(row: number, col: number): void {
  const el = document.querySelector<HTMLElement>(`.fcell[data-rc="${row}:${col}"]`);
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretAtEdge(el: HTMLElement): { start: boolean; end: boolean } {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return { start: true, end: true };
  const r = sel.getRangeAt(0);
  if (!sel.isCollapsed) return { start: false, end: false };
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString().length;
  const total = el.textContent?.length ?? 0;
  return { start: before === 0, end: before === total };
}

function renderFlowGrid(flow: Flow): HTMLElement {
  const grid = h('div', {
    class: 'flow-grid',
    style: `grid-template-columns:repeat(${flow.cols.length}, minmax(190px, 1fr))`,
  });
  for (const name of flow.cols) grid.append(h('div', { class: 'fcol-head' }, name));
  flow.grid.forEach((rowCells, r) => {
    rowCells.forEach((cell, c) => {
      const el = h('div', {
        class: `fcell${cell.bold ? ' b' : ''}${cell.struck ? ' s' : ''}`,
        contenteditable: 'true',
        'data-rc': `${r}:${c}`,
        spellcheck: 'false',
      }, cell.text);
      el.oninput = () => { cell.text = el.textContent ?? ''; scheduleFlowSave(); };
      el.onblur = () => { clearTimeout(flowSaveTimer); saveFlows(flowStore); };
      el.onkeydown = (e: KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Enter' && e.altKey) {
          e.preventDefault(); insertRow(flow, r); scheduleFlowSave(); rerenderFlow(); focusFlowCell(r, c);
        } else if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault(); if (c + 1 < flow.cols.length) focusFlowCell(r, c + 1);
        } else if (e.key === 'Enter') {
          e.preventDefault(); insertRow(flow, r + 1); scheduleFlowSave(); rerenderFlow(); focusFlowCell(r + 1, c);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const nc = c + (e.shiftKey ? -1 : 1);
          if (nc >= 0 && nc < flow.cols.length) focusFlowCell(r, nc);
        } else if (e.key === 'ArrowDown') {
          if (r + 1 < flow.grid.length) { e.preventDefault(); focusFlowCell(r + 1, c); }
        } else if (e.key === 'ArrowUp') {
          if (r > 0) { e.preventDefault(); focusFlowCell(r - 1, c); }
        } else if (e.key === 'ArrowLeft') {
          if (c > 0 && caretAtEdge(el).start) { e.preventDefault(); focusFlowCell(r, c - 1); }
        } else if (e.key === 'ArrowRight') {
          if (c + 1 < flow.cols.length && caretAtEdge(el).end) { e.preventDefault(); focusFlowCell(r, c + 1); }
        } else if (e.key === 'Backspace' && (el.textContent ?? '') === '' && rowIsEmpty(flow, r) && flow.grid.length > 1) {
          e.preventDefault(); deleteRow(flow, r); scheduleFlowSave(); rerenderFlow(); focusFlowCell(Math.max(0, r - 1), c);
        } else if (mod && e.key.toLowerCase() === 'b') {
          e.preventDefault(); cell.bold = !cell.bold; el.classList.toggle('b', !!cell.bold); saveFlows(flowStore);
        } else if (mod && e.key.toLowerCase() === 'd') {
          e.preventDefault(); cell.struck = !cell.struck; el.classList.toggle('s', !!cell.struck); saveFlows(flowStore);
        }
      };
      grid.append(el);
    });
  });
  return grid;
}

function rerenderFlow(): void {
  const mainEl = document.getElementById('flowmain');
  const flow = activeFlow();
  if (!mainEl || !flow) return;
  mainEl.querySelector('.flow-grid')?.replaceWith(renderFlowGrid(flow));
}

function downloadText(name: string, text: string, type = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function renderFlowView(): HTMLElement {
  const flow = activeFlow();

  const nameInput = h('input', {
    type: 'text', class: 'flow-newname', placeholder: 'New flow name…', 'aria-label': 'New flow name',
  });
  const eventSel = h('select', { class: 'flow-event', 'aria-label': 'Event' },
    ...(['LD', 'Policy', 'PF'] as FlowEvent[]).map((ev) =>
      h('option', { value: ev }, `${ev} · ${FLOW_COLUMNS[ev].length} cols`)));

  const side = h('aside', { class: 'flow-side' },
    h('div', { class: 'rail-top' }, h('span', { class: 'rail-label' }, 'FLOWS')),
    h('div', { class: 'flow-list' },
      ...(flowStore.flows.length === 0
        ? [h('div', { class: 'empty' }, 'One flow per debate. Make one below — it stays on this machine.')]
        : flowStore.flows.map((f) => h('div', { class: `flow-item${f.id === flowStore.activeId ? ' on' : ''}` },
            h('button', {
              class: 'flow-open',
              onclick: () => { flowStore.activeId = f.id; saveFlows(flowStore); renderAll(); },
            }, f.name, h('span', { class: 'flow-ev' }, f.event)),
            h('button', {
              class: 'flow-del', title: 'Delete flow',
              onclick: () => {
                if (!confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
                flowStore.flows = flowStore.flows.filter((x) => x.id !== f.id);
                if (flowStore.activeId === f.id) flowStore.activeId = flowStore.flows[0]?.id ?? null;
                saveFlows(flowStore); renderAll();
              },
            }, '×'),
          ))),
    ),
    h('div', { class: 'flow-new' },
      nameInput, eventSel,
      h('button', {
        class: 'flow-add',
        onclick: () => addFlow(nameInput.value.trim(), eventSel.value as FlowEvent),
      }, '+ New flow'),
    ),
  );

  if (!flow) {
    return h('div', { class: 'flowview' }, side,
      h('main', { class: 'flow-main', id: 'flowmain' },
        h('div', { class: 'flow-emptystate' },
          h('h2', {}, 'The flow'),
          h('p', {}, 'Speech columns for your event, argument rows, all keyboard. Enter adds an argument below, Alt-Enter above, Shift-Enter jumps to the response column. Make a flow on the left to start.'),
        )));
  }

  const renameInput = h('input', {
    type: 'text', class: 'flow-name', value: flow.name, 'aria-label': 'Flow name',
    onchange: () => {
      flow.name = renameInput.value.trim() || flow.name;
      renameInput.value = flow.name;
      saveFlows(flowStore);
      document.querySelectorAll('.flow-item.on .flow-open').forEach((b) => {
        (b.childNodes[0] as Text).textContent = flow.name;
      });
    },
  });
  const importInput = h('input', {
    type: 'file', accept: '.json,application/json', style: 'display:none',
    onchange: async () => {
      const file = (importInput as HTMLInputElement).files?.[0];
      if (!file) return;
      const imported = importFlowJSON(await file.text());
      if (!imported) { toast('That file is not a Spread flow.'); return; }
      flowStore.flows.push(imported);
      flowStore.activeId = imported.id;
      saveFlows(flowStore);
      renderAll();
    },
  });

  const main = h('main', { class: 'flow-main', id: 'flowmain' },
    h('div', { class: 'flow-head' },
      renameInput,
      h('span', { class: 'flow-evtag' }, flow.event),
      h('div', { class: 'flow-tools' },
        h('button', { title: 'Bold cell (⌘B)', onclick: () => { /* keyboard-first; hint */ toast('Select a cell and press Mod-B.'); } }, 'B'),
        h('button', { title: 'Strike cell (⌘D)', class: 'st', onclick: () => toast('Select a cell and press Mod-D.') }, 'S'),
        h('span', { class: 'sep' }),
        h('button', { onclick: () => { const f = activeFlow(); if (f) { insertRow(f, f.grid.length); scheduleFlowSave(); rerenderFlow(); } } }, '+ Row'),
        h('button', { onclick: () => downloadText(`${flow.name.replace(/[^\w.-]+/g, '_')}.flow.json`, exportFlowJSON(flow)) }, 'Export'),
        h('button', { onclick: () => importInput.click() }, 'Import'),
        importInput,
      ),
      h('span', { class: 'flow-hint' }, 'Enter argument · ⌥Enter above · ⇧Enter response · ⌘B bold · ⌘D strike'),
    ),
    renderFlowGrid(flow),
  );
  return h('div', { class: 'flowview' }, side, main);
}

/** Editor → flow: put the current card's tag on the active flow's first column. */
function sendTagToFlow(): void {
  if (!view) return;
  const state = view.state;
  const doc = state.doc;
  let index = state.selection.$from.index(0);
  let tag = '';
  for (let i = index; i >= 0; i--) {
    const n = doc.child(i);
    if (n.type === schema.nodes.heading ||
        (n.type === schema.nodes.paragraph && n.attrs.kind === 'analytic')) {
      tag = n.textContent.trim();
      break;
    }
  }
  if (!tag) { toast('Put the cursor in a card first.'); return; }
  let flow = activeFlow();
  if (!flow) {
    flow = newFlow('Round flow', 'LD');
    flowStore.flows.push(flow);
    flowStore.activeId = flow.id;
  }
  appendToColumn(flow, 0, tag);
  saveFlows(flowStore);
  toast(`On the flow: ${tag.slice(0, 60)}`);
}

// --- WPM test ---
const WPM_PASSAGE = 'The strongest version of any argument is the one your opponent would write. Before a tournament, read your own cards the way a judge hears them, out loud and at pace, because the words that look clean on a screen can trip a reader mid sentence. Evidence wins rounds when the highlighted line says exactly what the tag promises, no more and no less. A card that needs three sentences of spin is a card that should have been cut better. Practice the transitions between cards as much as the cards themselves, since hesitation between arguments costs more time than slow reading inside them. Speed matters, but a judge who misses a warrant gives it no weight, so the real target is the fastest rate at which every word still lands.';

let wpmHandle: number | null = null;
let wpmStart = 0;

function openWpmTest(): void {
  closeOverlay();
  const words = (WPM_PASSAGE.match(/[\w'’-]+/g) ?? []).length;
  const elapsed = h('span', { class: 'wpm-clock' }, '0:00');
  const result = h('div', { class: 'wpm-result' });
  const actions = h('div', { class: 'row', style: 'margin-top:10px' });
  const mainBtn = h('button', { class: 'stamp' }, 'Start reading');

  const stopTimer = () => { if (wpmHandle) { clearInterval(wpmHandle); wpmHandle = null; } };

  mainBtn.onclick = () => {
    if (!wpmHandle) {
      wpmStart = Date.now();
      result.replaceChildren();
      actions.replaceChildren();
      wpmHandle = window.setInterval(() => {
        elapsed.textContent = fmtTime(Math.round((Date.now() - wpmStart) / 1000));
      }, 250);
      mainBtn.textContent = 'Done — I read it all';
    } else {
      const secs = Math.max(1, (Date.now() - wpmStart) / 1000);
      stopTimer();
      const wpm = Math.round(words / (secs / 60));
      mainBtn.textContent = 'Start reading';
      elapsed.textContent = fmtTime(Math.round(secs));
      result.replaceChildren(
        h('p', { class: 'wpm-big' }, `${wpm} words per minute`),
        h('p', { class: 'note' }, `${words} words in ${fmtTime(Math.round(secs))}. Debate pace is usually 250–350; conversational is around 150.`),
      );
      actions.replaceChildren(
        h('button', { class: 'opt', onclick: () => { updateSettings({ reader1Wpm: wpm }); toast(`Reader 1 set to ${wpm} wpm`); } }, `Set Reader 1 to ${wpm}`),
        h('button', { class: 'opt', onclick: () => { updateSettings({ reader2Wpm: wpm }); toast(`Reader 2 set to ${wpm} wpm`); } }, `Set Reader 2 to ${wpm}`),
      );
    }
  };

  showOverlay(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'WPM test' },
    h('h2', {}, 'How fast do you read?',
      h('button', { class: 'x', onclick: () => { stopTimer(); closeOverlay(); }, 'aria-label': 'Close' }, '×')),
    h('p', { class: 'note', style: 'margin-bottom:10px' },
      'Press Start, read the passage below out loud at your round pace, and press Done the moment you finish. This is a stopwatch and a word count, nothing else — no microphone, no recording, nothing leaves your machine.'),
    h('div', { class: 'wpm-passage' }, WPM_PASSAGE),
    h('div', { class: 'row', style: 'align-items:center; gap:12px; margin-top:12px' }, mainBtn, elapsed),
    result,
    actions,
  ));
}
function toggleReadMode(): void {
  readMode = !readMode;
  const s = getSettings();
  document.getElementById('docwrap')?.setAttribute('class', docwrapClass(s));
  view?.setProps({ editable: () => !readMode });
  updateRibbonState();
  toast(readMode ? 'Read mode — the doc shows only what gets read; editing is off.' : 'Read mode off');
}

// --- find / replace ---
function closeFind(): void {
  document.getElementById('findbar')?.remove();
  view?.focus();
}

function openFind(withReplace = false): void {
  if (showingHome || !view) return;
  document.getElementById('findbar')?.remove();
  const wrap = document.getElementById('docwrap');
  if (!wrap) return;

  let matches: { from: number; to: number }[] = [];
  let idx = -1;
  const count = h('span', { class: 'fcount' }, '');

  const collect = (query: string) => {
    matches = [];
    idx = -1;
    if (!view || query.length === 0) { count.textContent = ''; return; }
    const q = query.toLowerCase();
    view.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return true;
      const hay = node.text.toLowerCase();
      let at = hay.indexOf(q);
      while (at >= 0) {
        matches.push({ from: pos + at, to: pos + at + q.length });
        at = hay.indexOf(q, at + Math.max(1, q.length));
      }
      return false;
    });
    count.textContent = `${matches.length}`;
  };

  const jump = (delta: number) => {
    if (!view || matches.length === 0) return;
    idx = (idx + delta + matches.length) % matches.length;
    const m = matches[idx];
    if (m.to > view.state.doc.content.size) { collect(input.value); return; }
    view.dispatch(view.state.tr
      .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
      .scrollIntoView());
    count.textContent = `${idx + 1}/${matches.length}`;
  };

  const replaceOne = () => {
    if (!view || idx < 0 || !matches[idx]) { collect(input.value); jump(1); return; }
    const m = matches[idx];
    view.dispatch(view.state.tr.insertText(replInput.value, m.from, m.to));
    collect(input.value);
    jump(1);
  };
  const replaceAll = () => {
    if (!view) return;
    collect(input.value);
    if (matches.length === 0) return;
    let tr = view.state.tr;
    for (const m of [...matches].reverse()) tr = tr.insertText(replInput.value, m.from, m.to);
    view.dispatch(tr);
    const n = matches.length;
    collect(input.value);
    toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`);
  };

  const input = h('input', {
    type: 'text', placeholder: 'Find in document…', 'aria-label': 'Find',
    oninput: () => collect(input.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); if (idx < 0) collect(input.value); jump(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeFind(); }
    },
  });
  const replInput = h('input', {
    type: 'text', placeholder: 'Replace with…', 'aria-label': 'Replace',
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeFind(); }
    },
  });
  const rows: HTMLElement[] = [
    h('div', { class: 'frow' },
      input, count,
      h('button', { title: 'Previous (Shift-Enter)', 'aria-label': 'Previous match', onclick: () => jump(-1) }, '‹'),
      h('button', { title: 'Next (Enter)', 'aria-label': 'Next match', onclick: () => jump(1) }, '›'),
      h('button', { title: 'Close (Esc)', 'aria-label': 'Close find', onclick: () => closeFind() }, '×'),
    ),
  ];
  if (withReplace) {
    rows.push(h('div', { class: 'frow' },
      replInput,
      h('button', { class: 'ftext', onclick: replaceOne }, 'Replace'),
      h('button', { class: 'ftext', onclick: replaceAll }, 'All'),
    ));
  }
  wrap.prepend(h('div', { class: 'findbar', id: 'findbar' }, ...rows));
  input.focus();
}

// --- ribbon: every command, always visible ---
interface RibbonBtn {
  label?: string; kbd?: string; icon?: () => SVGElement; glyph?: string;
  cls?: string; title: string; run?: () => void; soon?: string;
  k?: string;                        // state key for cursor lighting
  picker?: () => HTMLElement;        // split-button dropdown
  menu?: boolean;                    // whole button opens the picker (no split)
}

function runCmd(cmd: Command): () => void {
  return () => { if (view) { cmd(view.state, view.dispatch); view.focus(); } };
}

function closePickers(): void {
  document.querySelectorAll('.rpick').forEach((n) => n.remove());
}

function openPicker(anchor: HTMLElement, content: HTMLElement): void {
  closePickers();
  const rect = anchor.getBoundingClientRect();
  content.classList.add('rpick');
  content.style.top = `${rect.bottom + 4}px`;
  content.style.left = `${Math.min(rect.left, innerWidth - 240)}px`;
  document.body.append(content);
  const dismiss = (e: MouseEvent) => {
    if (!content.contains(e.target as Node)) { content.remove(); removeEventListener('mousedown', dismiss, true); }
  };
  addEventListener('mousedown', dismiss, true);
}

function swatchGrid(kind: 'hl' | 'shade' | 'font'): HTMLElement {
  const grid = h('div', { class: 'swgrid' });
  if (kind === 'hl') {
    for (const c of HL_COLORS) {
      grid.append(h('button', {
        class: 'sw', style: `background:var(--hl-${c})`, title: c,
        onclick: () => { updateSettings({ highlightColor: c }); closePickers(); renderRibbonSwatches(); toast(`Highlight color: ${c}`); view?.focus(); },
      }));
    }
  } else if (kind === 'shade') {
    for (const hex of SHADE_HEXES) {
      grid.append(h('button', {
        class: 'sw', style: `background:#${hex}`, title: `#${hex}`,
        onclick: () => { updateSettings({ shadeHex: hex }); closePickers(); renderRibbonSwatches(); toast(`Background color set`); view?.focus(); },
      }));
    }
  } else {
    for (const hex of FONT_HEXES) {
      grid.append(h('button', {
        class: `sw${hex === 'auto' ? ' auto' : ''}`,
        style: hex === 'auto' ? '' : `background:#${hex}`,
        title: hex === 'auto' ? 'Automatic' : `#${hex}`,
        onclick: () => {
          if (view) {
            const { from, to } = view.state.selection;
            if (from !== to) {
              const tr = hex === 'auto'
                ? view.state.tr.removeMark(from, to, schema.marks.fcolor)
                : view.state.tr.addMark(from, to, schema.marks.fcolor.create({ hex }));
              view.dispatch(tr);
            }
            view.focus();
          }
          closePickers();
        },
      }));
    }
  }
  return grid;
}

function menuList(items: { label: string; hint?: string; run: () => void }[]): HTMLElement {
  return h('div', { class: 'rmenu' },
    ...items.map((it) => h('button', {
      onclick: () => { closePickers(); it.run(); view?.focus(); },
    }, it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null)));
}

function sizeMenu(): HTMLElement {
  return menuList(FONT_SIZES.map((pt) => ({
    label: `${pt} pt`,
    run: () => { if (view) setFontSize(pt * 2)(view.state, view.dispatch); },
  })).concat([{
    label: 'File default (remove size)',
    run: () => { if (view) setFontSize(0)(view.state, view.dispatch); },
  }]));
}

function fontMenu(): HTMLElement {
  return menuList(BODY_FONTS.map((f) => ({
    label: f,
    run: () => setDocumentFont(f),
  })).concat([{
    label: `Restore the file's fonts`,
    run: () => restoreDocumentFonts(),
  }]));
}

function docMenu(): HTMLElement {
  const cmd = (c: Command) => () => { if (view) c(view.state, view.dispatch); };
  return menuList([
    { label: `Standardize highlighting → ${getSettings().highlightColor}`, run: cmd(standardizeHighlights(getSettings().highlightColor)) },
    { label: 'Remove all highlighting', run: cmd(removeAllOf('highlight')) },
    { label: 'Remove all background color', run: cmd(removeAllOf('shd')) },
    { label: 'Highlight → background color', run: cmd(highlightToBackground) },
    { label: 'Background color → highlight', run: cmd(backgroundToHighlight) },
    { label: 'Remove hyperlinks', run: cmd(removeAllOf('link')) },
  ]);
}

function cardMenu(): HTMLElement {
  const cmd = (c: Command) => () => { if (view) c(view.state, view.dispatch); };
  return menuList([
    { label: 'Select card', run: cmd(commands.selectCard) },
    { label: 'Select section', hint: '⌥A', run: cmd(commands.selectSection) },
    { label: 'Condense', hint: 'F3', run: cmd(commands.condense) },
    { label: 'Uncondense', hint: '⌘⌥⇧F3', run: cmd(commands.uncondense) },
    { label: 'Shrink', hint: '⌘8', run: cmd(commands.shrink) },
    { label: 'Regrow', hint: '⌘⇧8', run: cmd(commands.regrow) },
    { label: 'Copy previous cite', hint: '⌥F8', run: cmd(commands.copyPreviousCite) },
    { label: 'Send to speech doc', hint: '`', run: () => { sendToSpeech('cursor'); } },
    { label: 'Park in dropzone', hint: '⌘`', run: () => { sendToDropzone(); } },
    { label: 'Send tag to flow', run: () => sendTagToFlow() },
  ]);
}

function renderRibbonSwatches(): void {
  const s = getSettings();
  const hl = document.querySelector('.rb[data-k="hl"] .glyph') as HTMLElement | null;
  if (hl) hl.style.setProperty('--bar', `var(--hl-${s.highlightColor})`);
  const sh = document.querySelector('.rb[data-k="shade"] .glyph') as HTMLElement | null;
  if (sh) sh.style.setProperty('--bar', `#${s.shadeHex}`);
}

function renderRibbon(): HTMLElement {
  const groups: RibbonBtn[][] = [
    [
      { icon: iconFolder, title: 'Open (Mod-O)', run: () => void openFile() },
      { icon: iconSave, title: 'Save (Mod-S)', run: () => void doSave() },
      { icon: iconExport, title: 'Save As… (Mod-Shift-S)', run: () => void doSaveAs() },
      { icon: iconPaste, title: 'Paste plain text (F2)', run: () => void pastePlain() },
    ],
    [
      { icon: iconUndo, title: 'Undo (Mod-Z)', run: () => undoRedo('undo') },
      { icon: iconRedo, title: 'Redo (Mod-Shift-Z)', run: () => undoRedo('redo') },
      { icon: iconSend, title: 'Send to speech doc (`)', run: () => { sendToSpeech('cursor'); } },
      { icon: iconDown, title: 'Append to speech doc (Alt-`)', run: () => { sendToSpeech('end'); } },
    ],
    [
      { label: 'Pocket', kbd: 'F4', k: 'h1', title: 'Pocket — Heading 1', run: runCmd(commands.pocket) },
      { label: 'Tag', kbd: 'F7', k: 'h4', title: 'Tag', run: runCmd(commands.tag) },
      { label: 'Hat', kbd: 'F5', k: 'h2', title: 'Hat — Heading 2', run: runCmd(commands.hat) },
      { label: 'Block', kbd: 'F6', k: 'h3', title: 'Block — Heading 3', run: runCmd(commands.block) },
      { label: 'Analytic', kbd: '⌘F7', cls: 'analytic', k: 'analytic', title: 'Analytic — standalone analysis', run: runCmd(commands.analytic) },
      { label: 'Undertag', kbd: '⌘F8', cls: 'undertag', k: 'undertag', title: 'Undertag — annotation under a tag', run: runCmd(commands.undertag) },
    ],
    [
      { label: 'Cite', kbd: 'F8', k: 'cite', title: 'Cite style', run: runCmd(commands.cite) },
      { label: 'Underline', kbd: 'F9', k: 'ustyle', title: 'Underline style', run: runCmd(commands.underlineStyle) },
      { label: 'Emphasis', kbd: 'F10', k: 'emph', title: 'Emphasis style', run: runCmd(commands.emphasis) },
      { label: 'Clear', kbd: 'F12', title: 'Clear formatting', run: runCmd(commands.clear) },
      { label: 'Condense', kbd: 'F3', title: 'Condense the card (Alt-F3 flat · ⌘Alt-F3 pilcrows · ⌘Alt-Shift-F3 restore)', run: () => { if (view) { const cmd = commands.condense; cmd(view.state, view.dispatch); view.focus(); } } },
      { label: 'Case', kbd: '⇧F3', title: 'Cycle case: lower → UPPER → Title', run: runCmd(commands.toggleCase) },
    ],
    [
      { glyph: 'A', cls: 'cbar', k: 'hl', title: 'Highlight (F11) — active color', run: () => { if (view) { toggleHighlight(getSettings().highlightColor)(view.state, view.dispatch); view.focus(); } },
        picker: () => swatchGrid('hl') },
      { glyph: 'A', cls: 'cbar', k: 'shade', title: 'Background color (⌘F11)', run: () => { if (view) { toggleShade(getSettings().shadeHex)(view.state, view.dispatch); view.focus(); } },
        picker: () => swatchGrid('shade') },
      { glyph: 'A', cls: 'fcol', title: 'Font color', run: () => {}, picker: () => swatchGrid('font') },
    ],
    [
      { label: 'Font ▾', title: 'Document font — changes the file, like changing it in Word', menu: true, picker: () => fontMenu() },
      { glyph: '11', cls: 'fsz', title: 'Font size (pt)', menu: true, picker: () => sizeMenu() },
      { glyph: 'A˄', title: 'Grow font 1pt', run: runCmd(stepFontSize(1, () => 22)) },
      { glyph: 'A˅', title: 'Shrink font 1pt', run: runCmd(stepFontSize(-1, () => 22)) },
    ],
    [
      { label: 'Doc ▾', title: 'Document operations', menu: true, picker: () => docMenu() },
      { label: 'Card ▾', title: 'Card operations', menu: true, picker: () => cardMenu() },
    ],
    [
      { glyph: 'B', cls: 'bld', k: 'bold', title: 'Bold (⌘B)', run: runCmd(commands.bold) },
      { glyph: 'x²', k: 'sup', title: 'Superscript', run: runCmd(commands.superscript) },
      { glyph: 'A−', title: 'Shrink un-underlined (⌘8)', run: runCmd(commands.shrink) },
      { glyph: 'I', cls: 'ita', k: 'italic', title: 'Italic (⌘I)', run: runCmd(commands.italic) },
      { glyph: 'x₂', k: 'sub', title: 'Subscript', run: runCmd(commands.subscript) },
      { glyph: 'A+', title: 'Regrow — restore full size (⌘⇧8)', run: runCmd(commands.regrow) },
      { glyph: 'S', cls: 'strike', k: 'strike', title: 'Strikethrough', run: runCmd(commands.strike) },
      { glyph: '¶', title: 'Copy previous cite (Alt-F8)', run: runCmd(commands.copyPreviousCite) },
    ],
    [
      { icon: iconEye, k: 'read', title: 'Read mode — show only what gets read', run: () => toggleReadMode() },
      { icon: iconFind, title: 'Find (⌘F) / Replace (⌘H)', run: () => openFind(true) },
      { glyph: 'Σ', title: 'Word count & read times', run: () => openWordCount() },
      { icon: iconBook, title: 'Flashcards', soon: 'Flashcards' },
    ],
  ];
  const right: RibbonBtn[] = [
    { icon: iconKeys, title: 'Keyboard shortcuts', run: () => openSettings('shortcuts') },
    { icon: iconGear, title: 'Settings', run: () => openSettings() },
    { icon: iconTimer, title: 'Timer — speech & prep (pop-out inside)', run: () => toggleTimerPanel() },
    { icon: iconHome, title: 'Home', run: () => { syncActiveState(); showingHome = true; renderAll(); } },
  ];
  const btn = (b: RibbonBtn) => {
    const el = h('button', {
      class: `rb${b.cls ? ` ${b.cls}` : ''}${b.label ? ' wide' : ''}`,
      title: b.title,
      ...(b.k ? { 'data-k': b.k } : {}),
      onclick: b.menu
        ? (e: Event) => openPicker(e.currentTarget as HTMLElement, b.picker!())
        : (b.run ?? (() => toast(`${b.soon} is on the roadmap — not in v0.2 yet.`))),
    },
      b.icon ? b.icon() : null,
      b.glyph ? h('span', { class: `glyph${b.cls ? ` ${b.cls}` : ''}` }, b.glyph) : null,
      b.label ?? null,
      b.kbd ? h('kbd', {}, b.kbd) : null,
    );
    if (!b.picker || b.menu) return el;
    const wrap = h('span', { class: 'rsplit' }, el,
      h('button', {
        class: 'rb arrow', title: `${b.title} — pick color`, 'aria-label': 'Pick color',
        onclick: (e: Event) => openPicker(e.currentTarget as HTMLElement, b.picker!()),
      }, '▾'));
    return wrap;
  };
  const bar = h('div', { class: 'ribbon', role: 'toolbar', 'aria-label': 'All commands' },
    ...groups.map((g) => h('div', { class: 'rg' }, ...g.map(btn))),
    h('div', { class: 'rg last' }, ...right.map(btn)),
  );
  requestAnimationFrame(() => { renderRibbonSwatches(); updateRibbonState(); });
  return bar;
}

/** Light the style buttons for whatever the cursor sits in — like CardMirror. */
function updateRibbonState(): void {
  if (!view) return;
  const state = view.state;
  const { $from, from, to, empty } = state.selection;
  const parent = $from.parent;
  const on: Record<string, boolean> = {
    h1: false, h2: false, h3: false, h4: false, analytic: false, undertag: false,
    read: readMode,
  };
  if (parent.type === schema.nodes.heading) on[`h${parent.attrs.level}`] = true;
  if (parent.type === schema.nodes.paragraph && parent.attrs.kind === 'analytic') on.analytic = true;
  if (parent.type === schema.nodes.paragraph && parent.attrs.kind === 'undertag') on.undertag = true;
  const M = schema.marks;
  const has = (t: any) => empty
    ? !!t.isInSet(state.storedMarks ?? $from.marks())
    : state.doc.rangeHasMark(from, to, t);
  on.cite = has(M.cite); on.ustyle = has(M.ustyle); on.emph = has(M.emph);
  on.hl = has(M.highlight); on.shade = has(M.shd);
  on.sup = false; on.sub = false;
  const vert = empty ? M.vert.isInSet(state.storedMarks ?? $from.marks()) : null;
  if (vert) { on.sup = vert.attrs.v === 'superscript'; on.sub = vert.attrs.v === 'subscript'; }
  on.strike = has(M.strike);
  on.bold = has(M.bold);
  on.italic = has(M.italic);
  document.querySelectorAll<HTMLElement>('.rb[data-k]').forEach((el) => {
    el.classList.toggle('on', !!on[el.dataset.k!]);
  });
}

function undoRedo(which: 'undo' | 'redo'): void {
  if (!view) return;
  (which === 'undo' ? undoCmd : redoCmd)(view.state, view.dispatch);
  view.focus();
}

// --- speech pane + dropzone ---
function renderSpeech(): void {
  const el = document.getElementById('speechpane');
  if (!el) return;
  const sp = speechSession();
  const s = getSettings();
  const dz = h('div', { class: 'dz' },
    h('div', { class: 'dz-head' },
      h('span', { class: 'rail-label' }, 'DROPZONE'),
      h('span', { class: 'dz-hint' }, '⌘` parks a card'),
    ),
    ...(dropzone.length === 0
      ? [h('div', { class: 'speech-empty' }, 'A holding shelf. Park a card here when you know you need it but not where yet.')]
      : dropzone.map((item, i) => h('div', { class: 'dz-item' },
          h('button', { class: 'dz-take', title: 'Insert at cursor', onclick: () => insertFromDropzone(i) }, item.label),
          h('button', { class: 'dz-x', title: 'Remove', onclick: () => { dropzone.splice(i, 1); renderSpeech(); } }, '×'),
        ))),
  );
  if (!sp) {
    el.replaceChildren(
      h('div', { class: 'speech-head' }, h('h2', {}, 'Speech doc')),
      h('div', { class: 'speech-empty' },
        'No speech doc yet. Create one from Home, or mark any open tab as the speech doc from the command palette. Then ` sends the card under your cursor here.'),
      dz,
    );
    return;
  }
  const state = sp.id === activeId && view ? view.state : sp.state;
  const cards: { tag: string; words: number }[] = [];
  let current: { tag: string; words: number } | null = null;
  state.doc.forEach((node) => {
    if (node.type === schema.nodes.heading && node.attrs.level === 4) {
      current = { tag: node.textContent || '(untagged)', words: 0 };
      cards.push(current);
    } else if (current && node.type === schema.nodes.paragraph) {
      current.words += (node.textContent.match(/[\w'’-]+/g) ?? []).length;
    }
  });
  const totalWords = readableWords(state.doc);
  const secs = secondsAt(totalWords, s.reader1Wpm);
  el.replaceChildren(
    h('div', { class: 'speech-head' },
      h('h2', {}, sp.name, h('span', { class: 'vs' }, 'speech doc')),
      renderTimerButton(),
    ),
    h('div', { class: 'speech-list' },
      ...(cards.length === 0
        ? [h('div', { class: 'speech-empty' }, 'Send cards here: cursor on a card, press ` (backtick). Alt-` appends at the end.')]
        : cards.map((c) => h('button', { class: 'sent', onclick: () => { syncActiveState(); activeId = sp.id; showingHome = false; renderAll(); } },
            h('p', { class: 's-tag' }, c.tag),
            h('p', { class: 's-meta' }, h('span', {}, `${c.words} w`)),
          ))),
    ),
    dz,
    h('div', { class: 'speech-foot' },
      h('span', {}, `${cards.length} card${cards.length === 1 ? '' : 's'}`),
      h('span', {}, 'reads ', h('b', {}, fmtTime(secs))),
    ),
  );
}

// --- speech timer ---
let timerRemain = getSettings().speechSeconds;
let timerHandle: number | null = null;

function renderTimerButton(): HTMLElement {
  const btn = h('button', {
    class: `timer${timerHandle ? ' on' : ''}`, id: 'speechTimer',
    'aria-label': 'Start or pause the speech timer',
    onclick: () => toggleTimer(),
  }, h('span', { class: 'run' }), h('span', { id: 'timerText' }, fmtTime(timerRemain)));
  return btn;
}

function toggleTimer(): void {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  else {
    timerHandle = window.setInterval(() => {
      timerRemain = Math.max(0, timerRemain - 1);
      const t = document.getElementById('timerText');
      if (t) t.textContent = fmtTime(timerRemain);
      if (timerRemain === 0 && timerHandle) { clearInterval(timerHandle); timerHandle = null; document.getElementById('speechTimer')?.classList.remove('on'); }
    }, 1000);
  }
  document.getElementById('speechTimer')?.classList.toggle('on', !!timerHandle);
}

// --- the round timer: speech + prep, each a timer or a stopwatch, any length ---
interface Clock {
  mode: 'timer' | 'stopwatch';
  setSec: number;      // the configured length (timer mode)
  cur: number;         // seconds remaining (timer) or elapsed (stopwatch)
  running: boolean;
  handle: number | null;
}
const clocks: Record<'speech' | 'prep', Clock> = {
  speech: { mode: 'timer', setSec: 6 * 60, cur: 6 * 60, running: false, handle: null },
  prep: { mode: 'timer', setSec: 4 * 60, cur: 4 * 60, running: false, handle: null },
};

function parseClockTime(text: string): number | null {
  const m = /^(\d{1,3})(?::([0-5]?\d))?$/.exec(text.trim());
  if (!m) return null;
  // "630" keypad-style: last two digits are seconds. "6:30" is explicit.
  if (m[2] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
  const digits = m[1];
  if (digits.length <= 2) return Number(digits) * 60; // "6" -> 6:00
  return Number(digits.slice(0, -2)) * 60 + Number(digits.slice(-2));
}

function clockText(c: Clock): string {
  return fmtTime(Math.max(0, Math.round(c.cur)));
}

function refreshClockDisplays(): void {
  for (const key of ['speech', 'prep'] as const) {
    const c = clocks[key];
    document.querySelectorAll<HTMLElement>(`[data-clock="${key}"]`).forEach((el) => {
      el.textContent = clockText(c);
      el.classList.toggle('done', c.mode === 'timer' && c.cur <= 0);
      el.classList.toggle('running', c.running);
    });
    document.querySelectorAll<HTMLElement>(`[data-clockbtn="${key}"]`).forEach((el) => {
      el.textContent = c.running ? '❚❚' : '▶';
    });
  }
}

function toggleClock(key: 'speech' | 'prep'): void {
  const c = clocks[key];
  if (c.running) {
    if (c.handle) clearInterval(c.handle);
    c.handle = null; c.running = false;
  } else {
    c.running = true;
    c.handle = window.setInterval(() => {
      if (c.mode === 'timer') {
        c.cur = Math.max(0, c.cur - 1);
        if (c.cur === 0 && c.handle) { clearInterval(c.handle); c.handle = null; c.running = false; }
      } else {
        c.cur += 1;
      }
      refreshClockDisplays();
    }, 1000);
  }
  refreshClockDisplays();
}

function resetClock(key: 'speech' | 'prep'): void {
  const c = clocks[key];
  if (c.handle) clearInterval(c.handle);
  c.handle = null; c.running = false;
  c.cur = c.mode === 'timer' ? c.setSec : 0;
  refreshClockDisplays();
}

function setClockMode(key: 'speech' | 'prep', mode: Clock['mode']): void {
  const c = clocks[key];
  c.mode = mode;
  resetClock(key);
}

/** One clock row: label · big time · set-time input · mode · start · reset. */
function clockRow(key: 'speech' | 'prep', label: string): HTMLElement {
  const c = clocks[key];
  const input = h('input', {
    type: 'text', class: 'tp-set', value: fmtTime(c.setSec), 'aria-label': `${label} length`,
    title: 'Length — 6:30, or keypad style: 630',
    onchange: () => {
      const sec = parseClockTime(input.value);
      if (sec === null || sec <= 0) { input.value = fmtTime(c.setSec); return; }
      c.setSec = sec;
      input.value = fmtTime(sec);
      resetClock(key);
    },
  });
  const modeBtn = h('button', {
    class: 'tp-mode', title: 'Switch between countdown timer and stopwatch',
    onclick: () => {
      setClockMode(key, c.mode === 'timer' ? 'stopwatch' : 'timer');
      modeBtn.textContent = c.mode === 'timer' ? 'timer' : 'stopwatch';
      input.disabled = c.mode === 'stopwatch';
    },
  }, c.mode === 'timer' ? 'timer' : 'stopwatch');
  if (c.mode === 'stopwatch') (input as HTMLInputElement).disabled = true;
  return h('div', { class: 'tp-row' },
    h('div', { class: 'tp-top' },
      h('span', { class: 'tp-label' }, label),
      modeBtn,
    ),
    h('div', { class: 'tp-main' },
      h('span', { class: `tp-time${c.running ? ' running' : ''}`, 'data-clock': key }, clockText(c)),
      h('div', { class: 'tp-ctl' },
        input,
        h('button', { class: 'tp-go', 'data-clockbtn': key, 'aria-label': `Start or pause ${label}`, onclick: () => toggleClock(key) }, c.running ? '❚❚' : '▶'),
        h('button', { class: 'tp-reset', 'aria-label': `Reset ${label}`, onclick: () => resetClock(key) }, '↺'),
      ),
    ),
  );
}

function timerPanelContent(): HTMLElement {
  return h('div', { class: 'tp-body' },
    clockRow('speech', 'SPEECH'),
    clockRow('prep', 'PREP'),
  );
}

function toggleTimerPanel(): void {
  const existing = document.getElementById('timerpanel');
  if (existing) { existing.remove(); return; }
  const panel = h('div', { class: 'timerpanel', id: 'timerpanel' },
    h('div', { class: 'tp-head' },
      h('span', {}, 'Timer'),
      h('button', { class: 'tp-pop', title: 'Pop out into its own window', onclick: () => { popoutTimer(); } }, '⇱'),
      h('button', { class: 'tp-x', title: 'Close', onclick: () => document.getElementById('timerpanel')?.remove() }, '×'),
    ),
    timerPanelContent(),
  );
  document.body.append(panel);
  refreshClockDisplays();
}

function popoutTimer(): void {
  const url = `${location.href.split('#')[0]}#timer`;
  const w = window.open(url, 'spread-timer', 'width=340,height=300');
  if (!w) { toast('Pop-up blocked — allow pop-ups for this site to use the timer window.'); return; }
  document.getElementById('timerpanel')?.remove();
}

/** Standalone timer window (#timer) — same clocks, tiny chrome. */
export function bootTimer(): void {
  document.title = 'Timer — Spread';
  applyTheme(getSettings());
  document.body.classList.add('timerwin');
  root().replaceChildren(
    h('div', { class: 'timerpanel standalone' },
      h('div', { class: 'tp-head' }, h('span', {}, 'Spread timer')),
      timerPanelContent(),
    ),
  );
  refreshClockDisplays();
}

// --- status bar ---
function renderStatusEl(): HTMLElement {
  return h('div', { class: 'status', id: 'status' });
}

function renderStatus(): void {
  const el = document.getElementById('status');
  if (!el) return;
  const s = activeSession();
  const cfg = getSettings();
  if (showingFlow) {
    const f = activeFlow();
    el.replaceChildren(
      h('span', { class: 'sigma' }, 'Σ'),
      h('span', { class: 'mono' }, f
        ? `Flow: ${f.name} · ${f.grid.length} row${f.grid.length === 1 ? '' : 's'} · saved on this machine`
        : 'Flow — saved on this machine, exportable as JSON'),
      h('span', { class: 'grow' }),
    );
    return;
  }
  if (showingHome || !s) {
    el.replaceChildren(
      h('span', { class: 'sigma' }, 'Σ'),
      h('span', { class: 'mono' }, 'Spread — free, open-source, Verbatim-compatible'),
      h('span', { class: 'grow' }),
    );
    return;
  }
  const state = view?.state ?? s.state;
  const words = readableWords(state.doc);
  let line = `Doc: ${words} · Reader 1: ${fmtTime(secondsAt(words, cfg.reader1Wpm))} · Reader 2: ${fmtTime(secondsAt(words, cfg.reader2Wpm))}`;
  const sel = state.selection;
  if (!sel.empty) {
    const selWords = readableWordsInSelection(state.doc, sel.from, sel.to);
    line += ` | Sel: ${selWords} · ${fmtTime(secondsAt(selWords, cfg.reader1Wpm))}`;
  } else {
    const card = cardBodyRange(state);
    if (card) {
      const cw = readableWordsInSelection(state.doc, card.from, card.to);
      if (cw > 0 && cw < words) line += ` | Card: ${cw} · ${fmtTime(secondsAt(cw, cfg.reader1Wpm))}`;
    }
  }
  el.replaceChildren(
    h('span', { class: 'sigma', role: 'button', title: 'Word count & read times', onclick: () => openWordCount() }, 'Σ'),
    h('span', { class: 'mono' }, line),
    h('span', { class: 'grow' }),
    h('span', { class: s.dirty ? 'unsaved' : 'saved' }, s.dirty ? (s.handle ? 'Autosaving…' : 'Unsaved changes') : 'Saved'),
    h('div', { class: 'zoom' },
      h('button', { 'aria-label': 'Zoom out', onclick: () => zoomBy(-10) }, '−'),
      h('span', { class: 'pct' }, `${cfg.zoom}%`),
      h('button', { 'aria-label': 'Zoom in', onclick: () => zoomBy(10) }, '+'),
      h('button', { 'aria-label': 'Reset zoom', style: 'font-size:11px', onclick: () => { updateSettings({ zoom: 100 }); applyZoom(); renderStatus(); } }, '⟲'),
    ),
  );
}

// --- word count dialog ---
function openWordCount(): void {
  const s = activeSession();
  if (!s) return;
  const state = view?.state ?? s.state;
  const cfg = getSettings();
  const words = readableWords(state.doc);
  const sel = state.selection;
  const rows: HTMLElement[] = [
    h('div', { class: 'wc-row' }, h('b', {}, 'Document'), h('span', {}, `${words} readable words`)),
    h('div', { class: 'wc-row' }, h('span', {}, `Reader 1 (${cfg.reader1Wpm} wpm)`), h('span', {}, fmtTime(secondsAt(words, cfg.reader1Wpm)))),
    h('div', { class: 'wc-row' }, h('span', {}, `Reader 2 (${cfg.reader2Wpm} wpm)`), h('span', {}, fmtTime(secondsAt(words, cfg.reader2Wpm)))),
  ];
  if (!sel.empty) {
    const sw = readableWordsInSelection(state.doc, sel.from, sel.to);
    rows.push(
      h('div', { class: 'wc-row sep' }, h('b', {}, 'Selection'), h('span', {}, `${sw} readable words`)),
      h('div', { class: 'wc-row' }, h('span', {}, 'Reader 1'), h('span', {}, fmtTime(secondsAt(sw, cfg.reader1Wpm)))),
    );
  }
  closeOverlay();
  showOverlay(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Word count' },
    h('h2', {}, 'Word count', h('button', { class: 'x', onclick: closeOverlay, 'aria-label': 'Close' }, '×')),
    ...rows,
    h('p', { class: 'note' }, 'Only words that get read out loud count: tags, cites, analytics, underlines, and highlights. Reader speeds live in Settings.'),
  ));
}

// --- command palette ---
interface PaletteItem { label: string; hint?: string; run: () => void }

function paletteItems(): PaletteItem[] {
  const run = (cmd: Command) => () => { if (view) { cmd(view.state, view.dispatch); view.focus(); } };
  const items: PaletteItem[] = [
    { label: 'New document', run: () => newDocument(false) },
    { label: 'New speech document', run: () => newDocument(true) },
    { label: 'Open…', hint: '⌘O', run: () => void openFile() },
    { label: 'Save', hint: '⌘S', run: () => void doSave() },
    { label: 'Save As…', hint: '⌘⇧S', run: () => void doSaveAs() },
    { label: 'Go home', run: () => { syncActiveState(); showingHome = true; renderAll(); } },
    { label: 'Paste plain text', hint: 'F2', run: () => void pastePlain() },
    { label: 'Pocket (Heading 1)', hint: 'F4', run: run(commands.pocket) },
    { label: 'Hat (Heading 2)', hint: 'F5', run: run(commands.hat) },
    { label: 'Block (Heading 3)', hint: 'F6', run: run(commands.block) },
    { label: 'Tag', hint: 'F7', run: run(commands.tag) },
    { label: 'Analytic', hint: '⌘F7', run: run(commands.analytic) },
    { label: 'Undertag', hint: '⌘F8', run: run(commands.undertag) },
    { label: 'Cite', hint: 'F8', run: run(commands.cite) },
    { label: 'Copy previous cite', hint: '⌥F8', run: run(commands.copyPreviousCite) },
    { label: 'Underline', hint: 'F9', run: run(commands.underlineStyle) },
    { label: 'Emphasis', hint: 'F10', run: run(commands.emphasis) },
    { label: 'Highlight', hint: 'F11', run: () => { if (view) { toggleHighlight(getSettings().highlightColor)(view.state, view.dispatch); view.focus(); } } },
    { label: 'Background color', hint: '⌘F11', run: () => { if (view) { toggleShade(getSettings().shadeHex)(view.state, view.dispatch); view.focus(); } } },
    { label: 'Clear formatting', hint: 'F12', run: run(commands.clear) },
    { label: 'Condense card', hint: 'F3', run: run(commands.condense) },
    { label: 'Condense with pilcrows', hint: '⌘⌥F3', run: run(commands.condense) },
    { label: 'Uncondense (restore breaks)', hint: '⌘⌥⇧F3', run: run(commands.uncondense) },
    { label: 'Toggle case (lower / UPPER / Title)', hint: '⇧F3', run: run(commands.toggleCase) },
    { label: 'Shrink un-underlined text', hint: '⌘8', run: run(commands.shrink) },
    { label: 'Regrow (restore full size)', hint: '⌘⇧8', run: run(commands.regrow) },
    { label: 'Indent', hint: 'Tab', run: run(commands.indent) },
    { label: 'Outdent', hint: '⇧Tab', run: run(commands.outdent) },
    { label: 'Reading-position marker', hint: '⌘⇧D', run: run(toggleMarker(nowShort)) },
    { label: 'Read mode', run: () => toggleReadMode() },
    { label: 'Find in document', hint: '⌘F', run: () => openFind() },
    { label: 'Find and replace', hint: '⌘H', run: () => openFind(true) },
    { label: 'Word count & read times', run: () => openWordCount() },
    { label: 'Select card', run: run(commands.selectCard) },
    { label: 'Select section', hint: '⌥A', run: run(commands.selectSection) },
    { label: 'Send to speech doc', hint: '`', run: () => { sendToSpeech('cursor'); } },
    { label: 'Append to speech doc', hint: '⌥`', run: () => { sendToSpeech('end'); } },
    { label: 'Park in dropzone', hint: '⌘`', run: () => { sendToDropzone(); } },
    { label: 'Mark this tab as speech doc', run: () => { const s = activeSession(); if (s) { for (const o of sessions) o.isSpeech = false; s.isSpeech = true; renderAll(); } } },
    { label: 'Open the flow', run: () => openFlow() },
    { label: 'Send tag to flow', run: () => sendTagToFlow() },
    { label: 'Test your reading speed (WPM)', run: () => openWpmTest() },
    { label: 'Timer panel (speech & prep)', run: () => toggleTimerPanel() },
    { label: 'Pop-out timer', run: () => popoutTimer() },
    { label: 'Take the tour', run: () => openTutorial() },
    { label: 'Keyboard shortcuts', run: () => openSettings('shortcuts') },
    { label: 'Settings…', run: () => openSettings() },
  ];
  for (const c of HL_COLORS) {
    items.push({ label: `Set highlight color: ${c}`, run: () => { updateSettings({ highlightColor: c }); renderRibbonSwatches(); toast(`Highlight color: ${c}`); } });
  }
  return items;
}

function openPalette(): void {
  closeOverlay();
  const items = paletteItems();
  let filtered = items;
  let sel = 0;
  const list = h('ul', {});
  const render = () => {
    list.replaceChildren(...(filtered.length === 0
      ? [h('div', { class: 'none' }, 'No matching command.')]
      : filtered.map((item, i) => h('li', {
          class: i === sel ? 'sel' : '',
          onclick: () => { closeOverlay(); item.run(); },
          onmouseenter: () => { sel = i; render(); },
        }, item.label, item.hint ? h('span', { class: 'hint' }, item.hint) : null))));
  };
  const input = h('input', {
    type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command',
    oninput: () => {
      const q = input.value.toLowerCase();
      filtered = items.filter((i) => i.label.toLowerCase().includes(q));
      sel = 0; render();
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, filtered.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { const item = filtered[sel]; if (item) { closeOverlay(); item.run(); } }
      else if (e.key === 'Escape') closeOverlay();
    },
  });
  render();
  showOverlay(h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command palette' }, input, list));
  input.focus();
}

// --- save as modal (with presets) ---
function openSaveAsModal(s: Session): void {
  closeOverlay();
  const nameInput = h('input', { type: 'text', value: s.name });
  let preset: 'asis' | 'send' | 'read' = 'asis';
  const presetBtns: HTMLButtonElement[] = [];
  const pick = (p: typeof preset, base: string) => () => {
    preset = p;
    presetBtns.forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    const cfg = getSettings();
    const strip = new RegExp(`^(${[cfg.sendPrefix, cfg.readPrefix].filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
    const raw = cfg.sendPrefix || cfg.readPrefix ? nameInput.value.replace(strip, '') : nameInput.value;
    nameInput.value = !cfg.prefixPresets ? raw
      : p === 'send' ? `${cfg.sendPrefix}${raw}` : p === 'read' ? `${cfg.readPrefix}${raw}` : raw;
    void base;
  };
  const presetBtn = (p: typeof preset, label: string, desc: string) => {
    const b = h('button', { class: `opt${p === 'asis' ? ' on' : ''}`, 'data-p': p, title: desc, onclick: pick(p, s.name) }, label);
    presetBtns.push(b);
    return b;
  };
  showOverlay(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Save As' },
    h('h2', {}, 'Save As', h('button', { class: 'x', onclick: closeOverlay, 'aria-label': 'Close' }, '×')),
    h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
    h('div', { class: 'field' },
      h('label', {}, 'What to save'),
      h('div', { class: 'row' },
        presetBtn('asis', 'As-is', 'A full copy'),
        presetBtn('send', 'Send Doc', 'A clean copy for the judge or opponent — analytics and undertags stripped'),
        presetBtn('read', 'Read Doc', 'Only what gets read: tags, cites, analytics, highlighted text'),
      ),
      h('p', { class: 'note' }, 'Send Doc strips analytics and undertags. Read Doc keeps only read-aloud content. Both leave this tab untouched.'),
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'stamp',
        onclick: async () => {
          let name = nameInput.value.trim() || 'Untitled.docx';
          if (!name.toLowerCase().endsWith('.docx')) name += '.docx';
          closeOverlay();
          try {
            const transform = preset === 'send' ? stripForSendDoc : preset === 'read' ? stripForReadDoc : undefined;
            const bytes = sessionBytes(s, transform);
            const handle = await saveAs(bytes, name);
            if (preset === 'asis') {
              if (handle) { s.handle = handle; s.name = handle.name ?? name; void addRecent({ name: s.name, openedAt: Date.now(), handle }); }
              else s.name = name;
              s.dirty = false;
            }
            renderAll();
            toast(handle ? `Saved ${name}` : `Downloaded ${name}`);
          } catch (e) { toast(`Save failed: ${(e as Error).message}`); }
        },
      }, 'Save'),
      h('button', { class: 'opt', onclick: closeOverlay }, 'Cancel'),
    ),
  ));
  nameInput.focus();
  nameInput.setSelectionRange(0, nameInput.value.replace(/\.docx$/i, '').length);
}

// --- settings (tabbed) ---
type SettingsTab = 'general' | 'files' | 'appearance' | 'editing' | 'shortcuts';

function openSettings(tab: SettingsTab = 'general'): void {
  closeOverlay();
  let active: SettingsTab = tab;
  const body = h('div', { class: 'set-body' });

  const optRow = (label: string, opts: [string, string][], current: string, set: (v: string) => void, note?: string) =>
    h('div', { class: 'field' },
      h('label', {}, label),
      h('div', { class: 'row' }, ...opts.map(([value, text]) => h('button', {
        class: `opt${current === value ? ' on' : ''}`,
        onclick: () => { set(value); render(); },
      }, text))),
      note ? h('p', { class: 'note' }, note) : null,
    );

  const numRow = (label: string, value: number, min: number, set: (n: number) => void) => {
    const input = h('input', {
      type: 'number', value: String(value), min: String(min),
      onchange: () => set(Math.max(min, Number(input.value) || value)),
    });
    return h('div', { class: 'field' }, h('label', {}, label), input);
  };

  const textRow = (label: string, value: string, placeholder: string, set: (v: string) => void, note?: string) => {
    const input = h('input', {
      type: 'text', value, placeholder,
      onchange: () => set(input.value),
    });
    return h('div', { class: 'field' }, h('label', {}, label), input, note ? h('p', { class: 'note' }, note) : null);
  };

  function renderGeneral(): HTMLElement[] {
    const s = getSettings();
    return [
      optRow('Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme,
        (v) => updateSettings({ theme: v as Settings['theme'] })),
      optRow('Default outline depth', [['1', 'Pocket'], ['2', 'Hat'], ['3', 'Block'], ['4', 'Tag']], String(s.navDepth),
        (v) => updateSettings({ navDepth: Number(v) as 1 | 2 | 3 | 4 })),
      numRow('Reader 1 (you) — words per minute', s.reader1Wpm, 60, (n) => updateSettings({ reader1Wpm: n })),
      numRow('Reader 2 (partner) — words per minute', s.reader2Wpm, 60, (n) => updateSettings({ reader2Wpm: n })),
      h('div', { class: 'field' },
        h('label', {}, 'Not sure of your speed?'),
        h('div', { class: 'row' },
          h('button', { class: 'opt', onclick: () => openWpmTest() }, 'Test your WPM'),
        ),
        h('p', { class: 'note' }, 'A stopwatch and a word count — no microphone, nothing recorded.'),
      ),
      numRow('Speech timer length (seconds)', s.speechSeconds, 30, (n) => updateSettings({ speechSeconds: n })),
    ];
  }

  function renderFiles(): HTMLElement[] {
    const s = getSettings();
    return [
      optRow('Autosave', [['on', 'On'], ['off', 'Off']], s.autosave ? 'on' : 'off',
        (v) => updateSettings({ autosave: v === 'on' }),
        'Autosave writes back to the opened file a few seconds after you stop typing. It needs the browser file permission (Chrome/Edge).'),
      optRow('Prefix preset saves', [['on', 'On'], ['off', 'Off']], s.prefixPresets ? 'on' : 'off',
        (v) => updateSettings({ prefixPresets: v === 'on' }),
        'When on, the Send Doc and Read Doc presets prepend the prefixes below to the filename.'),
      textRow('Send Doc filename prefix', s.sendPrefix, 'SEND_', (v) => updateSettings({ sendPrefix: v })),
      textRow('Read Doc filename prefix', s.readPrefix, 'READ_', (v) => updateSettings({ readPrefix: v })),
    ];
  }

  function renderAppearance(): HTMLElement[] {
    const s = getSettings();
    const sizeInputs: [keyof typeof s.styleSizes, string][] = [
      ['normal', 'Body'], ['pocket', 'Pocket'], ['hat', 'Hat'], ['block', 'Block'],
      ['tag', 'Tag'], ['analytic', 'Analytic'], ['undertag', 'Undertag'],
      ['cite', 'Cite'], ['underline', 'Underline'], ['emphasis', 'Emphasis'],
    ];
    const colorRow = (label: string, value: string, set: (v: string) => void) => {
      const input = h('input', { type: 'color', value, onchange: () => set(input.value) });
      return h('div', { class: 'field cfield' }, h('label', {}, label), input);
    };
    return [
      optRow('Dark mode and the page', [['paper', 'Page stays white'], ['themed', 'Theme colors the page']],
        s.docFollowsTheme ? 'themed' : 'paper',
        (v) => updateSettings({ docFollowsTheme: v === 'themed' })),
      optRow('Body font', [['', 'File default'], ...BODY_FONTS.map((f) => [f, f] as [string, string])], s.bodyFont,
        (v) => updateSettings({ bodyFont: v }),
        'Display-only: changes how body text renders here, never what the file carries.'),
      h('div', { class: 'field' },
        h('label', {}, 'Style font sizes (pt) — blank uses the file\'s own size'),
        h('div', { class: 'szgrid' },
          ...sizeInputs.map(([key, label]) => {
            const input = h('input', {
              type: 'number', min: '4', max: '72', placeholder: '—',
              value: s.styleSizes[key] ? String(s.styleSizes[key]) : '',
              onchange: () => {
                const n = Number(input.value);
                const next = { ...getSettings().styleSizes };
                if (n >= 4 && n <= 72) next[key] = n; else delete next[key];
                updateSettings({ styleSizes: next });
              },
            });
            return h('span', { class: 'szcell' }, h('span', {}, label), input);
          }),
        ),
        h('p', { class: 'note' }, 'Display-only overrides layered over the file\'s styles. Clear a box to go back to the file\'s size.'),
      ),
      colorRow('Analytic text color', s.analyticColor, (v) => updateSettings({ analyticColor: v })),
      colorRow('Undertag text color', s.undertagColor, (v) => updateSettings({ undertagColor: v })),
      optRow('Maximum text width', [['off', 'Off'], ['on', 'On']], s.maxWidthOn ? 'on' : 'off',
        (v) => updateSettings({ maxWidthOn: v === 'on' })),
      ...(s.maxWidthOn ? [numRow('Text width (px)', s.maxWidthPx, 400, (n) => updateSettings({ maxWidthPx: Math.min(3000, n) }))] : []),
      numRow('Zoom (%)', s.zoom, 50, (n) => { updateSettings({ zoom: Math.min(300, n) }); applyZoom(); }),
    ];
  }

  function renderEditing(): HTMLElement[] {
    const s = getSettings();
    return [
      h('div', { class: 'field' },
        h('label', {}, 'Highlight color (F11)'),
        h('div', { class: 'swrow' }, ...HL_COLORS.map((c) => h('button', {
          class: `sw${s.highlightColor === c ? ' on' : ''}`,
          style: `background:var(--hl-${c})`,
          title: c, 'aria-label': `Highlight ${c}`,
          onclick: () => { updateSettings({ highlightColor: c }); render(); },
        }))),
      ),
      h('div', { class: 'field' },
        h('label', {}, 'Background color (⌘F11)'),
        h('div', { class: 'swrow' }, ...SHADE_HEXES.map((hex) => h('button', {
          class: `sw${s.shadeHex === hex ? ' on' : ''}`,
          style: `background:#${hex}`,
          title: `#${hex}`, 'aria-label': `Background #${hex}`,
          onclick: () => { updateSettings({ shadeHex: hex }); render(); },
        }))),
        h('p', { class: 'note' }, 'Background color is a separate layer from highlighting — bulk highlight edits leave it alone.'),
      ),
      optRow('Spellcheck', [['off', 'Off'], ['on', 'On']], s.spellcheck ? 'on' : 'off',
        (v) => updateSettings({ spellcheck: v === 'on' }),
        'Off by default — author names and jargon trip false positives.'),
      optRow('F3 condense keeps paragraph breaks', [['on', 'On'], ['off', 'Off (merge flat)']], s.condenseIntegrity ? 'on' : 'off',
        (v) => updateSettings({ condenseIntegrity: v === 'on' })),
      optRow('Mark old breaks with ¶ pilcrows', [['on', 'On'], ['off', 'Off']], s.condensePilcrows ? 'on' : 'off',
        (v) => updateSettings({ condensePilcrows: v === 'on' }),
        'With pilcrows on, F3 merges but marks each old break with a small ¶; Uncondense (⌘⌥⇧F3) restores them.'),
      textRow('Shrink protections', s.shrinkProtections, 'e.g. [CHART OMITTED], [VIDEO]',
        (v) => updateSettings({ shrinkProtections: v }),
        'Comma-separated strings Shrink keeps at full size. Omission notes like [Table Omitted] are always protected.'),
    ];
  }

  function renderShortcuts(): HTMLElement[] {
    const rows: [string, string][] = [
      ['F2', 'Paste plain text'],
      ['F3 · ⌥F3 · ⌘⌥F3 · ⌘⌥⇧F3', 'Condense · flat · with pilcrows · uncondense'],
      ['⇧F3', 'Toggle case (lower / UPPER / Title)'],
      ['F4 / F5 / F6 / F7', 'Pocket / Hat / Block / Tag'],
      ['⌘F7 / ⌘F8', 'Analytic / Undertag'],
      ['F8 / ⌥F8', 'Cite / Copy previous cite'],
      ['F9', 'Underline'],
      ['F10', 'Emphasis'],
      ['F11 / ⌘F11', 'Highlight / Background color'],
      ['F12', 'Clear formatting'],
      ['⌘8 / ⌘⇧8', 'Shrink / Regrow'],
      ['⌘B / ⌘I / ⌘U', 'Bold / Italic / Underline (direct)'],
      ['Tab / ⇧Tab', 'Indent / Outdent'],
      ['PageUp / PageDown', 'Previous / next heading'],
      ['⌥A', 'Select the current section'],
      ['` / ⌥` / ⌘`', 'Send to speech · append · park in dropzone'],
      ['⌘⇧D', 'Reading-position marker'],
      ['⌘F / ⌘H', 'Find / Find and replace'],
      ['⌘K', 'Command palette'],
      ['⌘S / ⌘⇧S', 'Save / Save As'],
      ['⌘O', 'Open'],
      ['⌘= / ⌘−', 'Zoom in / out'],
    ];
    return [h('div', { class: 'kbd-table' },
      ...rows.map(([keys, what]) => h('div', { class: 'kbd-row' },
        h('span', { class: 'kbd-keys' }, keys), h('span', {}, what))))];
  }

  function render(): void {
    const panels: Record<SettingsTab, () => HTMLElement[]> = {
      general: renderGeneral, files: renderFiles, appearance: renderAppearance,
      editing: renderEditing, shortcuts: renderShortcuts,
    };
    body.replaceChildren(...panels[active]());
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === active));
  }

  const TAB_NAMES: Record<SettingsTab, string> = {
    general: 'General', files: 'Files', appearance: 'Appearance', editing: 'Editing', shortcuts: 'Shortcuts',
  };
  const tabsEl = h('div', { class: 'set-tabs' },
    ...(['general', 'files', 'appearance', 'editing', 'shortcuts'] as SettingsTab[]).map((t) =>
      h('button', { 'data-t': t, onclick: () => { active = t; render(); } }, TAB_NAMES[t])),
  );

  showOverlay(h('div', { class: 'modal set-modal', role: 'dialog', 'aria-label': 'Settings' },
    h('h2', {}, 'Settings', h('button', { class: 'x', onclick: closeOverlay, 'aria-label': 'Close' }, '×')),
    tabsEl,
    body,
    h('p', { class: 'note' }, 'Display settings never change your files — a saved .docx always carries exact Verbatim formatting.'),
    h('div', { class: 'legal' },
      h('span', {}, 'Made by Armaan Seth'),
      '·',
      h('a', { href: `${REPO}/blob/main/MANUAL.md`, target: '_blank', rel: 'noopener' }, 'User Manual'),
      '·',
      h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub'),
      '·',
      h('a', { href: `${REPO}/issues`, target: '_blank', rel: 'noopener' }, 'Issues & suggestions'),
      '·',
      h('a', { href: 'mailto:hello@mitez.org' }, 'hello@mitez.org'),
      '·',
      h('a', { href: `${REPO}/blob/main/PRIVACY.md`, target: '_blank', rel: 'noopener' }, 'Privacy Policy'),
      '·',
      h('a', { href: `${REPO}/blob/main/TERMS.md`, target: '_blank', rel: 'noopener' }, 'Terms of Use'),
      '·',
      h('span', {}, 'MIT license'),
    ),
  ));
  render();
}

// --- overlay plumbing ---
function showOverlay(content: HTMLElement): void {
  const ov = h('div', { class: 'overlay', id: 'overlay', onclick: (e: Event) => { if (e.target === ov) closeOverlay(); } }, content);
  document.body.append(ov);
}
function closeOverlay(): void {
  document.getElementById('overlay')?.remove();
  view?.focus();
}

// --- toasts ---
function toast(msg: string): void {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), 3200);
}

// --- tour ---
function openTutorial(): void {
  const parts = newDocumentParts();
  const s = newSession('Practice file', tutorialModel(), parts, null);
  activeId = s.id;
  showingHome = false;
  renderAll();
  // let the editor mount before the coach marks measure anything
  requestAnimationFrame(() => startTour({
    view: () => view,
    cmd: {
      tag: commands.tag,
      cite: commands.cite,
      underline: commands.underlineStyle,
      emphasis: commands.emphasis,
      shrink: commands.shrink,
    },
    highlight: () => toggleHighlight(getSettings().highlightColor),
    highlightColor: () => getSettings().highlightColor,
    isMac: navigator.platform.includes('Mac'),
  }));
}

// ---------------------------------------------------------------------------
// icons (inline, one stroke style)
// ---------------------------------------------------------------------------
function svgIcon(paths: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.innerHTML = paths;
  return svg;
}
const iconMoon = () => svgIcon('<path d="M13.5 8.8A6 6 0 1 1 7.2 2.5 4.7 4.7 0 0 0 13.5 8.8z"/>');
const iconGitHub = () => svgIcon('<path d="M8 1.8a6.2 6.2 0 0 0-2 12.1c.3.06.42-.13.42-.3v-1.1c-1.72.37-2.08-.83-2.08-.83-.28-.72-.69-.91-.69-.91-.56-.38.04-.38.04-.38.62.05.95.64.95.64.55.95 1.45.67 1.8.51.06-.4.22-.67.4-.83-1.38-.15-2.82-.68-2.82-3.05 0-.67.24-1.22.63-1.65-.06-.16-.28-.79.06-1.64 0 0 .52-.17 1.7.63a5.9 5.9 0 0 1 3.1 0c1.18-.8 1.7-.63 1.7-.63.34.85.12 1.48.06 1.64.4.43.63.98.63 1.65 0 2.38-1.45 2.9-2.83 3.05.22.19.42.57.42 1.15v1.7c0 .17.11.36.42.3A6.2 6.2 0 0 0 8 1.8z"/>');
const iconFolder = () => svgIcon('<path d="M1.5 3.5h4L7 5h7.5v8h-13z"/>');
const iconSave = () => svgIcon('<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5"/>');
const iconExport = () => svgIcon('<path d="M8 10V3M5 6l3-3 3 3M3 13h10"/>');
const iconPaste = () => svgIcon('<rect x="4" y="2.5" width="8" height="3" rx="1"/><path d="M4.5 4H3v10h10V4h-1.5"/><path d="M6 8h4M6 10.5h4"/>');
const iconUndo = () => svgIcon('<path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H8"/><path d="M6 3.5l-3 3 3 3"/>');
const iconRedo = () => svgIcon('<path d="M13 6.5H6a3.5 3.5 0 0 0 0 7h2"/><path d="M10 3.5l3 3-3 3"/>');
const iconSend = () => svgIcon('<path d="M3 3v4.5A3.5 3.5 0 0 0 6.5 11H13"/><path d="M10.5 8l3 3-3 3"/>');
const iconDown = () => svgIcon('<path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/>');
const iconEye = () => svgIcon('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>');
const iconFind = () => svgIcon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>');
const iconBook = () => svgIcon('<path d="M8 3.5C6.5 2.5 4 2.5 2 3v10c2-.5 4.5-.5 6 .5 1.5-1 4-1 6-.5V3c-2-.5-4.5-.5-6 .5z"/><path d="M8 3.5v10"/>');
const iconKeys = () => svgIcon('<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4 7h.5M7 7h.5M10 7h.5M4.5 9.5h7"/>');
const iconGear = () => svgIcon('<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>');
const iconTimer = () => svgIcon('<circle cx="8" cy="9" r="5.5"/><path d="M8 9V6M6 1.5h4"/>');
const iconHome = () => svgIcon('<path d="M2.5 8L8 2.5 13.5 8"/><path d="M4 7v6.5h8V7"/>');

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
/** Phones get a clear answer instead of a broken editor. */
function isMobileDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 700;
}

function renderMobileGate(): void {
  applyTheme(getSettings());
  root().replaceChildren(
    h('div', { class: 'mobilegate' },
      h('h1', {}, 'Sp', h('span', { class: 'swipe' }, h('span', {}, 'read'))),
      h('h2', {}, 'Sorry — desktop only.'),
      h('p', {}, 'Spread is a keyboard-first card cutter. F-keys, a full toolbar, real .docx files — none of that works on a phone screen. Open it on a computer or a Chromebook and it will be exactly where you left it.'),
      h('p', { class: 'mg-sub' }, 'wowneutral.github.io/spread'),
      h('button', {
        class: 'mg-anyway',
        onclick: () => { sessionStorage.setItem('spread-mobile-ok', '1'); location.reload(); },
      }, 'I know, let me in anyway'),
    ),
  );
}

export function boot(): void {
  if (isMobileDevice() && !sessionStorage.getItem('spread-mobile-ok')) {
    renderMobileGate();
    return;
  }
  applyTheme(getSettings());
  applyUserStyles();
  onSettingsChange((s) => {
    applyTheme(s);
    applyUserStyles();
    const wrap = document.getElementById('docwrap');
    if (wrap) wrap.setAttribute('class', docwrapClass(s));
    view?.dom.setAttribute('spellcheck', String(s.spellcheck));
    renderRibbonSwatches();
  });

  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (mod && e.key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); void doSave(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); void doSaveAs(); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openFile(); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'f' && !showingHome) { e.preventDefault(); openFind(); }
    else if (mod && e.key.toLowerCase() === 'h' && !showingHome) { e.preventDefault(); openFind(true); }
    else if (mod && (e.key === '=' || e.key === '+') && !showingHome) { e.preventDefault(); zoomBy(10); }
    else if (mod && e.key === '-' && !showingHome) { e.preventDefault(); zoomBy(-10); }
    else if (e.key === 'Escape') { closePickers(); closeOverlay(); }
  });

  addEventListener('beforeunload', (e) => {
    syncActiveState();
    clearTimeout(flowSaveTimer);
    saveFlows(flowStore);
    if (sessions.some((s) => s.dirty && !s.handle)) e.preventDefault();
  });

  renderAll();

  if (!getSettings().seenTutorial) {
    updateSettings({ seenTutorial: true });
    openTutorial();
  }
}
