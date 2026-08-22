# Spread User Manual

Spread is a card-cutting editor for competitive debate. It reads and writes the same Verbatim-compatible Word .docx files your teammates already use. It runs in the browser at [wowneutral.github.io/spread](https://wowneutral.github.io/spread/), and as a desktop app for Mac and Windows from the [releases page](https://github.com/wowneutral/spread/releases). Your files never leave your machine.

Throughout this manual, **Mod** means Cmd on macOS and Ctrl on Windows, Linux, and Chromebooks. Every shortcut listed here is also in the app under Settings, in the Shortcuts tab.

## Contents

1. [Getting started](#1-getting-started)
2. [Structure: pockets, hats, blocks, tags](#2-structure)
3. [Cutting a card](#3-cutting-a-card)
4. [Condense, case, and paste](#4-condense-case-and-paste)
5. [Colors](#5-colors)
6. [Fonts and sizes](#6-fonts-and-sizes)
7. [Finding things](#7-finding-things)
8. [Read mode and read times](#8-read-mode-and-read-times)
9. [The speech doc and the dropzone](#9-the-speech-doc-and-the-dropzone)
10. [The timer](#10-the-timer)
11. [The flow](#11-the-flow)
12. [The WPM test](#12-the-wpm-test)
13. [Saving](#13-saving)
14. [Settings](#14-settings)
15. [Keyboard shortcuts](#15-keyboard-shortcuts)
16. [Privacy](#16-privacy)

## 1. Getting started

The home screen has three actions. New document creates a fresh Verbatim-styled file. New speech document creates one already marked as the speech doc. Open reads any Verbatim or Word .docx.

Files you open show up under Recent. In Chrome and Edge, Spread remembers the file itself, so clicking a recent reopens and saves back to the same file after the browser asks your permission once. In Firefox and Safari there is no direct file access, so Save downloads a copy instead.

The first time you use Spread it opens a practice file and a short tour of popups that cuts a card in front of you. You can rerun it any time from Take the tour on the home screen.

When you open a document, Spread renders it with the file's own styles. Fonts, sizes, the boxed pocket, centered hats, spacing between paragraphs: all of it comes from the file, the way Word would show it. Display settings can change how things look on your screen, but the file itself only changes when you edit it.

## 2. Structure

Verbatim files are built out of four heading levels, each on a function key. Put the cursor on a line and press the key to convert it. Pressing the same key again turns it back into a normal paragraph.

F4 makes a Pocket, the top-level section. F5 makes a Hat, a major grouping inside a pocket. F6 makes a Block, a set of related cards on one point. F7 makes a Tag, the claim line of a single card. Mod-F7 makes an Analytic, standalone analysis with no card behind it. Mod-F8 makes an Undertag, a short annotation under a tag.

The outline on the left tracks all of this. The 1 2 3 4 buttons set how deep it shows, clicking an entry jumps there, and the entry your cursor is in stays highlighted. Analytics show in the outline at depth 4 with an A marker.

PageUp and PageDown jump between headings. Alt-A selects the current heading and everything under it. Tab and Shift-Tab indent and outdent the current paragraph.

## 3. Cutting a card

A card is a tag, a cite, and body text. The keys:

F8 applies the Cite style, meant for the author name and date, not the whole line. With nothing selected it hits the word under the cursor. F9 applies the Underline style to the selection, the broad pass over what you would read. F10 applies Emphasis, bold underline for what stands out inside the underlining. F11 highlights in your active color, the words you actually say. F12 clears formatting back to plain text.

Mod-8 shrinks everything in the card that is not underlined, highlighted, cited, or emphasized down to 8pt, the standard Verbatim look. Press it again to restore. Mod-Shift-8 regrows everything to full size. Bracketed omission notes like [TABLE OMITTED] stay full size when you shrink, and you can protect your own strings in Settings under Editing.

Alt-F8 copies the nearest previous cite into the current card, for cutting several cards from one article. Mod-B, Mod-I, and the toolbar S button do bold, italic, and strikethrough. The toolbar buttons light up to show what the text at your cursor already carries.

## 4. Condense, case, and paste

F3 condenses the card body. What it does exactly is controlled by two settings under Editing: with paragraph integrity on and pilcrows on (the default), it merges the paragraphs but marks every original break with a small ¶ so you can undo the merge later. Mod-Alt-Shift-F3 (Uncondense) restores the original paragraphs from those pilcrows. Alt-F3 merges flat with no markers. Shift-F3 cycles the case of the selection: lowercase, UPPERCASE, Title Case.

F2 pastes as plain text, which you should use when pasting from a website or PDF so the source's formatting junk stays out of your file. If the browser refuses clipboard access, Spread arms plain paste and your next regular paste lands plain.

## 5. Colors

There are three color controls in the toolbar, and each is a split button: the main button applies, the small arrow picks the color.

Highlight (F11) uses Word's 15 highlight colors and toggles on and off. Background color (Mod-F11) is a separate layer that can coexist with highlighting, useful for keeping an opponent's highlighting visible while you make your own pass. Font color applies a text color, with Automatic to remove it.

The Doc menu has the bulk operations: standardize all highlighting to your active color, remove all highlighting or background color, convert highlight to background or back, and remove hyperlinks. With text selected these work on the selection, otherwise on the whole document.

## 6. Fonts and sizes

The Font menu in the toolbar changes the document's font for real. Pick Times New Roman and the file's styles are rewritten so Word, Verbatim, and CardMirror all see Times New Roman after you save. Restore the file's fonts puts back whatever the file had when you opened it.

The size control next to it shows the sizes in points. Pick one to set the selection's size, or use the A with arrows to step it a point at a time. File default removes the size override so the text goes back to its style's size.

If you only want a different look on your own screen without touching the file, Settings under Appearance has a display-only body font and per-style size overrides.

## 7. Finding things

Mod-F opens find, with match count and Enter and Shift-Enter to move through matches. Mod-H adds a replace row, with Replace and All. Esc closes.

Mod-K opens the command palette. Every command in the app is in there by name, so if you forget a key, type what you want.

## 8. Read mode and read times

The eye button in the toolbar toggles read mode. It hides everything that is not read out loud, leaving tags, cites, analytics, and highlighted text, and it locks the keyboard so a stray keystroke at the podium cannot edit your file. Press it again to exit.

The status bar shows Doc, the count of read-aloud words, and the time it takes at two reader speeds. Reader 1 and Reader 2 speeds are set in Settings under General. With the cursor parked in a card, a second segment shows that card's read time. With a selection, the segment shows the selection instead. Click the Σ for the full word count dialog.

Mod-Shift-D drops a red reading marker at the cursor, for when you stop mid-card. Press it again on the marker to remove it.

## 9. The speech doc and the dropzone

Mark any tab as the speech doc from the command palette, or create one from home with New speech document. Then, from any other document, the backtick key sends the card under your cursor to the speech doc, and Alt-backtick appends it at the end. The speech pane on the right lists the cards it holds with a running read time.

Mod-backtick parks the current card in the dropzone instead, the holding shelf below the speech list. Click a parked card to insert it at your cursor, or the × to discard it.

## 10. The timer

The clock button in the toolbar opens the timer panel with two independent clocks, Speech and Prep. Type any length in the box, as 6:30 or keypad style as 630, then start, pause, and reset. Each clock switches between countdown timer and stopwatch with the link above it. The ⇱ button pops the timer into its own small window that you can keep on top while you work, on the web and in the desktop app.

## 11. The flow

The Flow button in the top bar opens Spread's flowing tool. A flow is speech columns for your event and argument rows, all keyboard.

Make a flow in the left sidebar: name it, pick the event (LD, Policy, or PF sets the columns), and add. One flow per debate; they all stay listed in the sidebar and you switch by clicking.

In the grid, type in any cell. Enter adds an argument row below, Alt-Enter adds one above, Shift-Enter jumps right to the response cell in the next column, and Tab does the same. Arrows move between cells. Mod-B bolds a cell, Mod-D strikes it out for arguments that are dead. Backspace on an empty row deletes it.

While cutting, put the cursor on a card and run Send tag to flow from the Card menu or the palette. The tag lands in the first column of your active flow, so the case flows itself as you assemble the speech doc.

Flows are saved on this machine automatically. Export writes a flow to a JSON file you can keep or share, and Import reads one back.

## 12. The WPM test

Reader speeds drive every read time in Spread, so measure yours instead of guessing. Test your WPM is on the home screen and in Settings under General. Press Start, read the passage out loud at your round pace, press Done when you finish, and Spread computes your words per minute with one-click buttons to set Reader 1 or Reader 2.

The test is a stopwatch and a word count, nothing else. No microphone, no recording, nothing leaves your machine.

## 13. Saving

Mod-S saves. In Chrome and Edge, saving writes straight back to the file after you grant permission once, and autosave writes a few seconds after you stop typing (turn it off in Settings under Files). In Firefox and Safari, Save downloads a copy.

Mod-Shift-S opens Save As, which has three presets. As-is saves a full copy. Send Doc saves a clean copy for the judge or opponent with analytics and undertags stripped, prefixed SEND_. Read Doc saves only the read-aloud content, tags, cites, analytics, and highlighted text, prefixed READ_. The prefixes are editable in Settings under Files.

Everything Spread saves is a real .docx that opens in Word, Verbatim, and CardMirror with exact formatting. Anything in the file that Spread does not edit, like tables and section setup, passes through untouched.

## 14. Settings

The gear opens Settings, in five tabs. General has the theme, default outline depth, reader speeds, and timer length. Files has autosave and the Send and Read Doc prefixes. Appearance has dark mode behavior for the page, a display-only body font, per-style font size overrides, analytic and undertag colors, and maximum text width. Editing has the highlight and background colors, spellcheck, the condense settings, and shrink protections. Shortcuts is the full key reference.

Dark mode darkens the interface but leaves the page white by default, because cards read like paper. Appearance has the switch if you want the page dark too.

Display settings never change your files. A saved .docx always carries exact Verbatim formatting.

## 15. Keyboard shortcuts

| Keys | Action |
|------|--------|
| F2 | Paste plain text |
| F3 / Alt-F3 / Mod-Alt-F3 / Mod-Alt-Shift-F3 | Condense / flat / with pilcrows / uncondense |
| Shift-F3 | Toggle case |
| F4 / F5 / F6 / F7 | Pocket / Hat / Block / Tag |
| Mod-F7 / Mod-F8 | Analytic / Undertag |
| F8 / Alt-F8 | Cite / Copy previous cite |
| F9 | Underline |
| F10 | Emphasis |
| F11 / Mod-F11 | Highlight / Background color |
| F12 | Clear formatting |
| Mod-8 / Mod-Shift-8 | Shrink / Regrow |
| Mod-B / Mod-I / Mod-U | Bold / Italic / Underline (direct) |
| Tab / Shift-Tab | Indent / Outdent |
| PageUp / PageDown | Previous / next heading |
| Alt-A | Select the current section |
| ` / Alt-` / Mod-` | Send to speech / append / dropzone |
| Mod-Shift-D | Reading marker |
| Mod-F / Mod-H | Find / Find and replace |
| Mod-K | Command palette |
| Mod-S / Mod-Shift-S / Mod-O | Save / Save As / Open |
| Mod-= / Mod-- | Zoom in / out |

## 16. Privacy

Spread has no accounts, no analytics, and no server that ever sees your files. The details are in the [Privacy Policy](PRIVACY.md) and the [Terms of Use](TERMS.md).

Bug reports and suggestions: [GitHub issues](https://github.com/wowneutral/spread/issues) or hello@mitez.org.

Made by Armaan Seth.
