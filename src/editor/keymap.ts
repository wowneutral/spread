/**
 * Verbatim's F-key muscle memory, exactly:
 * F3 Condense (Alt: flat · Mod-Alt: pilcrows · Mod-Alt-Shift: uncondense) ·
 * Shift-F3 Case · F4 Pocket · F5 Hat · F6 Block · F7 Tag · Mod-F7 Analytic ·
 * Mod-F8 Undertag · F8 Cite · F9 Underline · F10 Emphasis · F11 Highlight ·
 * Mod-F11 Background · F12 Clear · Mod-8 Shrink · Mod-Shift-8 Regrow ·
 * Alt-F8 Copy previous cite · Tab indent · PageUp/PageDown heading jumps ·
 * Alt-A select section.
 */
import { keymap } from 'prosemirror-keymap';
import { undo, redo } from 'prosemirror-history';
import {
  commands, toggleHighlight, toggleShade, condenseCmd, shrinkSelection,
  type CondenseMode,
} from './commands';
import type { Plugin } from 'prosemirror-state';

export interface KeymapOptions {
  /** Active highlight color, from settings (you cut in cyan? cyan.) */
  getHighlightColor: () => string;
  /** Active background-shade fill (Mod-F11), RRGGBB. */
  getShadeHex: () => string;
  /** What plain F3 does, from the integrity / pilcrow settings. */
  getCondenseMode: () => CondenseMode;
  /** Custom strings Shrink keeps at full size. */
  getShrinkProtections: () => string[];
}

export function buildKeymap(opts: KeymapOptions): Plugin {
  const shrink = shrinkSelection(opts.getShrinkProtections);
  return keymap({
    F3: (state, dispatch) => condenseCmd(opts.getCondenseMode())(state, dispatch),
    'Alt-F3': condenseCmd('merge'),
    'Mod-Alt-F3': condenseCmd('pilcrows'),
    'Mod-Alt-Shift-F3': commands.uncondense,
    'Shift-F3': commands.toggleCase,
    F4: commands.pocket,
    F5: commands.hat,
    F6: commands.block,
    F7: commands.tag,
    'Mod-F7': commands.analytic,
    'Mod-F8': commands.undertag,
    F8: commands.cite,
    'Alt-F8': commands.copyPreviousCite,
    F9: commands.underlineStyle,
    F10: commands.emphasis,
    F11: (state, dispatch) => toggleHighlight(opts.getHighlightColor())(state, dispatch),
    'Mod-F11': (state, dispatch) => toggleShade(opts.getShadeHex())(state, dispatch),
    F12: commands.clear,
    'Mod-8': shrink,
    'Mod-Shift-8': commands.regrow,
    'Mod-b': commands.bold,
    'Mod-i': commands.italic,
    'Mod-u': commands.underlineDirect,
    Tab: commands.indent,
    'Shift-Tab': commands.outdent,
    PageUp: commands.headingPrev,
    PageDown: commands.headingNext,
    'Alt-a': commands.selectSection,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  });
}
