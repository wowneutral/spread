/**
 * Editor command behavior: the condense family, case cycling, and the
 * analytic/undertag toggles — the muscle-memory verbs must act exactly.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../src/editor/schema';
import { condenseCmd, uncondense, toggleCase, setParaKind } from '../src/editor/commands';

function mkState(bodies: string[]): EditorState {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 4 }, schema.text('Tag line')),
    ...bodies.map((t) => schema.nodes.paragraph.create(null, schema.text(t))),
  ]);
  return EditorState.create({ doc });
}

function cursorInFirstBody(state: EditorState): EditorState {
  const pos = state.doc.child(0).nodeSize + 2;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function paraTexts(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((n) => { if (n.type === schema.nodes.paragraph) out.push(n.textContent); });
  return out;
}

describe('condense family', () => {
  it('merge mode flattens the card body with spaces', () => {
    let state = cursorInFirstBody(mkState(['One.', 'Two.', 'Three.']));
    condenseCmd('merge')(state, (tr) => { state = state.apply(tr); });
    expect(paraTexts(state)).toEqual(['One. Two. Three.']);
  });

  it('pilcrow mode marks seams and uncondense restores them', () => {
    let state = cursorInFirstBody(mkState(['One.', 'Two.', 'Three.']));
    condenseCmd('pilcrows')(state, (tr) => { state = state.apply(tr); });
    expect(paraTexts(state)).toEqual(['One. ¶ Two. ¶ Three.']);
    // pilcrows carry the 6pt size mark
    let pilcrowSized = 0;
    state.doc.descendants((n) => {
      if (n.isText && n.text?.includes('¶') && schema.marks.size.isInSet(n.marks)) pilcrowSized++;
      return true;
    });
    expect(pilcrowSized).toBe(2);
    state = cursorInFirstBody(state);
    uncondense(state, (tr) => { state = state.apply(tr); });
    expect(paraTexts(state)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('whitespace mode collapses runs of spaces without merging', () => {
    let state = cursorInFirstBody(mkState(['One.   Two.', 'Three.']));
    condenseCmd('whitespace')(state, (tr) => { state = state.apply(tr); });
    expect(paraTexts(state)).toEqual(['One. Two.', 'Three.']);
  });
});

describe('toggleCase', () => {
  it('cycles mixed -> lower -> UPPER -> Title', () => {
    let state = mkState(['First body.']);
    const start = state.doc.child(0).nodeSize + 1;
    const reselect = () => {
      state = state.apply(state.tr.setSelection(
        TextSelection.create(state.doc, start, start + state.doc.child(1).textContent.length)));
    };
    reselect();
    const run = () => { toggleCase(state, (tr) => { state = state.apply(tr); }); reselect(); };
    run(); expect(state.doc.child(1).textContent).toBe('first body.');
    run(); expect(state.doc.child(1).textContent).toBe('FIRST BODY.');
    run(); expect(state.doc.child(1).textContent).toBe('First Body.');
  });
});

describe('setParaKind', () => {
  it('toggles analytic on and off', () => {
    let state = cursorInFirstBody(mkState(['Standalone analysis.']));
    setParaKind('analytic')(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.child(1).attrs.kind).toBe('analytic');
    state = cursorInFirstBody(state);
    setParaKind('analytic')(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.child(1).attrs.kind).toBe('p');
  });
});
