/**
 * DocModel <-> ProseMirror document conversion. Lossless both ways:
 * raw pass-through blocks become atom nodes holding an index into the
 * session's raw-node registry; run marks map 1:1.
 */
import { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema';
import {
  type DocModel, type BodyBlock, type Paragraph, type Run, type RunMarks,
  type HighlightColor, STYLE,
} from '../model/types';
import type { XmlNode } from '../model/types';

export interface EditorSession {
  rawBlocks: XmlNode[];
  rels: Map<string, string>;
}

export function modelToPM(model: DocModel): { doc: PMNode; session: EditorSession } {
  const session: EditorSession = { rawBlocks: [], rels: model.rels };
  const blocks: PMNode[] = [];
  for (const b of model.blocks) {
    if (b.type === 'raw') {
      const idx = session.rawBlocks.length;
      session.rawBlocks.push(b.node);
      const name = Object.keys(b.node).find((k) => k !== ':@') ?? '';
      const label = name === 'w:tbl' ? 'Table' : name === 'w:sectPr' ? 'Page setup' : 'Preserved content';
      blocks.push(schema.nodes.rawblock.create({ idx, label }));
    } else {
      blocks.push(paraToPM(b.para));
    }
  }
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
  return { doc: schema.nodes.doc.create(null, blocks), session };
}

function paraToPM(p: Paragraph): PMNode {
  const inline: PMNode[] = [];
  for (const run of p.runs) {
    if (run.text === '') continue;
    inline.push(schema.text(run.text, marksToPM(run.marks)));
  }
  if (p.kind === 'heading' && p.level) {
    return schema.nodes.heading.create({ level: p.level }, inline);
  }
  return schema.nodes.paragraph.create(null, inline);
}

function marksToPM(m: RunMarks): Mark[] {
  const out: Mark[] = [];
  const M = schema.marks;
  switch (m.charStyle) {
    case undefined: break;
    case STYLE.CITE: out.push(M.cite.create()); break;
    case STYLE.UNDERLINE: out.push(M.ustyle.create()); break;
    case STYLE.EMPHASIS: out.push(M.emph.create()); break;
    default: out.push(M.cstyleOther.create({ id: m.charStyle }));
  }
  if (m.bold) out.push(M.bold.create());
  if (m.boldOff) out.push(M.boldOff.create());
  if (m.italic) out.push(M.italic.create());
  if (m.underline) out.push(M.udirect.create());
  if (m.strike) out.push(M.strike.create());
  if (m.highlight && m.highlight !== 'none') out.push(M.highlight.create({ color: m.highlight }));
  if (m.size !== undefined) out.push(M.size.create({ hp: m.size }));
  if (m.color) out.push(M.fcolor.create({ hex: m.color }));
  if (m.vertAlign) out.push(M.vert.create({ v: m.vertAlign }));
  if (m.link) out.push(M.link.create({ href: m.link }));
  return out;
}

export function pmToModel(doc: PMNode, session: EditorSession): DocModel {
  const blocks: BodyBlock[] = [];
  doc.forEach((node) => {
    if (node.type === schema.nodes.rawblock) {
      const raw = session.rawBlocks[node.attrs.idx];
      if (raw) blocks.push({ type: 'raw', node: raw });
      return;
    }
    const para: Paragraph = {
      kind: node.type === schema.nodes.heading ? 'heading' : 'para',
      level: node.type === schema.nodes.heading ? node.attrs.level : undefined,
      styleId: node.type === schema.nodes.heading ? `Heading${node.attrs.level}` : undefined,
      runs: [],
    };
    node.forEach((inline) => {
      if (!inline.isText || inline.text === undefined) return;
      para.runs.push({ text: inline.text, marks: pmMarksToModel(inline.marks) });
    });
    blocks.push({ type: 'p', para });
  });
  return { blocks, rels: session.rels };
}

function pmMarksToModel(marks: readonly Mark[]): RunMarks {
  const out: RunMarks = {};
  const M = schema.marks;
  for (const mark of marks) {
    switch (mark.type) {
      case M.cite: out.charStyle = STYLE.CITE; break;
      case M.ustyle: out.charStyle = STYLE.UNDERLINE; break;
      case M.emph: out.charStyle = STYLE.EMPHASIS; break;
      case M.cstyleOther: out.charStyle = mark.attrs.id; break;
      case M.bold: out.bold = true; break;
      case M.boldOff: out.boldOff = true; break;
      case M.italic: out.italic = true; break;
      case M.udirect: out.underline = true; break;
      case M.strike: out.strike = true; break;
      case M.highlight: out.highlight = mark.attrs.color as HighlightColor; break;
      case M.size: out.size = Number(mark.attrs.hp); break;
      case M.fcolor: out.color = mark.attrs.hex; break;
      case M.vert: out.vertAlign = mark.attrs.v; break;
      case M.link: out.link = mark.attrs.href; break;
    }
  }
  return out;
}
