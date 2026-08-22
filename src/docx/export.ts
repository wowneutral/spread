/**
 * DocModel -> .docx exporter.
 *
 * Strategy: keep every part of the original file untouched except
 * word/document.xml, which we regenerate from the model. Raw pass-through
 * fragments (rawPPr / rawRPr / raw body blocks) are re-emitted verbatim, so
 * properties we never modeled survive. For brand-new documents we start from
 * a canonical minimal Verbatim package generated in template.ts.
 */
import { buildXml, el, textNode, XML_DECL, ATTR } from './xml';
import { writeDocx, setPartText, type PartMap } from './zip';
import {
  type DocModel, type BodyBlock, type Paragraph, type Run,
  STYLE_BY_HEADING_LEVEL,
} from '../model/types';

/** Namespaces Word emits on w:document; we mirror the common set. */
const DOC_ATTRS: Record<string, string> = {
  'xmlns:wpc': 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  'xmlns:o': 'urn:schemas-microsoft-com:office:office',
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'xmlns:m': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'xmlns:v': 'urn:schemas-microsoft-com:vml',
  'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  'xmlns:w10': 'urn:schemas-microsoft-com:office:word',
  'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'xmlns:w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
  'xmlns:wpg': 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  'xmlns:wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'mc:Ignorable': 'w14 wp14',
};

export interface ExportOptions {
  /**
   * Hyperlink support: existing links are exported as plain styled runs unless
   * their target already has a relationship in the original file. New-link
   * relationship management lands with the link editor (v1 keeps links read-faithful).
   */
  linkRelIds?: Map<string, string>; // target URL -> existing rId
}

export function exportDocx(model: DocModel, parts: PartMap, opts: ExportOptions = {}): Uint8Array {
  const linkRels = opts.linkRelIds ?? invertRels(model.rels);
  const bodyKids: any[] = [];
  for (const block of model.blocks) {
    if (block.type === 'raw') bodyKids.push(block.node);
    else bodyKids.push(exportParagraph(block.para, linkRels));
  }
  const doc = el('w:document', [el('w:body', bodyKids)], DOC_ATTRS);
  const xml = XML_DECL + buildXml([doc]);
  setPartText(parts, 'word/document.xml', xml);
  return writeDocx(parts);
}

function invertRels(rels: Map<string, string>): Map<string, string> {
  const inv = new Map<string, string>();
  for (const [id, target] of rels) if (!inv.has(target)) inv.set(target, id);
  return inv;
}

function exportParagraph(p: Paragraph, linkRels: Map<string, string>): any {
  const kids: any[] = [];
  const pPrKids: any[] = [];
  const styleId = p.kind === 'heading' && p.level
    ? STYLE_BY_HEADING_LEVEL[p.level]
    : p.styleId && p.styleId !== 'Normal' ? p.styleId : undefined;
  if (styleId) pPrKids.push(el('w:pStyle', [], { 'w:val': styleId }));
  if (p.rawPPr) pPrKids.push(...p.rawPPr);
  if (pPrKids.length) kids.push(el('w:pPr', pPrKids));

  // Group consecutive runs sharing a link target under one w:hyperlink.
  let i = 0;
  while (i < p.runs.length) {
    const run = p.runs[i];
    if (run.marks.link) {
      const target = run.marks.link;
      const group: Run[] = [];
      while (i < p.runs.length && p.runs[i].marks.link === target) group.push(p.runs[i++]);
      const rid = linkRels.get(target);
      const runNodes = group.map(exportRun);
      if (rid) {
        kids.push(el('w:hyperlink', runNodes, { 'r:id': rid, 'w:history': '1' }));
      } else {
        // No relationship available: emit runs styled as-is (URL text preserved).
        kids.push(...runNodes);
      }
    } else {
      kids.push(exportRun(run));
      i++;
    }
  }
  return el('w:p', kids);
}

function exportRun(r: Run): any {
  const rPrKids: any[] = [];
  const m = r.marks;
  if (m.charStyle) rPrKids.push(el('w:rStyle', [], { 'w:val': m.charStyle }));
  if (m.bold) { rPrKids.push(el('w:b', [])); rPrKids.push(el('w:bCs', [])); }
  if (m.boldOff) { rPrKids.push(el('w:b', [], { 'w:val': '0' })); rPrKids.push(el('w:bCs', [], { 'w:val': '0' })); }
  if (m.italic) rPrKids.push(el('w:i', []));
  if (m.strike) rPrKids.push(el('w:strike', []));
  if (m.underline) rPrKids.push(el('w:u', [], { 'w:val': 'single' }));
  if (m.color) rPrKids.push(el('w:color', [], { 'w:val': m.color }));
  if (m.size !== undefined) {
    rPrKids.push(el('w:sz', [], { 'w:val': String(m.size) }));
    rPrKids.push(el('w:szCs', [], { 'w:val': String(m.size) }));
  }
  if (m.highlight && m.highlight !== 'none') rPrKids.push(el('w:highlight', [], { 'w:val': m.highlight }));
  if (m.vertAlign) rPrKids.push(el('w:vertAlign', [], { 'w:val': m.vertAlign }));
  if (r.rawRPr) {
    // Re-emit unmodeled props, skipping any that would duplicate modeled ones.
    const emitted = new Set(rPrKids.map((n) => Object.keys(n).find((k) => k !== ATTR)));
    for (const raw of r.rawRPr) {
      const name = Object.keys(raw).find((k) => k !== ATTR);
      if (name && !emitted.has(name)) rPrKids.push(raw);
    }
  }

  const kids: any[] = [];
  if (rPrKids.length) kids.push(el('w:rPr', rPrKids));
  // Split text on tabs/newlines into w:t / w:tab / w:br sequence.
  const segments = r.text.split(/(\t|\n)/);
  for (const seg of segments) {
    if (seg === '\t') kids.push(el('w:tab', []));
    else if (seg === '\n') kids.push(el('w:br', []));
    else if (seg !== '') {
      const t = el('w:t', [textNode(seg)]);
      if (/^\s|\s$/.test(seg)) t[ATTR] = { 'xml:space': 'preserve' };
      kids.push(t);
    }
  }
  if (kids.length === 0) kids.push(el('w:t', [textNode('')]));
  return el('w:r', kids);
}
