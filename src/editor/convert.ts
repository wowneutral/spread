/**
 * DocModel <-> ProseMirror document conversion. Lossless both ways:
 * raw pass-through blocks become atom nodes holding an index into the
 * session's raw-node registry; unmodeled paragraph and run properties ride
 * along the same way (pprIdx attr / rawrpr mark), so editing a file no longer
 * drops formatting we don't model. Run marks map 1:1.
 */
import { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema';
import {
  type DocModel, type BodyBlock, type Paragraph, type RunMarks,
  type HighlightColor, STYLE,
} from '../model/types';
import type { XmlNode } from '../model/types';

export interface EditorSession {
  rawBlocks: XmlNode[];
  rawPPrs: XmlNode[][];
  rawRPrs: XmlNode[][];
  rels: Map<string, string>;
}

export function modelToPM(model: DocModel): { doc: PMNode; session: EditorSession } {
  const session: EditorSession = { rawBlocks: [], rawPPrs: [], rawRPrs: [], rels: model.rels };
  const blocks: PMNode[] = [];
  for (const b of model.blocks) {
    if (b.type === 'raw') {
      const idx = session.rawBlocks.length;
      session.rawBlocks.push(b.node);
      const name = Object.keys(b.node).find((k) => k !== ':@') ?? '';
      const label = name === 'w:tbl' ? 'Table' : name === 'w:sectPr' ? 'Page setup' : 'Preserved content';
      blocks.push(schema.nodes.rawblock.create({ idx, label }));
    } else {
      blocks.push(paraToPM(b.para, session));
    }
  }
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
  return { doc: schema.nodes.doc.create(null, blocks), session };
}

function paraToPM(p: Paragraph, session: EditorSession): PMNode {
  const inline: PMNode[] = [];
  for (const run of p.runs) {
    if (run.text === '') continue;
    const marks = marksToPM(run.marks);
    if (run.rawRPr && run.rawRPr.length) {
      const idx = session.rawRPrs.length;
      session.rawRPrs.push(run.rawRPr);
      marks.push(schema.marks.rawrpr.create({ idx }));
    }
    inline.push(schema.text(run.text, marks));
  }
  let pprIdx = -1;
  if (p.rawPPr && p.rawPPr.length) {
    pprIdx = session.rawPPrs.length;
    session.rawPPrs.push(p.rawPPr);
  }
  const layout = { indent: p.indent ?? 0, align: p.align ?? null, pprIdx };
  if (p.kind === 'heading' && p.level) {
    return schema.nodes.heading.create({ level: p.level, ...layout }, inline);
  }
  const kind = p.styleId === STYLE.ANALYTIC ? 'analytic'
    : p.styleId === STYLE.UNDERTAG ? 'undertag' : 'p';
  return schema.nodes.paragraph.create({ kind, ...layout }, inline);
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
  if (m.shd) out.push(M.shd.create({ hex: m.shd }));
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
    const isHeading = node.type === schema.nodes.heading;
    const kind = isHeading ? undefined : node.attrs.kind;
    const styleId = isHeading ? `Heading${node.attrs.level}`
      : kind === 'analytic' ? STYLE.ANALYTIC
      : kind === 'undertag' ? STYLE.UNDERTAG
      : undefined;
    const para: Paragraph = {
      kind: isHeading ? 'heading' : 'para',
      level: isHeading ? node.attrs.level : undefined,
      styleId,
      align: node.attrs.align ?? undefined,
      indent: node.attrs.indent > 0 ? node.attrs.indent : undefined,
      rawPPr: node.attrs.pprIdx >= 0 ? session.rawPPrs[node.attrs.pprIdx] : undefined,
      runs: [],
    };
    node.forEach((inline) => {
      if (!inline.isText || inline.text === undefined) return;
      const rawMark = schema.marks.rawrpr.isInSet(inline.marks);
      para.runs.push({
        text: inline.text,
        marks: pmMarksToModel(inline.marks),
        rawRPr: rawMark ? session.rawRPrs[rawMark.attrs.idx] : undefined,
      });
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
      case M.shd: out.shd = mark.attrs.hex; break;
      case M.size: out.size = Number(mark.attrs.hp); break;
      case M.fcolor: out.color = mark.attrs.hex; break;
      case M.vert: out.vertAlign = mark.attrs.v; break;
      case M.link: out.link = mark.attrs.href; break;
      case M.rawrpr: break; // handled at the run level via the registry
    }
  }
  return out;
}
