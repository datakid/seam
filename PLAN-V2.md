# Seam v2: build plan for Sonnet

**For:** the implementing model (Sonnet), working in `github.com/datakid/seam`.
**From:** the owner, via the planning pass.
**Source of truth:** this file, then v1 `PLAN.md` for anything this file does not change. Where they conflict, this file wins.

---

## 0. Rules for using this plan

- **MUST / MUST NOT** are hard rules. **SHOULD** is the default; if you depart from it, write the reason under "Deviations" in `README.md`.
- Build phases in order: **A, B, C**. Phases D, E and F are outlines only. Do not start them until the owner has re-planned them using the Phase A scoreboard.
- Every step ends with: the full v1 browser suite passing (`tests/` → `RESULT pass=N fail=0`), the new CI jobs green, and README updated.
- If you lose context, re-read this file in full before you continue.
- **Stop and ask the owner** if: a step cannot pass without breaking a guardrail; you want a runtime dependency; a licence is unclear; a judge cannot be installed; or a number in an exit gate cannot be reached.
- You cannot run Microsoft Office. **MUST NOT** claim any output was opened in Office.

### 0.1 Owner decisions that block work

| # | Decision | Blocks | If unanswered |
|---|---|---|---|
| 1 | Dev-only CI tooling (Node, LibreOffice, .NET, Playwright) while the app stays no-build | All of Phase A | Stop. Do not start. |
| 2 | Windows machine with Office available for `tools/office-judge.ps1` | A4.3 only | Build the script, mark the Office column "not run". |
| 3 | Genuinely damaged files for the wild set | A2 | Leave the wild set empty; the scoreboard says so. |
| 4 | Which Phase E items are wanted | Phase E | Not needed until after F re-plan. |
| 5 | Approve changing guardrail 17 (DOMParser as sole authority) | D6 only | Keep guardrail 17 as is. |

---

## 1. What the planning pass found in v1 source

These settle "check" items from `ROADMAP-V2.md`. Sources read: `README.md`, `PLAN.md` §3, `js/core/zip-recover.js`, `js/core/verify.js`. Other files were not read. Each item below that says **verify** must be confirmed by you with a failing test before you change the code.

| Item | Finding | Consequence |
|---|---|---|
| Inflate keeps partial output | **Yes.** `inflatePartial` streams fflate `Inflate` in 64 KB pushes, then replays the failing chunk in 96-byte pushes. Output before the error is kept, at roughly 96-byte resolution. Nothing after the first error is recovered. | Phase B1 adds resync after damage. It does not need to rebuild the "before the cut" path, but it SHOULD replace it so the resolution becomes exact. |
| Recovery scan | `recoverEntries` walks local headers (`PK\3\4`) forward. For data-descriptor entries it tries at most 16 later `PK` signatures (`MAX_CANDIDATES`) as possible ends. | A part containing more than 16 false `PK` hits before its true end, such as a stored ZIP inside an embedding, falls back to partial. **verify** with a fixture, then make the limit depend on size or switch to a central directory hint. |
| Compression methods | Only 0 (stored) and 8 (deflate). Encrypted flag and other methods give `unsupported`. | Fine for OOXML. Keep. |
| ZIP64 | `parseLocal` reads 32-bit sizes only and does not read the ZIP64 extra field. A `0xFFFFFFFF` size is treated as a real size. | Parts over 4 GB are out of scope, but some writers emit ZIP64 headers for small files (for example Java and .NET streaming writers). **verify** in `zip-read.js`; add ZIP64 extra-field reading in B3. |
| Local versus central disagreement | `mergeEntries` merges by lower-case name and ranks by state (`ok > crcMismatch > partial > unreadable > unsupported`), with ties going to the longer data from the second list. No check by CRC across copies. | B3 replaces this with checksum-first selection. |
| Verification | `verifyPackage` checks: ZIP strict read with `[Content_Types].xml` first; every XML part well-formed (DOMParser through the page); internal relationship targets exist; every part has a content type; main part present with the right type; docx has `body`, xlsx has at least one sheet that resolves, pptx has at least one master that resolves. | This is the single tier "Passed structural checks". It says nothing about schema, cell or slide rules. Phase A measures how often it is wrong; Phase C adds tiers. |
| Strict OOXML | Not read. **verify**: does `identify`/`package` accept `http://purl.oclc.org/ooxml/...` namespaces, or report them as broken? | If v1 damages Strict files, that is a Phase A bug, not Phase E. |

---

## 2. Guardrails for v2

All v1 guardrails (v1 `PLAN.md` §3) stay, with these changes:

1. **Dev and CI tooling may use anything** (Node, npm, .NET, LibreOffice, Python, Playwright). Nothing under `tools/`, `ci/` or `corpus/` may be imported by `index.html`, `js/` or `css/`. `static.test.js` MUST check this.
2. **Runtime stays:** plain ES modules, no build step, no framework, fflate the only third-party code. Generated data tables are committed as plain `.js` modules exporting objects (not `.json` imports; import attributes are not safe in every target browser).
3. **The approved label phrases change** with verification tiers (Phase C5). Until then, "Passed structural checks." stays the only phrase.
4. **Corpus files are not committed** unless their licence allows redistribution and the owner agrees. The repo holds manifests (URL, SHA-256, licence, producer, features) and fetch scripts.
5. **Wild-set files never go into git, CI logs or artifacts.** They are run only locally by the owner (`npm run score -- --wild <dir>`), and only the aggregate numbers are committed.

---

## 3. Repository additions (all phases A to C)

```
package.json              dev only: scripts, devDependencies (Playwright, diff, fast-xml-parser)
tools/
  corpus-fetch.mjs        downloads files in corpus/manifest/*.json, checks SHA-256
  corpus-gen/             python scripts that write producer files (python-docx, openpyxl, python-pptx)
  damage.mjs              seeded corruptor (A3)
  run-seam.mjs            runs the real js/core pipeline in headless Chromium on a directory
  judge-lo.sh             LibreOffice headless judge
  judge-oxml/             .NET 8 console app around OpenXmlValidator
  office-judge.ps1        owner-run Windows Office judge
  text-extract.mjs        pristine and output text extraction for recovery ratio
  score.mjs               joins all results into scoreboard.json and SCOREBOARD.md
  gen-schema-lite.mjs     Phase C3 generator
corpus/
  manifest/healthy.json   entries (shape in A1)
  manifest/README.md      sources and licences
  cache/                  .gitignored; fetched files
  damaged/                .gitignored; damage-lab output
results/
  scoreboard.json         committed, latest run
  SCOREBOARD.md           committed, human table, linked from README
  history/<date>.json     committed, one file per tagged run
.github/workflows/
  unit.yml                v1 browser suite in Chromium, Firefox, WebKit
  score.yml               corpus → damage → seam → judges → score (manual and weekly)
js/core/data/             Phase C tables (parts.js, ref-policy.js, schema-lite.js)
js/core/inflate-tolerant.js   Phase B1
tests/                    new test files listed per step
```

---

## 4. Phase A: Truth (ships alone)

**Goal:** a published, reproducible scoreboard that says how good Seam is on files it did not create.
**No repair logic changes in Phase A**, except fixes for false alarms and over-labelled outputs (A7), each with a test.

### A1. Healthy corpus

Target: 300 files, at least 80 per format family (docx/docm, xlsx/xlsm, pptx/pptm), plus as many templates and shows as appear naturally.

Sources, in order of preference. Settle the licence for each before adding it to the manifest; record it in `corpus/manifest/README.md`.

| Source | Licence (confirm before use) | Notes |
|---|---|---|
| Apache POI `test-data/` (document, spreadsheet, slideshow) | Apache 2.0 | Many producers and edge cases. Some files are intentionally broken: tag them `broken: true` and keep them out of the healthy set (they belong in the wild set). |
| Open XML SDK test assets (`dotnet/Open-XML-SDK`, test files folders) | MIT | Office-made files with charts, SmartArt, comments. |
| LibreOffice core QA data (`sw/qa/*/data`, `sc/qa/*/data`, `sd/qa/*/data`) | MPL 2.0 | Many are bug reproducers; same `broken` tagging rule. |
| Generated in CI by `tools/corpus-gen/` | Ours (MIT) | python-docx, openpyxl, python-pptx, LibreOffice `--convert-to` from ODF. Gives exact producer coverage. |
| govdocs1 subset | Public domain (US government) | Mostly old binary formats. Use only for the OOXML files it holds; optional. |

Manifest entry shape:

```json
{
  "id": "poi-sheet-0042",
  "url": "https://.../file.xlsx",
  "sha256": "…",
  "licence": "Apache-2.0",
  "family": "xlsx",
  "producer": "Excel 2016",
  "features": ["charts", "pivot", "comments"],
  "bytes": 183422,
  "broken": false
}
```

Producer is read from `docProps/app.xml` `Application` and `AppVersion` by `corpus-fetch.mjs`, not guessed. Features are detected from the part list (charts, pivotTables, comments, vbaProject.bin, diagrams, media/video, embeddings, any part over 10 MB).

Coverage gate (checked by `corpus-fetch.mjs --report`): each of Word, Excel, PowerPoint, LibreOffice, Google, Apple, WPS, python-docx/openpyxl/python-pptx, POI appears at least 5 times; each feature in the list above appears at least 3 times. Gaps are listed in `SCOREBOARD.md`, not hidden.

**Acceptance:** `npm run corpus` on a clean machine downloads, hash-checks and reports coverage; a changed hash fails the run.

### A2. Wild set

- `npm run score -- --wild <dir>` runs Seam and the judges on owner files locally. No pristine copy exists, so recovery ratio is not computed; only labels and judge verdicts.
- POI and LibreOffice files tagged `broken: true` form a public wild set and run in CI.

### A3. Damage lab (`tools/damage.mjs`)

Deterministic: `damage(bytes, kind, seed) → { bytes, meta }`. Same seed, same output. `meta` records offsets and lengths so the scoreboard can say which parts were hit.

| Kind | Model |
|---|---|
| `truncate` | cut at 10, 30, 50, 70, 90, 99 % of length |
| `zero512`, `zero4096` | one aligned zero block, 1 to 8 blocks long, placed in the middle third |
| `losttail` | last 1 to 64 KB replaced with zeros (keeps length) |
| `head` | first 512 or 4096 bytes overwritten with random bytes |
| `crlf` | every `0x0A` not preceded by `0x0D` becomes `0x0D 0x0A` (text-mode transfer) |
| `bitflip` | 1, 8 or 64 random bit flips |
| `insert` | 4096 random bytes inserted at an aligned offset |
| `dropblock` | one 4096-byte aligned block removed |
| `prefix`, `suffix` | an HTML error page (fixed template) added before or after |
| `concat` | two corpus files joined |
| `padzero` | truncated at 50–90 % then zero-padded to the original length |

Run matrix: every healthy file × every kind × 3 seeds. About 300 × 14 × 3 = 12,600 cases. CI SHOULD run a fixed 10 % sample on every push to `main` and the full matrix weekly and on tags.

**Acceptance:** `tests/damage.test.mjs` (Node) checks determinism, that `crlf` is reversible on a sample, and that `meta` offsets match the bytes changed.

### A4. Independent judges (CI only)

All judges run on GitHub Actions `ubuntu-latest`, except the Office judge.

1. **LibreOffice** (`tools/judge-lo.sh`): `soffice --headless --norestore --convert-to pdf` per file, with a 60 s timeout and a fresh user profile per batch. Verdict `load` if a non-empty PDF appears, `fail` otherwise. Also convert to the same OOXML format and record success; that catches files LibreOffice reads but cannot round-trip.
2. **Open XML SDK** (`tools/judge-oxml/`): .NET 8 console app using `DocumentFormat.OpenXml` (pin the version). Opens with `WordprocessingDocument/SpreadsheetDocument/PresentationDocument.Open(path, false)`, runs `OpenXmlValidator` (FileFormatVersions.Office2019), writes JSON: `{ opens: bool, errors: [{ id, part, path, description }] }`. Error IDs feed Phase C ordering. Confirm it runs headless on Linux in the first CI run; it SHOULD, since it does not need Office.
3. **Office** (`tools/office-judge.ps1`, owner only): COM automation, `DisplayAlerts` off. Word: `Documents.Open(path, ConfirmConversions:=false, ReadOnly:=true, OpenAndRepair:=false)`. Excel: `Workbooks.Open(path, CorruptLoad:=0)` (xlNormalLoad). PowerPoint: `Presentations.Open(path, ReadOnly, Untitled, WithWindow:=false)`. Verdict `open` / `fail` / `timeout` (90 s; kill the process). The owner must confirm on a real machine that a repair prompt shows up as an error or a hang and not as a silent repaired open; if it opens silently after repairing, the script MUST compare the open document's paragraph, sheet or slide count against Seam's inventory and mark a mismatch as `repaired-by-office`.
4. **Seam itself**: the label and findings from `run-seam.mjs`, which loads `js/core/pipeline.js` in headless Chromium through a small test page (the same worker path the app uses, so DOMParser behaviour is real).

### A5. Scoreboard (`tools/score.mjs`)

Per case: `{ file, family, producer, kind, seed, seamLabel, findings, judges: { lo, oxml, office }, textRecall, ms, peakMB }`.

- **textRecall**: text extracted from the pristine file and from Seam's output (`tools/text-extract.mjs`: `w:t`, `a:t`, shared strings plus inline strings plus cell values, in document order), compared with a token-level diff. Recall = matched tokens / pristine tokens. For salvage outputs, compare against the salvage text.
- **Baseline**: LibreOffice opening the damaged file directly, with its text extracted by converting to `.txt`/`.csv`. This answers "is Seam better than doing nothing with a free tool?".
- **peakMB**: from `performance.measureUserAgentSpecificMemory()` where available, otherwise `process.memoryUsage` of the browser process via Playwright CDP. Mark the method.

`SCOREBOARD.md` tables:

1. Healthy files: false alarms (label other than No problems found), by producer.
2. Damaged files by kind: label distribution, judge pass rate for outputs labelled Repaired, median textRecall, Seam versus baseline.
3. **Over-labels**: outputs labelled Repaired that any judge rejects. Listed per file.
4. Gaps: missing producers, features, browsers, Office not run.

### A6. Property tests (`tests/property.test.js`, runs in the browser suite)

Using the damage lab on the v1 fixtures plus 20 corpus files bundled into the test page by hash:

1. Never throws, never exceeds the time budget.
2. Idempotence: repairing an output labelled Repaired or No problems found gives No problems found.
3. Label never above evidence: a label of Repaired implies `verifyPackage(...).ok`; a Lost finding implies the label is not No problems found.
4. Original bytes unchanged after processing (compare a copy).

### A7. Fix what A exposes

Order of work after the first full run:

1. **False alarms on healthy files** to zero. Expect unfamiliar producers (Google, Apple, WPS, POI) to trip checks such as `[Content_Types].xml` order, single-quoted attributes (v1 known limit: `t="s"` only in double quotes), relative targets with `../`, absolute `/` targets, `mc:AlternateContent`, Strict namespaces.
2. **Over-labels** to zero: fix the repair, or make verification stricter so the label drops. Downgrading is allowed; hiding is not.
3. Each fix lands with a minimal fixture in `tests/` reproducing it (self-made fixtures are fine as unit tests).

### A8. Browsers

`unit.yml` runs the v1 suite through Playwright in Chromium, Firefox and WebKit. A browser-specific failure is fixed or documented in Known limits.

### Phase A exit

- Scoreboard committed and linked from README. README "Honest position" stays but the 100 MB/5 s claim is replaced by measured numbers.
- Healthy false alarms: **0**.
- Repaired outputs rejected by LibreOffice or Open XML SDK `opens == false`: **0**. (Validator *errors* are tracked, not gated, in A; they drive C.)
- v1 suite green in three engines.
- Tag `v2.0.0-a`. Deploy only with owner approval.

---

## 5. Phase B: Bytes

**Goal:** recover more from byte-level damage. Target damage kinds: `zero512`, `zero4096`, `bitflip`, `insert`, `dropblock`, `padzero`, `crlf`, `losttail`.

### B1. Tolerant inflater (`js/core/inflate-tolerant.js`, own code, no new dependency)

API:

```js
inflateTolerant(bytes, { maxOut, budgetMs }) → {
  data: Uint8Array,          // output; unknown bytes set to 0x00
  holes: [[start, end], …],  // output ranges whose content is unknown
  gaps:  [[bitStart, bitEnd], …], // input ranges that could not be decoded
  complete: boolean          // reached a final block with no gaps
}
```

Algorithm:

1. Decode normally (own decoder; RFC 1951). On error at input bit `e`, keep all output up to the last fully decoded symbol (exact, replaces the 96-byte replay).
2. **Resync:** from bit `e + 1` onward, try each bit offset as a block start, up to a search window (default 256 KB of input or budget):
   - Stored block (`BTYPE=00`): after byte alignment, `LEN == ~NLEN`. Strong test.
   - Dynamic block (`BTYPE=10`): HLIT ≤ 286, HDIST ≤ 30, code-length code is a complete or valid prefix code, literal/length and distance codes valid, symbol 256 has a code. Strong test.
   - Fixed block (`BTYPE=01`): weak; accept only if the following decode yields at least 2 KB of output that is ≥ 95 % printable UTF-8 or XML-plausible.
   - Candidate accepted when it decodes to the end of its block without error, and the next block header also parses.
3. **Unknown window:** after resync, back-references that reach before the resync point produce bytes marked as holes. Literals are known. This is the method used by parallel gzip decoders (pugz, Kerbiriou and Chikhi 2019; rapidgzip). Confirm the citations before writing them into the README.
4. Repeat from the next error. Mark the end `complete` only if a final block decodes and no gaps exist.
5. Memory: output capped at `maxOut` (from the local header's uncompressed size if sane, else 512 MB).

Tests (`tests/inflate.test.js`):

- Round trip against fflate on 200 random buffers and all fixture parts: identical output, `holes` empty.
- Each damage kind applied to a deflate stream of a 1 MB XML part: decoder never throws; known bytes match the pristine bytes at the same output offset after the resync point (check alignment by matching a 64-byte window); holes cover every mismatched byte.
- Performance: no damage, within 2× fflate on a 20 MB part in Chromium.

Wire-up: `zip-recover.js` `partialFrom` and `tryDecode` failure path call `inflateTolerant`. Entry gains `holes`. Keep fflate for the fast path (intact entries).

### B2. Holes in the XML layer

- Before decoding, each hole range is replaced with a sentinel run of U+FFFE-free private-use character U+E000 (encode as UTF-8). `xml-clean` MUST NOT strip it.
- `xml-repair` treats a sentinel run as damage: the text node or attribute value containing it is cut at the run; an element whose start tag contains a run is dropped with its subtree up to the next well-formed sibling; open elements are closed with the tolerant tree logic already used for truncation.
- Finding: `XML_HOLE_DROPPED` (Lost): "About N bytes in <part> could not be read; the content around them was removed." Add copy and severity in `copy.js`; copy lint applies.
- Text salvage also skips sentinel runs.

### B3. ZIP layer hardening

1. **ZIP64**: read the ZIP64 extended information extra field (0x0001) in local and central headers, and the ZIP64 end-of-central-directory record and locator.
2. **Entry selection when copies disagree** (local versus central, duplicate names): pick in this order: CRC matches the central directory CRC; CRC matches the local CRC; decodes complete; well-formed XML; longest output. Report `ZIP_ENTRY_CHOSEN` (Noted) when a choice was made.
3. **Central directory as a map**: when the central directory is intact but local data is damaged, use its offsets and sizes to bound each entry instead of scanning for `PK` candidates. Remove the fixed 16-candidate limit; scan within the bound.
4. **CRLF repair**: if the file fails strict read and replacing `0D 0A` with `0A` makes the central directory offsets line up, try that variant as a candidate; report `ZIP_CRLF_REVERSED` (Repaired).
5. **Shift detection**: for `insert` and `dropblock`, when central offsets are consistently off by a constant after some point, rebase them; report `ZIP_OFFSETS_REBASED`.

### B4. Orphan streams

Data with no usable local header (head overwritten, header in a zero block):

1. Scan the gap between known entries for deflate block starts (B1 test).
2. Decode; identify the part by content: XML root element and namespace mapped through the part registry (C1 lands a minimal version early: just root element → part kind → usual path); media by magic bytes (PNG, JPEG, GIF, EMF, WMF, MP4, BIN/CFB for vbaProject).
3. Name it at its usual path if that path is free and referenced by a relationship; otherwise `seam-recovered/partN.<ext>`, unreferenced, and reported.
4. Finding `ZIP_ORPHAN_NAMED` (Repaired) or `ZIP_ORPHAN_KEPT` (Noted).

### B5. Several copies

- UI: a row with an outcome below Repaired gets an "Add another copy" action. The worker receives several buffers for one job.
- Pipeline: recover entries from each copy; per part, select by B3.2 rules across copies. Report which copy each part came from (`MULTI_PART_FROM`, Noted).
- Test: the same file damaged by two different seeds must reach No problems found or Repaired with textRecall 1.0 when every part is intact in at least one copy.

### B6. Donor file

- UI: "Use a healthy file from the same source" on Partially repaired or Salvaged rows.
- Only non-content parts may be borrowed: styles, theme, numbering, fontTable, settings, webSettings, slide layouts and masters, table styles. Never document text, cells, slides, comments or media.
- Every borrowed part is a `DONOR_PART_BORROWED` finding (Noted), naming the part.

### Phase B exit (measured on the scoreboard, same seeds as Phase A)

- Median textRecall on `zero512`, `zero4096`, `dropblock`, `bitflip` up by at least **15 percentage points** over the Phase A run. If not reached, stop and report the numbers.
- `crlf` cases: at least **90 %** reach Repaired with textRecall ≥ 0.99.
- No regression: healthy false alarms 0, over-labels 0, no damage kind loses recall.
- Tag `v2.0.0-b`.

Owner decision, 2026-11-25: the +15 point median gate cannot be met, because median text recall was already 1.000 on every kind before Phase B. It is replaced by the share of outputs with recall of at least 0.99 and the Repaired count per kind, reported on the scoreboard, with no case losing more than 0.02 of recall against the end of Phase A unless the notes explain it. The `crlf` gate stays at 90 %.

---

## 6. Phase C: Rules

**Goal:** Excel and PowerPoint as deep as Word, driven by tables. Rule work is ordered by judge rejections, not by guesswork.

### C1. Part registry (`js/core/data/parts.js`)

```js
export const PARTS = [
  {
    kind: 'wordDocument',
    family: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    contentTypeAlt: ['application/vnd.ms-word.document.macroEnabled.main+xml'],
    relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
    relTypeStrict: 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
    path: 'word/document.xml',
    pathPattern: null,
    root: { ns: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', name: 'document' },
    source: ['package'],
    required: true,
    content: true
  },
  // … one row per part kind
];
```

Rows required at minimum: main parts of all three families (normal, macro, template, show variants), styles, numbering, settings, fontTable, webSettings, footnotes, endnotes, comments (classic and modern), header, footer, glossary, workbook, worksheet, chartsheet, sharedStrings, styles (xl), calcChain, table, pivotTable, pivotCacheDefinition, pivotCacheRecords, externalLink, drawing (xl), vmlDrawing, presentation, slide, slideLayout, slideMaster, notesSlide, notesMaster, handoutMaster, presProps, viewProps, tableStyles, theme, chart, chartStyle, chartColorStyle, diagram data/layout/style/colors/drawing, image, media (audio, video), oleObject, package (embedded workbook), activeX, customXml item and props, core/app/custom properties, thumbnail, vbaProject, vbaData, digital signature origin and signature, customUI.

`tests/parts.test.js` checks: every row has a unique `kind`; every relType resolves in both transitional and strict forms where both exist; every content type used in the v1 code appears in the table. Then replace v1 hard-coded maps with lookups in the registry, one module at a time, keeping the suite green.

### C2. Generic reference sweep (`js/core/ref-sweep.js` plus `js/core/data/ref-policy.js`)

For every XML part with relationships: every attribute in the relationships namespace (`r:id`, `r:embed`, `r:link`, `r:pict`, `r:dm`, `r:lo`, `r:qs`, `r:cs`, and any other attribute in that namespace) must name an existing relationship whose target exists, or be external.

Policy table:

```js
export const REF_POLICY = {
  'a:blip@r:embed':        { action: 'removeContainer', container: ['p:pic', 'pic:pic', 'xdr:pic'], loss: 'image' },
  'w:hyperlink@r:id':      { action: 'unwrap', loss: 'link' },
  'w:headerReference@r:id':{ action: 'remove', loss: 'header' },
  'xdr:graphicFrame//c:chart@r:id': { action: 'removeContainer', container: ['xdr:twoCellAnchor', 'xdr:oneCellAnchor', 'xdr:absoluteAnchor'], loss: 'chart' },
  'p:sldLayoutId@r:id':    { action: 'remove', loss: 'layout' },
  'tablePart@r:id':        { action: 'remove', loss: 'table' },
  // …
  '*':                     { action: 'removeContainer', container: 'nearestSafe', loss: 'unknown' }
};
```

Actions: `remove` (the element), `unwrap` (keep children), `removeContainer` (named ancestor), `placeholder` (only where a schema requires the element; insert the minimal valid element and report it). The `*` fallback removes the nearest ancestor whose removal is schema-safe according to C3; if none, the label cannot be Repaired.

Each removal is a finding with the loss type. This replaces the v1 hand-written cases; keep their tests as regression tests.

### C3. Schema-lite (`tools/gen-schema-lite.mjs` → `js/core/data/schema-lite.js`)

- Input: ECMA-376 Part 1 transitional and strict XSDs, 5th edition. Confirm the download source and that the generated table may be shipped under MIT (the table is derived facts, but record the source).
- Output, per element in the main part types:

```js
export const SCHEMA = {
  'w:body': { seq: [['w:p','w:tbl','w:sdt','w:customXml', /* block-level choice */ ], ['w:sectPr?']], attrs: {} },
  'w:tc':   { seq: [['w:tcPr?'], ['+block']], mustEnd: 'w:p' },
  'x:row':  { attrs: { r: 'uint', spans: 'string', s: 'uint', customFormat: 'bool' }, seq: [['x:c*'], ['x:extLst?']] },
  // …
};
```

- Size budget: the shipped file SHOULD be under 300 KB uncompressed. Cover only: document, styles, numbering, footnotes/endnotes, comments, header/footer; workbook, worksheet, sharedStrings, styles (xl); presentation, slide, slideLayout, slideMaster; chart; drawingML shapes used inside them.
- Uses: (a) closing cut-off trees with children in valid order and required children present; (b) a `schemaLite` verification check (C5).
- Pass through untouched: unknown namespaces, `mc:AlternateContent` (validate the `mc:Fallback` branch only), `extLst`. Prefixes listed in `mc:Ignorable` stay declared.
- Test: every corpus healthy part passes schema-lite with zero errors (it must never reject what Office wrote). Any failure means the table is wrong, not the file.

### C4. Rules, ordered by judge rejections

Procedure, repeated until the exit gate is met:

1. From the latest scoreboard, collect Open XML SDK error IDs and LibreOffice failures on outputs labelled Repaired or Partially repaired, grouped by family.
2. Take the most frequent group. Write a failing fixture. Implement the rule. Re-run the sample.
3. Each rule lives in `js/core/formats/<family>-rules/<rule>.js` with a test, a finding code and copy.

Starting candidates, to be ordered by the data (not built speculatively):

- **Excel:** rows ascending and unique; cells ascending within a row and unique; cell `r` matches row; `s` within `cellXfs` count; shared string index within count (any quoting style); numeric cells with non-numeric values become inline strings (reported); sheet names unique, ≤ 31 chars, no `[]:*?/\`; sheet ids unique; defined names pointing at missing sheets get `#REF!`; overlapping merges removed; table ranges and ids unique; pivot cache definition and records come as a set; shared formula masters exist for every dependant; worksheet child order (from schema-lite); `dimension` recomputed when content changed.
- **PowerPoint:** slide → layout → master → theme chain complete, synthesise a minimal layout or master when missing (reported as structural); `sldId` ≥ 256 and unique; `sldMasterId`/`sldLayoutId` ≥ 2147483648 and unique across the presentation; notes slide back-link; sections and custom shows drop removed slide ids; diagram part set complete or the graphic frame removed; media referenced by `p:videoFile`/`a:audioFile` present.
- **Word:** fields balanced (`fldChar` begin/separate/end); bookmarks start/end paired by id; comment range start/end/reference consistent with `comments.xml`; tracked change ids unique; footnote/endnote/comment references point at existing ids; every `w:tc` ends with `w:p`; `w:sectPr` last in body.
- **Shared:** chart parts and their embedded workbook; a damaged `vbaProject.bin` gives a macro-free output (extension changes to the non-macro form, reported as Lost: macros); signatures removed after any change (`SIGNATURE_REMOVED`, Noted); DOCTYPE and entity declarations stripped (`XML_DOCTYPE_REMOVED`).

### C5. Verification tiers

`verifyPackage` returns a tier instead of a boolean:

| Tier | Meaning | Label phrase (owner to approve copy) |
|---|---|---|
| 0 | Fails structural checks | Label drops (v1 behaviour) |
| 1 | Structural checks (v1 checks 1–5) | "Passed structural checks." |
| 2 | Tier 1 + reference sweep clean + schema-lite clean + family rules clean | "Passed structural and content checks." |

Repaired requires tier ≥ 1, as in v1. The scoreboard reports, per tier, the judge pass rate, so the phrase means something measurable. Wording never says the file opens in Office.

### Phase C exit

- Judge pass rate (LibreOffice loads and Open XML SDK opens) for Repaired outputs: xlsx and pptx within **2 percentage points** of docx.
- Open XML SDK validator errors on tier-2 outputs: median **0** per file for each family.
- Healthy false alarms 0; over-labels 0; Phase B recall not reduced.
- Tag `v2.0.0-c`.

---

## 7. Phases D to F (outline; re-plan after the C scoreboard)

**D. Ladder and product.** Repair ladder (minimal touch → structural → remove damaged features → transplant into clean skeleton → text salvage), each candidate verified and scored; offer "most complete" and "most likely to open" when they differ. Recovery inventory with recovered/expected counts only where expected is knowable. In-page preview (text, grid sample, slide titles). Exports: plain text, CSV per sheet, media ZIP. Worker-side strict well-formedness checker differential-tested against DOMParser on the whole corpus (needs owner decision 5).

**E. Reach (owner picks).** Templates and shows; Strict OOXML; xlsb/vsdx at ZIP level; OpenDocument through the same layers; password-protected files with a user-supplied password via WebCrypto (Agile encryption decrypts in 4096-byte segments, so damage stays local; confirm against MS-OFFCRYPTO); old .doc/.xls/.ppt salvage into a new modern file (CFB reader, text and cell values only).

**F. Ship.** Same-origin service worker for offline use (check it against the CSP and guardrail 4: cache app files only, never file data); time and memory measured at 200 MB; accessibility pass (keyboard, screen reader, contrast); README rewritten around the scoreboard; deployment only after owner approval.

---

## 8. Not doing

Password cracking or removal. Full-fidelity repair of old binary formats. Any claim that Office will accept a file. Server-side processing, telemetry or uploads. A framework or build step in the app.

## 9. Changes to v1 text and behaviour

- Self-made fixtures stay as unit tests only; the scoreboard is the evidence.
- "Passed structural checks." stops being the only tier (C5).
- Hand-written dangling-reference cases are replaced by the registry and sweep (C1, C2).
- The "100 MB in about 5 seconds" figure is removed; measured numbers replace it (A5).
- The "Honest position" paragraph is rewritten by the owner once the C scoreboard exists. Sonnet MUST NOT rewrite it.
- Guardrail 17 changes only if the owner approves decision 5.

## 10. Per-step checklist for Sonnet

1. Read the step in this file and the files it names.
2. Write the failing test first.
3. Implement the smallest change that passes it.
4. Run the v1 browser suite (Chromium locally, all three engines in CI) and the Node tests.
5. For any step that changes repair behaviour: run the 10 % scoreboard sample and compare with the last committed `results/scoreboard.json`. A regression in false alarms, over-labels or recall blocks the step.
6. Add any new finding code to `copy.js` with severity and copy that passes lint.
7. Update README (Status, Known limits, Deviations) and commit with the step id in the message, for example `B3.2 entry selection by checksum`.
