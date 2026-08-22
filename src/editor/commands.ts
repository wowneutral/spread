/**
 * The cutting commands — Verbatim's muscle-memory verbs.
 * Every command is a plain ProseMirror command usable from the keymap,
 * the toolbar, and the command palette alike.
 */
import { type Command, TextSelection, type EditorState } from 'prosemirror-state';
import { setBlockType } from 'prosemirror-commands';
import type { MarkType, Attrs } from 'prosemirror-model';
import { schema } from './schema';
import { MINIMIZED_SIZE, type HeadingLevel } from '../model/types';

/** Expand a cursor (empty selection) to the word around it — Verbatim behavior. */
function wordRange(state: EditorState): { from: number; to: number } {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to };
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  let start = offset, end = offset;
  const isWord = (ch: string) => /[\w'’-]/.test(ch);
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  const base = $from.start();
  return { from: base + start, to: base + end };
}

function rangeHasMark(state: EditorState, from: number, to: number, type: MarkType): boolean {
  if (from === to) return !!type.isInSet(state.storedMarks ?? state.selection.$from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** Toggle a mark over the selection (word-at-cursor when empty). */
export function toggleMarkSmart(type: MarkType, attrs?: Attrs): Command {
  return (state, dispatch) => {
    const { from, to } = wordRange(state);
    if (from === to) return false;
    const has = rangeHasMark(state, from, to, type);
    if (dispatch) {
      const tr = has ? state.tr.removeMark(from, to, type) : state.tr.addMark(from, to, type.create(attrs));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Highlight toggles by *any* highlight color; applying uses the active color. */
export function toggleHighlight(color: string): Command {
  return (state, dispatch) => {
    const { from, to } = wordRange(state);
    if (from === to) return false;
    const type = schema.marks.highlight;
    const has = rangeHasMark(state, from, to, type);
    if (dispatch) {
      const tr = has ? state.tr.removeMark(from, to, type) : state.tr.addMark(from, to, type.create({ color }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** F4–F7: convert paragraph(s) to a heading level; same level again -> back to Normal. */
export function setLevel(level: HeadingLevel): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const isSame = $from.parent.type === schema.nodes.heading && $from.parent.attrs.level === level;
    if (isSame) return setBlockType(schema.nodes.paragraph)(state, dispatch, view);
    return setBlockType(schema.nodes.heading, { level })(state, dispatch, view);
  };
}

/** F12 / Clear: strip every mark and return the block to Normal. */
export const clearFormatting: Command = (state, dispatch, view) => {
  const { from, to, empty } = state.selection;
  const r = empty ? wordRange(state) : { from, to };
  if (dispatch) {
    let tr = state.tr;
    for (const mark of Object.values(schema.marks)) tr = tr.removeMark(r.from, r.to, mark);
    dispatch(tr.scrollIntoView());
  }
  setBlockType(schema.nodes.paragraph)(state, dispatch, view);
  return true;
};

/**
 * Mod-8 / Shrink: minimize un-underlined text. Underlined (style or direct),
 * cite, emphasis, and highlighted runs keep full size — everything else in the
 * selection drops to 8pt. Applied again, restores.
 */
export function shrinkSelection(): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    if (from === to) return false;
    const M = schema.marks;
    const keep = [M.ustyle, M.cite, M.emph, M.udirect, M.highlight];
    // Determine mode: if any shrinkable text is currently un-shrunk, shrink; else restore.
    let anyUnshrunk = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const marks = node.marks;
      if (keep.some((t) => t.isInSet(marks))) return;
      if (!M.size.isInSet(marks)) anyUnshrunk = true;
    });
    if (dispatch) {
      let tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const marks = node.marks;
        if (keep.some((t) => t.isInSet(marks))) return;
        const a = Math.max(from, pos);
        const b = Math.min(to, pos + node.nodeSize);
        tr = anyUnshrunk
          ? tr.addMark(a, b, M.size.create({ hp: MINIMIZED_SIZE }))
          : tr.removeMark(a, b, M.size);
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Select the whole card-ish region: the tag above (if any) through following body paras. */
export const selectCard: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const doc = state.doc;
  let index = $from.index(0);
  // Walk up to the nearest tag (Heading4) or heading boundary.
  while (index > 0) {
    const node = doc.child(index);
    if (node.type === schema.nodes.heading) break;
    index--;
  }
  const startNode = doc.child(index);
  if (startNode.type === schema.nodes.heading && startNode.attrs.level !== 4) {
    // We're at a structural heading, not a card — select just this block.
    index = $from.index(0);
  }
  let end = index;
  while (end + 1 < doc.childCount) {
    const next = doc.child(end + 1);
    if (next.type === schema.nodes.heading || next.type === schema.nodes.rawblock) break;
    end++;
  }
  let fromPos = 0;
  for (let i = 0; i < index; i++) fromPos += doc.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = index; i <= end; i++) toPos += doc.child(i).nodeSize;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection.create(doc, fromPos + 1, toPos - 1)));
  }
  return true;
};

/**
 * F3 / Condense: merge the card's body paragraphs into one paragraph.
 * With a multi-paragraph selection, condenses the selection instead.
 */
export const condense: Command = (state, dispatch) => {
  const doc = state.doc;
  let { from, to } = state.selection;
  if (state.selection.empty) {
    // Card region: from below the nearest heading to the next heading/raw block.
    const $from = state.selection.$from;
    let index = $from.index(0);
    while (index > 0 && doc.child(index).type !== schema.nodes.heading) index--;
    let start = doc.child(index).type === schema.nodes.heading ? index + 1 : index;
    let end = start;
    while (end + 1 < doc.childCount) {
      const next = doc.child(end + 1);
      if (next.type === schema.nodes.heading || next.type === schema.nodes.rawblock) break;
      end++;
    }
    if (start >= doc.childCount || end < start) return false;
    let pos = 0;
    for (let i = 0; i < start; i++) pos += doc.child(i).nodeSize;
    from = pos + 1;
    for (let i = start; i <= end; i++) pos += doc.child(i).nodeSize;
    to = pos - 1;
  }
  // Collect join points (boundaries between adjacent paragraphs inside range).
  const joins: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== schema.nodes.paragraph) return true;
    const after = pos + node.nodeSize;
    if (after < to) {
      const $after = doc.resolve(after);
      if ($after.nodeAfter?.type === schema.nodes.paragraph) joins.push(after);
    }
    return false;
  });
  if (joins.length === 0) return false;
  if (dispatch) {
    let tr = state.tr;
    for (const pos of [...joins].reverse()) {
      // Join, then keep the seam readable with a single space.
      const mapped = tr.mapping.map(pos);
      tr = tr.join(mapped);
      const seam = mapped - 1;
      const $seam = tr.doc.resolve(seam);
      const before = $seam.nodeBefore, afterN = $seam.nodeAfter;
      if (before?.isText && afterN?.isText && !/\s$/.test(before.text ?? '') && !/^\s/.test(afterN.text ?? '')) {
        tr = tr.insertText(' ', seam);
      }
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Shift-F3: cycle selection case — lowercase → UPPERCASE → Title Case. */
export const toggleCase: Command = (state, dispatch) => {
  const { from, to } = state.selection.empty ? wordRange(state) : state.selection;
  if (from === to) return false;
  const current = state.doc.textBetween(from, to, ' ');
  const mode: 'upper' | 'title' | 'lower' =
    current === current.toLowerCase() ? 'upper'
    : current === current.toUpperCase() ? 'title'
    : 'lower';
  const transform = (t: string, offset: number): string => {
    if (mode === 'upper') return t.toUpperCase();
    if (mode === 'lower') return t.toLowerCase();
    // Title-case using document context so word starts split across runs work.
    let out = '';
    for (let k = 0; k < t.length; k++) {
      const prev = offset + k === 0 ? ' ' : (state.doc.textBetween(from + offset + k - 1, from + offset + k, ' ') || ' ');
      const ch = t[k].toLowerCase();
      out += /[\s([{"'‘“/-]/.test(prev) ? ch.toUpperCase() : ch;
    }
    return out;
  };
  if (dispatch) {
    const segs: { a: number; b: number; text: string; marks: readonly import('prosemirror-model').Mark[] }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.text) return true;
      const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
      if (a >= b) return false;
      segs.push({ a, b, text: node.text.slice(a - pos, b - pos), marks: node.marks });
      return false;
    });
    let tr = state.tr;
    for (const seg of [...segs].reverse()) {
      tr = tr.replaceWith(seg.a, seg.b, schema.text(transform(seg.text, seg.a - from), seg.marks.slice()));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Mod-F11: background shading (w:shd fill) — independent of highlight. */
export function toggleShade(hex: string): Command {
  return (state, dispatch) => {
    const { from, to } = wordRange(state);
    if (from === to) return false;
    const type = schema.marks.shd;
    const has = rangeHasMark(state, from, to, type);
    if (dispatch) {
      const tr = has ? state.tr.removeMark(from, to, type) : state.tr.addMark(from, to, type.create({ hex }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// Named command handles for palette/toolbar/keymap reuse.
export const commands = {
  pocket: setLevel(1),
  hat: setLevel(2),
  block: setLevel(3),
  tag: setLevel(4),
  cite: toggleMarkSmart(schema.marks.cite),
  underlineStyle: toggleMarkSmart(schema.marks.ustyle),
  emphasis: toggleMarkSmart(schema.marks.emph),
  bold: toggleMarkSmart(schema.marks.bold),
  italic: toggleMarkSmart(schema.marks.italic),
  underlineDirect: toggleMarkSmart(schema.marks.udirect),
  strike: toggleMarkSmart(schema.marks.strike),
  superscript: toggleMarkSmart(schema.marks.vert, { v: 'superscript' }),
  subscript: toggleMarkSmart(schema.marks.vert, { v: 'subscript' }),
  clear: clearFormatting,
  shrink: shrinkSelection(),
  selectCard,
  condense,
  toggleCase,
};
