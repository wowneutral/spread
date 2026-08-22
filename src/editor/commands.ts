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

/** Mod-F7 Analytic / Mod-F8 Undertag: toggle the paragraph kind. */
export function setParaKind(kind: 'analytic' | 'undertag'): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const isSame = $from.parent.type === schema.nodes.paragraph && $from.parent.attrs.kind === kind;
    return setBlockType(schema.nodes.paragraph, { kind: isSame ? 'p' : kind })(state, dispatch, view);
  };
}

/** Tab / Shift-Tab: indent or outdent the block(s) in the selection by 0.5". */
export function indentBlock(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const targets: { pos: number; node: any }[] = [];
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (parent !== state.doc) return false;
      if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
        targets.push({ pos, node });
      }
      return false;
    });
    if (targets.length === 0) return false;
    if (dispatch) {
      let tr = state.tr;
      for (const t of targets) {
        const cur = t.node.attrs.indent ?? 0;
        const next = Math.max(0, Math.min(7200, cur + delta * 720));
        if (next !== cur) tr = tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, indent: next });
      }
      dispatch(tr);
    }
    return true;
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

/** Built-in shrink protections: omission notes and integrity markers. */
const PROTECTED_RE = /[\[<{][^\]>}]*(omitted|omission|integrity|translation by)[^\]>}]*[\]>}]/i;

function isProtected(text: string, custom: string[]): boolean {
  if (PROTECTED_RE.test(text)) return true;
  const lower = text.toLowerCase();
  return custom.some((s) => s && lower.includes(s.toLowerCase()));
}

/**
 * Mod-8 / Shrink: minimize un-underlined text. Underlined (style or direct),
 * cite, emphasis, and highlighted runs keep full size — so do omission notes
 * and any custom protected strings — everything else drops to 8pt. Applied
 * again, restores. Falls back to the enclosing card when nothing is selected.
 */
export function shrinkSelection(getProtections: () => string[] = () => []): Command {
  return (state, dispatch) => {
    const r = state.selection.empty ? cardBodyRange(state) : state.selection;
    if (!r || r.from === r.to) return false;
    const { from, to } = r;
    const custom = getProtections();
    const M = schema.marks;
    const keep = [M.ustyle, M.cite, M.emph, M.udirect, M.highlight];
    const skip = (node: any, parent: any): boolean => {
      if (parent?.type === schema.nodes.heading) return true;
      if (parent?.type === schema.nodes.paragraph && parent.attrs.kind !== 'p') return true;
      if (keep.some((t) => t.isInSet(node.marks))) return true;
      if (node.text && isProtected(node.text, custom)) return true;
      return false;
    };
    // Mode: if any shrinkable text is currently un-shrunk, shrink; else restore.
    let anyUnshrunk = false;
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (!node.isText) return;
      if (skip(node, parent)) return;
      if (!M.size.isInSet(node.marks)) anyUnshrunk = true;
    });
    if (dispatch) {
      let tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (!node.isText) return;
        if (skip(node, parent)) return;
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

/** Mod-Shift-8 / Regrow: strip size marks, restoring everything to full size. */
export const regrow: Command = (state, dispatch) => {
  const r = state.selection.empty ? cardBodyRange(state) : state.selection;
  if (!r || r.from === r.to) return false;
  if (dispatch) dispatch(state.tr.removeMark(r.from, r.to, schema.marks.size).scrollIntoView());
  return true;
};

/** Alt-F8: copy the nearest preceding cite paragraph into the current card. */
export const copyPreviousCite: Command = (state, dispatch) => {
  const doc = state.doc;
  const $from = state.selection.$from;
  const here = $from.index(0);
  for (let i = here - 1; i >= 0; i--) {
    const node = doc.child(i);
    if (node.type !== schema.nodes.paragraph) continue;
    let hasCite = false;
    node.forEach((inline) => { if (schema.marks.cite.isInSet(inline.marks)) hasCite = true; });
    if (!hasCite) continue;
    if (dispatch) {
      let pos = 0;
      for (let k = 0; k <= here; k++) pos += doc.child(k).nodeSize;
      const copy = schema.nodes.paragraph.create(node.attrs, node.content);
      let tr = state.tr.insert(pos, copy);
      tr = tr.setSelection(TextSelection.create(tr.doc, pos + copy.nodeSize - 1)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  }
  return false;
};

/** Mod-Shift-D: toggle a red reading-position marker ("Marked 7:32"). */
export function toggleMarker(timeStr: () => string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    // If the cursor touches an existing marker run, remove it.
    const candidates = [$from.nodeBefore, $from.nodeAfter];
    for (const node of candidates) {
      if (node?.isText && node.text && /Marked \d/.test(node.text)) {
        const fc = schema.marks.fcolor.isInSet(node.marks);
        if (fc && fc.attrs.hex === 'FF0000') {
          if (dispatch) {
            const start = node === $from.nodeBefore ? $from.pos - node.nodeSize : $from.pos;
            dispatch(state.tr.delete(start, start + node.nodeSize));
          }
          return true;
        }
      }
    }
    if (dispatch) {
      const text = ` Marked ${timeStr()} `;
      const mark = schema.marks.fcolor.create({ hex: 'FF0000' });
      dispatch(state.tr.replaceSelectionWith(schema.text(text, [mark]), false).scrollIntoView());
    }
    return true;
  };
}

/** PageUp / PageDown: jump to the previous / next heading or analytic. */
export function jumpHeading(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    const here = state.selection.$from.index(0);
    const isStop = (n: any) => n.type === schema.nodes.heading ||
      (n.type === schema.nodes.paragraph && n.attrs.kind === 'analytic');
    for (let i = here + dir; i >= 0 && i < doc.childCount; i += dir) {
      if (isStop(doc.child(i))) {
        if (dispatch) {
          let pos = 0;
          for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
          dispatch(state.tr.setSelection(TextSelection.create(doc, pos + 1)).scrollIntoView());
        }
        return true;
      }
    }
    return false;
  };
}

/** Alt-A: select the current heading and everything under it. */
export const selectSection: Command = (state, dispatch) => {
  const doc = state.doc;
  let index = state.selection.$from.index(0);
  while (index > 0 && doc.child(index).type !== schema.nodes.heading) index--;
  if (doc.child(index).type !== schema.nodes.heading) return selectCard(state, dispatch);
  const level = doc.child(index).attrs.level;
  let end = index;
  while (end + 1 < doc.childCount) {
    const next = doc.child(end + 1);
    if (next.type === schema.nodes.heading && next.attrs.level <= level) break;
    end++;
  }
  let fromPos = 0;
  for (let i = 0; i < index; i++) fromPos += doc.child(i).nodeSize;
  let toPos = fromPos;
  for (let i = index; i <= end; i++) toPos += doc.child(i).nodeSize;
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(doc, fromPos + 1, toPos - 1)));
  return true;
};

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
 * The card region around the cursor: from below the nearest heading to the
 * next heading / raw block. Returns text positions, or null.
 */
export function cardBodyRange(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  const $from = state.selection.$from;
  let index = $from.index(0);
  while (index > 0 && doc.child(index).type !== schema.nodes.heading) index--;
  const start = doc.child(index).type === schema.nodes.heading ? index + 1 : index;
  let end = start;
  while (end + 1 < doc.childCount) {
    const next = doc.child(end + 1);
    if (next.type === schema.nodes.heading || next.type === schema.nodes.rawblock) break;
    end++;
  }
  if (start >= doc.childCount || end < start) return null;
  let pos = 0;
  for (let i = 0; i < start; i++) pos += doc.child(i).nodeSize;
  const from = pos + 1;
  for (let i = start; i <= end; i++) pos += doc.child(i).nodeSize;
  return { from, to: pos - 1 };
}

/** The 6pt pilcrow run that marks an original paragraph break. */
const PILCROW = '¶';
const PILCROW_HP = 12;

export type CondenseMode = 'merge' | 'pilcrows' | 'whitespace';

/**
 * The F3 family. 'merge' joins paragraphs flat (a space at each seam);
 * 'pilcrows' joins but marks each old break with a small ¶ so Uncondense can
 * restore it; 'whitespace' keeps the breaks and only collapses runs of
 * spaces. Selection first; the enclosing card body when nothing is selected.
 */
export function condenseCmd(mode: CondenseMode): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    const r = state.selection.empty ? cardBodyRange(state) : state.selection;
    if (!r || r.from === r.to) return false;
    const { from, to } = r;

    if (mode === 'whitespace') {
      const fixes: { a: number; b: number }[] = [];
      doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText || !node.text) return true;
        const re = /\s{2,}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(node.text))) {
          const a = Math.max(from, pos + m.index);
          const b = Math.min(to, pos + m.index + m[0].length);
          if (b - a > 1) fixes.push({ a, b });
        }
        return false;
      });
      if (fixes.length === 0) return false;
      if (dispatch) {
        let tr = state.tr;
        for (const f of [...fixes].reverse()) tr = tr.insertText(' ', f.a, f.b);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // Collect join points (boundaries between adjacent body paragraphs).
    const joins: number[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type !== schema.nodes.paragraph) return true;
      const after = pos + node.nodeSize;
      if (after < to) {
        const $after = doc.resolve(after);
        // Respect headings: only paragraph-to-paragraph seams merge.
        if ($after.nodeAfter?.type === schema.nodes.paragraph && $after.nodeAfter.attrs.kind === 'p' && node.attrs.kind === 'p') {
          joins.push(after);
        }
      }
      return false;
    });
    if (joins.length === 0) return false;
    if (dispatch) {
      let tr = state.tr;
      for (const pos of [...joins].reverse()) {
        const mapped = tr.mapping.map(pos);
        tr = tr.join(mapped);
        const seam = mapped - 1;
        if (mode === 'pilcrows') {
          tr = tr.insertText(` ${PILCROW} `, seam);
          tr = tr.addMark(seam + 1, seam + 2, schema.marks.size.create({ hp: PILCROW_HP }));
        } else {
          const $seam = tr.doc.resolve(seam);
          const before = $seam.nodeBefore, afterN = $seam.nodeAfter;
          if (before?.isText && afterN?.isText && !/\s$/.test(before.text ?? '') && !/^\s/.test(afterN.text ?? '')) {
            tr = tr.insertText(' ', seam);
          }
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Back-compat handle: flat condense (used by tests and the palette). */
export const condense: Command = condenseCmd('merge');

/** Mod-Alt-Shift-F3: restore paragraph breaks from ¶ pilcrows. */
export const uncondense: Command = (state, dispatch) => {
  const r = state.selection.empty ? cardBodyRange(state) : state.selection;
  if (!r) return false;
  const marks: { pos: number }[] = [];
  state.doc.nodesBetween(r.from, r.to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    let i = node.text.indexOf(PILCROW);
    while (i >= 0) {
      marks.push({ pos: pos + i });
      i = node.text.indexOf(PILCROW, i + 1);
    }
    return false;
  });
  if (marks.length === 0) return false;
  if (dispatch) {
    let tr = state.tr;
    for (const m of [...marks].reverse()) {
      // Remove the pilcrow and the single spaces around it, then split.
      let a = m.pos, b = m.pos + 1;
      const $p = tr.doc.resolve(a);
      const text = $p.parent.textBetween(Math.max(0, $p.parentOffset - 1), Math.min($p.parent.content.size, $p.parentOffset + 2), '\0');
      if (text.startsWith(' ')) a--;
      if (text.endsWith(' ')) b++;
      tr = tr.delete(a, b);
      tr = tr.split(a);
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

/** Word highlight name -> hex, for highlight <-> background conversion. */
export const HL_HEX: Record<string, string> = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF',
  blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080',
  darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0',
  black: '000000', white: 'FFFFFF',
};
const HEX_HL: Record<string, string> = Object.fromEntries(
  Object.entries(HL_HEX).map(([k, v]) => [v, k]));

/** Apply an explicit font size (half-points) to the selection. */
export function setFontSize(hp: number): Command {
  return (state, dispatch) => {
    const { from, to } = wordRange(state);
    if (from === to) return false;
    if (dispatch) {
      const tr = hp <= 0
        ? state.tr.removeMark(from, to, schema.marks.size)
        : state.tr.addMark(from, to, schema.marks.size.create({ hp }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Grow / shrink the selection's font size by one point. */
export function stepFontSize(deltaPt: 1 | -1, baseHp: () => number): Command {
  return (state, dispatch) => {
    const { from, to } = wordRange(state);
    if (from === to) return false;
    if (dispatch) {
      let tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
        const cur = schema.marks.size.isInSet(node.marks);
        const hp = Math.max(2, (cur ? Number(cur.attrs.hp) : baseHp()) + deltaPt * 2);
        tr = tr.addMark(a, b, schema.marks.size.create({ hp }));
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Scope for bulk ops: the selection, or the whole document. */
function bulkRange(state: EditorState): { from: number; to: number } {
  const { from, to, empty } = state.selection;
  return empty ? { from: 0, to: state.doc.content.size } : { from, to };
}

/** Doc menu: convert every highlight in scope to one color. */
export function standardizeHighlights(color: string): Command {
  return (state, dispatch) => {
    const { from, to } = bulkRange(state);
    if (dispatch) {
      let tr = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const m = schema.marks.highlight.isInSet(node.marks);
        if (m && m.attrs.color !== color) {
          const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
          tr = tr.removeMark(a, b, schema.marks.highlight)
            .addMark(a, b, schema.marks.highlight.create({ color }));
        }
      });
      dispatch(tr);
    }
    return true;
  };
}

/** Doc menu: strip every highlight (or background) in scope. */
export function removeAllOf(markName: 'highlight' | 'shd' | 'link'): Command {
  return (state, dispatch) => {
    const { from, to } = bulkRange(state);
    if (dispatch) dispatch(state.tr.removeMark(from, to, schema.marks[markName]));
    return true;
  };
}

/** Doc menu: highlight -> background color (frees the highlight layer). */
export const highlightToBackground: Command = (state, dispatch) => {
  const { from, to } = bulkRange(state);
  if (dispatch) {
    let tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const m = schema.marks.highlight.isInSet(node.marks);
      if (m) {
        const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
        const hex = HL_HEX[m.attrs.color] ?? 'FFFF00';
        tr = tr.removeMark(a, b, schema.marks.highlight)
          .addMark(a, b, schema.marks.shd.create({ hex }));
      }
    });
    dispatch(tr);
  }
  return true;
};

/** Doc menu: background color -> highlight, where the color maps. */
export const backgroundToHighlight: Command = (state, dispatch) => {
  const { from, to } = bulkRange(state);
  if (dispatch) {
    let tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const m = schema.marks.shd.isInSet(node.marks);
      if (m) {
        const name = HEX_HL[String(m.attrs.hex).toUpperCase()];
        if (!name) return;
        const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
        tr = tr.removeMark(a, b, schema.marks.shd)
          .addMark(a, b, schema.marks.highlight.create({ color: name }));
      }
    });
    dispatch(tr);
  }
  return true;
};

// Named command handles for palette/toolbar/keymap reuse.
export const commands = {
  pocket: setLevel(1),
  hat: setLevel(2),
  block: setLevel(3),
  tag: setLevel(4),
  analytic: setParaKind('analytic'),
  undertag: setParaKind('undertag'),
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
  regrow,
  selectCard,
  selectSection,
  condense,
  uncondense,
  toggleCase,
  copyPreviousCite,
  indent: indentBlock(1),
  outdent: indentBlock(-1),
  headingNext: jumpHeading(1),
  headingPrev: jumpHeading(-1),
};
