/**
 * Spread Flow — keyboard-first flowing, built into the editor.
 *
 * A flow is a matrix: speech columns for the event, argument rows. Enter adds
 * an argument below, Alt-Enter above, Shift-Enter jumps to the response cell
 * in the next column, arrows move between cells. Everything lives in
 * localStorage on this machine; flows export and import as JSON files you own.
 */

export type FlowEvent = 'LD' | 'Policy' | 'PF';

export const FLOW_COLUMNS: Record<FlowEvent, string[]> = {
  LD: ['AC', 'NC', '1AR', '2NR', '2AR'],
  Policy: ['1AC', '1NC', '2AC', 'Neg block', '1AR', '2NR', '2AR'],
  PF: ['Case', 'Rebuttal', 'Summary', 'Final focus'],
};

export interface FlowCell {
  text: string;
  bold?: boolean;
  struck?: boolean;
}

export interface Flow {
  id: string;
  name: string;
  event: FlowEvent;
  cols: string[];
  /** Dense matrix: grid[row][col] always exists. */
  grid: FlowCell[][];
}

export interface FlowStore {
  flows: Flow[];
  activeId: string | null;
}

const KEY = 'spread-flows';

function blankRow(cols: number): FlowCell[] {
  return Array.from({ length: cols }, () => ({ text: '' }));
}

export function newFlow(name: string, event: FlowEvent): Flow {
  const cols = FLOW_COLUMNS[event];
  return {
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name, event, cols: [...cols],
    grid: [blankRow(cols.length)],
  };
}

export function insertRow(flow: Flow, at: number): void {
  flow.grid.splice(Math.max(0, Math.min(at, flow.grid.length)), 0, blankRow(flow.cols.length));
}

export function deleteRow(flow: Flow, at: number): void {
  if (flow.grid.length <= 1) { flow.grid = [blankRow(flow.cols.length)]; return; }
  flow.grid.splice(at, 1);
}

export function rowIsEmpty(flow: Flow, row: number): boolean {
  return flow.grid[row]?.every((c) => c.text.trim() === '') ?? true;
}

export function loadFlows(): FlowStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FlowStore;
      if (Array.isArray(parsed.flows)) return parsed;
    }
  } catch { /* fresh start */ }
  return { flows: [], activeId: null };
}

export function saveFlows(store: FlowStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

export function exportFlowJSON(flow: Flow): string {
  return JSON.stringify({ app: 'spread-flow', version: 1, flow }, null, 2);
}

export function importFlowJSON(text: string): Flow | null {
  try {
    const parsed = JSON.parse(text);
    const f = parsed.flow ?? parsed;
    if (!f || !Array.isArray(f.grid) || !Array.isArray(f.cols)) return null;
    const cols: string[] = f.cols.map(String);
    const grid: FlowCell[][] = f.grid.map((row: any[]) =>
      Array.from({ length: cols.length }, (_, i) => ({
        text: String(row?.[i]?.text ?? ''),
        ...(row?.[i]?.bold ? { bold: true } : {}),
        ...(row?.[i]?.struck ? { struck: true } : {}),
      })));
    if (grid.length === 0) grid.push(blankRow(cols.length));
    return {
      id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: String(f.name ?? 'Imported flow'),
      event: (['LD', 'Policy', 'PF'].includes(f.event) ? f.event : 'LD') as FlowEvent,
      cols, grid,
    };
  } catch { return null; }
}

/** Append text into the first empty cell of a column (send-tag-to-flow). */
export function appendToColumn(flow: Flow, col: number, text: string): number {
  for (let r = 0; r < flow.grid.length; r++) {
    if (flow.grid[r][col].text.trim() === '') {
      flow.grid[r][col].text = text;
      return r;
    }
  }
  insertRow(flow, flow.grid.length);
  const r = flow.grid.length - 1;
  flow.grid[r][col].text = text;
  return r;
}
