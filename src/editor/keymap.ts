/**
 * Verbatim's F-key muscle memory, exactly:
 * F2 paste-plain · F4 Pocket · F5 Hat · F6 Block · F7 Tag ·
 * F8 Cite · F9 Underline · F10 Emphasis · F11 Highlight · F12 Clear ·
 * Mod-8 Shrink. Every binding is rebindable in Settings (v1: fixed defaults).
 */
import { keymap } from 'prosemirror-keymap';
import { undo, redo } from 'prosemirror-history';
import { commands, toggleHighlight } from './commands';
import type { Plugin } from 'prosemirror-state';

export interface KeymapOptions {
  /** Active highlight color, from settings (user-choosable: you cut in cyan? cyan.) */
  getHighlightColor: () => string;
}

export function buildKeymap(opts: KeymapOptions): Plugin {
  return keymap({
    F4: commands.pocket,
    F5: commands.hat,
    F6: commands.block,
    F7: commands.tag,
    F8: commands.cite,
    F9: commands.underlineStyle,
    F10: commands.emphasis,
    F11: (state, dispatch) => toggleHighlight(opts.getHighlightColor())(state, dispatch),
    F12: commands.clear,
    'Mod-8': commands.shrink,
    'Mod-b': commands.bold,
    'Mod-i': commands.italic,
    'Mod-u': commands.underlineDirect,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  });
}
