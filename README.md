# Seam

Open-source, in-browser repair for damaged Microsoft Office files (.docx, .xlsx, .pptx and their macro-enabled versions). Plain JavaScript ES modules, no build step, no framework. Files are processed on the device and never uploaded.

## Honest position against paid tools

> Commercial repair tools (for example Stellar Repair, Kernel, Recovery Toolbox) also handle the old binary formats (.doc/.xls/.ppt) and use proprietary heuristics. Seam does not try to match them on breadth. It focuses on the damage that actually happens to modern Office files: interrupted downloads and copies, broken ZIP structure, malformed XML, and broken internal links. For those cases it uses transparent, open methods and tells you exactly what changed.

## Status

All phases P0 to P7 are built. Seam v2 (`PLAN-V2.md`) Phases A to C are built too: a healthy corpus, a damage lab, independent judges and a scoreboard (A), byte-level recovery (B), and a part registry, a reference sweep, a schema table and verification tiers (C). What the app achieves is measured, not asserted: the latest committed run is [results/SCOREBOARD.md](results/SCOREBOARD.md), with the notes for each phase in `docs/`. The full test suite passes (see "Tests"). Nothing is deployed. Deployment needs explicit approval from the owner.

Manual verification in Office: pending owner (checklist at the end of this file).

## What it does

- Drop or choose up to 50 files (200 MB each). Two are processed at a time in module Web Workers.
- Identifies the real type from the bytes: ZIP-based Office files are repaired; password-protected, older binary, PDF, RTF, web page, image, empty and unknown files are detected and explained, not repaired.
- Repairs: truncated files, a missing or broken ZIP directory, data in front of the file, damaged entries (CRC and inflate errors), malformed XML (invalid characters, unclosed or mismatched elements, duplicate attributes, UTF-16 parts), content types, relationships, and the format rules for Word, Excel and PowerPoint.
- Verifies every output with structural checks. An output that fails verification is discarded and the outcome drops a level.
- Salvages text into a new file when the structure cannot be rebuilt.
- Reports every change as a finding, grouped as Lost, Repaired and Noted, with the part it concerns. Reports can be copied or saved as .txt.
- Light, dark and system themes. The theme control is a custom menu in the header. System is the default and follows the operating system setting.
- No browser-native controls are shown: no select element, no title tooltips (a styled tooltip is used), thin token-coloured scrollbars. The only native UI is the operating system file picker, which opens when you choose files and cannot be replaced by a web page.

Outcomes: No problems found, Repaired, Partially repaired, Salvaged text, Could not repair, Not supported, Not processed.

## Run it

Any static file server works. The page uses ES modules and module workers, so it cannot be opened from file://.

```
python3 -m http.server 8000
```

Open http://localhost:8000/ for the app. Add `?demo=1` to see three sample results without loading files.

## Tests

Open http://localhost:8000/tests/ in a browser. The runner prints `PASS` and `FAIL` lines and a final `RESULT pass=N fail=M` line to the page and the console. Add `?only=zip,xml` to run files whose name contains one of the words.

| File | Covers |
|---|---|
| `copy.test.js` | Copy lint (no exclamation marks, emoji or banned words), a template and severity for every finding code |
| `static.test.js` | No network APIs in `js/`, CSP text, no inline script or style, verbatim tokens, fonts and vendor files |
| `identify.test.js` | Type detection, C13 (zero-filled), C14 (encrypted) |
| `fixtures.test.js` | Fixtures pass the structural checks |
| `zip.test.js` | Strict read, recovery, data descriptors, C1 flags, C2, C3, C16, C17, path rules |
| `xml.test.js` | 49 cases for the tokenizer, cleaning, decoding, trees and every-position truncation |
| `package.test.js` | Content types, relationships and the Word, Excel and PowerPoint rules, output compression and times |
| `salvage.test.js` | Text scanners, built files, zeroed main parts |
| `pipeline.test.js` | The corruption matrix C1 to C12 and C15 to C18 across docx, xlsx and pptx |
| `queue.test.js` | Time budget, worker replacement, concurrency, order, duplicates and limits |
| `report.test.js` | Report layout, grouping, sentences |
| `theme.test.js` | Contrast (WCAG AA) in light and dark, theme resolution |
| `ui.test.js` | The real page in an iframe: drop, workers, rows, reports, downloads, Download all, limits, Clear, theme, live region |

The tests were run in Chromium (Playwright). Firefox and Safari were not run.

## Evidence and development tooling

Nothing in this section ships with the app. It lives in `tools/`, `corpus/`, `results/` and `.github/`, needs Node 20 or later, and runs only in development and CI.

```
npm ci
npm run test:node
npm run test:browser
npm run corpus
```

| Command | Does |
|---|---|
| `npm run test:node` | Node tests for the damage lab and the text extractor |
| `npm run test:browser` | The browser suite in headless Chromium. `--browser firefox` or `--browser webkit` for the others |
| `npm run corpus` | Fetches the healthy corpus, checks every SHA-256 and prints the coverage report |
| `npm run corpus:gen` | Builds the python-docx, openpyxl and python-pptx files. Needs `tools/corpus-gen/requirements.txt` |
| `node tools/damage-run.mjs --sample 0.02` | Damages corpus files with 13 seeded kinds |
| `node tools/run-seam.mjs --in <dir> --out <dir>` | Runs the real pipeline over a directory in a browser |
| `tools/judge-lo.sh <in> <out> --roundtrip` | LibreOffice headless: load check and re-save |
| `node tools/score.mjs --gate` | Joins results into `results/SCOREBOARD.md` and fails on false alarms or rejected outputs |
| `node tools/property.mjs` | Never throws or hangs, and a second pass over each output reports no problems |

The Open XML SDK judge is `tools/judge-oxml` and the Office judge is `tools/office-judge.ps1`. The full run is `.github/workflows/score.yml`. `docs/PHASE-A-NOTES.md` lists what is built, what has not been run and where it differs from the plan.

## Structure

```
index.html
css/       tokens.css (verbatim copy of brand/tokens.css), themes.css, fonts.css, app.css
js/        main.js, ui.js, queue.js, worker.js, copy.js, theme.js, theme-init.js
js/core/   identify, crc32, zip-read, zip-recover, zip-write, xml-clean, xml-repair,
           package, verify, salvage, report, constants, pipeline
js/core/formats/   docx.js, xlsx.js, pptx.js
vendor/    fflate.module.js and its licence, open-xml-sdk.LICENSE for the schema table
fonts/     Instrument Sans (3 weights), JetBrains Mono (1 weight), OFL.txt
brand/     icon, favicon, tokens and identity board (unchanged)
tests/     see above
```

Every user-facing string lives in `js/copy.js`.

## Guardrails (PLAN.md section 3)

- [x] 1. No network calls (checked by `static.test.js`).
- [x] 2. Nothing is loaded from a third-party origin. Fonts and fflate are files in the repo.
- [x] 3. The CSP meta matches the specified text (checked by `static.test.js`).
- [x] 4. No file contents are stored. The only stored value is the theme choice (see Deviations).
- [x] 5. No database.
- [x] 6. The original file is never changed. Output is a new Blob.
- [x] 7. Output names follow the specified patterns.
- [x] 8. Non-XML parts pass through byte for byte (checked by `pipeline.test.js`).
- [x] 9. Repaired is only reported after the output passes the structural checks.
- [x] 10. The only content added is structural: relationships, content types, a body element. Each is reported.
- [x] 11. Every change is a finding.
- [x] 12. Loss is reported (truncation, CRC mismatches kept, removed sheets, slides, images, links).
- [x] 13. Copy lint passes.
- [x] 14. The approved phrases are "Passed structural checks." and, for outputs that also pass the schema table, "Passed structural and content checks."
- [x] 15 and 16. No framework, no build step. fflate is the only third-party code. The schema table in `js/core/data/schema-lite.js` is data, generated by `tools/gen-schema-lite.mjs` from the Open XML SDK's schema files and from the healthy corpus.
- [x] 17. DOMParser decides well-formedness. The tolerant tokenizer is used for repair. Regex is only used for character cleaning, the salvage scanners and read-only checks.
- [x] 18. Heavy work runs in module workers.
- [x] 19. Layout works on mobile widths.
- [x] 23. This file does not claim Office testing.
- [x] 24. Nothing is deployed.

## Deviations

Departures from PLAN.md, with the reason for each.

1. **Light, dark and system themes (owner request).** Added `css/themes.css`, `js/theme.js` and `js/theme-init.js`. `tokens.css` stays verbatim. Dark colours are overrides under `:root[data-theme="dark"]`, written in the same OKLCH style as the tokens. `theme-init.js` is a small classic script in the head so the page does not flash the wrong theme; it is a second script besides the one module. `<meta name="color-scheme" content="light dark">` was added. The theme control is a custom menu button with arrow-key, Home, End, Escape and outside-press handling, not a select element.
2. **Storage.** The theme choice (`light`, `dark` or `system`) is kept in localStorage under `seam-theme`. No file data is stored.
3. **No code comments (owner request).** None in code written for this project. `css/tokens.css` and `vendor/` are copied unchanged and keep their own comments.
4. **DOMParser runs on the main thread.** Web Workers do not have DOMParser. The worker sends each part's text to the page, which checks it with DOMParser and replies. Parsing and repair still run in the worker. Before asking, the worker runs a light scan of its own; text it already knows is ill-formed is not sent, because Chrome builds an inline-styled error document for ill-formed input and the strict CSP reports that as a violation. DOMParser remains the only authority for "well-formed".
5. **Progress line.** The CSP blocks inline style changes in Chromium, including through the CSSOM. The progress line is driven by a `data-p` attribute in 5% steps and plain CSS rules.
6. **Calc chain and shared string counts.** The plan says to always remove `xl/calcChain.xml` and normalise shared string counts. That conflicts with C16 (an untouched file must report No problems found) and C2 (all parts byte-identical). Both are applied only when the content of the workbook is already being changed.
7. **Extension-only correction.** A valid file with a wrong extension is returned with its original bytes and the corrected name, not re-zipped.
8. **fflate and fonts source.** The CDN named in the plan was not reachable from the build environment. `fflate@0.8.2` `esm/browser.js` and the Latin woff2 subsets of Instrument Sans (400, 500, 600) and JetBrains Mono (400) were taken from the npm packages. Each font is over 10 KB. `OFL.txt` holds both licences.
9. **Extra files.** `core/pipeline.js` (orchestration), and under `tests/`: `harness.js`, `fixtures.js`, `corrupt.js`, `queue.test.js`, `ui.test.js`.
10. **Extra finding codes.** `ZIP_ENDS_EARLY`, `ZIP_UNSUPPORTED_METHOD`, `ZIP_PATH_DROPPED`, `CT_DEFAULT_ADDED`, `CT_MAIN_FIXED`, `ROOT_RELS_FIXED`, `REL_ID_RENAMED`, `REL_DUPLICATE_DROPPED`, `PPTX_MASTER_REMOVED`. Each has copy, a severity and a test.
11. **Extra copy.** `link.scopeShort` ("What it can repair", used on narrow screens), the theme labels, `btn.close`, notice and live-region strings, and the extension-corrected text for a file with no extension.
12. **Drag-over border.** Painted with a two-layer background (`padding-box` and `border-box`) instead of `border-image`, so the rounded corners are kept.
13. **Contrast override.** `--ink-3` on `--paper-2` measures 4.39:1 in the light theme. Report labels and part paths use `color-mix(in oklch, var(--ink-3), var(--ink) 18%)` in `app.css`. Tokens are unchanged.
14. **Report file name.** The plan does not name it. It is `<original base name> (repair report).txt`.
15. **Tools.** The plan names TodoWrite, WriteFileFromUrl and Playwright tools that were not available. npm, bash and Playwright were used instead.

## Known limits

- A truncation that falls exactly on a part boundary with no directory left is indistinguishable from a removed directory (C2). It is reported as Repaired with the directory rebuilt.
- A file cut inside its ZIP directory is reported as Partially repaired with a finding that data after the cut may be missing, even when every part is complete.
- Shared string checks use the double-quoted `t="s"` form that Excel writes.
- Dangling references are removed for images, hyperlinks, headers and footers (Word), drawings (Excel) and pictures (PowerPoint). Other relationship-based references, such as table parts or pictures in slide layouts, are not rewritten.
- A slide with more than one layout relationship is left as it is.
- A file that is valid and has a Content_Types entry that is not first in the ZIP is reported as No problems found; the order is only enforced on output.
- Very large XML parts are checked by DOMParser on the main thread, which can pause the page briefly.
- Tested in Chromium only. On the 1,139-case damaged set the median repair takes 62 ms, the 95th percentile 412 ms and the slowest 15.7 s (a 12 MB part), with peak JS heap up to 495 MB. Six 100 MB documents (a 4 MB main part plus a 96 MB image) damaged in the main part or the ZIP directory repaired in 3 to 7 seconds at 170 to 680 MB peak heap; the same file undamaged is checked in under 1 second.

## Remaining work

- Manual verification in Office (below).
- Run the suite in Firefox and Safari.
- Deployment, after the owner approves.

## Manual verification in Office

Pending owner (PLAN.md section 14):

1. Open 3 repaired files of each type in Microsoft Office (Windows or Mac) and in LibreOffice.
2. Confirm no "We found a problem with some content" prompt appears for files marked Repaired.
3. Report any file where Office still complains, with the Seam report attached.

## Storage

File contents: none. Only the theme preference is stored in localStorage.

## Licence

MIT. fflate is MIT (see `vendor/fflate.LICENSE`). The schema table is derived from the Open XML SDK data files, MIT, Copyright (c) .NET Foundation and Contributors (see `vendor/open-xml-sdk.LICENSE`; the pinned commit is recorded in the table's `source`). The fonts are under the SIL Open Font License (see `fonts/OFL.txt`).
