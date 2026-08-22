/**
 * File-driven rendering: theme fonts, per-paragraph spacing display, and the
 * CardMirror-accurate read-aloud word count.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseStylesheet, stylesheetCSS, parseThemeFonts } from '../src/docx/stylesheet';
import { importDocx } from '../src/docx/import';
import { exportDocx } from '../src/docx/export';
import { writeDocx } from '../src/docx/zip';
import { newDocumentParts } from '../src/docx/template';
import { modelToPM } from '../src/editor/convert';
import { readableWords } from '../src/lib/readtime';
import { schema } from '../src/editor/schema';
import type { DocModel } from '../src/model/types';

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements><a:fontScheme name="Office">
    <a:majorFont><a:latin typeface="Cambria Math"/></a:majorFont>
    <a:minorFont><a:latin typeface="Cambria"/></a:minorFont>
  </a:fontScheme></a:themeElements>
</a:theme>`;

const STYLES = `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

describe('theme-driven fonts', () => {
  it('reads minor/major faces from theme1.xml', () => {
    const fonts = parseThemeFonts(THEME);
    expect(fonts.minor).toBe('Cambria');
    expect(fonts.major).toBe('Cambria Math');
  });

  it('renders asciiTheme fonts with the file theme, not a hardcoded face', () => {
    const sheet = parseStylesheet(STYLES, THEME);
    const css = stylesheetCSS(sheet, '#docmount');
    expect(css).toContain('"Cambria"');
    expect(css).toContain('font-size:10pt');       // docDefaults sz 20hp
    expect(css).toMatch(/cs-h4\{[^}]*font-size:12pt/); // Heading4 sz 24hp
  });
});

describe('per-paragraph spacing display', () => {
  it('imports w:spacing for display and keeps it raw for export', () => {
    const parts = newDocumentParts();
    const model: DocModel = { blocks: [], rels: new Map() };
    model.blocks.push({ type: 'p', para: { kind: 'para', styleId: 'Normal', runs: [{ text: 'tight', marks: {} }] } });
    const out = exportDocx(model, parts);
    // splice a spacing override into the exported paragraph
    const dec = new TextDecoder().decode(out);
    void dec;
    const imported = importDocx(out);
    const p0 = imported.model.blocks[0];
    expect(p0.type).toBe('p');
    // synthesize: re-import a doc that carries spacing directly
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:t>tight</w:t></w:r></w:p>
    </w:body></w:document>`;
    const parts2 = newDocumentParts();
    parts2.set('word/document.xml', new TextEncoder().encode(xml));
    const re = importDocx(writeDocx(parts2));
    const para = re.model.blocks.find((b) => b.type === 'p');
    if (!para || para.type !== 'p') throw new Error('expected paragraph');
    expect(para.para.dispAfterPt).toBe(0);
    expect(para.para.dispLine).toBe(1);
    // display attrs reach the editor
    const { doc } = modelToPM(re.model);
    let pmPara: any = null;
    doc.forEach((n) => { if (!pmPara && n.type === schema.nodes.paragraph) pmPara = n; });
    expect(pmPara.attrs.sa).toBe(0);
    expect(pmPara.attrs.ln).toBe(1);
    // and the spacing node still exports (rawPPr pass-through) — re-import proves it
    const re2 = importDocx(exportDocx(re.model, re.parts));
    const p2 = re2.model.blocks.find((b) => b.type === 'p');
    if (!p2 || p2.type !== 'p') throw new Error('expected paragraph');
    expect(p2.para.dispAfterPt).toBe(0);
  });
});

describe('read-aloud words (CardMirror-accurate)', () => {
  it('counts tags, cites, analytics, highlights — not bare underlines', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 4 }, schema.text('two words')),               // 2
      schema.nodes.paragraph.create({ kind: 'analytic' }, schema.text('three more words')), // 3
      schema.nodes.paragraph.create(null, [
        schema.text('cite', [schema.marks.cite.create()]),                                // 1
        schema.text(' underlined only', [schema.marks.ustyle.create()]),                  // 0
        schema.text(' highlighted words', [schema.marks.highlight.create({ color: 'cyan' })]), // 2
        schema.text(' plain filler'),                                                     // 0
      ]),
    ]);
    expect(readableWords(doc)).toBe(8);
  });
});
