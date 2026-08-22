/**
 * Editor conversion fidelity: file model -> ProseMirror -> file model must be
 * identity for every fixture, so nothing is lost between disk and editor.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importDocx } from '../src/docx/import';
import { exportDocx } from '../src/docx/export';
import { modelToPM, pmToModel } from '../src/editor/convert';
import { readableWords } from '../src/lib/readtime';
import type { DocModel } from '../src/model/types';

const FIXTURES = join(__dirname, 'fixtures');
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.docx'));

function normalize(model: DocModel) {
  return model.blocks.map((b) => {
    if (b.type === 'raw') return { raw: true };
    const p = b.para;
    return {
      kind: p.kind,
      level: p.level ?? null,
      runs: p.runs.filter((r) => r.text !== '').map((r) => {
        // rawRPr props are pass-through-only and intentionally dropped when a
        // run goes through the editor; marks and text must survive exactly.
        const { link, ...marks } = r.marks;
        return { text: r.text, marks: { ...marks, ...(link ? { link } : {}) } };
      }),
    };
  });
}

describe('model <-> ProseMirror round-trip', () => {
  for (const file of files) {
    it(`${file}: identity through the editor`, () => {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES, file)));
      const { model } = importDocx(bytes);
      const { doc, session } = modelToPM(model);
      const back = pmToModel(doc, session);
      expect(normalize(back)).toEqual(normalize(model));
    });
  }

  it('editor output still exports to a valid, re-importable docx', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '01-minimal.docx')));
    const first = importDocx(bytes);
    const { doc, session } = modelToPM(first.model);
    const model2 = pmToModel(doc, session);
    const out = exportDocx(model2, first.parts);
    const second = importDocx(out);
    expect(normalize(second.model)).toEqual(normalize(model2));
  });

  it('computes readable words on a fixture', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '01-minimal.docx')));
    const { model } = importDocx(bytes);
    const { doc } = modelToPM(model);
    expect(readableWords(doc)).toBeGreaterThan(0);
  });
});
