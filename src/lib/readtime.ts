/**
 * Read-time model, CardMirror-compatible: read-aloud content is tags and
 * headings, cites, analytics, and highlighted text. Underlined-but-not-
 * highlighted text is context you skip in round, so it does not count —
 * this matches CardMirror's Doc number exactly.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema';

function countWords(text: string): number {
  return (text.match(/[\w'’-]+/g) ?? []).length;
}

export function readableWords(doc: PMNode): number {
  let words = 0;
  const M = schema.marks;
  doc.descendants((node) => {
    if (node.type === schema.nodes.heading ||
        (node.type === schema.nodes.paragraph && node.attrs.kind === 'analytic')) {
      words += countWords(node.textContent);
      return false; // don't double count children
    }
    if (node.type === schema.nodes.paragraph && node.attrs.kind === 'undertag') {
      return false; // undertags are not read aloud
    }
    if (node.isText && node.text) {
      const marks = node.marks;
      const readable = M.highlight.isInSet(marks) || M.cite.isInSet(marks);
      if (readable) words += countWords(node.text);
    }
    return true;
  });
  return words;
}

/** Words in a text slice using the same readability rule (for selections). */
export function readableWordsInSelection(doc: PMNode, from: number, to: number): number {
  let words = 0;
  const M = schema.marks;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isText && node.text) {
      const start = Math.max(from, pos), end = Math.min(to, pos + node.nodeSize);
      const text = node.text.slice(start - pos, end - pos);
      if (parent?.type === schema.nodes.paragraph && parent.attrs.kind === 'undertag') return true;
      const inHeading = parent?.type === schema.nodes.heading ||
        (parent?.type === schema.nodes.paragraph && parent.attrs.kind === 'analytic');
      const marks = node.marks;
      const readable = inHeading ||
        M.highlight.isInSet(marks) || M.cite.isInSet(marks);
      if (readable) words += countWords(text);
    }
    return true;
  });
  return words;
}

export function secondsAt(words: number, wpm: number): number {
  if (wpm <= 0) return 0;
  return Math.round((words / wpm) * 60);
}

export function fmtTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
