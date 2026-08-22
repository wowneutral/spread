/** Flow model: rows, columns, append, and JSON round-trip. */
import { describe, it, expect } from 'vitest';
import {
  FLOW_COLUMNS, newFlow, insertRow, deleteRow, rowIsEmpty,
  exportFlowJSON, importFlowJSON, appendToColumn,
} from '../src/flow';

describe('flow model', () => {
  it('creates an event-shaped grid', () => {
    const f = newFlow('R1 v Xu', 'LD');
    expect(f.cols).toEqual(FLOW_COLUMNS.LD);
    expect(f.grid.length).toBe(1);
    expect(f.grid[0].length).toBe(5);
    expect(rowIsEmpty(f, 0)).toBe(true);
  });

  it('inserts and deletes rows, never dropping below one', () => {
    const f = newFlow('x', 'PF');
    insertRow(f, 1);
    insertRow(f, 0);
    expect(f.grid.length).toBe(3);
    f.grid[1][0].text = 'case arg';
    deleteRow(f, 0);
    expect(f.grid[0][0].text).toBe('case arg');
    deleteRow(f, 0);
    deleteRow(f, 0);
    expect(f.grid.length).toBe(1); // floor
  });

  it('appendToColumn fills the first empty cell, growing when full', () => {
    const f = newFlow('x', 'LD');
    expect(appendToColumn(f, 0, 'AC 1')).toBe(0);
    expect(appendToColumn(f, 0, 'AC 2')).toBe(1);
    expect(f.grid[1][0].text).toBe('AC 2');
    // column 1 untouched
    expect(f.grid[0][1].text).toBe('');
  });

  it('round-trips through JSON with formatting flags', () => {
    const f = newFlow('vs Kim', 'Policy');
    f.grid[0][0] = { text: 'DA shell', bold: true };
    appendToColumn(f, 1, 'no link');
    f.grid[0][1].struck = true;
    const back = importFlowJSON(exportFlowJSON(f));
    expect(back).not.toBeNull();
    expect(back!.name).toBe('vs Kim');
    expect(back!.event).toBe('Policy');
    expect(back!.grid[0][0]).toMatchObject({ text: 'DA shell', bold: true });
    expect(back!.grid[0][1]).toMatchObject({ text: 'no link', struck: true });
  });

  it('rejects files that are not flows', () => {
    expect(importFlowJSON('{"nope":1}')).toBeNull();
    expect(importFlowJSON('not json')).toBeNull();
  });
});
