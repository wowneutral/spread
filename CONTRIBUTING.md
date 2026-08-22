# Contributing to Spread

Thanks for helping. Spread exists so debaters never have to pay to cut cards; contributions that protect that goal — file fidelity, Chromebook performance, zero-cost hosting — are the most valuable ones.

## Dev setup

Node 22 (what CI uses):

```sh
npm install
npm run dev        # http://localhost:5173
```

Desktop wrapper (optional): `npm --prefix desktop start` with the dev server running.

## Tests

```sh
npm test           # Vitest
npm run typecheck  # tsc --noEmit
```

**The round-trip suite (`tests/roundtrip.test.ts`) is the merge gate.** Every fixture must survive import → export → re-import with a semantically identical model, byte-identical `styles.xml`, identical text, and a byte-stable second round-trip. If your change breaks a round-trip test, the change is wrong, not the test — a debater's file surviving a save is the whole product.

The `.docx` fixtures in `tests/fixtures/` are generated, not hand-made. To regenerate or add one:

```sh
pip install python-docx
python3 tools/make_fixtures.py
```

Fixtures embed the real Verbatim 6 style definitions (see `tools/make_fixtures.py` for how to obtain the styles.xml locally — it is GPL and not committed). If you add a fixture, add it to the generator, not as a loose binary.

## Style

- TypeScript, strict mode. `npm run typecheck` must pass.
- No frameworks. The UI is plain DOM (see the `h()` helper in `src/app.ts`); the editor is ProseMirror. Don't introduce React, a state library, or a CSS framework.
- Unknown .docx content is sacred: anything the importer doesn't model must be captured and re-emitted untouched, never dropped.
- Keep the interop rules in `spec/verbatim-styles.md` in sync with any importer/exporter change.

## Adding a command

Commands live in one place and surface in three:

1. Implement it in `src/editor/commands.ts` as a ProseMirror command.
2. Add it to the palette in `paletteItems()` in `src/app.ts` — every command must be reachable from Ctrl/Cmd-K.
3. If it deserves a shortcut, bind it in `src/editor/keymap.ts`. F4–F12 and Mod-8 are Verbatim's bindings — don't rearrange them.

Add it to the contextual toolbar or full toolbar in `src/app.ts` only if it earns the space.

## Pull requests

- Keep PRs small and focused; one change per PR.
- `npm test` and `npm run typecheck` must pass (CI runs both on every PR).
- Anything touching import/export needs a fixture that exercises it.
- No code from CardMirror or other incompatibly-licensed projects, ever — see [PROVENANCE.md](PROVENANCE.md). New dependencies need a permissive license (MIT/BSD/Apache) and a good reason.
- Say what you tested and on what browser/OS.
