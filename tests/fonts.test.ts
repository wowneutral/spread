/** Document-font switching: explicit faces, theme references, and injection. */
import { it, expect } from 'vitest';
import { setDocFontInStyles } from '../src/docx/fonts';

it('replaces explicit ascii/hAnsi/cs faces', () => {
  const xml = `<w:styles><w:style><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/></w:rPr></w:style></w:styles>`;
  const out = setDocFontInStyles(xml, 'Times New Roman');
  expect(out).toContain('w:ascii="Times New Roman"');
  expect(out).not.toContain('Calibri');
});

it('rewrites theme-based rFonts to explicit faces', () => {
  const xml = `<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  const out = setDocFontInStyles(xml, 'Arial');
  expect(out).toContain('w:ascii="Arial"');
  expect(out).not.toContain('Theme=');
});

it('injects rFonts into docDefaults when absent', () => {
  const xml = `<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  const out = setDocFontInStyles(xml, 'Georgia');
  expect(out).toContain('<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia"');
});
