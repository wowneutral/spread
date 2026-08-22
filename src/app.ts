/**
 * Spread — application shell.
 * Free, MIT-licensed debate card-cutting editor. Reads/writes Verbatim .docx.
 *
 * Layout: topbar (tabs) · [ribbon if full-toolbar mode] · outline | editor |
 * speech pane · status bar. Home screen for open/new/recents. Command palette
 * (Mod-K) reaches every command; a contextual toolbar appears on selection.
 */
import { EditorState, TextSelection, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo as undoCmd, redo as redoCmd } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';

import { schema } from './editor/schema';
import { buildKeymap } from './editor/keymap';
import { commands, toggleHighlight, selectCard } from './editor/commands';
import { modelToPM, pmToModel, type EditorSession } from './editor/convert';
import { importDocx } from './docx/import';
import { exportDocx } from './docx/export';
import { newDocumentParts } from './docx/template';
import type { PartMap } from './docx/zip';
import type { DocModel } from './model/types';
import {
  openViaPicker, saveFile, saveAs, addRecent, listRecents, clearRecents,
  openRecent, hasFSA, type RecentEntry,
} from './lib/fsa';
import { readableWords, readableWordsInSelection, secondsAt, fmtTime } from './lib/readtime';
import { getSettings, updateSettings, onSettingsChange, applyTheme, type Settings } from './lib/settings';
import { tutorialModel } from './tutorial';
import { startTour } from './tour';

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

const HL_COLORS = ['yellow', 'cyan', 'green', 'magenta', 'blue', 'red', 'darkYellow', 'darkCyan', 'darkGreen', 'lightGray'];

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
  dirty: boolean;
  isSpeech: boolean;
}

let sessions: Session[] = [];
let activeId: number | null = null;
let nextSessionId = 1;
let view: EditorView | null = null;
let showingHome = true;
let autosaveTimer: number | undefined;

function activeSession(): Session | null {
  return sessions.find((s) => s.id === activeId) ?? null;
}
function speechSession(): Session | null {
  return sessions.find((s) => s.isSpeech) ?? null;
}

function makeState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      buildKeymap({ getHighlightColor: () => getSettings().highlightColor }),
      history(),
      keymap(baseKeymap),
      new Plugin({
        props: {
          handleDOMEvents: {
            focus: () => { hideCtx(); return false; },
          },
        },
      }),
    ],
  });
}

function newSession(name: string, model: DocModel, parts: PartMap, handle: FileSystemFileHandle | null): Session {
  const { doc, session: es } = modelToPM(model);
  const s: Session = {
    id: nextSessionId++, name, handle, parts, es,
    state: makeState(doc), dirty: false, isSpeech: false,
  };
  sessions.push(s);
  return s;
}

function sessionBytes(s: Session): Uint8Array {
  const state = s.id === activeId && view ? view.state : s.state;
  return exportDocx(pmToModel(state.doc, s.es), s.parts);
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
    renderTopbar(); renderStatus();
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
  if (!s?.handle) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    const cur = activeSession();
    if (cur?.dirty && cur.handle) void doSave(cur);
  }, 5000);
}

// ---------------------------------------------------------------------------
// send to speech
// ---------------------------------------------------------------------------
function sendToSpeech(): void {
  const from = activeSession();
  const to = speechSession();
  if (!from || !view) return;
  if (!to) { toast('No speech doc yet — mark a tab as speech (palette: "Mark as speech doc")'); return; }
  if (to.id === from.id) { toast('This tab IS the speech doc'); return; }
  // Select the card around the cursor if selection is empty.
  let state = view.state;
  if (state.selection.empty) {
    selectCard(state, (tr) => { view!.dispatch(tr); });
    state = view.state;
  }
  const slice = state.selection.content();
  const insertPos = to.state.doc.content.size;
  const tr = to.state.tr.insert(insertPos, slice.content);
  to.state = to.state.apply(tr);
  to.dirty = true;
  renderSpeech();
  toast('Sent to speech doc');
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const root = () => document.getElementById('app')!;

function renderAll(): void {
  const settings = getSettings();
  applyTheme(settings);
  root().replaceChildren(
    renderTopbarEl(),
    ...(settings.toolbar === 'full' && !showingHome ? [renderRibbon()] : []),
    showingHome ? renderHome() : renderShell(),
    renderStatusEl(),
    h('div', { class: 'toasts', id: 'toasts' }),
  );
  if (!showingHome) mountEditor();
  renderStatus();
}

// --- topbar ---
function renderTopbarEl(): HTMLElement {
  const s = getSettings();
  const bar = h('div', { class: 'topbar', id: 'topbar' },
    h('div', {
      class: 'wordmark', role: 'button', tabindex: '0', title: 'Home',
      onclick: () => { syncActiveState(); showingHome = true; renderAll(); },
    }, 'Sp', h('span', { class: 'swipe' }, h('span', {}, 'read'))),
    h('div', { class: 'doctabs', role: 'tablist' },
      ...sessions.map((sess) => h('button', {
        class: 'doctab', role: 'tab',
        'aria-selected': sess.id === activeId && !showingHome ? 'true' : 'false',
        onclick: () => { syncActiveState(); activeId = sess.id; showingHome = false; renderAll(); },
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
        class: 'chip-btn', title: 'Toggle document view',
        onclick: () => { updateSettings({ docView: getSettings().docView === 'clean' ? 'faithful' : 'clean' }); },
      }, 'View: ', h('b', {}, s.docView === 'clean' ? 'Clean' : 'Faithful')),
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

// --- home ---
function renderHome(): HTMLElement {
  const recentsList = h('div', { id: 'recents' }, h('div', { class: 'empty' }, 'Loading…'));
  void (async () => {
    const recents = await listRecents();
    recentsList.replaceChildren(
      ...(recents.length === 0
        ? [h('div', { class: 'empty' }, hasFSA
            ? 'Files you open will show up here. Spread asks your browser for permission before reading or editing anything.'
            : 'Recents need the File System Access API (Chrome/Edge). You can still open and download files.')]
        : recents.map((r) => renderRecent(r))),
    );
  })();
  return h('section', { class: 'home' },
    h('div', { class: 'home-inner' },
      h('h1', {}, 'Sp', h('span', { class: 'swipe' }, h('span', {}, 'read'))),
      h('p', { class: 'sub' }, 'Open a document to start, or pick up where you left off.'),
      h('div', { class: 'badges' },
        h('span', { class: 'badge' }, 'Free forever'),
        h('span', { class: 'badge' }, 'MIT open source'),
        h('span', { class: 'badge' }, 'Verbatim-compatible .docx'),
      ),
      h('div', { class: 'home-primary' },
        h('button', { class: 'hcard primary', onclick: () => newDocument(false) },
          h('h3', {}, 'New document'), h('p', {}, 'Create a new Verbatim-styled document.')),
        h('button', { class: 'hcard', onclick: () => newDocument(true) },
          h('h3', {}, 'New speech document'), h('p', {}, 'Create a new document and mark it as the speech doc.')),
        h('button', { class: 'hcard', onclick: () => void openFile() },
          h('h3', {}, 'Open…'), h('p', {}, 'Browse for a Verbatim or Word .docx file.')),
      ),
      h('div', { class: 'recents' },
        h('div', { class: 'home-row' },
          h('span', { class: 'home-label' }, 'RECENT'),
          h('button', { class: 'home-clear', onclick: async () => { await clearRecents(); renderAll(); } }, 'Clear'),
        ),
        recentsList,
      ),
      h('div', { class: 'home-grid' },
        h('div', {},
          h('span', { class: 'home-label' }, 'LEARN'),
          h('button', { class: 'hcard', onclick: () => openTutorial() },
            h('h3', {}, 'Take the tour'),
            h('p', {}, 'Two minutes of popups on a practice file. It cuts a card in front of you.')),
        ),
        h('div', {},
          h('span', { class: 'home-label' }, 'TOOLS'),
          h('button', { class: 'hcard', onclick: () => popoutTimer() },
            h('h3', {}, 'Pop-out timer'),
            h('p', {}, 'A floating speech & prep timer in its own window.')),
        ),
        h('div', {},
          h('span', { class: 'home-label' }, 'COMING'),
          h('button', { class: 'hcard', onclick: () => toast('On the roadmap — follow the repo for updates.') },
            h('h3', {}, 'Card passing ', h('span', { class: 'soon' }, 'SOON')),
            h('p', {}, 'Serverless card sharing between teammates, free forever.')),
        ),
      ),
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
function renderShell(): HTMLElement {
  const s = getSettings();
  return h('div', { class: 'shell' },
    h('nav', { class: 'outline', 'aria-label': 'Document outline', id: 'outline' }),
    h('main', { class: `docwrap${s.docView === 'clean' ? ' clean' : ''}`, id: 'docwrap' },
      h('div', { id: 'docmount', class: 'doczoom' }),
      h('div', { class: 'ctxbar', id: 'ctxbar', hidden: true }),
    ),
    h('aside', { class: 'speech', 'aria-label': 'Speech document', id: 'speechpane' }),
  );
}

function mountEditor(): void {
  const mount = document.getElementById('docmount');
  const s = activeSession();
  if (!mount || !s) return;
  view?.destroy();
  view = new EditorView(mount, {
    state: s.state,
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
      updateCtx();
      renderTopbarDirtyDots();
    },
  });
  applyZoom();
  renderOutline();
  renderSpeech();
  updateCtx();
}

function renderTopbarDirtyDots(): void {
  // cheap: re-render tabs only when dirty flags may have flipped
  renderTopbar();
}

function applyZoom(): void {
  const mount = document.getElementById('docmount') as HTMLElement | null;
  if (mount) (mount.style as any).zoom = `${getSettings().zoom}%`;
}

// --- outline ---
function renderOutline(): void {
  const el = document.getElementById('outline');
  const s = activeSession();
  if (!el || !s) return;
  const depth = getSettings().navDepth;
  const state = view?.state ?? s.state;
  const items: { level: number; text: string; pos: number }[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type === schema.nodes.heading && node.attrs.level <= depth) {
      items.push({ level: node.attrs.level, text: node.textContent || '(untitled)', pos: offset });
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
            class: `l${item.level}${item.pos === activePos ? ' active-mark' : ''}`,
            onclick: () => {
              if (!view) return;
              const pos = item.pos + 1;
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
              view.focus();
            },
          },
            h('span', { class: 'lvl' }, ['', 'P', 'H', 'B', 'T'][item.level]),
            h('span', {}, item.text),
          ))),
    ),
  );
}

// --- contextual toolbar ---
function hideCtx(): void {
  const bar = document.getElementById('ctxbar');
  if (bar) bar.hidden = true;
}

function updateCtx(): void {
  const bar = document.getElementById('ctxbar');
  const wrap = document.getElementById('docwrap');
  if (!bar || !wrap || !view) return;
  if (getSettings().toolbar !== 'contextual') { bar.hidden = true; return; }
  const { empty, from } = view.state.selection;
  if (empty) { bar.hidden = true; return; }
  bar.hidden = false;
  if (bar.childElementCount === 0) buildCtxButtons(bar);
  const coords = view.coordsAtPos(from);
  const wrapRect = wrap.getBoundingClientRect();
  const top = coords.top - wrapRect.top + wrap.scrollTop - 44;
  const left = Math.max(8, Math.min(coords.left - wrapRect.left - 20, wrap.clientWidth - 460));
  bar.style.top = `${Math.max(6, top)}px`;
  bar.style.left = `${left}px`;
}

function buildCtxButtons(bar: HTMLElement): void {
  const run = (cmd: (state: EditorState, dispatch: any) => boolean) => () => {
    if (!view) return;
    cmd(view.state, view.dispatch);
    view.focus();
  };
  const hlColor = () => getSettings().highlightColor;
  bar.replaceChildren(
    h('button', { onclick: run(commands.tag) }, 'Tag', h('kbd', {}, 'F7')),
    h('button', { onclick: run(commands.cite) }, 'Cite', h('kbd', {}, 'F8')),
    h('button', { onclick: run(commands.underlineStyle) }, 'Underline', h('kbd', {}, 'F9')),
    h('button', { onclick: run(commands.emphasis) }, 'Emphasis', h('kbd', {}, 'F10')),
    h('button', { onclick: () => { if (view) { toggleHighlight(hlColor())(view.state, view.dispatch); view.focus(); } } },
      h('span', { class: 'hlsw', style: `background:var(--hl-${hlColor()})` }), 'Highlight', h('kbd', {}, 'F11')),
    h('span', { class: 'sep' }),
    h('button', { onclick: run(commands.shrink) }, 'Shrink', h('kbd', {}, '⌘8')),
    h('button', { onclick: run(commands.clear) }, 'Clear', h('kbd', {}, 'F12')),
    h('span', { class: 'sep' }),
    h('button', { onclick: () => sendToSpeech() }, 'Send →'),
  );
}

// --- full ribbon (optional) ---
interface RibbonBtn { label?: string; kbd?: string; icon?: () => SVGElement; glyph?: string;
  cls?: string; title: string; run?: () => void; soon?: string }

function renderRibbon(): HTMLElement {
  const run = (cmd: any) => () => { if (view) { cmd(view.state, view.dispatch); view.focus(); } };
  const groups: RibbonBtn[][] = [
    [
      { icon: iconFolder, title: 'Open (from Home or palette)', run: () => void openFile() },
      { icon: iconSave, title: 'Save', run: () => void doSave() },
      { icon: iconExport, title: 'Save As…', run: () => void doSaveAs() },
      { icon: iconCycle, title: 'Convert', soon: 'Format conversion' },
    ],
    [
      { icon: iconUndo, title: 'Undo', run: () => undoRedo('undo') },
      { icon: iconRedo, title: 'Redo', run: () => undoRedo('redo') },
      { icon: iconSend, title: 'Send to speech doc', run: () => sendToSpeech() },
      { icon: iconDown, title: 'Send to bottom of speech doc', run: () => sendToSpeech() },
    ],
    [
      { label: 'Pocket', kbd: 'F4', title: 'Pocket — Heading 1', run: run(commands.pocket) },
      { label: 'Tag', kbd: 'F7', title: 'Tag', run: run(commands.tag) },
      { label: 'Hat', kbd: 'F5', title: 'Hat — Heading 2', run: run(commands.hat) },
      { label: 'Block', kbd: 'F6', title: 'Block — Heading 3', run: run(commands.block) },
      { label: 'Analytic', cls: 'analytic', title: 'Analytic', soon: 'Analytic style' },
      { label: 'Undertag', cls: 'undertag', title: 'Undertag', soon: 'Undertag style' },
    ],
    [
      { label: 'Cite', kbd: 'F8', title: 'Cite style', run: run(commands.cite) },
      { label: 'Underline', kbd: 'F9', title: 'Underline style', run: run(commands.underlineStyle) },
      { label: 'Emphasis', kbd: 'F10', title: 'Emphasis style', run: run(commands.emphasis) },
      { label: 'Clear', kbd: 'F12', title: 'Clear formatting', run: run(commands.clear) },
    ],
    [
      { glyph: 'A', cls: 'cbar', title: 'Highlight (F11) — active color', run: () => { if (view) { toggleHighlight(getSettings().highlightColor)(view.state, view.dispatch); view.focus(); } } },
      { glyph: 'x²', title: 'Superscript', run: run(commands.superscript) },
      { glyph: 'A−', title: 'Shrink un-underlined (Mod-8)', run: run(commands.shrink) },
      { glyph: 'x₂', title: 'Subscript', run: run(commands.subscript) },
    ],
    [
      { icon: iconEye, title: 'Read mode', soon: 'Read mode' },
      { icon: iconComment, title: 'Comments', soon: 'Comments' },
      { icon: iconBook, title: 'Flashcards', soon: 'Flashcards' },
      { icon: iconPanes, title: 'Three-pane view', soon: 'Multi-pane' },
    ],
  ];
  const right: RibbonBtn[] = [
    { icon: iconKeys, title: 'Command palette (Mod-K)', run: () => openPalette() },
    { icon: iconGear, title: 'Settings', run: () => openSettings() },
    { icon: iconTimer, title: 'Pop-out timer', run: () => popoutTimer() },
    { icon: iconHome, title: 'Home', run: () => { syncActiveState(); showingHome = true; renderAll(); } },
  ];
  const btn = (b: RibbonBtn) => h('button', {
    class: `rb${b.cls ? ` ${b.cls}` : ''}${b.label ? ' wide' : ''}`,
    title: b.title,
    onclick: b.run ?? (() => toast(`${b.soon} is on the roadmap — not in v0.1 yet.`)),
  },
    b.icon ? b.icon() : null,
    b.glyph ? h('span', { class: `glyph${b.cls === 'cbar' ? ' cbar' : ''}` }, b.glyph) : null,
    b.label ?? null,
    b.kbd ? h('kbd', {}, b.kbd) : null,
  );
  return h('div', { class: 'ribbon', role: 'toolbar', 'aria-label': 'All commands' },
    ...groups.map((g) => h('div', { class: 'rg' }, ...g.map(btn))),
    h('div', { class: 'rg last' }, ...right.map(btn)),
  );
}

function undoRedo(which: 'undo' | 'redo'): void {
  if (!view) return;
  (which === 'undo' ? undoCmd : redoCmd)(view.state, view.dispatch);
  view.focus();
}

// --- speech pane ---
function renderSpeech(): void {
  const el = document.getElementById('speechpane');
  if (!el) return;
  const sp = speechSession();
  const s = getSettings();
  if (!sp) {
    el.replaceChildren(
      h('div', { class: 'speech-head' }, h('h2', {}, 'Speech doc')),
      h('div', { class: 'speech-empty' },
        'No speech doc yet. Create one from Home, or mark any open tab as the speech doc from the command palette.'),
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
        ? [h('div', { class: 'speech-empty' }, 'Send cards here: select a card and press Send → (or use the palette).')]
        : cards.map((c) => h('button', { class: 'sent', onclick: () => { syncActiveState(); activeId = sp.id; showingHome = false; renderAll(); } },
            h('p', { class: 's-tag' }, c.tag),
            h('p', { class: 's-meta' }, h('span', {}, `${c.words} w`)),
          ))),
    ),
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

function popoutTimer(): void {
  const w = window.open('', 'spread-timer', 'width=260,height=140,alwaysOnTop=yes');
  if (!w) { toast('Pop-up blocked — allow pop-ups for the timer window.'); return; }
  w.document.write(`<!doctype html><title>Timer — Spread</title>
  <body style="margin:0;display:grid;place-items:center;height:100vh;background:#1B1A17;color:#ECE8DD;font-family:ui-monospace,monospace">
  <div style="text-align:center">
    <div id=t style="font-size:44px;font-weight:600">8:00</div>
    <div style="margin-top:6px">
      <button onclick="go()" style="font:inherit;padding:4px 12px">start/stop</button>
      <button onclick="reset()" style="font:inherit;padding:4px 12px">reset</button>
    </div>
  </div>
  <script>
    let r=480,h=null;const f=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
    const d=()=>document.getElementById('t').textContent=f(r);
    function go(){if(h){clearInterval(h);h=null}else h=setInterval(()=>{r=Math.max(0,r-1);d();if(!r&&h){clearInterval(h);h=null}},1000)}
    function reset(){r=480;d()}
  <\/script></body>`);
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
  const parts: (HTMLElement | string)[] = [
    h('span', { class: 'sigma' }, 'Σ'),
    h('span', { class: 'mono' },
      `Doc: ${words} · Reader 1: ${fmtTime(secondsAt(words, cfg.reader1Wpm))} · Reader 2: ${fmtTime(secondsAt(words, cfg.reader2Wpm))}`),
  ];
  const sel = state.selection;
  if (!sel.empty) {
    const selWords = readableWordsInSelection(state.doc, sel.from, sel.to);
    parts.push(h('span', { class: 'mono' }, `Sel: ${selWords} · ${fmtTime(secondsAt(selWords, cfg.reader1Wpm))}`));
  }
  el.replaceChildren(
    ...parts,
    h('span', { class: 'grow' }),
    h('span', { class: s.dirty ? 'unsaved' : 'saved' }, s.dirty ? (s.handle ? 'Autosaving…' : 'Unsaved changes') : 'Saved'),
    h('div', { class: 'zoom' },
      h('button', { 'aria-label': 'Zoom out', onclick: () => { updateSettings({ zoom: Math.max(50, getSettings().zoom - 10) }); applyZoom(); renderStatus(); } }, '−'),
      h('span', { class: 'pct' }, `${cfg.zoom}%`),
      h('button', { 'aria-label': 'Zoom in', onclick: () => { updateSettings({ zoom: Math.min(300, getSettings().zoom + 10) }); applyZoom(); renderStatus(); } }, '+'),
      h('button', { 'aria-label': 'Reset zoom', style: 'font-size:11px', onclick: () => { updateSettings({ zoom: 100 }); applyZoom(); renderStatus(); } }, '⟲'),
    ),
  );
}

// --- command palette ---
interface PaletteItem { label: string; hint?: string; run: () => void }

function paletteItems(): PaletteItem[] {
  const run = (cmd: any) => () => { if (view) { cmd(view.state, view.dispatch); view.focus(); } };
  const items: PaletteItem[] = [
    { label: 'New document', run: () => newDocument(false) },
    { label: 'New speech document', run: () => newDocument(true) },
    { label: 'Open…', hint: 'file', run: () => void openFile() },
    { label: 'Save', hint: '⌘S', run: () => void doSave() },
    { label: 'Save As…', hint: '⌘⇧S', run: () => void doSaveAs() },
    { label: 'Go home', run: () => { syncActiveState(); showingHome = true; renderAll(); } },
    { label: 'Pocket (Heading 1)', hint: 'F4', run: run(commands.pocket) },
    { label: 'Hat (Heading 2)', hint: 'F5', run: run(commands.hat) },
    { label: 'Block (Heading 3)', hint: 'F6', run: run(commands.block) },
    { label: 'Tag', hint: 'F7', run: run(commands.tag) },
    { label: 'Cite', hint: 'F8', run: run(commands.cite) },
    { label: 'Underline', hint: 'F9', run: run(commands.underlineStyle) },
    { label: 'Emphasis', hint: 'F10', run: run(commands.emphasis) },
    { label: 'Highlight', hint: 'F11', run: () => { if (view) { toggleHighlight(getSettings().highlightColor)(view.state, view.dispatch); view.focus(); } } },
    { label: 'Clear formatting', hint: 'F12', run: run(commands.clear) },
    { label: 'Shrink un-underlined text', hint: '⌘8', run: run(commands.shrink) },
    { label: 'Select card', run: run(commands.selectCard) },
    { label: 'Send to speech doc', run: () => sendToSpeech() },
    { label: 'Mark this tab as speech doc', run: () => { const s = activeSession(); if (s) { for (const o of sessions) o.isSpeech = false; s.isSpeech = true; renderAll(); } } },
    { label: 'Toggle Clean / Faithful view', run: () => updateSettings({ docView: getSettings().docView === 'clean' ? 'faithful' : 'clean' }) },
    { label: 'Toggle full toolbar', run: () => updateSettings({ toolbar: getSettings().toolbar === 'full' ? 'contextual' : 'full' }) },
    { label: 'Pop-out timer', run: () => popoutTimer() },
    { label: 'Take the tour', run: () => openTutorial() },
    { label: 'Settings…', run: () => openSettings() },
  ];
  for (const c of HL_COLORS) {
    items.push({ label: `Set highlight color: ${c}`, run: () => { updateSettings({ highlightColor: c }); toast(`Highlight color: ${c}`); } });
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

// --- save as modal ---
function openSaveAsModal(s: Session): void {
  closeOverlay();
  const nameInput = h('input', { type: 'text', value: s.name });
  showOverlay(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Save As' },
    h('h2', {}, 'Save As', h('button', { class: 'x', onclick: closeOverlay, 'aria-label': 'Close' }, '×')),
    h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
    h('div', { class: 'field' },
      h('label', {}, 'Format'),
      h('div', { class: 'row' },
        h('span', { class: 'opt on' }, 'Word (.docx) — Verbatim-compatible'),
      ),
      h('p', { class: 'note' }, 'Send Doc / Read Doc / Marked Doc presets are on the roadmap.'),
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'stamp',
        onclick: async () => {
          let name = nameInput.value.trim() || 'Untitled.docx';
          if (!name.toLowerCase().endsWith('.docx')) name += '.docx';
          closeOverlay();
          try {
            const handle = await saveAs(sessionBytes(s), name);
            if (handle) { s.handle = handle; s.name = handle.name ?? name; void addRecent({ name: s.name, openedAt: Date.now(), handle }); }
            else s.name = name;
            s.dirty = false;
            renderAll();
            toast(handle ? `Saved ${s.name}` : `Downloaded ${name}`);
          } catch (e) { toast(`Save failed: ${(e as Error).message}`); }
        },
      }, 'Save'),
      h('button', { class: 'opt', onclick: closeOverlay }, 'Cancel'),
    ),
  ));
  nameInput.focus();
  nameInput.setSelectionRange(0, nameInput.value.replace(/\.docx$/i, '').length);
}

// --- settings modal ---
function openSettings(): void {
  closeOverlay();
  const s = getSettings();
  const wpm1 = h('input', { type: 'number', value: String(s.reader1Wpm), min: '60', max: '600' });
  const wpm2 = h('input', { type: 'number', value: String(s.reader2Wpm), min: '60', max: '600' });
  const optRow = (label: string, opts: [string, string][], current: string, set: (v: string) => void) =>
    h('div', { class: 'field' },
      h('label', {}, label),
      h('div', { class: 'row' }, ...opts.map(([value, text]) => h('button', {
        class: `opt${current === value ? ' on' : ''}`,
        onclick: () => { set(value); openSettings(); },
      }, text))),
    );
  showOverlay(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Settings' },
    h('h2', {}, 'Settings', h('button', { class: 'x', onclick: closeOverlay, 'aria-label': 'Close' }, '×')),
    optRow('Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme,
      (v) => updateSettings({ theme: v as Settings['theme'] })),
    optRow('Document view', [['clean', 'Clean (better formatting)'], ['faithful', 'Faithful (exact Verbatim)']], s.docView,
      (v) => updateSettings({ docView: v as Settings['docView'] })),
    optRow('Toolbar', [['contextual', 'Contextual + palette'], ['full', 'Full toolbar']], s.toolbar,
      (v) => updateSettings({ toolbar: v as Settings['toolbar'] })),
    h('div', { class: 'field' },
      h('label', {}, 'Highlight color (F11)'),
      h('div', { class: 'swrow' }, ...HL_COLORS.map((c) => h('button', {
        class: `sw${s.highlightColor === c ? ' on' : ''}`,
        style: `background:var(--hl-${c})`,
        title: c, 'aria-label': `Highlight ${c}`,
        onclick: () => { updateSettings({ highlightColor: c }); openSettings(); },
      }))),
    ),
    h('div', { class: 'field' }, h('label', {}, 'Reader 1 (you) — words per minute'), wpm1),
    h('div', { class: 'field' }, h('label', {}, 'Reader 2 (partner) — words per minute'), wpm2),
    h('div', { class: 'row' },
      h('button', {
        class: 'stamp',
        onclick: () => {
          updateSettings({
            reader1Wpm: Math.max(60, Number(wpm1.value) || 270),
            reader2Wpm: Math.max(60, Number(wpm2.value) || 240),
          });
          closeOverlay(); renderAll();
        },
      }, 'Done'),
    ),
    h('p', { class: 'note' }, 'Display settings never change your files — a saved .docx always carries exact Verbatim formatting.'),
  ));
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
const iconFolder = () => svgIcon('<path d="M1.5 3.5h4L7 5h7.5v8h-13z"/>');
const iconSave = () => svgIcon('<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5"/>');
const iconExport = () => svgIcon('<path d="M8 10V3M5 6l3-3 3 3M3 13h10"/>');
const iconCycle = () => svgIcon('<path d="M3.5 6a5 5 0 0 1 8.6-1.9M12.5 10a5 5 0 0 1-8.6 1.9"/><path d="M12.5 1.8v2.7h-2.7M3.5 14.2v-2.7h2.7"/>');
const iconUndo = () => svgIcon('<path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H8"/><path d="M6 3.5l-3 3 3 3"/>');
const iconRedo = () => svgIcon('<path d="M13 6.5H6a3.5 3.5 0 0 0 0 7h2"/><path d="M10 3.5l3 3-3 3"/>');
const iconSend = () => svgIcon('<path d="M3 3v4.5A3.5 3.5 0 0 0 6.5 11H13"/><path d="M10.5 8l3 3-3 3"/>');
const iconDown = () => svgIcon('<path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/>');
const iconEye = () => svgIcon('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>');
const iconComment = () => svgIcon('<path d="M2 3h12v8H7l-3 3v-3H2z"/>');
const iconBook = () => svgIcon('<path d="M8 3.5C6.5 2.5 4 2.5 2 3v10c2-.5 4.5-.5 6 .5 1.5-1 4-1 6-.5V3c-2-.5-4.5-.5-6 .5z"/><path d="M8 3.5v10"/>');
const iconPanes = () => svgIcon('<rect x="2" y="3" width="12" height="10"/><path d="M6.5 3v10M10.5 3v10"/>');
const iconKeys = () => svgIcon('<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4 7h.5M7 7h.5M10 7h.5M4.5 9.5h7"/>');
const iconGear = () => svgIcon('<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>');
const iconTimer = () => svgIcon('<circle cx="8" cy="9" r="5.5"/><path d="M8 9V6M6 1.5h4"/>');
const iconHome = () => svgIcon('<path d="M2.5 8L8 2.5 13.5 8"/><path d="M4 7v6.5h8V7"/>');

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
export function boot(): void {
  applyTheme(getSettings());
  onSettingsChange((s) => {
    applyTheme(s);
    // view mode / toolbar changes need a re-render
    const wrap = document.getElementById('docwrap');
    if (wrap) wrap.classList.toggle('clean', s.docView === 'clean');
    if (!showingHome) {
      // ribbon visibility may change
      const hasRibbon = !!document.querySelector('.ribbon');
      if ((s.toolbar === 'full') !== hasRibbon) { syncActiveState(); renderAll(); }
    }
    updateCtx();
  });

  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (mod && e.key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); void doSave(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); void doSaveAs(); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openFile(); }
    else if (e.key === 'Escape') closeOverlay();
  });

  addEventListener('beforeunload', (e) => {
    syncActiveState();
    if (sessions.some((s) => s.dirty && !s.handle)) e.preventDefault();
  });

  document.addEventListener('selectionchange', () => updateCtx());

  renderAll();

  if (!getSettings().seenTutorial) {
    updateSettings({ seenTutorial: true });
    openTutorial();
  }
}
