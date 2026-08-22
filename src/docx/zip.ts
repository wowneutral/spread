/**
 * Docx container layer. A .docx is a zip of XML parts; we read it into an
 * insertion-ordered Map (so re-serialization preserves part order), replace
 * only the parts we regenerate, and copy every other part through untouched.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';

export type PartMap = Map<string, Uint8Array>;

export function readDocx(bytes: Uint8Array): PartMap {
  const unzipped = unzipSync(bytes);
  const parts: PartMap = new Map();
  for (const [name, data] of Object.entries(unzipped)) parts.set(name, data);
  return parts;
}

export function writeDocx(parts: PartMap): Uint8Array {
  const obj: Zippable = {};
  for (const [name, data] of parts) obj[name] = data;
  // level 6: solid compression without pathological CPU on multi-MB files.
  return zipSync(obj, { level: 6 });
}

const dec = new TextDecoder();
const enc = new TextEncoder();

export function partText(parts: PartMap, name: string): string | null {
  const data = parts.get(name);
  return data ? dec.decode(data) : null;
}

export function setPartText(parts: PartMap, name: string, xml: string): void {
  parts.set(name, enc.encode(xml));
}
