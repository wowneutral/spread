/**
 * .docx -> DocModel importer.
 *
 * Reads word/document.xml in preserveOrder form and produces the flat
 * paragraph model. Unmodeled paragraph/run properties are captured as raw
 * pass-through fragments so the exporter can re-emit them untouched.
 * Anything that is not a paragraph (tables, sectPr, bookmarks at body level)
 * is kept as an opaque raw block and re-emitted verbatim.
 */
import {
  parseXml, nodeName, children, childrenNamed, child, attrs, textContent, ATTR,
} from './xml';
import { readDocx, partText, type PartMap } from './zip';
import {
  type DocModel, type BodyBlock, type Paragraph, type Run, type RunMarks,
  type HighlightColor, HEADING_LEVEL_BY_STYLE,
} from '../model/types';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ImportedDoc {
  model: DocModel;
  /** The full part map — held so export can pass everything through. */
  parts: PartMap;
  /** Parsed document.xml tree (preserveOrder) for structural pass-through. */
  docTree: any[];
}

export function importDocx(bytes: Uint8Array): ImportedDoc {
  const parts = readDocx(bytes);
  const docXml = partText(parts, 'word/document.xml');
  if (!docXml) throw new Error('Not a .docx: word/document.xml missing');
  const docTree = parseXml(docXml);
  const rels = parseRels(partText(parts, 'word/_rels/document.xml.rels'));
  const body = findBody(docTree);
  const blocks: BodyBlock[] = [];
  let nextId = 1;
  for (const node of body ? children(body) : []) {
    const name = nodeName(node);
    if (name === 'w:p') {
      blocks.push({ type: 'p', para: importParagraph(node, rels, () => `p${nextId++}`) });
    } else {
      blocks.push({ type: 'raw', node });
    }
  }
  return { model: { blocks, rels }, parts, docTree };
}

function findBody(tree: any[]): any | null {
  for (const n of tree) {
    if (nodeName(n) === 'w:document') {
      return child(n, 'w:body');
    }
  }
  return null;
}

function parseRels(xml: string | null): Map<string, string> {
  const rels = new Map<string, string>();
  if (!xml) return rels;
  const tree = parseXml(xml);
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (nodeName(n) === 'Relationship') {
        const a = attrs(n);
        if (a.Id && a.Target) rels.set(a.Id, a.Target);
      }
      walk(children(n));
    }
  };
  walk(tree);
  return rels;
}

function importParagraph(pNode: any, rels: Map<string, string>, mkId: () => string): Paragraph {
  const pPr = child(pNode, 'w:pPr');
  let styleId: string | undefined;
  let align: Paragraph['align'];
  let indent: number | undefined;
  let dispBeforePt: number | undefined;
  let dispAfterPt: number | undefined;
  let dispLine: number | undefined;
  const rawPPr: any[] = [];
  if (pPr) {
    for (const c of children(pPr)) {
      const name = nodeName(c);
      if (name === 'w:pStyle') styleId = attrs(c)['w:val'];
      else if (name === 'w:jc') {
        const v = attrs(c)['w:val'];
        if (v === 'left' || v === 'center' || v === 'right' || v === 'both') align = v;
        else rawPPr.push(c);
      } else if (name === 'w:spacing') {
        // Display-only: read the paragraph's own spacing, keep the node raw
        // so export re-emits it byte-faithfully.
        const a = attrs(c);
        if (a['w:before'] !== undefined) dispBeforePt = Number(a['w:before']) / 20;
        if (a['w:after'] !== undefined) dispAfterPt = Number(a['w:after']) / 20;
        if (a['w:line'] !== undefined && (a['w:lineRule'] === 'auto' || a['w:lineRule'] === undefined)) {
          dispLine = Number(a['w:line']) / 240;
        }
        rawPPr.push(c);
      } else if (name === 'w:ind') {
        // Model the plain left indent; anything richer stays raw.
        const a = attrs(c);
        const keys = Object.keys(a);
        const left = a['w:left'] ?? a['w:start'];
        const onlyLeft = keys.every((k) => k === 'w:left' || k === 'w:start');
        if (left !== undefined && onlyLeft) indent = Number(left);
        else rawPPr.push(c);
      } else rawPPr.push(c);
    }
  }
  const level = styleId ? HEADING_LEVEL_BY_STYLE[styleId] : undefined;
  const para: Paragraph = {
    kind: level ? 'heading' : 'para',
    level,
    styleId,
    align,
    indent,
    dispBeforePt,
    dispAfterPt,
    dispLine,
    runs: [],
    rawPPr: rawPPr.length ? rawPPr : undefined,
    id: mkId(),
  };
  collectRuns(pNode, para.runs, rels, undefined);
  return para;
}

/** Recursively collect runs; hyperlink wrappers contribute a link mark. */
function collectRuns(node: any, out: Run[], rels: Map<string, string>, link: string | undefined) {
  for (const c of children(node)) {
    const name = nodeName(c);
    if (name === 'w:r') {
      const run = importRun(c, link);
      if (run) out.push(run);
    } else if (name === 'w:hyperlink') {
      const rid = attrs(c)['r:id'];
      const target = rid ? rels.get(rid) : undefined;
      collectRuns(c, out, rels, target ?? link);
    } else if (name === 'w:pPr') {
      // skip — handled in importParagraph
    } else if (name === 'w:smartTag' || name === 'w:ins') {
      // unwrap containers whose children are ordinary runs
      collectRuns(c, out, rels, link);
    }
    // w:del (tracked deletions), bookmarks, proofErr: dropped/ignored at run level
  }
}

function importRun(rNode: any, link: string | undefined): Run | null {
  const rPr = child(rNode, 'w:rPr');
  const marks: RunMarks = {};
  const rawRPr: any[] = [];
  if (link) marks.link = link;
  if (rPr) {
    for (const c of children(rPr)) {
      const name = nodeName(c);
      const a = attrs(c);
      switch (name) {
        case 'w:rStyle': marks.charStyle = a['w:val']; break;
        case 'w:b':
          if (a['w:val'] === '0' || a['w:val'] === 'false') marks.boldOff = true;
          else marks.bold = true;
          break;
        case 'w:i':
          if (!(a['w:val'] === '0' || a['w:val'] === 'false')) marks.italic = true;
          break;
        case 'w:u':
          if (a['w:val'] && a['w:val'] !== 'none') marks.underline = true;
          break;
        case 'w:strike':
          if (!(a['w:val'] === '0' || a['w:val'] === 'false')) marks.strike = true;
          break;
        case 'w:highlight':
          marks.highlight = a['w:val'] as HighlightColor; break;
        case 'w:shd': {
          const fill = a['w:fill'];
          if (fill && fill !== 'auto') marks.shd = fill;
          break;
        }
        case 'w:sz': marks.size = Number(a['w:val']); break;
        case 'w:color': marks.color = a['w:val']; break;
        case 'w:vertAlign':
          if (a['w:val'] === 'superscript' || a['w:val'] === 'subscript') marks.vertAlign = a['w:val'];
          break;
        case 'w:bCs': /* modeled implicitly with bold on export */ rawRPr.push(c); break;
        default: rawRPr.push(c);
      }
    }
  }
  // Text content: w:t, w:tab -> \t, w:br -> \n
  let text = '';
  for (const c of children(rNode)) {
    const name = nodeName(c);
    if (name === 'w:t') text += textContent(c);
    else if (name === 'w:tab') text += '\t';
    else if (name === 'w:br' || name === 'w:cr') text += '\n';
    // w:drawing (images) etc.: not modeled in v1 — dropped from text but kept
    // at the paragraph level only if the whole paragraph is raw. Known limit.
  }
  if (text === '' && rawRPr.length === 0 && Object.keys(marks).length === 0) return null;
  return { text, marks, rawRPr: rawRPr.length ? rawRPr : undefined };
}
