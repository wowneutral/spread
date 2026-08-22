/**
 * ProseMirror schema mirroring the file model 1:1 so conversion is lossless.
 * Character styles (Cite / Underline / Emphasis / unknown) are mutually
 * exclusive marks — a run carries at most one w:rStyle, and the schema
 * enforces that invariant for us via the shared "cstyle" exclusion group.
 */
import { Schema } from 'prosemirror-model';

/** Shared layout attrs → inline style (indent in twips; 20 twips = 1pt).
 * sb/sa/ln are the paragraph's own spacing (display-only, from the file). */
function layoutStyle(attrs: { indent: number; align: string | null; sb: number | null; sa: number | null; ln: number | null }): string {
  let s = '';
  if (attrs.indent > 0) s += `margin-left:${attrs.indent / 20}pt;`;
  if (attrs.align) s += `text-align:${attrs.align === 'both' ? 'justify' : attrs.align};`;
  if (attrs.sb !== null) s += `margin-top:${attrs.sb}pt;`;
  if (attrs.sa !== null) s += `margin-bottom:${attrs.sa}pt;`;
  if (attrs.ln !== null) s += `line-height:${attrs.ln.toFixed(3)};`;
  return s;
}

const LAYOUT_ATTRS = {
  indent: { default: 0 },
  align: { default: null as string | null },
  sb: { default: null as number | null },
  sa: { default: null as number | null },
  ln: { default: null as number | null },
  pprIdx: { default: -1 },   // index into the session's rawPPr registry
};

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    // paragraph is declared first so it is the default block type —
    // pressing Enter after a heading must produce a plain paragraph.
    // kind: 'p' (Normal), 'analytic', or 'undertag'.
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { kind: { default: 'p' }, ...LAYOUT_ATTRS },
      toDOM(node) {
        const cls = node.attrs.kind === 'analytic' ? 'cs-analytic'
          : node.attrs.kind === 'undertag' ? 'cs-undertag' : 'cs-p';
        const style = layoutStyle(node.attrs as any);
        return ['p', { class: cls, ...(style ? { style } : {}) }, 0];
      },
      parseDOM: [{
        tag: 'p',
        getAttrs: (dom: HTMLElement) => ({
          kind: dom.classList.contains('cs-analytic') ? 'analytic'
            : dom.classList.contains('cs-undertag') ? 'undertag' : 'p',
        }),
      }],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 4 }, ...LAYOUT_ATTRS },
      toDOM(node) {
        const style = layoutStyle(node.attrs as any);
        return [`h${node.attrs.level}`, { class: `cs-h cs-h${node.attrs.level}`, ...(style ? { style } : {}) }, 0];
      },
      parseDOM: [1, 2, 3, 4].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    },
    /** Pass-through content we preserve but don't edit (tables etc.). */
    rawblock: {
      group: 'block',
      atom: true,
      attrs: { idx: {}, label: { default: 'Preserved content' } },
      toDOM(node) {
        return ['div', { class: 'cs-raw', 'data-idx': String(node.attrs.idx) },
          `⊞ ${node.attrs.label} — kept exactly as-is in the file`];
      },
      parseDOM: [{ tag: 'div.cs-raw', getAttrs: (dom: HTMLElement) => ({ idx: Number(dom.dataset.idx ?? 0) }) }],
    },
    text: { group: 'inline' },
  },
  marks: {
    // --- character styles (one per run) ---
    cite: {
      group: 'cstyle', excludes: 'cstyle',
      toDOM() { return ['span', { class: 'm-cite' }, 0]; },
      parseDOM: [{ tag: 'span.m-cite' }],
    },
    ustyle: {
      group: 'cstyle', excludes: 'cstyle',
      toDOM() { return ['span', { class: 'm-ustyle' }, 0]; },
      parseDOM: [{ tag: 'span.m-ustyle' }],
    },
    emph: {
      group: 'cstyle', excludes: 'cstyle',
      toDOM() { return ['span', { class: 'm-emph' }, 0]; },
      parseDOM: [{ tag: 'span.m-emph' }],
    },
    cstyleOther: {
      group: 'cstyle', excludes: 'cstyle',
      attrs: { id: {} },
      toDOM(mark) { return ['span', { class: 'm-cstyle', 'data-style': mark.attrs.id }, 0]; },
      parseDOM: [{ tag: 'span.m-cstyle', getAttrs: (dom: HTMLElement) => ({ id: dom.dataset.style }) }],
    },
    // --- direct formatting ---
    bold: {
      toDOM() { return ['strong', 0]; },
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    },
    boldOff: {
      excludes: 'bold',
      toDOM() { return ['span', { class: 'm-boldoff' }, 0]; },
      parseDOM: [{ tag: 'span.m-boldoff' }],
    },
    italic: {
      toDOM() { return ['em', 0]; },
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    },
    udirect: {
      toDOM() { return ['span', { class: 'm-u' }, 0]; },
      parseDOM: [{ tag: 'span.m-u' }],
    },
    strike: {
      toDOM() { return ['s', 0]; },
      parseDOM: [{ tag: 's' }],
    },
    highlight: {
      attrs: { color: { default: 'yellow' } },
      toDOM(mark) { return ['span', { class: `m-hl hl-${mark.attrs.color}` }, 0]; },
      parseDOM: [{
        tag: 'span.m-hl',
        getAttrs: (dom: HTMLElement) => {
          const m = Array.from(dom.classList).find((c) => c.startsWith('hl-'));
          return { color: m ? m.slice(3) : 'yellow' };
        },
      }],
    },
    shd: {
      attrs: { hex: {} },  // w:shd fill as RRGGBB
      toDOM(mark) {
        return ['span', { class: 'm-shd', style: `background-color:#${mark.attrs.hex}` }, 0];
      },
      parseDOM: [],
    },
    size: {
      attrs: { hp: {} },  // half-points
      toDOM(mark) { return ['span', { class: 'm-size', style: `font-size:${Number(mark.attrs.hp) / 2}pt` }, 0]; },
      parseDOM: [],
    },
    fcolor: {
      attrs: { hex: {} },
      toDOM(mark) {
        const hex = String(mark.attrs.hex);
        // 'auto' and black inherit the theme ink so dark mode stays readable.
        const style = hex === 'auto' || hex === '000000' ? '' : `color:#${hex}`;
        return ['span', { class: 'm-color', style }, 0];
      },
      parseDOM: [],
    },
    vert: {
      attrs: { v: {} },
      toDOM(mark) { return [mark.attrs.v === 'superscript' ? 'sup' : 'sub', 0]; },
      parseDOM: [{ tag: 'sup', attrs: { v: 'superscript' } }, { tag: 'sub', attrs: { v: 'subscript' } }],
    },
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM(mark) { return ['a', { href: mark.attrs.href, class: 'm-link', rel: 'noopener' }, 0]; },
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom: HTMLElement) => ({ href: dom.getAttribute('href') }) }],
    },
    /** Opaque pass-through: unmodeled w:rPr props survive editing via the registry. */
    rawrpr: {
      attrs: { idx: {} },
      inclusive: true,
      toDOM() { return ['span', { class: 'm-rawrpr' }, 0]; },
      parseDOM: [],
    },
  },
});

export type CSSchema = typeof schema;
