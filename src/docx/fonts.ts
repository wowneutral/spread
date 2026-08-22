/**
 * Document-wide font switching. Rewrites word/styles.xml so every style —
 * docDefaults included — carries an explicit font, replacing both explicit
 * faces and theme references. This is a real change to the file: Word,
 * Verbatim, and CardMirror will all show the new font.
 */

export function setDocFontInStyles(stylesXml: string, font: string): string {
  let out = stylesXml
    .replace(/w:ascii="[^"]*"/g, `w:ascii="${font}"`)
    .replace(/w:hAnsi="[^"]*"/g, `w:hAnsi="${font}"`)
    .replace(/w:cs="[^"]*"/g, `w:cs="${font}"`);
  // Theme-based references (asciiTheme/hAnsiTheme) would still win over the
  // theme part — rewrite those rFonts nodes to explicit faces.
  out = out.replace(/<w:rFonts([^>]*?)\/>/g, (m, attrs: string) => {
    if (/Theme=/.test(attrs)) return `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
    return m;
  });
  // No rFonts in docDefaults at all: inject one so the base font is explicit.
  if (!/<w:rPrDefault>\s*<w:rPr>[\s\S]{0,200}?<w:rFonts/.test(out)) {
    out = out.replace(/(<w:rPrDefault>\s*<w:rPr>)/, `$1<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`);
  }
  return out;
}
