# Spread

Spread is a free, open-source card-cutting editor for competitive debate. It reads and writes the same Verbatim-compatible Word .docx files your teammates already use, but it needs no Word license, no account, and no install — it runs in the browser, including on a school Chromebook. Your files stay on your machine. MIT licensed, free forever.

**Try it:** https://YOURUSER.github.io/spread/ · **Desktop installers:** see [Releases](../../releases)

## Why

Cutting cards should not cost money.

- **Verbatim** is the standard, and it is excellent — but it is a Word template. Word costs roughly $100/year unless your school pays for it, and it does not run on Chromebooks at all. Plenty of debaters have neither.
- **CardMirror** proved a browser editor works, but it is licensed PolyForm Noncommercial: forks and commercial redistribution are forbidden, and collaboration features sit behind a paid plan.

Spread is the third option: MIT licensed, so anyone can use it, fork it, fix it, or ship it — and its files are ordinary Verbatim-styled .docx, so switching costs nothing and nobody on your team has to switch with you.

## Features (v0.1)

**File fidelity is the core promise.** Open a Verbatim file, edit it, save it, and it is still a correct Verbatim file:

- Full .docx round-trip. `styles.xml` is preserved byte-for-byte, and formatting Spread doesn't model (unknown run and paragraph properties, tables, section settings, bookmarks) passes through untouched on save. The test suite verifies a second round-trip is byte-identical.
- New documents are created with the real Verbatim 6 style definitions, so they open cleanly in Word and Verbatim.

**The editor:**

- Verbatim's F-key muscle memory: F4 Pocket, F5 Hat, F6 Block, F7 Tag, F8 Cite, F9 Underline, F10 Emphasis, F11 Highlight (pick your color), F12 Clear, and Ctrl/Cmd-8 to shrink un-underlined text to 8pt.
- Two document views: **Clean** (comfortable to read while cutting) and **Faithful** (exactly how the file renders in Word). Switching views never changes the file.
- A contextual toolbar that appears on selection, a Ctrl/Cmd-K command palette that reaches every command, and an optional full toolbar for people who want buttons.
- Outline navigation built from Pocket/Hat/Block/Tag headings, with a 1–4 depth control.
- Multiple documents in tabs.
- A speech doc: mark any tab as the speech doc, select a card (or just put your cursor in one) and send it over. The speech pane lists sent cards with word counts and total read time.
- A read-time status bar: "Doc" counts only the words you'd read aloud — tags, cites, underlines, highlights — and converts them to minutes at Reader 1 and Reader 2 words-per-minute (set your own in Settings). Selections get their own count.
- A speech timer in the speech pane, plus a pop-out timer window.

**Files and platform:**

- Open and save-in-place through the File System Access API (Chrome/Edge), with a recents list that asks permission before touching anything. Other browsers fall back to open/download.
- Autosave once a file has been saved in place.
- An interactive tutorial ("Cut your first card") that assumes zero Verbatim knowledge — it opens on first launch and teaches the whole workflow in a real, editable document.
- Light and dark themes, installable as an offline PWA, and desktop apps for Mac and Windows.
- Display settings (view mode, zoom, theme, toolbar) are yours; they never touch the file. A saved .docx always carries exact Verbatim formatting.

## Getting started

### Web (recommended, works on Chromebooks)

Open https://YOURUSER.github.io/spread/ in Chrome or Edge. That's it — the first-launch tutorial walks you through cutting a card. Install it as an app (browser menu → Install) for offline use.

Chrome and Edge get the full experience, including save-in-place and recents. Firefox and Safari work too, but saving downloads a copy instead of writing back to the original file.

### Desktop (Mac / Windows)

Download the installer from [Releases](../../releases): `Spread-<version>-mac.dmg` or `Spread-Setup-<version>.exe`.

The builds are not code-signed yet (certificates cost money; see the roadmap), so your OS will warn you once:

- **macOS** — "Spread can't be opened because it is from an unidentified developer": right-click (or Ctrl-click) **Spread.app**, choose **Open**, then **Open** in the dialog. First launch only. If macOS instead says the app is "damaged", clear the quarantine flag:

  ```sh
  xattr -cr /Applications/Spread.app
  ```

- **Windows** — SmartScreen "Windows protected your PC": click **More info**, then **Run anyway**. First run of the installer only.

## Development

```sh
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm test           # Vitest — includes the round-trip fidelity suite
npm run typecheck  # tsc --noEmit
npm run build      # web build into dist/
```

Desktop:

```sh
npm run dev                    # in one terminal
npm --prefix desktop start     # Electron pointed at the dev server

# local installers into desktop/release/:
npm run build && npm --prefix desktop run dist
```

Releases are cut by pushing a tag: `git tag v0.1.0 && git push origin v0.1.0` builds unsigned Mac and Windows installers on CI and attaches them to a GitHub Release. Pushes to `main` deploy the web app to GitHub Pages. Details in [docs/packaging.md](docs/packaging.md); contribution notes in [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

What's next, in no particular order. Everything stays free.

- Send Doc / Read Doc / Marked Doc save presets
- Analytic and Undertag paragraph styles
- Read mode
- Comments
- Flashcards for drilling your files
- Card passing between teammates — serverless, free, and published as an open protocol so other tools can speak it too
- Per-topic open evidence search
- Signed installers, once donations cover the certificates

## Compatibility notes

- Spread targets the Verbatim 6 style set: `Heading1`–`Heading4` (aliased Pocket, Hat, Block, Tag), `Style13ptBold` (Cite), `StyleUnderline` (Underline), and `Emphasis`. Styles are matched by styleId first, with fallback to Word's style names and aliases for files produced by other tools. The full extracted spec lives at [spec/verbatim-styles.md](spec/verbatim-styles.md).
- Formatting Spread doesn't model passes through untouched — open and save a file and unknown run properties, tables, section settings, and the rest come out exactly as they went in. Tables are preserved but not yet editable in the editor.
- Known v0.1 limit: images inside text paragraphs are not preserved when that paragraph is edited. Keep image-heavy files in Word for now.

## Documentation

The full [User Manual](MANUAL.md) covers everything: structure keys, cutting, condense, colors, fonts, read mode, the speech doc, the timer, saving, and every shortcut.

## Feedback

Bug reports and feature requests: [GitHub issues](https://github.com/wowneutral/spread/issues), or email hello@mitez.org.

Next up on the roadmap: a built-in flowing tool — fluid, keyboard-first, made for round speed.

## Credits

Spread is made by **Armaan Seth**.

- **Verbatim**, by Aaron Hardy / Ashtar Communications (GPL), defined the conventions this entire space runs on — the styles, the F-keys, send-to-speech, all of it. Spread interoperates with its file format and is grateful for two decades of groundwork.
- **ProseMirror**, by Marijn Haverbeke, is the editor toolkit underneath.
- **CardMirror** showed that a browser-based card cutter is viable. Spread was built independently, from scratch — see [PROVENANCE.md](PROVENANCE.md).

## License

MIT. See [LICENSE](LICENSE).

## Privacy and terms

Spread has no accounts, no analytics, and no server that ever sees your files. The details are in the [Privacy Policy](PRIVACY.md) and the [Terms of Use](TERMS.md).
