/**
 * Per-document stylesheet: parse word/styles.xml and render the document the
 * way Word (and CardMirror) would — with the FILE's own fonts, sizes,
 * alignment, underlines, and borders, not hardcoded guesses. The result is a
 * CSS string scoped to the editor mount, regenerated per opened document.
 */
import { parseXml, nodeName, children, child, attrs } from './xml';

export interface StyleRender {
  szHp?: number;                       // w:sz in half-points
  bold?: boolean;
  italic?: boolean;
  underline?: 'single' | 'double' | 'none';
  font?: string;
  color?: string;                      // RRGGBB, 'auto' ignored
  center?: boolean;
  justify?: boolean;
  boxed?: boolean;                     // pBdr on all sides (Pocket look)
  beforePt?: number;
  afterPt?: number;
  line?: number;                       // line-height multiplier
  basedOn?: string;
  type?: string;
}

export interface DocStylesheet {
  defaults: { font: string; szHp: number; afterPt: number; line: number };
  byId: Map<string, StyleRender>;
}

/** Theme fonts from word/theme/theme1.xml — the file's own minor/major faces. */
export interface ThemeFonts { minor: string; major: string }

export function parseThemeFonts(themeXml: string | null): ThemeFonts {
  const fonts: ThemeFonts = { minor: 'Calibri', major: 'Calibri Light' };
  if (!themeXml) return fonts;
  // The theme part is large; a targeted scan beats a full parse.
  const grab = (tag: string): string | undefined => {
    const at = themeXml.indexOf(`<a:${tag}>`);
    if (at < 0) return undefined;
    const m = /<a:latin[^>]*typeface="([^"]*)"/.exec(themeXml.slice(at, at + 600));
    return m?.[1] || undefined;
  };
  fonts.minor = grab('minorFont') ?? fonts.minor;
  fonts.major = grab('majorFont') ?? fonts.major;
  return fonts;
}

let activeTheme: ThemeFonts = { minor: 'Calibri', major: 'Calibri Light' };

function themeFont(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('minor')) return activeTheme.minor;
  if (name.startsWith('major')) return activeTheme.major;
  return undefined;
}

function parseRPr(rPr: any, out: StyleRender): void {
  for (const c of children(rPr)) {
    const n = nodeName(c);
    const a = attrs(c);
    switch (n) {
      case 'w:sz': out.szHp = Number(a['w:val']); break;
      case 'w:b': out.bold = !(a['w:val'] === '0' || a['w:val'] === 'false'); break;
      case 'w:i': out.italic = !(a['w:val'] === '0' || a['w:val'] === 'false'); break;
      case 'w:u': {
        const v = a['w:val'];
        out.underline = v === 'double' ? 'double' : v === 'none' ? 'none' : v ? 'single' : undefined;
        break;
      }
      case 'w:color':
        if (a['w:val'] && a['w:val'] !== 'auto') out.color = a['w:val'];
        break;
      case 'w:rFonts':
        out.font = a['w:ascii'] ?? themeFont(a['w:asciiTheme']) ?? out.font;
        break;
    }
  }
}

function parsePPr(pPr: any, out: StyleRender): void {
  for (const c of children(pPr)) {
    const n = nodeName(c);
    const a = attrs(c);
    switch (n) {
      case 'w:jc':
        out.center = a['w:val'] === 'center';
        out.justify = a['w:val'] === 'both';
        break;
      case 'w:pBdr': out.boxed = children(c).length > 0; break;
      case 'w:spacing': {
        if (a['w:before'] !== undefined) out.beforePt = Number(a['w:before']) / 20;
        if (a['w:after'] !== undefined) out.afterPt = Number(a['w:after']) / 20;
        if (a['w:line'] !== undefined && (a['w:lineRule'] === 'auto' || a['w:lineRule'] === undefined)) {
          out.line = Number(a['w:line']) / 240;
        }
        break;
      }
    }
  }
}

export function parseStylesheet(stylesXml: string | null, themeXml: string | null = null): DocStylesheet {
  activeTheme = parseThemeFonts(themeXml);
  const sheet: DocStylesheet = {
    defaults: { font: activeTheme.minor, szHp: 22, afterPt: 8, line: 1.08 },
    byId: new Map(),
  };
  if (!stylesXml) return sheet;
  let tree: any[];
  try { tree = parseXml(stylesXml); } catch { return sheet; }
  const root = tree.find((n) => nodeName(n) === 'w:styles');
  if (!root) return sheet;

  for (const node of children(root)) {
    const n = nodeName(node);
    if (n === 'w:docDefaults') {
      const rd = child(node, 'w:rPrDefault');
      const rPr = rd ? child(rd, 'w:rPr') : null;
      if (rPr) {
        const d: StyleRender = {};
        parseRPr(rPr, d);
        if (d.font) sheet.defaults.font = d.font;
        if (d.szHp) sheet.defaults.szHp = d.szHp;
      }
      const pd = child(node, 'w:pPrDefault');
      const pPr = pd ? child(pd, 'w:pPr') : null;
      if (pPr) {
        const d: StyleRender = {};
        parsePPr(pPr, d);
        if (d.afterPt !== undefined) sheet.defaults.afterPt = d.afterPt;
        if (d.line !== undefined) sheet.defaults.line = d.line;
      }
    } else if (n === 'w:style') {
      const a = attrs(node);
      const id = a['w:styleId'];
      if (!id) continue;
      const s: StyleRender = { type: a['w:type'] };
      const based = child(node, 'w:basedOn');
      if (based) s.basedOn = attrs(based)['w:val'];
      const pPr = child(node, 'w:pPr');
      if (pPr) parsePPr(pPr, s);
      const rPr = child(node, 'w:rPr');
      if (rPr) parseRPr(rPr, s);
      sheet.byId.set(id, s);
    }
  }
  return sheet;
}

/** Effective render props for a styleId, walking the basedOn chain. */
export function effective(sheet: DocStylesheet, id: string): StyleRender {
  const chain: StyleRender[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = sheet.byId.get(cur);
    if (!s) break;
    chain.unshift(s);
    cur = s.basedOn;
  }
  const out: StyleRender = {};
  for (const s of chain) {
    for (const [k, v] of Object.entries(s)) {
      if (v !== undefined && k !== 'basedOn' && k !== 'type') (out as any)[k] = v;
    }
  }
  return out;
}

function fontStack(name: string): string {
  return `"${name}","Helvetica Neue",Arial,system-ui,sans-serif`;
}

function blockRule(sel: string, s: StyleRender, defaults: DocStylesheet['defaults']): string {
  const d: string[] = [];
  if (s.szHp) d.push(`font-size:${s.szHp / 2}pt`);
  d.push(`font-weight:${s.bold ? 700 : 400}`);
  if (s.italic) d.push('font-style:italic');
  if (s.font) d.push(`font-family:${fontStack(s.font)}`);
  if (s.color) d.push(`color:#${s.color}`);
  if (s.center) d.push('text-align:center');
  else if (s.justify) d.push('text-align:justify');
  else d.push('text-align:left');
  if (s.underline && s.underline !== 'none') {
    d.push(`text-decoration:underline`, `text-decoration-style:${s.underline === 'double' ? 'double' : 'solid'}`, 'text-underline-offset:2px');
  } else {
    d.push('text-decoration:none');
  }
  if (s.boxed) d.push('border:1pt solid var(--doc-ink)', 'padding:4pt 8pt');
  else d.push('border:none', 'padding:0');
  const before = s.beforePt ?? 0;
  const after = s.afterPt ?? defaults.afterPt;
  d.push(`margin:${before}pt 0 ${after}pt`);
  if (s.line ?? defaults.line) d.push(`line-height:${(s.line ?? defaults.line).toFixed(3)}`);
  return `${sel}{${d.join(';')}}`;
}

function charRule(sel: string, s: StyleRender): string {
  const d: string[] = [];
  if (s.szHp) d.push(`font-size:${s.szHp / 2}pt`);
  if (s.bold !== undefined) d.push(`font-weight:${s.bold ? 700 : 400}`);
  if (s.italic !== undefined) d.push(`font-style:${s.italic ? 'italic' : 'normal'}`);
  if (s.font) d.push(`font-family:${fontStack(s.font)}`);
  if (s.color) d.push(`color:#${s.color}`);
  if (s.underline === 'none') d.push('text-decoration:none');
  else if (s.underline) d.push('text-decoration:underline', 'text-underline-offset:2px');
  return d.length ? `${sel}{${d.join(';')}}` : '';
}

/**
 * Generate the document CSS for one file, scoped under `scope` (an id
 * selector, so these rules beat the static fallback styles). The Clean view
 * deliberately keeps its own look, so every rule is guarded out of `.clean`.
 */
export function stylesheetCSS(sheet: DocStylesheet, scope: string): string {
  const g = (sel: string) => `.docwrap:not(.clean) ${scope} ${sel}`;
  const rules: string[] = [];
  const dv = sheet.defaults;
  rules.push(`.docwrap:not(.clean) ${scope} .ProseMirror{font-family:${fontStack(dv.font)};font-size:${dv.szHp / 2}pt;line-height:${dv.line.toFixed(3)}}`);

  const heads = ['Heading1', 'Heading2', 'Heading3', 'Heading4'];
  heads.forEach((id, i) => {
    if (!sheet.byId.has(id)) return;
    const s = effective(sheet, id);
    if (s.bold === undefined) s.bold = true;
    rules.push(blockRule(g(`.cs-h${i + 1}`), s, dv));
  });

  if (sheet.byId.has('Normal')) {
    const s = effective(sheet, 'Normal');
    rules.push(blockRule(g('.cs-p'), s, dv));
  }
  if (sheet.byId.has('Analytic')) {
    rules.push(blockRule(g('.cs-analytic'), effective(sheet, 'Analytic'), dv));
  }
  if (sheet.byId.has('Undertag')) {
    rules.push(blockRule(g('.cs-undertag'), effective(sheet, 'Undertag'), dv));
  }
  if (sheet.byId.has('Style13ptBold')) {
    rules.push(charRule(g('.m-cite'), effective(sheet, 'Style13ptBold')));
  }
  if (sheet.byId.has('StyleUnderline')) {
    const s = effective(sheet, 'StyleUnderline');
    if (!s.underline) s.underline = 'single';
    rules.push(charRule(g('.m-ustyle'), s));
  }
  if (sheet.byId.has('Emphasis')) {
    const s = effective(sheet, 'Emphasis');
    if (!s.underline) s.underline = 'single';
    if (s.bold === undefined) s.bold = true;
    rules.push(charRule(g('.m-emph'), s));
  }
  return rules.filter(Boolean).join('\n');
}
