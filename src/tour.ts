/**
 * The interactive tour: coach-mark popups with back/next arrows that walk
 * around the editor on a practice file. Steps that teach a command actually
 * run it, so the user watches the tag form, the cite shrink, the highlight
 * land. Esc or Skip ends it; it can be reopened from Home or the palette.
 */
import type { EditorView } from 'prosemirror-view';
import { TextSelection, type Command } from 'prosemirror-state';

export interface TourApi {
  view(): EditorView | null;
  cmd: {
    tag: Command; cite: Command; underline: Command; emphasis: Command;
    shrink: Command;
  };
  highlight(): Command;
  highlightColor(): string;
  isMac: boolean;
}

interface Step {
  title: string;
  body: string;
  /** Returns the element or text range to spotlight; null = centered step. */
  target?: () => DOMRect | null;
  onEnter?: () => void;
}

const PAD = 6;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls: string, ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...kids);
  return n;
}

function rectOf(sel: string): DOMRect | null {
  const node = document.querySelector(sel);
  return node ? node.getBoundingClientRect() : null;
}

export function startTour(api: TourApi): void {
  document.getElementById('tour')?.remove();

  const mod = api.isMac ? 'Cmd' : 'Ctrl';

  function findText(marker: string): { from: number; to: number } | null {
    const view = api.view();
    if (!view) return null;
    let found: { from: number; to: number } | null = null;
    view.state.doc.descendants((node, pos) => {
      if (found || !node.isText || !node.text) return !found;
      const i = node.text.indexOf(marker);
      if (i >= 0) found = { from: pos + i, to: pos + i + marker.length };
      return !found;
    });
    return found;
  }

  function select(marker: string): boolean {
    const view = api.view();
    const r = findText(marker);
    if (!view || !r) return false;
    view.dispatch(view.state.tr
      .setSelection(TextSelection.create(view.state.doc, r.from, r.to))
      .scrollIntoView());
    return true;
  }

  function run(command: Command): void {
    const view = api.view();
    if (view) command(view.state, view.dispatch);
  }

  function textRect(marker: string): DOMRect | null {
    const view = api.view();
    const r = findText(marker);
    if (!view || !r) return rectOf('.docwrap');
    const a = view.coordsAtPos(r.from);
    const b = view.coordsAtPos(r.to);
    return new DOMRect(
      Math.min(a.left, b.left) - 2,
      Math.min(a.top, b.top) - 2,
      Math.max(60, Math.abs(b.right - a.left)) + 4,
      Math.abs(b.bottom - a.top) + 4,
    );
  }

  const steps: Step[] = [
    {
      title: 'This is Spread',
      body: `A card cutter that saves real Verbatim .docx files. This practice file is yours to wreck. Use the arrows to move through the tour, or Esc to skip it.`,
    },
    {
      title: 'Tags',
      body: `F7 turns a line into a tag, the claim your card proves. That line just became one. Pockets, hats, and blocks work the same way on F4, F5, F6, and they build the outline on the left.`,
      target: () => textRect('Renewables solve grid reliability'),
      onEnter: () => { if (select('Renewables solve grid reliability')) run(api.cmd.tag); },
    },
    {
      title: 'Cites',
      body: `Select the author and year, press F8. Big bold name, small everything else. That whole dance takes six clicks in Word.`,
      target: () => textRect('Okafor 25'),
      onEnter: () => { if (select('Okafor 25')) run(api.cmd.cite); },
    },
    {
      title: 'Underline what you would read',
      body: `F9. Underlined text stays full size. Everything else is context you skip in round.`,
      target: () => textRect('Batteries paired'),
      onEnter: () => { if (select('Batteries paired with wind and solar now clear reliability auctions in three regional markets')) run(api.cmd.underline); },
    },
    {
      title: 'Highlight what you will say',
      body: `F11, in your color (currently ${api.highlightColor()} — change it in Settings). In a fast round you read the highlights and nothing else.`,
      target: () => textRect('clear reliability auctions'),
      onEnter: () => { if (select('clear reliability auctions')) run(api.highlight()); },
    },
    {
      title: 'Shrink the rest',
      body: `${mod}-8 drops un-underlined text to 8 point. Same look as every Verbatim file you have ever been sent.`,
      target: () => textRect('Storage costs'),
      onEnter: () => { if (select('Storage costs fell forty percent in two years and utilities noticed.')) run(api.cmd.shrink); },
    },
    {
      title: 'Read times',
      body: `Doc counts only the words you would say out loud: tags, cites, analytics, highlights. Reader 1 and Reader 2 turn that into minutes at your speed and your partner's. Speeds live in Settings.`,
      target: () => rectOf('.status'),
    },
    {
      title: 'The speech doc',
      body: `Mark any tab as the speech doc, put your cursor on a card, press Send. It stacks up here with a running read time for the speech.`,
      target: () => rectOf('.speech') ?? rectOf('.status'),
    },
    {
      title: 'Every command, two ways',
      body: `The toolbar up top has a button for everything, keys labeled. ${mod}-K opens the command palette — type what you want instead of hunting for it.`,
      target: () => rectOf('.ribbon') ?? rectOf('.topbar-right'),
    },
    {
      title: 'That is the whole job',
      body: `Cut on this file as long as you want. When you are ready, make a new document from Home. ${mod}-S saves a real .docx your teammates open in Word.`,
    },
  ];

  let i = 0;

  const ring = el('div', 'tour-ring');
  const title = el('h3', 'tour-title');
  const body = el('p', 'tour-body');
  const count = el('span', 'tour-count');
  const back = el('button', 'tour-arrow');
  back.textContent = '‹';
  back.setAttribute('aria-label', 'Back');
  const next = el('button', 'tour-arrow next');
  next.setAttribute('aria-label', 'Next');
  const skip = el('button', 'tour-skip', 'Skip tour');
  const pop = el('div', 'tour-pop', title, body,
    el('div', 'tour-foot', skip, el('span', 'tour-nav', back, count, next)));
  const overlay = el('div', 'tour', ring, pop);
  overlay.id = 'tour';
  document.body.append(overlay);

  function place(): void {
    const step = steps[i];
    const rect = step.target?.() ?? null;
    if (rect) {
      ring.style.display = 'block';
      ring.style.left = `${rect.left - PAD}px`;
      ring.style.top = `${rect.top - PAD}px`;
      ring.style.width = `${rect.width + PAD * 2}px`;
      ring.style.height = `${rect.height + PAD * 2}px`;
      // popover below the ring unless there is no room
      const popH = pop.offsetHeight || 160;
      const below = rect.bottom + PAD * 2 + popH < innerHeight - 12;
      pop.style.top = `${below ? rect.bottom + PAD * 2 : Math.max(12, rect.top - PAD * 2 - popH)}px`;
      pop.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - pop.offsetWidth - 12))}px`;
      pop.style.transform = 'none';
    } else {
      ring.style.display = 'none';
      pop.style.top = '50%';
      pop.style.left = '50%';
      pop.style.transform = 'translate(-50%,-50%)';
    }
  }

  function render(): void {
    const step = steps[i];
    title.textContent = step.title;
    body.textContent = step.body;
    count.textContent = `${i + 1} / ${steps.length}`;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Done' : '›';
    step.onEnter?.();
    // position after the edit has painted
    requestAnimationFrame(() => requestAnimationFrame(place));
  }

  function end(): void {
    overlay.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    api.view()?.focus();
  }

  function go(delta: number): void {
    const n = i + delta;
    if (n < 0) return;
    if (n >= steps.length) { end(); return; }
    i = n;
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  back.onclick = () => go(-1);
  next.onclick = () => go(1);
  skip.onclick = end;
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);

  render();
}
