/**
 * The kill-criterion suite: every fixture must survive import -> export ->
 * re-import with a semantically identical model, byte-identical styles.xml,
 * and identical text/marks. Fixtures are real Verbatim-styled files generated
 * against the extracted Verbatim 6.0.0 template spec.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importDocx } from '../src/docx/import';
import { exportDocx } from '../src/docx/export';
import { newDocumentParts } from '../src/docx/template';
import { readDocx, partText } from '../src/docx/zip';
import type { DocModel, Paragraph } from '../src/model/types';

const FIXTURES = join(__dirname, 'fixtures');
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.docx'));

/** Strip volatile fields (ids) for comparison. */
function normalize(model: DocModel) {
  return model.blocks.map((b) => {
    if (b.type === 'raw') return { raw: true };
    const p = b.para;
    return {
      kind: p.kind,
      level: p.level ?? null,
      // 'Normal' is the default and is deliberately not emitted — canonicalize.
      styleId: p.styleId && p.styleId !== 'Normal' ? p.styleId : null,
      runs: p.runs.map((r) => ({ text: r.text, marks: r.marks })),
    };
  });
}

function fullText(model: DocModel): string {
  return model.blocks
    .map((b) => (b.type === 'p' ? b.para.runs.map((r) => r.text).join('') : ''))
    .join('\n');
}

describe('round-trip fidelity', () => {
  for (const file of files) {
    describe(file, () => {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES, file)));

      it('imports without error', () => {
        const { model } = importDocx(bytes);
        expect(model.blocks.length).toBeGreaterThanOrEqual(0);
      });

      it('round-trips to a semantically identical model', () => {
        const first = importDocx(bytes);
        const out = exportDocx(first.model, first.parts);
        const second = importDocx(out);
        expect(normalize(second.model)).toEqual(normalize(first.model));
      });

      it('preserves styles.xml byte-for-byte', () => {
        const first = importDocx(bytes);
        const out = exportDocx(first.model, first.parts);
        const before = partText(readDocx(bytes), 'word/styles.xml');
        const after = partText(readDocx(out), 'word/styles.xml');
        expect(after).toEqual(before);
      });

      it('preserves all text content', () => {
        const first = importDocx(bytes);
        const out = exportDocx(first.model, first.parts);
        const second = importDocx(out);
        expect(fullText(second.model)).toEqual(fullText(first.model));
      });

      it('is a stable fixed point (second round-trip is byte-identical document.xml)', () => {
        const first = importDocx(bytes);
        const out1 = exportDocx(first.model, first.parts);
        const second = importDocx(out1);
        const out2 = exportDocx(second.model, second.parts);
        const doc1 = partText(readDocx(out1), 'word/document.xml');
        const doc2 = partText(readDocx(out2), 'word/document.xml');
        expect(doc2).toEqual(doc1);
      });
    });
  }
});

describe('fixture semantics', () => {
  it('01-minimal: recognizes the Verbatim structure', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '01-minimal.docx')));
    const { model } = importDocx(bytes);
    const paras = model.blocks.filter((b) => b.type === 'p').map((b: any) => b.para as Paragraph);
    const levels = paras.filter((p) => p.kind === 'heading').map((p) => p.level);
    expect(levels).toContain(1);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
    expect(levels).toContain(4);
    const styles = new Set(paras.flatMap((p) => p.runs.map((r) => r.marks.charStyle).filter(Boolean)));
    expect(styles.has('Style13ptBold')).toBe(true);
    expect(styles.has('StyleUnderline')).toBe(true);
  });

  it('02-highlights: all highlight colors survive', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '02-highlights.docx')));
    const first = importDocx(bytes);
    const out = exportDocx(first.model, first.parts);
    const { model } = importDocx(out);
    const colors = new Set<string>();
    for (const b of model.blocks) if (b.type === 'p')
      for (const r of b.para.runs) if (r.marks.highlight) colors.add(r.marks.highlight);
    for (const c of ['yellow', 'cyan', 'green', 'magenta']) expect(colors.has(c)).toBe(true);
  });

  it('05-unicode: exotic text and emoji survive byte-exact', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '05-unicode.docx')));
    const first = importDocx(bytes);
    const out = exportDocx(first.model, first.parts);
    const second = importDocx(out);
    expect(fullText(second.model)).toEqual(fullText(first.model));
    expect(fullText(first.model)).toMatch(/😎/);
  });

  it('07-large: imports and exports a big file quickly', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '07-large.docx')));
    const t0 = performance.now();
    const first = importDocx(bytes);
    const out = exportDocx(first.model, first.parts);
    importDocx(out);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
  });
});

describe('new documents', () => {
  it('creates a valid empty Verbatim-styled package', () => {
    const parts = newDocumentParts();
    const model: DocModel = { blocks: [], rels: new Map() };
    // Build a small doc: pocket, hat, tag, cite+body card.
    model.blocks.push(
      { type: 'p', para: { kind: 'heading', level: 1, styleId: 'Heading1', runs: [{ text: '1AC — Test', marks: {} }] } },
      { type: 'p', para: { kind: 'heading', level: 2, styleId: 'Heading2', runs: [{ text: 'ADV 1', marks: {} }] } },
      { type: 'p', para: { kind: 'heading', level: 4, styleId: 'Heading4', runs: [{ text: 'Warming is real', marks: {} }] } },
      { type: 'p', para: { kind: 'para', styleId: 'Normal', runs: [
        { text: 'Smith 24', marks: { charStyle: 'Style13ptBold' } },
        { text: ' — Professor of things', marks: {} },
      ] } },
      { type: 'p', para: { kind: 'para', styleId: 'Normal', runs: [
        { text: 'The evidence ', marks: {} },
        { text: 'says important things', marks: { charStyle: 'StyleUnderline' } },
        { text: 'important', marks: { charStyle: 'StyleUnderline', highlight: 'yellow' } },
      ] } },
    );
    const out = exportDocx(model, parts);
    const back = importDocx(out);
    expect(normalize(back.model)).toEqual(normalize(model));
    const styles = partText(readDocx(out), 'word/styles.xml')!;
    expect(styles).toContain('Style13ptBold');
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('Pocket');
  });

  it('Analytic and Undertag styles round-trip, with definitions in styles.xml', () => {
    const parts = newDocumentParts();
    const model: DocModel = { blocks: [], rels: new Map() };
    model.blocks.push(
      { type: 'p', para: { kind: 'para', styleId: 'Analytic', runs: [{ text: 'Extinction outweighs on timeframe.', marks: {} }] } },
      { type: 'p', para: { kind: 'para', styleId: 'Undertag', runs: [{ text: 'even under their framework', marks: {} }] } },
    );
    const out = exportDocx(model, parts);
    const back = importDocx(out);
    expect(normalize(back.model)).toEqual(normalize(model));
    const p0 = back.model.blocks[0];
    expect(p0.type === 'p' && p0.para.styleId).toBe('Analytic');
    const styles = partText(readDocx(out), 'word/styles.xml')!;
    expect(styles).toContain('w:styleId="Analytic"');
    expect(styles).toContain('w:styleId="Undertag"');
  });

  it('alignment (w:jc) and left indent (w:ind) round-trip', () => {
    const parts = newDocumentParts();
    const model: DocModel = { blocks: [], rels: new Map() };
    model.blocks.push(
      { type: 'p', para: { kind: 'para', styleId: 'Normal', align: 'center', indent: 720, runs: [{ text: 'centered and indented', marks: {} }] } },
    );
    const out = exportDocx(model, parts);
    const back = importDocx(out);
    const p = back.model.blocks[0];
    expect(p.type === 'p' && p.para.align).toBe('center');
    expect(p.type === 'p' && p.para.indent).toBe(720);
  });

  it('background shading (w:shd) survives export and re-import', () => {
    const parts = newDocumentParts();
    const model: DocModel = { blocks: [], rels: new Map() };
    model.blocks.push(
      { type: 'p', para: { kind: 'para', styleId: 'Normal', runs: [
        { text: 'plain ', marks: {} },
        { text: 'shaded', marks: { shd: 'FFE9A8' } },
        { text: ' shaded and highlighted', marks: { shd: 'FFE9A8', highlight: 'cyan' } },
      ] } },
    );
    const out = exportDocx(model, parts);
    const back = importDocx(out);
    expect(normalize(back.model)).toEqual(normalize(model));
    const runs = back.model.blocks[0].type === 'p' ? back.model.blocks[0].para.runs : [];
    expect(runs.find((r) => r.text === 'shaded')?.marks.shd).toBe('FFE9A8');
    expect(runs.find((r) => r.text === ' shaded and highlighted')?.marks.highlight).toBe('cyan');
  });
});
