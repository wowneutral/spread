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
};
