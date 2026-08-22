/**
 * Canonical minimal Verbatim-compatible .docx package for documents created
 * from scratch. The style definitions are generated programmatically from the
 * documented Verbatim formatting facts (spec/verbatim-styles.md) — same
 * styleIds, names, aliases, and properties Word and Verbatim's macros key on.
 */
import { el, textNode, buildXml, XML_DECL } from './xml';
import type { PartMap } from './zip';

const enc = new TextEncoder();

function xml(nodes: any[]): Uint8Array {
  return enc.encode(XML_DECL + buildXml(nodes));
}

const CONTENT_TYPES = el('Types', [
  el('Default', [], { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
  el('Default', [], { Extension: 'xml', ContentType: 'application/xml' }),
  el('Override', [], { PartName: '/word/document.xml', ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' }),
  el('Override', [], { PartName: '/word/styles.xml', ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml' }),
], { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' });

const ROOT_RELS = el('Relationships', [
  el('Relationship', [], {
    Id: 'rId1',
    Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
    Target: 'word/document.xml',
  }),
], { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' });

const DOC_RELS = el('Relationships', [
  el('Relationship', [], {
    Id: 'rId1',
    Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
    Target: 'styles.xml',
  }),
], { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' });

// ---------------------------------------------------------------------------
// styles.xml — the Verbatim debate styles, from documented formatting facts.
// w:sz values are half-points (52 = 26pt). Aliases match what Verbatim's VBA
// addresses ("Pocket", "Hat", "Block", "Tag", "Cite", "Underline").
// ---------------------------------------------------------------------------

function heading(
  id: string, name: string, alias: string, uiPriority: string, outline: number,
  sz: number, opts: { border?: boolean; underline?: 'single' | 'double'; center?: boolean; pageBreak?: boolean; iCs?: boolean },
): any {
  const pPr: any[] = [
    el('w:keepNext', []), el('w:keepLines', []),
    ...(opts.pageBreak ? [el('w:pageBreakBefore', [])] : []),
    el('w:spacing', [], { 'w:before': '240', 'w:after': '0' }),
    ...(opts.center ? [el('w:jc', [], { 'w:val': 'center' })] : []),
    el('w:outlineLvl', [], { 'w:val': String(outline) }),
  ];
  if (opts.border) {
    const b = { 'w:val': 'single', 'w:sz': '24', 'w:space': '1', 'w:color': 'auto' };
    pPr.splice(2, 0, el('w:pBdr', [
      el('w:top', [], b), el('w:left', [], b), el('w:bottom', [], b), el('w:right', [], b),
    ]));
  }
  const rPr: any[] = [
    el('w:b', []), el('w:bCs', []),
    ...(opts.iCs ? [el('w:iCs', [])] : []),
    ...(opts.underline ? [el('w:u', [], { 'w:val': opts.underline })] : []),
    el('w:sz', [], { 'w:val': String(sz) }), el('w:szCs', [], { 'w:val': String(sz) }),
  ];
  return el('w:style', [
    el('w:name', [], { 'w:val': name }),
    el('w:aliases', [], { 'w:val': alias }),
    el('w:basedOn', [], { 'w:val': 'Normal' }),
    el('w:next', [], { 'w:val': 'Normal' }),
    el('w:uiPriority', [], { 'w:val': uiPriority }),
    el('w:qFormat', []),
    el('w:pPr', pPr),
    el('w:rPr', rPr),
  ], { 'w:type': 'paragraph', 'w:styleId': id });
}

function charStyle(id: string, name: string, alias: string | null, rPrKids: any[]): any {
  const kids: any[] = [el('w:name', [], { 'w:val': name })];
  if (alias) kids.push(el('w:aliases', [], { 'w:val': alias }));
  kids.push(
    el('w:basedOn', [], { 'w:val': 'DefaultParagraphFont' }),
    el('w:uiPriority', [], { 'w:val': '1' }),
    el('w:qFormat', []),
    el('w:rPr', rPrKids),
  );
  return el('w:style', kids, { 'w:type': 'character', 'w:styleId': id });
}

const STYLES_XML = el('w:styles', [
  el('w:docDefaults', [
    el('w:rPrDefault', [el('w:rPr', [
      el('w:rFonts', [], { 'w:asciiTheme': 'minorHAnsi', 'w:eastAsiaTheme': 'minorHAnsi', 'w:hAnsiTheme': 'minorHAnsi', 'w:cstheme': 'minorBidi' }),
      el('w:sz', [], { 'w:val': '22' }), el('w:szCs', [], { 'w:val': '22' }),
      el('w:lang', [], { 'w:val': 'en-US', 'w:eastAsia': 'en-US', 'w:bidi': 'ar-SA' }),
    ])]),
    el('w:pPrDefault', [el('w:pPr', [
      el('w:spacing', [], { 'w:after': '160', 'w:line': '259', 'w:lineRule': 'auto' }),
    ])]),
  ]),
  el('w:style', [
    el('w:name', [], { 'w:val': 'Normal' }),
    el('w:aliases', [], { 'w:val': 'Card' }),
    el('w:qFormat', []),
  ], { 'w:type': 'paragraph', 'w:default': '1', 'w:styleId': 'Normal' }),
  el('w:style', [
    el('w:name', [], { 'w:val': 'Default Paragraph Font' }),
    el('w:uiPriority', [], { 'w:val': '1' }),
    el('w:semiHidden', []), el('w:unhideWhenUsed', []),
  ], { 'w:type': 'character', 'w:default': '1', 'w:styleId': 'DefaultParagraphFont' }),
  heading('Heading1', 'heading 1', 'Pocket', '9', 0, 52, { border: true, center: true, pageBreak: true }),
  heading('Heading2', 'heading 2', 'Hat', '9', 1, 44, { underline: 'double', center: true, pageBreak: true }),
  heading('Heading3', 'heading 3', 'Block', '9', 2, 32, { underline: 'single', center: true, pageBreak: true }),
  heading('Heading4', 'heading 4', 'Tag', '9', 3, 26, { iCs: true }),
  charStyle('Style13ptBold', 'Style 13 pt Bold', 'Cite', [
    el('w:b', []), el('w:bCs', []),
    el('w:sz', [], { 'w:val': '26' }), el('w:szCs', [], { 'w:val': '26' }),
    el('w:u', [], { 'w:val': 'none' }),
  ]),
  charStyle('StyleUnderline', 'Style Underline', 'Underline', [
    el('w:b', [], { 'w:val': '0' }), el('w:bCs', [], { 'w:val': '0' }),
    el('w:sz', [], { 'w:val': '22' }), el('w:szCs', [], { 'w:val': '22' }),
    el('w:u', [], { 'w:val': 'single' }),
  ]),
  charStyle('Emphasis', 'Emphasis', null, [
    el('w:rFonts', [], { 'w:ascii': 'Calibri', 'w:hAnsi': 'Calibri' }),
    el('w:b', []), el('w:bCs', []),
    el('w:i', [], { 'w:val': '0' }), el('w:iCs', [], { 'w:val': '0' }),
    el('w:sz', [], { 'w:val': '22' }), el('w:szCs', [], { 'w:val': '22' }),
    el('w:u', [], { 'w:val': 'single' }),
  ]),
  charStyle('Hyperlink', 'Hyperlink', null, [
    el('w:color', [], { 'w:val': '0563C1', 'w:themeColor': 'hyperlink' }),
    el('w:u', [], { 'w:val': 'single' }),
  ]),
], {
  'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'xmlns:w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
  'mc:Ignorable': 'w14',
});

const EMPTY_DOCUMENT = el('w:document', [el('w:body', [el('w:p', [])])], {
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
});

/** Fresh part map for a brand-new document. */
export function newDocumentParts(): PartMap {
  const parts: PartMap = new Map();
  parts.set('[Content_Types].xml', xml([CONTENT_TYPES]));
  parts.set('_rels/.rels', xml([ROOT_RELS]));
  parts.set('word/document.xml', xml([EMPTY_DOCUMENT]));
  parts.set('word/_rels/document.xml.rels', xml([DOC_RELS]));
  parts.set('word/styles.xml', xml([STYLES_XML]));
  return parts;
}
