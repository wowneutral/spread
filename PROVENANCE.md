# Provenance

Spread's codebase was written from scratch. This document states exactly what was and was not used from other projects, because the debate software space has projects under three different license regimes (MIT, GPL, PolyForm Noncommercial) and the boundaries matter.

## CardMirror

CardMirror is licensed under PolyForm Noncommercial 1.0.0, which forbids forks for commercial use and does not permit reuse of its source in an MIT project.

**None of CardMirror's source code was copied, ported, or consulted during Spread's implementation.** No files, functions, algorithms, or data structures derive from it. What Spread takes from CardMirror is the observation, available to anyone, that a browser-based card cutter is viable — the same way any product demonstrates a market.

## Verbatim

Verbatim (Aaron Hardy / Ashtar Communications) is GPL-licensed. Spread does not incorporate Verbatim's code. Verbatim's template (`Debate.dotm`, version 6.0.0) was used for one purpose only: extracting the .docx **style definitions** as an interoperability specification.

- The extracted `word/styles.xml` is preserved at [spec/verbatim-styles.md](spec/verbatim-styles.md), and [spec/verbatim-styles.md](spec/verbatim-styles.md) documents it: style IDs, names, aliases, font sizes, outline levels, and direct-formatting conventions. These are factual formatting properties needed to read and write compatible files — the .docx equivalent of documenting a wire protocol.
- Test fixtures embed those same style definitions so that compatibility is tested against the real thing.
- No VBA code, macros, or other program logic from Verbatim appears in Spread.

Feature ideas common to debate editors — F-key formatting shortcuts, Pocket/Hat/Block/Tag structure, send-to-speech, read-time estimates — originate in Verbatim's public conventions, which have been the community standard for two decades. Spread implements those conventions independently.

## Libraries

Spread's runtime dependencies are all MIT licensed:

- `prosemirror-commands`, `prosemirror-history`, `prosemirror-inputrules`, `prosemirror-keymap`, `prosemirror-model`, `prosemirror-state`, `prosemirror-transform`, `prosemirror-view` (Marijn Haverbeke)
- `fflate` (zip read/write)
- `fast-xml-parser` (OOXML parsing)

Development and build tooling: `vite`, `vitest`, `jsdom`, `electron`, and `electron-builder` (MIT); `typescript` and `@playwright/test` (Apache-2.0). Test fixtures are generated with `python-docx` (MIT).

## Authorship

Spread was built by Seth, a debater, with AI assistance, and is released under the MIT license (see [LICENSE](LICENSE)). Contributions are welcome under the same terms — see [CONTRIBUTING.md](CONTRIBUTING.md).
