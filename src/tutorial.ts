/**
 * The practice file the tour runs on. Instructions live in the tour popups,
 * not in the document, so this stays a small, ordinary-looking file the
 * reader can wreck without consequences.
 */
import type { DocModel, Paragraph, Run } from './model/types';

const p = (runs: Run[]): { type: 'p'; para: Paragraph } => ({
  type: 'p',
  para: { kind: 'para', runs },
});
const heading = (level: 1 | 2 | 3 | 4, text: string): { type: 'p'; para: Paragraph } => ({
  type: 'p',
  para: { kind: 'heading', level, styleId: `Heading${level}`, runs: [{ text, marks: {} }] },
});
const t = (text: string, marks: Run['marks'] = {}): Run => ({ text, marks });

export function tutorialModel(): DocModel {
  return {
    rels: new Map(),
    blocks: [
      heading(1, 'Practice file'),
      p([t('Everything here is editable. Break whatever you want.')]),
      p([t('Renewables solve grid reliability')]),
      p([t('Okafor 25, Tunde Okafor, energy systems professor at Rice, "Grid Futures," Journal of Energy Policy, 9-12-2025')]),
      p([t('Storage costs fell forty percent in two years and utilities noticed. Batteries paired with wind and solar now clear reliability auctions in three regional markets, and the operators who ran those auctions say the hybrid plants beat gas peakers on response time. The grid did not get less stable as renewables scaled. It got faster.')]),
    ],
  };
}
