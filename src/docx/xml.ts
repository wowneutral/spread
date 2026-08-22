/**
 * XML layer over fast-xml-parser in preserveOrder mode — order of paragraphs
 * and runs is meaning, so we never let the parser collapse repeated elements.
 * trimValues:false because leading/trailing spaces inside <w:t> are content.
 */
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export const ATTR = ':@';
export const TEXT = '#text';

const parserOpts = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
} as const;

export function parseXml(xml: string): any[] {
  return new XMLParser(parserOpts).parse(xml);
}

export function buildXml(nodes: any[]): string {
  return new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    processEntities: true,
    suppressEmptyNode: true,
  }).build(nodes);
}

/** Name of an ordered node (its single non-":@" key). */
export function nodeName(node: any): string {
  for (const k of Object.keys(node)) if (k !== ATTR) return k;
  return '';
}

export function children(node: any): any[] {
  const name = nodeName(node);
  const c = node[name];
  return Array.isArray(c) ? c : [];
}

export function attrs(node: any): Record<string, string> {
  return (node[ATTR] as Record<string, string>) ?? {};
}

/** First child with the given name, or null. */
export function child(node: any, name: string): any | null {
  for (const c of children(node)) if (nodeName(c) === name) return c;
  return null;
}

export function childrenNamed(node: any, name: string): any[] {
  return children(node).filter((c) => nodeName(c) === name);
}

/** Make an ordered element node. */
export function el(name: string, kids: any[] = [], attributes?: Record<string, string>): any {
  const node: any = { [name]: kids };
  if (attributes && Object.keys(attributes).length) node[ATTR] = attributes;
  return node;
}

export function textNode(text: string): any {
  return { [TEXT]: text };
}

/** Concatenated text of all descendant #text nodes. */
export function textContent(node: any): string {
  let out = '';
  const walk = (n: any) => {
    if (TEXT in n) { out += String(n[TEXT]); return; }
    for (const c of children(n)) walk(c);
  };
  walk(node);
  return out;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
