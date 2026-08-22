/**
 * Read-time model, CardMirror-status-bar compatible:
 * "Doc: N · Reader 1: M:SS · Reader 2: M:SS" where N counts the words you
 * would actually read aloud — underlined (style or direct), highlighted,
 * emphasized, cite-styled runs, and tag/heading text. Shrunk un-underlined
 * body text does not count.
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
    if (node.type === schema.nodes.heading) {
      words += countWords(node.textContent);
      return false; // don't double count children
    }
    if (node.isText && node.text) {
      const marks = node.marks;
      const readable =
        M.ustyle.isInSet(marks) || M.udirect.isInSet(marks) ||
        M.highlight.isInSet(marks) || M.emph.isInSet(marks) ||
        M.cite.isInSet(marks);
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
      const inHeading = parent?.type === schema.nodes.heading;
      const marks = node.marks;
      const readable = inHeading ||
        M.ustyle.isInSet(marks) || M.udirect.isInSet(marks) ||
        M.highlight.isInSet(marks) || M.emph.isInSet(marks) ||
        M.cite.isInSet(marks);
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
