/**
 * The document model: a flat sequence of paragraphs, exactly as Verbatim files
 * are structured. Cards (tag + cite + body) are DERIVED groupings in the editor
 * layer — the file model stays flat so round-trip is simple and lossless.
 *
 * Fidelity strategy: every paragraph and run carries opaque pass-through
 * fragments (`rawPPr`, `rawRPr`) — the original OOXML property nodes we do not
 * model. On export they are re-emitted with our modeled properties merged on
 * top, so formatting we never understood still survives the round trip.
 */

/** OOXML node in fast-xml-parser preserveOrder form (opaque to us). */
export type XmlNode = Record<string, unknown>;

export type HeadingLevel = 1 | 2 | 3 | 4;

/** w:highlight accepted values (Word's 17-color highlight palette). */
export type HighlightColor =
  | 'yellow' | 'green' | 'cyan' | 'magenta' | 'blue' | 'red'
  | 'darkBlue' | 'darkCyan' | 'darkGreen' | 'darkMagenta' | 'darkRed'
  | 'darkYellow' | 'darkGray' | 'lightGray' | 'black' | 'white' | 'none';

export interface RunMarks {
  /** Character style by Verbatim styleId: StyleUnderline, Style13ptBold (cite), Emphasis, Hyperlink, or any unknown id kept verbatim. */
  charStyle?: string;
  bold?: boolean;          // explicit w:b (val !== 0)
  boldOff?: boolean;       // explicit w:b w:val="0" (un-bold inside bold contexts)
  italic?: boolean;
  underline?: boolean;     // direct w:u (single); style-underline lives in charStyle
  strike?: boolean;
  highlight?: HighlightColor;
  /** Background shading fill (w:shd) as RRGGBB hex — independent of highlight. */
  shd?: string;
  /** Font size in half-points (w:sz). 16 = the 8pt "minimized" convention. */
  size?: number;
  /** Font color as RRGGBB hex (w:color), 'auto' preserved as-is. */
  color?: string;
  vertAlign?: 'superscript' | 'subscript';
  /** Resolved hyperlink target (from w:hyperlink + rels). */
  link?: string;
}

export interface Run {
  text: string;
  marks: RunMarks;
  /** Original <w:rPr> children we didn't model, re-emitted on export. */
  rawRPr?: XmlNode[];
}

export type ParaKind = 'heading' | 'para';

export interface Paragraph {
  kind: ParaKind;
  /** For headings: 1=Pocket 2=Hat 3=Block 4=Tag. */
  level?: HeadingLevel;
  /** The original paragraph styleId (Heading1..4, Normal, or anything else — kept verbatim). */
  styleId?: string;
  runs: Run[];
  /** Original <w:pPr> children minus pStyle, re-emitted opaquely on export. */
  rawPPr?: XmlNode[];
  /** Stable id for outline navigation (not persisted to docx in v1). */
  id?: string;
}

/** A block we render/edit, or pass through untouched (tables, sectPr, unknown). */
export type BodyBlock =
  | { type: 'p'; para: Paragraph }
  | { type: 'raw'; node: XmlNode };  // e.g. w:tbl — re-emitted byte-faithfully

export interface DocModel {
  blocks: BodyBlock[];
  /** Relationship id -> target URL, from word/_rels/document.xml.rels. */
  rels: Map<string, string>;
}

/** Verbatim's canonical debate styles (from spec/verbatim-styles.md). */
export const STYLE = {
  POCKET: 'Heading1',
  HAT: 'Heading2',
  BLOCK: 'Heading3',
  TAG: 'Heading4',
  NORMAL: 'Normal',
  CITE: 'Style13ptBold',
  UNDERLINE: 'StyleUnderline',
  EMPHASIS: 'Emphasis',
  HYPERLINK: 'Hyperlink',
} as const;

export const HEADING_LEVEL_BY_STYLE: Record<string, HeadingLevel> = {
  Heading1: 1, Heading2: 2, Heading3: 3, Heading4: 4,
};

export const STYLE_BY_HEADING_LEVEL: Record<HeadingLevel, string> = {
  1: STYLE.POCKET, 2: STYLE.HAT, 3: STYLE.BLOCK, 4: STYLE.TAG,
};

/** The 8pt minimized size in half-points. */
export const MINIMIZED_SIZE = 16;
