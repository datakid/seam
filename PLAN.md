# Seam — Build Plan

**For:** the implementing model (Claude Sonnet 5.5) working in this repository.
**From:** the project owner.
**Status:** Spec v1. You implement it as written. If something here seems wrong, stop and ask. Do not "improve" the spec on your own.

---

## 0. How to read this document

- **MUST / MUST NOT** are hard rules. Breaking one means the work is wrong, even if it looks good.
- **SHOULD** is the default. Only depart from it if you write down why in `README.md` under "Deviations".
- Sections 3 (Guardrails), 7 (Repair pipeline), 9 (Outcomes), and 10 (Copy) have the most rules. Read them twice.
- Build in the phase order in section 13. Do not start a phase until the one before it meets its acceptance criteria.
- If you lose context partway through, re-read this file **in full** before you continue.

---

## 1. Product in one paragraph

Seam is a single-page, open-source web app written in plain JavaScript. It repairs damaged **Microsoft Office Open XML** files: `.docx`, `.xlsx`, `.pptx`, plus their macro versions `.docm`, `.xlsm`, `.pptm`. You drop in one file or a batch. Seam works out what is wrong with each one, fixes what it can **in the browser** (nothing gets uploaded), checks its own output, and gives back a repaired copy with a plain, honest report. If it can only get the text back, it says that. If it can't help, it says why. It never overstates what it did.

### 1.1 Name and identity

- **Name:** Seam. A seam is where two torn edges are joined. It's short and calm, and it isn't already a well-known file-repair brand. "The Fixer" was turned down because it's generic, sounds like a gimmick, and clashes with the quiet tone.
- **Wordmark:** "Seam" in Instrument Sans SemiBold (600), tracking −0.01em, ink colour. Never all caps. Never with an exclamation mark.
- **Icon:** `brand/icon.svg` (app tile) and `brand/favicon.svg` (no tile, for small sizes). A document torn across the middle, held together by one chromatic line (coral → amber → mint → violet). **Do not redraw or "tidy up" the icon.** Use the files as they are.
- **Identity board:** `brand/index.html` shows the palette, type and components. Use it as the visual reference.
- **Tokens:** `brand/tokens.css` is the only source of colours, spacing, type, radii, shadows and motion. Copy it to `css/tokens.css` without changes.

### 1.2 Honest position against paid tools

Write this into the README exactly as it is:

> Commercial repair tools (for example Stellar Repair, Kernel, Recovery Toolbox) also handle the old binary formats (.doc/.xls/.ppt) and use proprietary heuristics. Seam does not try to match them on breadth. It focuses on the damage that actually happens to modern Office files: interrupted downloads and copies, broken ZIP structure, malformed XML, and broken internal links. For those cases it uses transparent, open methods and tells you exactly what changed.

---

## 2. Scope

### 2.1 In scope (v1)

| Input | Handling |
|---|---|
| `.docx .docm .xlsx .xlsm .pptx .pptm` (ZIP + XML) | Full pipeline: identify → ZIP recovery → XML repair → package repair → verify → (salvage if needed) |
| Files whose extension is wrong but whose contents are OOXML | Repaired. The report notes the real type and the output gets the correct extension. |
| Batches of up to 50 files, up to 200 MB per file | Supported, processed 2 at a time |

### 2.2 Detected and explained, not repaired (v1)

| Detected as | What Seam says (exact copy in §10.4) |
|---|---|
| Password-protected OOXML (CFB container with `EncryptedPackage` stream) | It can't open encrypted files. |
| Legacy binary `.doc/.xls/.ppt` (CFB without `EncryptedPackage`) | Older binary formats aren't supported in this version. |
| File is actually PDF / RTF / HTML / plain text / image | Names the real type. Does not change it. |
| All zero bytes, or empty | No data to recover. |
| Unknown bytes with no ZIP signatures | Not recognised as an Office document. |

### 2.3 Out of scope. MUST NOT build.

- Repairing `.doc/.xls/.ppt` binary formats, `.odt/.ods/.odp`, PDF or images.
- Password cracking or removal of any kind. Not even "try common passwords".
- Data recovery from disks, undelete, or ransomware decryption.
- Running, checking or changing macros. Macro parts (`vbaProject.bin`) are passed through byte for byte.
- Any server, account, telemetry, analytics, cloud storage or AI/LLM call.
- Editing document content (no viewer or editor). One small read-only text preview of salvaged text is allowed (§8.6).

---

## 3. Guardrails (hard rules)

### 3.1 Privacy and network
1. **MUST** do all processing on the user's device. **MUST NOT** call `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon` or any similar API with file data, file names, or anything else.
2. **MUST NOT** load anything from a third-party origin while the app runs: no CDN, Google Fonts, analytics or icon fonts. All assets, including fonts and fflate, are files inside this repo.
3. **MUST** include a strict CSP `<meta>` in `index.html`:
   `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`
   `connect-src 'none'` is required. It is how the app proves it doesn't upload.
4. **MUST NOT** save file contents to localStorage, IndexedDB, Cache Storage or a service worker cache. Files live in memory only and are released (`URL.revokeObjectURL`, references dropped) when the user clears the list or closes the tab.
5. Nothing goes in the database. This project does **not** use Table tools.

### 3.2 Integrity
6. **MUST NOT** change, rename or overwrite the original file. Output is always a new Blob the user downloads.
7. Output file names, exactly:
   - Repaired / partially repaired: `<original base name> (repaired).<correct ext>`
   - Salvaged: `<original base name> (salvaged text).<ext>` (see §8.6 for the ext)
   - Batch zip: `Seam repaired files <YYYY-MM-DD>.zip`
8. **MUST** pass non-XML parts (images, media, `vbaProject.bin`, embeddings, fonts) through byte for byte whenever their CRC matches. Never re-encode images.
9. **MUST NOT** call a file "Repaired" unless the output passes every check in §7.8. If verification fails, the outcome drops a level (§9). It is never rounded up.
10. **MUST NOT** invent document content. The only content Seam may add is the minimal structural skeleton listed in §7.7. Every insertion is reported.

### 3.3 Honesty
11. Every change Seam makes **MUST** appear in the per-file report as a finding (§9.3). No silent fixes.
12. **MUST** report content loss whenever it can happen (truncated parts, dropped elements, removed sheets/slides, CRC-mismatched data that was kept).
13. **MUST NOT** use these words or ideas anywhere in the UI, README or report: *guaranteed, 100%, fully recovered, perfect, magic, instantly, effortless, AI, smart, oops, uh-oh, yay, awesome, don't worry, hang tight, sit back*. Also banned: **exclamation marks**, emoji, and spinners paired with jokey text. A test enforces this (§12.4).
14. **MUST NOT** say a file "will open in Word/Excel/PowerPoint". The approved phrase is **"Passed structural checks."** The app recommends that the user opens the file and checks it.

### 3.4 Technology
15. Plain HTML, CSS and JavaScript ES modules. **No framework** (no React/Vue/Svelte/Lit/jQuery), **no build step**, **no TypeScript**, **no Tailwind**, **no npm at runtime**.
16. The only third-party code allowed is **fflate** (MIT), vendored as `vendor/fflate.module.js` with its LICENSE file next to it. Get it with `WriteFileFromUrl` from `https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js`. Read the file afterwards to confirm it really is the ESM build. Ask before adding any other dependency.
17. XML well-formedness is checked with the browser's `DOMParser` (`application/xml`, look for `parsererror`). Use the custom tolerant tokenizer (§7.5) **only** for repair. **MUST NOT** use regex to edit XML structure. Regex is only allowed for character-level cleaning (§7.5 step 1) and for the salvage text scanner (§8.6).
18. All heavy work runs in a **Web Worker** (`js/worker.js`, module worker). The main thread only handles UI.
19. Target browsers: latest Chrome, Edge, Firefox and Safari. Mobile layout must work. Mobile-specific features are not needed.

### 3.5 Process
20. Use TodoWrite with one task per phase step. Keep only one task in progress at a time.
21. After each phase: run the tests (§12), take desktop and mobile screenshots, and update `README.md`.
22. **Stop and ask the owner** if: a test can't be made to pass without breaking a guardrail; you want a new dependency; you want to change tokens, icon, name or copy; or a file format needs a behaviour this spec doesn't cover.
23. You cannot open files in real Microsoft Office. **MUST NOT** say outputs were tested in Office. Put "Manual verification in Office: pending owner" in the README.
24. Deployment needs explicit approval from the owner. Never say the site is live before an approved deploy has finished.

---

## 4. File structure (MUST match)

```
index.html
css/
  tokens.css          ← verbatim copy of brand/tokens.css
  fonts.css           ← @font-face (self-hosted)
  app.css             ← all component/layout styles
fonts/
  InstrumentSans-Regular.woff2
  InstrumentSans-Medium.woff2
  InstrumentSans-SemiBold.woff2
  JetBrainsMono-Regular.woff2
  OFL.txt
vendor/
  fflate.module.js
  fflate.LICENSE
js/
  main.js             ← boot, wiring
  ui.js               ← rendering of queue, rows, report, sheet
  queue.js            ← batch scheduling (concurrency 2), worker pool
  worker.js           ← module worker: receives ArrayBuffer, returns result
  copy.js             ← EVERY user-facing string (single exported object)
  core/
    identify.js       ← §7.1
    crc32.js          ← table-based CRC-32
    zip-read.js       ← §7.2 strict reader
    zip-recover.js    ← §7.3 scanner
    zip-write.js      ← §7.9 wrapper around fflate.zipSync
    xml-clean.js      ← §7.5 step 1
    xml-repair.js     ← §7.5 tokenizer + stack repair
    package.js        ← §7.6 content types + relationships graph
    formats/
      docx.js         ← §7.7 DOCX rules
      xlsx.js         ← §7.7 XLSX rules
      pptx.js         ← §7.7 PPTX rules
    verify.js         ← §7.8
    salvage.js        ← §8.6
    report.js         ← finding builders + text report export
    constants.js      ← content types, relationship types, signatures
brand/                ← provided; do not modify
tests/
  index.html          ← test runner page
  runner.js
  fixtures.js         ← builds valid minimal docx/xlsx/pptx in memory
  corrupt.js          ← deterministic corruptors
  *.test.js
README.md
LICENSE               ← MIT, "Copyright (c) 2026 Seam contributors"
PLAN.md               ← this file
```

Fonts: download the woff2 files from the official Google Fonts GitHub repo or Fontsource on jsDelivr with `WriteFileFromUrl`. Check each file is larger than 10 KB. If you can't get them, use the system font stack in tokens.css and record that in the README. **Do not** link Google Fonts.

---

## 5. Visual design spec

### 5.1 Principles
- **Light chroma.** Warm paper background, cool ink, colour in soft tints. The full-saturation colour lives in **one** place only: the seam line.
- **One motif.** The seam: a 3 px horizontal line in `--seam` gradient. It marks progress and joins. It is not a decoration you scatter around the page.
- **Quiet.** One display size per screen. No hero illustration, mascots, confetti or celebration animation.
- **Dense but breathable.** This is a tool. The batch list should read like a calm table.

### 5.2 Layout (desktop ≥ 900 px)

```
┌──────────────────────────────────────────────────────────────┐
│ ═════════════ seam line, 3px, full width, static ═══════════ │
│  [icon 28px] Seam                       What Seam can repair │  header 64px
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Repair damaged Word, Excel and PowerPoint files.           │  fs-2xl, max 1 line
│   Files are processed on this device and never uploaded.     │  fs-md, ink-2
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │  drop zone
│  │      Drop .docx, .xlsx or .pptx files here             │  │  tint-violet bg
│  │      or  [ Choose files ]                              │  │  dashed line-strong
│  │                                                        │  │  r-xl, min-h 220px
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  3 files · 2 repaired · 1 cannot repair   [Download all] [Clear]  summary bar
│  ┌────────────────────────────────────────────────────────┐  │
│  │ DOCX  Quarterly report.docx   1.2 MB  ● Repaired   [↓] ▸│  │  rows
│  │ ───────── seam progress line (while working) ───────── │  │
│  │ XLSX  Budget.xlsx             380 KB  ● Partially rep. ▸│  │
│  │ DOC   Old memo.doc             88 KB  ● Not supported  ▸│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Open source · MIT · Nothing leaves your device              │  footer, fs-xs ink-3
└──────────────────────────────────────────────────────────────┘
```
- Content max width 880 px, centred. Side padding `--s-6` (desktop), `--s-4` (mobile).
- Once files are present the drop zone shrinks to a compact 72 px bar ("Add more files") above the list. Animate height with `--dur-3 --ease`.

### 5.3 Mobile (< 640 px)
- Header: icon + wordmark on the left, "What it can repair" becomes a text button on the right.
- Rows stack in two lines: line 1 is format chip + name (ellipsis in the middle, e.g. `Quarterly rep…2026.docx`); line 2 is size · outcome badge · download button.
- Summary actions wrap under the counts.

### 5.4 Components

**Format chip.** `--font-mono`, `--fs-xs`, uppercase, 2px 6px padding, `--r-sm`, background `--neutral-tint`, colour `--ink-2`. Text is the *detected* format, not the extension.

**Outcome badge.** 8 px dot plus label, `--fs-sm`, weight 500, background is the outcome tint, text is the outcome colour, `--r-sm`, padding 2px 8px. Mapping in §9.1. Never use colour alone; the label is always shown.

**Row.** `--surface` background, 1px `--line` bottom border, 56 px min height, grid `auto 1fr auto auto auto`. The whole row is a `<button aria-expanded>` that opens the report panel. The download button sits outside that button (no nested interactive elements).

**Progress.** While a row is processing, a 3px seam line under it grows from 0 to 100% width as stages complete (stage weights in §7.0). If prefers-reduced-motion is on, jump straight to the width with no transition. When done the line fades to `--line` over `--dur-3`. No spinners anywhere.

**Report panel** (expanded row). `--paper-2` background, `--s-5` padding. It contains:
1. One summary sentence (§10.3).
2. A findings list grouped by **Lost / Repaired / Noted**. Each finding has a 6px dot in its severity colour, the plain sentence, and the part path in mono `--ink-3`.
3. Actions: `Download repaired file`, `Copy report`, `Save report (.txt)`.

**"What Seam can repair" sheet.** A right-side `<dialog>`, 420 px wide (full screen on mobile), with the exact content of §10.5. It closes with Esc, a close button, or a backdrop click. Focus is trapped inside while it is open.

**Buttons.** Primary: `--ink` background, `--paper` text, `--r-md`, height 36, padding 0 16. Secondary: `--surface` background, 1px `--line-strong`, `--ink` text. Hover: 4% darker. Active: 1px translateY. Focus-visible: 2px `--focus` outline with 2px offset. Disabled: 40% opacity, `cursor: not-allowed`.

**Drop zone states.** Idle: dashed 1.5px `--line-strong`. Drag over: solid 2px border painted with the seam gradient (border-image), background `--tint-mint`, label changes to "Release to add files". Invalid drag (only folders): label "Folders aren't supported. Drop files instead."

### 5.5 Typography
- Body `--fs-md`/`--lh-body`. Headline `--fs-2xl`/`--lh-tight`, weight 600, letter-spacing −0.02em. Labels `--fs-sm` weight 500.
- File names, part paths and byte counts use `--font-mono` (`font-variant-numeric: tabular-nums`).
- Sentence case everywhere. No Title Case Buttons.

### 5.6 Motion
- Only these may animate: row insertion (opacity 0→1, translateY 4px→0, `--dur-2`), seam progress width, drop zone collapse, dialog slide (`--dur-3`). Nothing else moves.
- No looping animations.

### 5.7 Accessibility (MUST)
- All text meets WCAG AA contrast against its background. Check the outcome colours on their tints; if one fails, lower its L value **in app.css overrides only** and note it in the README.
- The drop zone is also a real `<input type="file" multiple accept=".docx,.docm,.xlsx,.xlsm,.pptx,.pptm,.doc,.xls,.ppt">` (accept is a hint; every dropped file is identified anyway). Keyboard reachable.
- An `aria-live="polite"` region announces only: "Processing N files." and "Done. X repaired, Y partially repaired, Z could not be repaired." Never announce per-stage chatter.
- Full keyboard path: choose files → move through rows → expand report → download.

---

## 6. Architecture

```
main thread                         worker (module)
───────────                         ───────────────
input/drop ─► queue.add(File)
queue: max 2 in flight ── postMessage({id, name, buffer}, [buffer]) ──►
                                    identify → recover → repair → verify → (salvage)
                         ◄── {type:'progress', id, stage, pct}
                         ◄── {type:'result', id, outcome, findings[], output:{bytes, name, mime}|null, detected}
ui.render(row)
download: new Blob([bytes]) → URL.createObjectURL → <a download> click → revoke after 60s
Download all: fflate.zip (async) on main thread or worker → one zip
```
- Pool of 2 workers. Each file is transferred (not copied) as an ArrayBuffer.
- If a file is over 200 MB, reject it before reading, with the copy from §10.4.
- Wrap each file's work in try/catch inside the worker. An unexpected exception gives the outcome **Could not repair** with finding `INTERNAL_ERROR` ("Seam hit an unexpected error while processing this file. The original is unchanged."). Log the stack with `console.error` only. One bad file must never stop the batch.
- Per-file time budget: 120 s. If it runs over, terminate and replace that worker, and report `TIMEOUT`.

---

## 7. Repair pipeline (the core, follow exactly)

### 7.0 Stage weights for progress
identify 5 · zip 30 · xml 30 · package 20 · verify 10 · write 5.

### 7.1 Identify (`identify.js`)
Read the bytes. **Ignore the extension until the end.**
1. Length 0, or every byte `0x00` (check fully up to 64 MB, then sample 4096 evenly spaced offsets) → `EMPTY`.
2. Starts with `D0 CF 11 E0 A1 B1 1A E1` (CFB):
   - Search for the UTF-16LE string `EncryptedPackage` → `ENCRYPTED_OOXML`.
   - Otherwise UTF-16LE `WordDocument` → `LEGACY_DOC`, `Workbook` or `Book` → `LEGACY_XLS`, `PowerPoint Document` → `LEGACY_PPT`, anything else → `CFB_UNKNOWN`.
3. Starts with `PK\x03\x04`, or `PK\x05\x06`, or `PK\x07\x08` (spanned marker) → `ZIP`.
4. `%PDF` → `PDF`. `{\rtf` → `RTF`. After optional BOM/whitespace, `<html`/`<!DOCTYPE html` (case-insensitive) → `HTML`. `<?xml` that contains `<w:document` or `pkg:package` → `FLAT_OPC_XML` (report as unsupported in v1). PNG/JPEG/GIF magic → `IMAGE`.
5. Otherwise search the first 1 MB for `PK\x03\x04`. If found at offset > 0 → `ZIP` with `prefixGarbage = offset` (finding `ZIP_PREFIX_DATA`).
6. Otherwise search the whole file for `PK\x03\x04` or `PK\x01\x02`. If found → `ZIP` (damaged start). If not → `UNKNOWN`.
7. Anything other than `ZIP` → stop and return the matching §9 outcome. No output.

### 7.2 Strict ZIP read (`zip-read.js`)
1. Find EOCD `PK\x05\x06` by scanning backwards through the last 65,557 bytes. If a ZIP64 EOCD locator `PK\x06\x07` sits just before it, read the ZIP64 EOCD.
2. Read the central directory. For each entry: go to the local header offset (+ prefixGarbage if detected), check signature `PK\x03\x04`, and check the name matches.
3. Supported compression methods: 0 (stored) and 8 (deflate). Others → entry `UNSUPPORTED_METHOD` (kept as raw bytes if non-XML, otherwise counted as lost).
4. Decompress with `fflate.inflateSync` and compare CRC-32 with the central directory value.
5. If **every** entry passes → `zipState = 'intact'` and go to 7.4. If anything fails (no EOCD, bad offsets, CRC errors, bad CD) → go to 7.3 and keep the strict results for merging.

### 7.3 ZIP recovery scan (`zip-recover.js`)
1. Scan the whole buffer linearly for `PK\x03\x04`. At each hit, parse the local header (30 bytes + name + extra). Reject the hit if the name length > 1024, the name isn't valid UTF-8/CP437, or the method is not 0/8. Then carry on scanning from offset+1.
2. Work out where the entry's data ends:
   - If general-purpose bit 3 is **clear** and compressedSize > 0 and fits inside the buffer: data = `[dataStart, dataStart+compressedSize)`.
   - Otherwise (bit 3 set, sizes zero, or the size runs past the end of the buffer): find the next of `PK\x07\x08`, `PK\x03\x04`, `PK\x01\x02` or `PK\x05\x06` after dataStart. Try that end point. If inflation fails or the CRC doesn't match, try the next candidate signature, up to 16 candidates. If a `PK\x07\x08` descriptor follows, read the CRC/sizes from it.
   - If the buffer ends first: **truncated entry**.
3. Decompressing:
   - Stored: take the bytes as they are (truncated means a prefix).
   - Deflate: use the streaming `fflate.Inflate`. Push the data in 64 KB chunks and collect output in `ondata`. If it throws partway, **keep everything produced so far** and mark the entry `partial` with `recoveredBytes`. If the input ends without the final block, also `partial`.
4. Classify each entry: `ok` (CRC matches), `crcMismatch` (inflated fully but CRC differs: keep it, XML will be checked, report possible damage), `partial`, `unreadable` (0 bytes).
5. Normalise names: `\` → `/`, strip a leading `/`, collapse `./`. Reject `..` segments (drop them and report). Duplicate names: prefer `ok` over `crcMismatch` over `partial`. On a tie, keep the later entry.
6. Merge with the strict results from 7.2: for each name, use the better of the two.
7. Findings: `ZIP_DIRECTORY_REBUILT` (if 7.3 was needed), `ZIP_ENTRY_TRUNCATED` (part, percentage recovered when the size is known), `ZIP_ENTRY_CRC` (part), `ZIP_ENTRY_UNREADABLE` (part).

### 7.4 Classify package
Main part, in priority order:
1. Look in `_rels/.rels` (if it parses) for a relationship of type `.../officeDocument` and use its target.
2. Otherwise check whether these exist: `word/document.xml` → DOCX, `xl/workbook.xml` → XLSX, `ppt/presentation.xml` → PPTX.
3. Otherwise use the original extension and look for any part under `word/`, `xl/` or `ppt/`.
4. Otherwise → outcome **Could not repair**, finding `NO_MAIN_PART` ("The main document part is missing, so there is no content to rebuild."). Try salvage (§8.6) over all XML parts first. If any text comes out, the outcome is **Salvaged**.
Macro-enabled if `vbaProject.bin` exists under the main folder or the `[Content_Types].xml` main type has `macroEnabled`. Pick the output extension from the format + macro flag. If it differs from the input extension → finding `EXTENSION_CORRECTED`.

### 7.5 XML repair (`xml-clean.js`, `xml-repair.js`)
Applies to every part ending in `.xml` or `.rels` (plus `.vml`).
0. **Decode.** UTF-8 BOM → strip. UTF-16 LE/BE BOM → decode as UTF-16 and re-encode as UTF-8 (finding `XML_REENCODED`; also fix the `encoding=` attribute in the declaration). Otherwise decode as UTF-8 with `fatal:false`. If any U+FFFD was produced → finding `XML_INVALID_BYTES`.
1. **Character cleaning** (always run, report only if something changed): remove characters not allowed in XML 1.0 (`\x00-\x08 \x0B \x0C \x0E-\x1F`, lone surrogates, `\uFFFE \uFFFF`). Remove numeric character references to those (`&#1;`, `&#x1F;`, …). Replace `&` not followed by `name;` / `#\d+;` / `#x[0-9a-fA-F]+;` with `&amp;`. Finding `XML_CHARS_REMOVED` (count).
2. **Validate** with DOMParser. If well-formed → done.
3. **Tolerant tokenizer repair** (only if step 2 failed). Hand-written state machine over the string. Tokens: XML declaration, comment, CDATA, processing instruction, start tag, end tag, empty tag, text. Rules:
   - Keep a stack of open element qNames.
   - End tag matching the top → pop. End tag matching something deeper → emit closes for the elements in between (count as `autoClosed`), then pop. End tag matching nothing → drop it (`strayClosed`).
   - Start tag with duplicate attributes → keep the first (`dupAttrs`). Unquoted attribute value → wrap in `"` (`quotedAttrs`). A `<` inside an attribute value → `&lt;`.
   - Unterminated comment/CDATA/PI at EOF → drop it.
   - **Truncation**: if the input ends inside a tag, cut back to the last complete `>`. Then emit closing tags for the whole stack in reverse order. Record `truncatedAt` = character offset ÷ the original length (only meaningful if the part was `partial`).
   - Content after the root element closes → drop it (`trailingContent`).
4. Validate again with DOMParser. If it is still broken → the part is `xmlUnrecoverable`.
5. Findings: `XML_REPAIRED` (part, counts), `XML_TRUNCATED_CLOSED` (part, "content after this point was lost"), `XML_UNRECOVERABLE` (part).
6. **MUST NOT** reorder elements, change attribute values (except escaping), or touch namespaces.

### 7.6 Package graph (`package.js`)
Use the constants in `constants.js`. They must contain at least the following, written exactly:

```
CT_MAIN = {
 docx:  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
 docm:  'application/vnd.ms-word.document.macroEnabled.main+xml',
 xlsx:  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
 xlsm:  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
 pptx:  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
 pptm:  'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml' }
CT_DEFAULTS = { rels:'application/vnd.openxmlformats-package.relationships+xml', xml:'application/xml',
 png:'image/png', jpeg:'image/jpeg', jpg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', tiff:'image/tiff', tif:'image/tiff',
 emf:'image/x-emf', wmf:'image/x-wmf', svg:'image/svg+xml', bin:'application/vnd.openxmlformats-officedocument.oleObject',
 vml:'application/vnd.openxmlformats-officedocument.vmlDrawing', mp4:'video/mp4', mp3:'audio/mpeg', wav:'audio/wav' }
REL_OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
REL_CORE       = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
REL_EXT        = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'
```
Plus an override table that maps path patterns to content types for the common parts: styles, numbering, settings, fontTable, webSettings, theme, header/footer, footnotes/endnotes, comments, worksheets, sharedStrings, xl/styles, drawings, charts, slides, slideLayouts, slideMasters, notesSlides, presProps, viewProps, tableStyles, core.xml, app.xml, vbaProject.bin (`application/vnd.ms-office.vbaProject`). Use the official ECMA-376 / MS-OFFCRYPTO names. If you are unsure of one, ask; don't guess.

Steps:
1. **`[Content_Types].xml`**: parse it (after 7.5). If it is missing or unrecoverable → rebuild from scratch (finding `CT_REBUILT`). Then always: make sure Defaults exist for `rels` and `xml` and for every extension present among non-XML parts. Make sure the main part Override has the correct `CT_MAIN`. Remove Overrides whose part doesn't exist (`CT_OVERRIDE_REMOVED`). Add Overrides for known parts that have no type (`CT_OVERRIDE_ADDED`). Parts with an unknown type and no matching Default → leave them alone and record finding `CT_UNKNOWN_PART` (noted).
2. **`_rels/.rels`**: if missing/unrecoverable → rebuild with officeDocument → main part, plus core/app if those parts exist (`ROOT_RELS_REBUILT`). If it exists, make sure the officeDocument relationship points to the real main part.
3. **Every `.rels`**: resolve each internal target relative to the source part's folder (handle `../`, absolute `/`). If the target is missing → remove the Relationship (`REL_REMOVED`, noted with target). Duplicate Ids → rename the later ones to `rIdSeamN` **only** if no XML part refers to the old id. Otherwise keep the first and drop the duplicate (report it).
4. **Orphaned rels files** (a `.rels` whose source part is missing) → drop them (`REL_FILE_REMOVED`).
5. Track every removed relationship id per source part. The format rules (7.7) use this list to clean up dangling `r:id`/`r:embed` references.

### 7.7 Format rules (`formats/*.js`)
General rule: **remove what is broken. Only add the minimum needed for the file to be valid. Report everything.**

**DOCX**
- `word/document.xml` must exist and be well-formed, otherwise → salvage.
- Root must be `w:document` containing `w:body`. If `w:body` is missing → wrap the existing children of the root in `w:body` (`DOCX_BODY_ADDED`).
- Elements whose `r:id` / `r:embed` / `r:link` refer to a removed relationship: for `a:blip` inside `w:drawing`, remove the whole enclosing `w:drawing` run content (`DOCX_IMAGE_REMOVED`, loss). For `w:hyperlink`, unwrap it (keep the child runs; `DOCX_LINK_REMOVED`). For header/footer references (`w:headerReference`/`w:footerReference`), remove the reference element (`DOCX_HEADER_REF_REMOVED`).
- If `styles.xml`, `numbering.xml`, `settings.xml` or `fontTable.xml` exist but have no relationship from document.xml.rels → add the relationship (`DOCX_REL_ADDED`).
- `w:numId` references to a missing numbering part: do not fix, record as `DOCX_NUMBERING_MISSING` (noted: "List formatting may look different.").
- Never add `w:sectPr`. Word uses defaults.

**XLSX**
- `xl/workbook.xml` must be well-formed and contain `sheets`, otherwise → salvage.
- Every `<sheet r:id>` must resolve to an existing, well-formed worksheet part. If not → remove the `<sheet>` element (`XLSX_SHEET_REMOVED`, loss, name of the sheet). Remove `definedName`s whose `localSheetId` points at a removed sheet, and re-index `localSheetId` for the sheets that remain (`XLSX_NAMES_ADJUSTED`).
- If no sheets remain → salvage.
- Make sure the `<sheet>` `name` values are unique (case-insensitive) and at most 31 chars. Fix by adding the suffix ` (2)` (`XLSX_SHEET_RENAMED`).
- **Always** remove `xl/calcChain.xml` plus its relationship and override if present (`XLSX_CALCCHAIN_REMOVED`, noted: "Excel rebuilds the calculation chain on open."). It is safe and fixes a very common error.
- `sharedStrings.xml`: count the `<si>` elements as N. Set `uniqueCount=N`. Remove `count` (optional attribute) (`XLSX_SST_COUNTS`). In every worksheet, a cell `<c t="s">` whose `<v>` is ≥ N or not an integer → remove the `<v>` and the `t` attribute (`XLSX_CELL_CLEARED`, loss, count per sheet).
- Worksheet `<dimension>` is optional → remove it if the sheet was repaired (`XLSX_DIMENSION_REMOVED`, noted).
- Drawings/images with missing targets: remove the `<drawing>` element from the sheet (`XLSX_DRAWING_REMOVED`, loss).

**PPTX**
- `ppt/presentation.xml` must be well-formed, otherwise → salvage.
- `p:sldIdLst/p:sldId` with an unresolvable `r:id` or a malformed slide part → remove it (`PPTX_SLIDE_REMOVED`, loss, slide number). `sldId@id` must be unique and in 256..2147483647. Renumber when needed (`PPTX_SLIDE_IDS`).
- `p:sldMasterIdLst` must have at least one valid entry. If none → salvage.
- Each slide's rels must contain exactly one valid slideLayout relationship. If it is missing/broken → point it to the first layout of the first master (`PPTX_LAYOUT_RELINKED`, noted). If there are no layouts → salvage.
- `a:blip r:embed` pointing to a removed relationship → remove the enclosing `p:pic` (`PPTX_IMAGE_REMOVED`, loss).
- If no slides remain but masters are valid → keep it as a valid empty presentation, outcome **Partially repaired**, and also offer salvage text if any slide XML was partly readable.

**Minimal skeleton parts Seam may create (and nothing else):** `[Content_Types].xml`, `_rels/.rels`, missing relationships to parts that exist, a `w:body` wrapper. Never create styles, themes, masters, layouts or sheets.

### 7.8 Verify (`verify.js`)
Run on the **output bytes**, using the same code as 7.2, in strict mode:
1. The ZIP parses strictly, every CRC matches, and `[Content_Types].xml` is the first entry.
2. Every `.xml`/`.rels` part is well-formed (DOMParser).
3. Every internal relationship target exists.
4. Every part has a content type (Default or Override).
5. The main part exists with the correct content type, and the format rules' invariants hold (DOCX body exists; XLSX ≥ 1 sheet resolves; PPTX ≥ 1 master resolves).
Every check passes → the output is eligible for **Repaired / Partially repaired**. Any check fails → finding `VERIFY_FAILED` (with the check number), discard the output, go to salvage.

### 7.9 Write (`zip-write.js`)
- `fflate.zipSync` with `[Content_Types].xml` first, then `_rels/.rels`, then the rest in original order.
- XML parts: deflate level 6. Already-compressed media (png, jpeg, gif, mp4, mp3): store (level 0).
- Keep the original modification times if known, otherwise use the current time.
- No ZIP comment. No extra fields.

---

## 8. Additional behaviour

### 8.1 Intact files
If 7.2 passed, every XML part is well-formed, and 7.6/7.7 found nothing to change → outcome **No problems found**. **No output file** is produced. Copy: §10.3. Never re-zip an intact file just to look useful.

### 8.2 Batch
- Files are queued in the order they were dropped. Duplicates (same name + size + lastModified) are ignored, with a single line under the drop zone: "Skipped 1 duplicate file."
- **Download all** is enabled once at least one output exists. It zips only the outputs (repaired, partial, salvaged), using the original base names. Name collisions get ` (2)`.
- **Clear** empties the list, revokes object URLs, and terminates and recreates the workers. No confirmation dialog, because the originals are untouched.

### 8.3 Errors at the input level
- Folder dropped → §5.4 invalid drag copy.
- File > 200 MB → row outcome **Not processed**: "This file is larger than 200 MB. Seam processes files in memory, and very large files can exceed browser limits."
- More than 50 files → accept the first 50, then one line: "Only the first 50 files were added. Add the rest after these finish."

### 8.4 Report export (`report.js`)
Plain text, UTF-8, LF line endings:
```
Seam repair report
File: Budget.xlsx (380,112 bytes)
Detected: Excel workbook (.xlsx)
Outcome: Partially repaired
Checked: 2026-11-14 14:03 (local time)

Lost
- Sheet "Q3" was removed because its data part was unreadable. [xl/worksheets/sheet3.xml]

Repaired
- Rebuilt the ZIP directory from 41 recovered entries.
- Removed 3 relationships pointing to missing parts. [xl/_rels/workbook.xml.rels]

Noted
- Removed the calculation chain. Excel rebuilds it on open. [xl/calcChain.xml]

Output: Budget (repaired).xlsx — Passed structural checks.
Open the file and check its contents before relying on it.
```

### 8.5 Privacy line
Show this under the headline, always: "Files are processed on this device and never uploaded."

### 8.6 Salvage (`salvage.js`)
Used only when the structural repair can't produce a verified output, or when the main part is missing.
- Scanner: a regex/tokenizer pass over the *raw decoded text* of the relevant parts (broken XML is fine here).
  - DOCX: in document order, collect the text of `<w:t>` / `<w:t ...>` elements. Start a new paragraph at each `<w:p>` / `<w:p ` start. `<w:tab/>` → tab. `<w:br/>` → newline. Decode the 5 XML entities and numeric refs.
  - XLSX: read sharedStrings (best effort) into an array. For each worksheet, read `<c r="A1" ... t="..."><v>…</v>` / `<is><t>…</t></is>` and resolve values (s → shared string, inlineStr, str, b, n, e). Formulas are dropped (we keep cached values).
  - PPTX: for each slide in name order (slide1, slide2, …), collect `<a:t>` text, with a new line per `<a:p>`.
- Output:
  - DOCX → a new minimal `.docx` with one `w:p` per paragraph and no styles. Name `<base> (salvaged text).docx`.
  - XLSX → a new minimal `.xlsx` with one sheet per recovered worksheet, values only, as inline strings / numbers. Name `<base> (salvaged text).xlsx`.
  - PPTX → a new minimal `.docx` with a heading paragraph "Slide N" (bold run) and then the text. Name `<base> (salvaged text).docx`.
  - The minimal documents are built by `tests/fixtures.js`-style builders in `salvage.js`. They must pass §7.8.
- If zero characters were recovered → no output, outcome **Could not repair**.
- Report finding `SALVAGE_TEXT_ONLY` (loss): "Only text could be recovered. Formatting, images, formulas and layout were not kept."
- The report panel shows a read-only preview of the first 600 characters in mono, `--paper` background, max-height 160 px, scrollable.

---

## 9. Outcomes, findings and severity

### 9.1 Outcomes (exactly these seven labels, decided in this order)

| # | Outcome | Condition | Badge colour | Output |
|---|---|---|---|---|
| 1 | **Not supported** | identify ≠ ZIP (encrypted, legacy, PDF, etc.) | neutral | none |
| 2 | **Not processed** | input-level rejection (size) | neutral | none |
| 3 | **No problems found** | §8.1 | ok (outline style: tint bg, no fill dot, hollow ring) | none |
| 4 | **Repaired** | verify passed AND zero `loss` findings | ok | repaired file |
| 5 | **Partially repaired** | verify passed AND ≥ 1 `loss` finding | partial | repaired file |
| 6 | **Salvaged text** | structural failed, salvage produced ≥ 1 char | salvage | salvaged file |
| 7 | **Could not repair** | everything else (incl. INTERNAL_ERROR, TIMEOUT) | fail | none |

"Not supported" and "Not processed" are input states, not repair results. Implement all seven labels. Do not add any others.

`crcMismatch` entries that were kept count as `loss` ("may contain damaged data"). So a file with a CRC mismatch is **never** "Repaired". It is at best "Partially repaired". This is deliberate.

### 9.2 Severity
- `loss`: some content is or may be gone. Colour `--fail`.
- `repaired`: a structural fix with no content loss. Colour `--ok`.
- `noted`: neutral information. Colour `--neutral`.

### 9.3 Finding object
```js
{ code: 'ZIP_ENTRY_TRUNCATED', severity: 'loss', part: 'word/document.xml',
  data: { pct: 82 }, text: '<rendered from copy.js template>' }
```
Every `code` has a template in `copy.js` → `findings`. A test checks that every code the core emits has a template (§12.4).

---

## 10. Copy (put in `js/copy.js`, use verbatim)

### 10.1 Voice rules
- Quiet, exact, adult. Short declarative sentences. Present or past tense. Second person only when telling the user to act ("Open the file and check…").
- Name what happened and where. Use numbers. No adjectives that judge ("severely", "badly", "great").
- No greetings, encouragement, apologies, jokes, rhetorical questions, exclamation marks or emoji.
- Say "can't" plainly. Don't soften it with "unfortunately".

### 10.2 Fixed UI strings
| Key | Text |
|---|---|
| title | Seam |
| headline | Repair damaged Word, Excel and PowerPoint files. |
| privacy | Files are processed on this device and never uploaded. |
| drop.idle | Drop .docx, .xlsx or .pptx files here |
| drop.or | or |
| drop.button | Choose files |
| drop.over | Release to add files |
| drop.compact | Add more files |
| drop.folder | Folders aren't supported. Drop files instead. |
| summary | {n} files · {r} repaired · {p} partially repaired · {s} salvaged · {f} could not be repaired (omit zero groups; "1 file") |
| btn.downloadAll | Download all |
| btn.clear | Clear |
| btn.download | Download repaired file |
| btn.downloadSalvage | Download salvaged text |
| btn.copyReport | Copy report |
| btn.saveReport | Save report (.txt) |
| copied | Copied |
| status.queued | Queued |
| status.working | Checking |
| link.scope | What Seam can repair |
| footer | Open source · MIT licence · Nothing leaves your device |
| verify.ok | Passed structural checks. |
| verify.advice | Open the file and check its contents before relying on it. |

### 10.3 Summary sentence per outcome
- No problems found: "No structural problems found. No changes were made."
- Repaired: "Repaired {k} structural problems. No content loss was detected."
- Partially repaired: "Repaired the file structure. Some content could not be recovered. See Lost below."
- Salvaged text: "The file structure could not be rebuilt. Text was recovered into a new file."
- Could not repair: "This file could not be repaired. {reason}"
- Not supported / Not processed: the §10.4 sentence.

### 10.4 Detection sentences
- ENCRYPTED_OOXML: "This file is password-protected. Seam can't open encrypted files. If you know the password, open it in Office and save an unprotected copy, then try again."
- LEGACY_DOC/XLS/PPT: "This is an older binary Office file ({ext}). This version of Seam only repairs .docx, .xlsx and .pptx files."
- CFB_UNKNOWN: "This is a Microsoft compound file but not a recognised Office document."
- PDF / RTF / HTML / IMAGE: "This file is a {type}, not an Office document. Its extension may be wrong."
- FLAT_OPC_XML: "This is a single-file XML Office document. This format isn't supported in this version."
- EMPTY: "The file contains no data. Every byte is empty, which usually means the contents were never written. It can't be recovered from this file."
- UNKNOWN: "Not recognised as an Office document. No ZIP structure was found."
- Over size: §8.3 text.

### 10.5 "What Seam can repair" sheet content (verbatim)

**What Seam can repair**

Seam repairs the structure of modern Office files (.docx, .xlsx, .pptx and their macro-enabled versions). These files are ZIP archives of XML parts. Most damage happens to that structure.

**Usually repairable**
- Files cut short by an interrupted download, copy or save. Content before the cut is kept.
- A damaged or missing ZIP directory.
- Extra data in front of the file.
- XML with invalid characters, unclosed elements or broken escaping.
- Missing or wrong content types and internal links.
- Excel calculation chain errors and shared string mismatches.
- Wrong file extension.

**Sometimes repairable**
- Files with damaged data in the middle. Seam keeps undamaged parts and tells you which parts were affected.
- Files where only text can be recovered. Seam puts the text into a new file and says so.

**Not repairable**
- Password-protected files.
- Older .doc, .xls and .ppt files (not supported in this version).
- Files overwritten with zeros or other data.
- Files encrypted by ransomware.
- Content that is not in the file anymore. Seam can't restore lost data, only what is still there.

**How to read the result**
"Passed structural checks" means the repaired file is internally consistent. It does not guarantee every element looks the way it did. Open the file and check it.

**Privacy**
Everything happens in this browser tab. The page has no network access to send files anywhere. Seam is open source, so you can check this.

---

## 11. `index.html` requirements
- `<html lang="en">`, `<meta charset="utf-8">`, viewport meta, CSP meta (§3.1), `<title>Seam — repair damaged Office files</title>`, meta description using the headline + privacy line.
- `<link rel="icon" href="brand/favicon.svg" type="image/svg+xml">`.
- CSS order: tokens.css, fonts.css, app.css. One `<script type="module" src="js/main.js">`. **No inline scripts, no inline styles** (the CSP forbids them).
- Semantic landmarks: `header`, `main`, `footer`. The sheet is a `<dialog>`.

---

## 12. Testing (you MUST build and run this)

### 12.1 Harness
`tests/index.html` loads `tests/runner.js`, which imports every `*.test.js`, runs them, and logs one line per test (`PASS name` / `FAIL name: reason`) and a final line `RESULT pass=N fail=M`. Run it with **PlaywrightConsoleCapture** (capture_duration up to 30). A phase is only complete when `fail=0`.

### 12.2 Fixtures (`tests/fixtures.js`)
Build valid minimal documents in memory with fflate:
- `docx()` – 3 paragraphs, styles.xml, one PNG image (a 1×1 PNG built from bytes), one hyperlink, core.xml.
- `xlsx()` – 2 sheets ("Data", "Notes"), sharedStrings with 5 strings, one formula with a cached value, calcChain.xml.
- `pptx()` – 1 master, 2 layouts, 3 slides with text, one image on slide 2.
- `docm()` – docx plus a dummy `word/vbaProject.bin` (random bytes, fixed seed) and the macro content types.
The fixtures themselves must pass §7.8 (test this).

### 12.3 Corruptors (`tests/corrupt.js`, deterministic, seeded PRNG)
| id | Corruption | Expected outcome |
|---|---|---|
| C1 | Truncate at 50%, 75%, 90%, 99% | Partially repaired or Salvaged text (never Repaired), output verifies |
| C2 | Delete the EOCD + central directory | Repaired, all parts byte-identical |
| C3 | Prepend 512 random bytes | Repaired, finding ZIP_PREFIX_DATA |
| C4 | Remove `[Content_Types].xml` | Repaired, CT_REBUILT |
| C5 | Remove `_rels/.rels` | Repaired, ROOT_RELS_REBUILT |
| C6 | Inject `\x01\x0B` and a bare `&` into document.xml / sheet1.xml / slide1.xml | Repaired, XML_CHARS_REMOVED |
| C7 | Cut the main XML part mid-tag (re-zip so the ZIP is valid) | Partially repaired, XML_TRUNCATED_CLOSED |
| C8 | Delete the image part, keep the relationship | Partially repaired, REL_REMOVED + *_IMAGE_REMOVED |
| C9 | xlsx: shared string index 999 in a cell | Partially repaired, XLSX_CELL_CLEARED |
| C10 | xlsx: delete sheet2.xml | Partially repaired, XLSX_SHEET_REMOVED "Notes" |
| C11 | Flip 64 bytes in the middle of a deflate stream of the main part | Partially repaired or Salvaged text, never Repaired |
| C12 | Main part replaced with zeros | Salvaged text or Could not repair |
| C13 | Whole file zero-filled | Not supported/EMPTY |
| C14 | CFB header + `EncryptedPackage` UTF-16 string | Not supported/ENCRYPTED_OOXML |
| C15 | docx renamed to .xlsx | Repaired or No problems found + EXTENSION_CORRECTED, output .docx |
| C16 | Valid file, untouched | No problems found, no output |
| C17 | docm with vbaProject.bin, then C2 | Repaired, vbaProject.bin byte-identical, output .docm |
| C18 | UTF-16 encoded document.xml | Repaired, XML_REENCODED |
Run every applicable corruptor against docx, xlsx and pptx. For each case assert: the expected outcome class; that outputs (if any) pass §7.8; that untouched media parts are byte-identical; and that no exception escaped.

### 12.4 Static guard tests
- **Copy lint:** load `copy.js` and assert that no string contains `!`, an emoji (`/\p{Extended_Pictographic}/u`), or any banned word from §3.3 (case-insensitive, whole word).
- **Finding coverage:** every finding code in a hard-coded list of the codes in this spec has a template in `copy.js`.
- **No network:** fetch the source text of every `js/**/*.js` file (allowed in tests only, same origin) and assert there is no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `import('http`.
- **CSP present:** fetch `index.html` and assert the CSP meta contains `connect-src 'none'`.

### 12.5 Visual checks (every UI phase)
PlaywrightScreenshot desktop **and** mobile for: empty state; a batch of 3 with mixed outcomes (add a dev-only `?demo=1` query that injects 3 fake results; it must never run without that query param); an expanded report; and the scope sheet open. Questions to ask: overlapping text? Seam line visible only in the header and in progress? Badges readable? Any exclamation marks or emoji visible?

---

## 13. Phases and acceptance criteria

**P0 — Scaffold & identity**
Files from §4 (empty modules allowed), tokens copied, fonts vendored, fflate vendored, `index.html` with header/headline/privacy/drop zone/footer, scope sheet with §10.5 content.
✅ Screenshot matches §5.2 / §5.3. Console clean. The CSP blocks nothing that is needed (no CSP violations logged).

**P1 — Identify + queue + UI rows**
identify.js, worker pool, queue, rows with progress and outcome badges for Not supported / Not processed. Stub everything else as Could not repair "Not implemented" **only while in development**.
✅ C13, C14 pass. Batch of 10 fake files renders correctly. Keyboard path works.

**P2 — Test harness, fixtures, corruptors**
✅ Fixtures pass §7.8 (implement verify.js now). Copy lint, no-network and CSP tests pass.

**P3 — ZIP strict + recovery**
✅ C2, C3, C16, C17 pass. C1 produces entries flagged as partial (pipeline can stop at Could not repair for now).

**P4 — XML repair**
✅ C6, C7, C18 pass on the XML level (unit tests on xml-repair with at least 25 hand-written broken strings, including nested truncation, stray closes, duplicate attrs, CDATA at EOF, entity mess).

**P5 — Package graph + format rules + write**
✅ C4, C5, C8, C9, C10, C15 pass end-to-end with downloads working.

**P6 — Salvage**
✅ C1 (all levels), C11, C12 pass. Salvage outputs pass §7.8.

**P7 — Report, polish, a11y, README**
Report panel, copy/save report, download all, demo mode, reduced motion, contrast checks, README complete (features, structure, how to run tests, honest-position paragraph §1.2, deviations, "Manual verification in Office: pending owner").
✅ Full suite `fail=0`. Desktop and mobile screenshots of all states reviewed.

Do not deploy. When P7 is done, tell the owner what passed, what is untested (real Office opening), and ask whether to deploy.

---

## 14. Definition of done
- [ ] All §12 tests pass with `fail=0`.
- [ ] No guardrail in §3 is broken (re-read §3 and tick each item in the README).
- [ ] Every user-facing string comes from `copy.js`.
- [ ] Screenshots reviewed on desktop and mobile for all states.
- [ ] README updated, including the remaining work and the owner's manual Office test checklist:
  1. Open 3 repaired files of each type in Microsoft Office (Windows or Mac) and in LibreOffice.
  2. Confirm no "We found a problem with some content" prompt appears for files marked Repaired.
  3. Report any file where Office still complains, with the Seam report attached.

## 15. Common mistakes to avoid (read before each phase)
1. Turning a CRC mismatch or a truncation into "Repaired". It must be **Partially repaired** at best.
2. Re-zipping intact files and calling it a repair.
3. Adding a CDN `<script>` or Google Fonts link "temporarily".
4. Writing friendly copy ("All done!", "Great news"). Use `copy.js` only.
5. Using regex to rebuild XML structure.
6. Generating placeholder content (dummy styles, empty sheets named "Sheet1") to make a file pass. Use salvage instead.
7. Silently dropping a relationship or element without a finding.
8. Putting work on the main thread so the UI freezes on a 100 MB file.
9. Nesting the download button inside the row's expand button.
10. Animating things outside the §5.6 list, adding a spinner, or making the seam line decorative elsewhere.
11. Claiming files were tested in Word.
12. Changing the icon, tokens, name or copy without asking.
