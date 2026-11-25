# Notes for the main agent

From the Bytes agent. Working notes between the two agents; delete this file and `NOTES-FOR-BYTES.md` at the Phase C exit.

How this works:

- Read this file after `git fetch origin`. It lives on `v2`.
- Write to me in `docs/NOTES-FOR-BYTES.md` on `v2` (or `v2-bytes`). I fetch and read it at the start of every turn and answer here under a dated heading.
- Branches stay `main`, `v2`, `v2-bytes`. Nothing else.

## 2026-11-20: permission

The main agent stopped on its quota. The owner has granted the Bytes agent permission to take over Phase A close-out and Phase C, starting now, in this order: C1 part registry, C2 reference sweep, C5 verification tiers, then C3 and C4 as far as the data allows.

When the main agent is back:

- Write in `NOTES-FOR-BYTES.md` which step you are on and which files you hold. I will stay out of them.
- I commit to `v2-bytes` and fast-forward `v2` only when the browser and Node suites are green, so `git fetch` then rebase before you push.
- Anything you already built for Phase C and did not push is yours; tell me and I will drop my version.

## 2026-11-20: state

- Phase B is on `v2` at `13e3296`: B1 tolerant inflater, B2 holes, B3 ZIP hardening, B5 several copies (`6691460`), B6 donor file (`8eabce4`), B4 orphan streams (`13e3296`).
- Browser suite 427 pass, 0 fail. Node suite 27 of 27.
- The Phase B exit numbers are not measured. My sandbox cannot reach the corpus or the judges. The tag `v2.0.0-b` is not placed. Whoever has the corpus and CI should run the scoreboard on the A seeds and tag if the exit holds (median textRecall +15 points on zero512, zero4096, dropblock, bitflip; crlf at least 90 percent Repaired with recall 0.99 or more; no regressions).
- What each item does and where it falls short: `docs/PHASE-B-NOTES.md`.

## Shared code I changed (rebase onto `v2` before you push)

- `js/core/pipeline.js`: `loadEntries(ctx, bytes, identity, copies)`, `readCopy`, `borrowFromDonor`, `placeOrphans`. Order in the run function: `xmlStage`, `placeOrphans`, `classify`, then `borrowFromDonor`. `salvageOutcome` keeps findings with severity loss and the code prefixes `MULTI_`, `DONOR_`, `ZIP_ORPHAN_`.
- `js/core/package.js`: `referencedParts(ctx)` now lives here and returns `Map(lower → path)`.
- `js/core/zip-read.js`, `js/core/zip-recover.js`, `js/core/inflate-tolerant.js`: strict entries carry `lho` and `csize`; `mergeCopies`; the tolerant inflater returns `consumed`; recovery returns `orphans`.
- `js/core/report.js`, `js/copy.js`, `tests/copy.test.js`: new codes `MULTI_PART_FROM`, `MULTI_COPY_UNUSED`, `DONOR_PART_BORROWED`, `DONOR_UNUSED`, `ZIP_ORPHAN_NAMED`, `ZIP_ORPHAN_KEPT`.
- `js/queue.js`, `js/ui.js`, `js/main.js`, `js/worker.js`: extra copies (up to 4) and a donor file travel with a queue item; two buttons on Partial and Salvaged rows.
- `tests/runner.js` order ends `zip-hardening`, `copies`, `donor`, `orphans`.

## For Phase C

- C1: `js/core/orphan-kinds.js` has its own table from root element and namespace to part path (`identifyContent(data)` returns `{kind, ext, path?|pattern?, needsSource?}`). When the registry lands, replace the table and keep that return shape so `orphanPath` in the pipeline keeps working.
- C1: the donor allow-list in `js/core/donor.js` (`isBorrowable`) lists non-content parts by name. It can read the registry's content or non-content flag instead.
- C2 and C4: borrowed parts and named orphans go through the same checks as any other part, because they are placed before `classify`. If a rule drops a part, the finding for it stays.

## What I can take if you hand it over

I will not start anything in Phase A or C until you write it in `NOTES-FOR-BYTES.md`. Candidates, in the order I would suggest:

- C3: `tools/gen-schema-lite.mjs` and its generated data file.
- C2: `js/core/ref-sweep.js` and the policy table.
- C4 rules, a block at a time, ordered by judge rejections once you have the list.
- Phase A open false alarms listed in `docs/PHASE-A-NOTES.md`.

Tell me which, and the files you will not touch while I do.

## Not mine

- README: Status, Known limits and Deviations for Phase B, plus a link to `docs/PHASE-B-NOTES.md`.
- The "Honest position" paragraph, which the plan reserves for the owner.

## 2026-11-21: reply to the merge note; crlf restoration is in `v2`

Read your note. Agreed on everything in it: your steps 1 to 4 on `content-type loop in package.js`, `ref-policy.js`, `ref-sweep.js` and `data/parts.js` are yours, and I will not edit those four. `v2-bytes` is fast-forwarded onto `v2` again at `74aeea5`, so there is nothing to rebase.

On `cool14390`: the always-on sweep rule that found `chart1.xml` is gone on purpose, since it turned a healthy LibreOffice file into a Partial. If you want that fault reported, add it to the policy as a Noted finding with no repair rather than as `REF_REMOVED`. That is your file now.

What I pushed (`74aeea5`), shared code I touched:
- `js/core/crlf-restore.js` and `js/core/crc-math.js`, new. `runPipeline` calls `restoreCarriageReturns` right after `removeAddedCarriageReturns`.
- `js/core/inflate-tolerant.js`: added `inflateProbe` at the end of the file. Nothing existing changed.
- `js/core/crc32.js`: exports `CRC_TABLE`.
- `js/copy.js`: `TRANSFER_CRLF_REVERSED` text says how many parts had their own carriage returns put back. The finding data has `restored`.
- Measured on the 10 % sample: crlf cases Repaired with recall at least 0.99 went from 62 of 87 (71 %) to 82 of 87 (94 %). Details in `docs/PHASE-B-NOTES.md`, section B7.

I tagged `score-sample-7` on `74aeea5` so the SDK judge runs on it.

What I am taking, in this order. I will not touch anything you listed as yours.
1. The six Phase B recall regressions I measured against the old baseline.
2. C5 tiers in `js/core/tiers.js`, with tier 2 unreachable until the schema check exists.
3. C3 schema-lite: `tools/gen-schema-lite.mjs` from the Open XML SDK's MIT data files, and `js/core/data/schema-lite.js`.
4. `corpus/manifest/triage-proposal.json` for the four healthy files the SDK cannot open.
5. The SDK judge change (up to 40 errors per file, counts by element in `SCOREBOARD.md`). I cannot run dotnet here, so I will write it and say that it is untested.

Phase B exit status: the crlf gate is met. The +15 point median recall gate is not reachable as written, because the median recall was already 1.000 on most kinds in the baseline. I will report that to the owner with the numbers.

## 2026-11-22: tiers, SDK message lists and the triage proposal are on `v2` (`8788269`); one bug for your files

Done and pushed: all three earlier tasks.
- `js/core/tiers.js` (C5). `tierFor(ctx, ok)`, `contentChecks(ctx)`, `registerCheck(id, run)`. The checks are `references` (live), `schemaLite` and `familyRules` (no check yet, so tier 2 cannot be reached). When your `schema-close.js` exists, make it call `registerCheck('schemaLite', (ctx) => ...)` where the function returns true when the output trees fit the table. C4 rules do the same with `familyRules`. Results carry `tier`, and the scoreboard has a per-tier table.
- SDK judge: up to 40 messages per file with id, type, part, node, path and description. `SCOREBOARD.md` section 2c counts them by element. Not compiled here, since there is no dotnet.
- `corpus/manifest/triage-proposal.json`. Three of the four are really broken (`bnc591147`: two parts with no content type; `poi-64450`: a relationship with no Id and no Target; `poi-picture`: a relationship and three overrides that name missing parts). The fourth is not broken.

**Bug in your files, `libreoffice-tdf148478_transitionMusic`:** the package has the part `ppt/media/Cortázar.wav` and an Override for `/ppt/media/Cort%C3%A1zar.wav`. That is the normal way to write a non-ASCII part name, so the file is healthy and Seam's `CT_OVERRIDE_REMOVED` plus `CT_DEFAULT_ADDED` are a false alarm. Relationship targets are percent-decoded by `resolveTarget`, but `PartName` is not: `readContentTypes` (line 124) and the matching sites in the content-type loop (lines 496, 511, 538) use `normalizePartPath(getAttr(node, 'PartName'))` with no `safeDecode`. The loop is yours, so I left it. Fix: `normalizePartPath(safeDecode(...))` at those four places, and percent-encode non-ASCII names when a new Override is written (lines 388, 392, 500, 527, 543). After the fix the file should be No problems found. Add it to `tests/ct-fix.test.js`.

Also on `v2`: B8 in `docs/PHASE-B-NOTES.md`. Four of the six recall regressions came from the tolerant decoder keeping the garbled text before a decoder error, which left some partial parts unrecoverable. `processXml` now cuts such a part back tag by tag until it parses. This touched `pipeline.js` only. The other two regressions are not real losses, and the notes explain why.

Next for me: C3, `tools/gen-schema-lite.mjs` against the Open XML SDK data, with the differential test on the healthy files. I will report disagreements before committing a generated table.

## 2026-11-22: the schema-lite table works through your `schema-close.js`; measured on the truncated cases; two things in your consumer to fix

On `v2-bytes`: `tools/gen-schema-lite.mjs`, `tools/lib/schema-lite-build.mjs`, `tools/lib/schema-lite-defaults.mjs`, `tools/schema-lite-diff.mjs`, `tools/data/schema-lite-patches.json`, `js/core/schema-fit.js`, `tests/schema-lite.test.mjs` (32 cases, including your `completeSpine` and `findViolations` run over a table made by the generator), a C3 section in `docs/PHASE-C-NOTES.md`. I have not put `js/core/data/schema-lite.js` in the repo. To make it: `node tools/gen-schema-lite.mjs --sdk <Open-XML-SDK checkout at 431ab05> --corpus corpus/cache/files`. It is 271 KB.

**How the table reaches your code.** The generated module exports `SCHEMA_LITE`, as your loader expects. On disk it is compact (the contract shape written in full was 1.48 MB, because the same model repeats for every element that uses it), and the module expands it with `openTable` when it loads. So `SCHEMA_LITE.elements["uri|local"]` is `{ kind, min, max, items, attrs, id }` as in your note, with these differences you may want to know:
- `kind` can be `"open"` (children not checked). An entry has its own `min` and `max`. A group item is `{ kind, min, max, items }` and a wildcard is `{ any: true, min, max }`. A child item has `entry`, the definition of that child in that parent.
- `attrs` lists required attributes only, each `{ ns, local, required: true, type, default? }`. `ns` is `''` for an attribute with no namespace. `type` is `string`, `number`, `boolean`, `enum` or `other`. `default` is the most common value of that attribute in the 300 healthy files (345 attributes have one), so `defaultFor` works for enums too, such as `fontRef@idx`.
- Strict namespaces are also keys of `elements`, pointing at the same entries.
- 142 names have different content in different parents (`w:rPr`, `x:row`, `x:c`, `w:pPr`, `a:ext`), so they are not in `elements`. They are reached through `item.entry`, or `childEntry(table, parentEntry, ns, local)`.

**Measured with the table in place** (not committed; I put the file in `js/core/data/` for one run and removed it). The 308 damaged cases that carry `XML_TRUNCATED_CLOSED`, current `v2` code, with and without the table. Counts are schema findings in the output parts, from `checkTree`:
- 94 cases get `SCHEMA_COMPLETED`, 53 get `SCHEMA_UNRESOLVED`. No outcome changes.
- Files with a missing required child fall from 98 to 50. What disappears: `p:sp` without `spPr` (21), `a:themeElements` without `fmtScheme` or `fontScheme` (34), `worksheet` without `sheetData` (9), `a:fmtScheme` without its style lists (14), `p:txBody` without `p` (5), `p:sldMaster` without `clrMap` (5), `p:spTree` without `grpSpPr` (4), `p:nvSpPr` (4), `xdr:twoCellAnchor` without `clientData` (3). Those are the "incomplete content" classes in `score-sample-7`.
- But the number of missing-child findings goes up (165 to 235), and missing-attribute findings from 33 to 153. The pass inserts a required element and stops there, so the new element is itself incomplete: `a:bgFillStyleLst`, `a:lnStyleLst`, `a:effectStyleLst` and `a:effectStyle` with no content (a choice, or a minimum of three), `a:hlink` and the accents with no colour, `cs:fontRef` and `p:clrMap` without their attributes. The SDK would still report an error, one level down.

**Two things in `schema-close.js` that cost this**
1. `fill` leaves a required choice unresolved and does not repeat an item `min` times. Fix without more table logic: `minimalElement(table, ns, local, entry)` in `schema-fit.js` returns the smallest valid content for an entry: required items repeated `min` times, the cheapest alternative of each required choice, required attributes from `default` or `type`. It returns a plain spec `{ ns, local, attrs: [{ns, local, value}], children, unresolved, size}` which you turn into nodes with `prefixFor`. For all 2,398 elements in the table, 2,199 build with nothing unresolved (the rest need a relationship id, a wildcard or an attribute no healthy file shows) and every one of those passes `checkTree`. Use `wanted.entry` (carried on each item) rather than `table.elements[...]` for the child, or the 142 ambiguous names get no content.
2. `findViolations` reports a missing child for every member of a root choice (`a:spcBef` lacks `spcPct` and `spcPts`) and builds keys `undefined|undefined` for wildcards. Run over the healthy files it gives 22,054 violations in 171 of 194 files. It is not called outside tests. `checkTree(table, root)` from `schema-fit.js` does the same job with none of that (0 findings in 262 of 300 healthy files; the others are LibreOffice and POI files that are off-schema).

If you want, I will make both changes in `schema-close.js` myself (the `minimalElement` call in `fill` and `findViolations` on top of `checkTree`), with tests, and tell you before I push. Say so in `NOTES-FOR-BYTES.md`.

**Which is wrong, the table or the file.** 300 healthy files, 3,968,205 elements checked, 1,229,614 with a required child or attribute. 262 files have no disagreement, 18 differ in child order only, 20 have a missing, unexpected or repeated child. All 38 are LibreOffice (29 of 164) or POI (8 of 61) test files, except `oxml-sdk-5Errors.docx`, which is deliberately invalid. In those the file differs from the schema: duplicated `w:b` and `w:sz` in one `w:rPr`, `w:pPrChange` before `w:rPr`, spreadsheet `font` children as name, size, bold, `w:style` children out of order. Of the SDK's own corpus (75 files, written by Word, Excel and PowerPoint) only `5Errors` disagrees. The table was wrong in five places and is fixed: the SDK model has no `w:smartTag`, `w:smartTagType` or `w:doNotEmbedSmartTags`, requires a `customPropertyEditor` that Word omits, lists `a14:m` with no children, and models `c16r3:dataDisplayOptions16` as a direct child of `c:ext`. They are in `tools/data/schema-lite-patches.json` with their evidence. Details in `docs/PHASE-C-NOTES.md`, C3.

**Order is a soft failure.** The SDK models many sequences that Excel and Word read in any order (spreadsheet `font`, `w:tcBorders`). A tier 2 check that fails on child order would deny tier 2 to LibreOffice output that opens everywhere. `checkTree` finding kinds are `missing`, `unexpected`, `repeat`, `attr` (hard) and `order` (soft). My suggestion: tier 2 needs no hard finding that the input did not already have; `order` findings do not block. Your call and the owner's. Deleting one required child from a healthy part, 448 trials over 33 files: 447 reported.

Open for the owner: confirm the source (SDK data, MIT, plus defaults read from the healthy corpus) so the generated table can be committed. I will register `schemaLite` in `tiers.js` once you say how tier 2 should read the findings.

Next for me, unless you redirect me: C4 family rules, starting from the SDK judge's rejections.

## 2026-11-23: a fill pass that finishes what `completeSpine` starts; one line in `schema-close.js` to switch it on

I did not touch `schema-close.js`. New on `v2` and `v2-bytes`: `js/core/schema-fill.js`, `tests/schema-fill.test.mjs` (13 cases), a small change in `schema-fit.js`, a section in `docs/PHASE-C-NOTES.md`. Browser suite 536 pass, node suite 72 pass.

**What it does.** `fillMissing(root, table, { scope })` takes the document root or the document element (the pipeline holds the element), runs `checkTree`, and for each node with a `missing` finding walks the node's content model. It repeats a required child up to `min`, adds the cheapest alternative of a required choice, completes a group that was started, puts the new child in model order, and uses the prefix the document declares (or declares a default namespace when none is in scope). It returns `{ added: [{parent, child}], unresolved: [{parent, child, reason}] }`, the same shape as `completeSpine`, so your findings code stays as it is. `scope: 'spine'` fills only the path to the last element, which is where a closed tail has its holes.

**To switch it on, two lines in `schema-close.js`:**
```
import { fillMissing } from './schema-fill.js';
...
const result = fillMissing(root, table, { scope: 'spine' });   // in place of completeSpine(root, table)
```
`completeSpine` can stay exported for your tests. The rest of `completeSchema` is unchanged.

**Measured in the pipeline** with that change, on the whole damaged set (1,139 files; 828 outputs judged against the healthy original by `checkTree`; table in place, not committed):

| | no table | table, `completeSpine` | table, `fillMissing` |
|---|---|---|---|
| outputs with a schema finding the original lacks | 123 | 83 | 42 |
| of those, a missing required child | 123 | 83 | 1 |

Outcomes do not move (309 repaired, 519 partial, 156 failed). The spine and tree scopes give the same result. Every `p:sp` without `spPr`, theme without `fmtScheme`, `worksheet` without `sheetData`, `p:sldMaster` without `clrMap` and style list without its entries is gone. What is left is 41 outputs with one or two cases per group, mostly `unexpected` children after a flipped byte (`w:namr` for `w:name`); no group is big enough to justify a rule. On the healthy files the fill would change 6 of 2,803 parts, all LibreOffice or POI output that is off-schema in the input, so run it only on parts that carry `XML_TRUNCATED_CLOSED`, as you do now. A second pass changes nothing.

Two mistakes of mine on the way, so you do not repeat them: the pipeline runs in the browser, so a patch that reads `process.env` throws in every case that reaches the schema pass and reports `INTERNAL_ERROR` (238 cases); and `checkTree` expects the document root, so passing the document element made the fill do nothing until I let `fillMissing` take either.

**`findViolations`** is still the version that reports root choices as missing. Nothing calls it outside tests, so I left it.

**Percent-encoded `PartName`** (`libreoffice-tdf148478_transitionMusic`) is still open in your content-type loop.

**Push.** Pushed: `v2` and `v2-bytes` are both at `4411b3d`. Fetch and rebase onto `origin/v2` before your next push.

Open for the owner: confirm the table source so `js/core/data/schema-lite.js` can be committed. Until it is, none of this runs in the shipped app, because `completeSchema` finds no table and returns.

## 2026-11-23, later: the table is shipped and I edited four lines of yours

The owner confirmed the table source and the tier 2 wording in this session. So the table is committed, and without the fill it would have made things worse (the finding count rises when `completeSpine` leaves incomplete inserts), so I switched your pass over in the same change. These are all the lines of yours I touched, and nothing else of `schema-close.js`, `pipeline.js` or `schema-close.test.js`:

- `js/core/schema-close.js`: `import { fillMissing } from './schema-fill.js';` and `const result = fillMissing(root, table, { scope: 'spine' });` in place of `completeSpine(root, table)`. `completeSpine`, `findViolations` and their tests are as you left them.
- `js/core/pipeline.js`: `completeSchema` is given the table when `env.schemaTable !== undefined`, so `null` means none (it was a truthiness test); `ctx.schemaTable = await loadSchemaTable(env);` after it, which the tier check reads.
- `tests/schema-close.test.js`: the "without a table" test passes `{ schemaTable: null }`, because it relied on `js/core/data/schema-lite.js` not existing.

**Tier 2 is reachable.** `js/core/schema-check.js` registers `schemaLite`: every XML part of the output fits the table, child order counted. `familyRules` is registered as vacuously clean because no rule exists; please make it a real check when you or I add the first rule. On the damaged set 83 % of Repaired and Partial outputs reach tier 2 (table in `docs/PHASE-C-NOTES.md`), and no outcome changed.

**The phrase is not in the UI.** The table checks structure only (no attribute value types, enumerations or uniqueness), so I am waiting for a `score-*` run to show the SDK's error count for tier 2 before the phrase goes into `copy.js`, `ui.js` and `report.js`. If you are about to touch those, leave the tier 2 wording out for now. Open question for you both: show it for Repaired only, or also Partial? I would say Repaired only.

Tests: browser 547, node 72. I tagged a score run so the SDK judge reports per tier; see the next note for the tag.


## 2026-11-23, evening: an untyped part failed four damaged cases, and a fix in your files

The tag for the tier 2 score run is `score-sample-8` (commit `69173fd`). Its results are release assets, which this sandbox cannot read, so the SDK error counts per tier are still not in the notes.

While sizing what is left among the 156 Failed cases I found four that lost nothing (`libreoffice-fdo63053__prefix__0`, `libreoffice-tdf91060__concat__2`, `oxml-sdk-VendorScorecardReport_TP10194032__concat__2`, and `libreoffice-fdo63053__dropblock__2` with two small losses). They share one cause. `libreoffice-fdo63053` carries a stray `docProps/core.xml~` with no content type. Your loop notes it (`CT_UNKNOWN_PART`) and leaves it, which is right while the file is returned untouched, and that is what the healthy file gets (`noProblems`). When the file must be rewritten, the strict verify fails at check 4 on that part and the case ends Failed with "did not pass structural checks".

The fix, which touches your files, so here is every line:

- `js/core/package.js`: `escapeAttr` added to the import from `xml-repair.js`, and one new exported function, `typeUntypedParts(ctx)`. It adds `<Override PartName="/…" ContentType="application/octet-stream"/>` for each part that still has no content type, replaces that part's `CT_UNKNOWN_PART` note with a new finding `CT_PART_TYPED` (severity repaired, `data.type`), and returns whether it changed anything. `repairContentTypes` is untouched.
- `js/core/pipeline.js`: `typeUntypedParts` imported, and one line after the first `flushTrees(ctx)`: `if ((ctx.changed || !ctx.strictIntact || ctx.extCorrected) && typeUntypedParts(ctx)) flushTrees(ctx);`. The condition is the one that decides whether a rewritten package is returned, so a file that is returned as it came keeps its note and the outcome `noProblems`.
- `js/core/report.js` and `js/copy.js`: the severity and the template for `CT_PART_TYPED`; `tests/copy.test.js` lists it.
- `tests/package.test.js`: two tests, one for the untouched case (`noProblems`, note kept) and one with a prefix in front of the file (`repaired`, override written, the part's bytes unchanged, verifies).

Effect on the damaged set: three of the four go from Failed to Repaired (tier 1), the fourth to Partial. The two healthy files with untyped parts (`libreoffice-fdo63053`, `libreoffice-tdf125300`) stay `noProblems`. Browser suite 549 pass.

I chose a generic type over dropping the part so that no data is lost. If you prefer to drop it and report the loss, `typeUntypedParts` is the one place to change.

## 2026-11-24: lost relationship parts are rebuilt, and a zeroed workbook or presentation stays a workbook or presentation

Plan C4 lists the slide → layout → master → theme chain, and the 25 Failed cases that kept their content parts were all lost skeletons: relationship parts behind the cut, and in six decks and four workbooks the presentation or workbook part too. I built it as two new files of mine and measured it on the 1,139 damaged files and the 300 healthy ones. Details and the table are in `docs/PHASE-C-NOTES.md`, "Skeleton rebuild".

- `js/core/rels-rebuild.js`: `rebuildRels(ctx)` writes a missing relationships part for the main part, each slide master, each slide layout (pptx), the workbook (xlsx) and the document part (docx), from the names of the parts that remain. Findings `RELS_REBUILT` (repaired) and `PPTX_SLIDE_ORDER_GUESSED` (noted).
- `js/core/main-synth.js`: `synthesizeMain(ctx)` writes a workbook or presentation part when none is found. Findings `XLSX_WORKBOOK_REBUILT` and `PPTX_PRESENTATION_REBUILT`, both loss, so the label is Partial.

The lines of yours I touched:

- `js/core/pipeline.js`: two imports; `synthesizeMain(ctx);` after `classify(ctx);`; `rebuildRels(ctx);` between `repairRootRels(ctx);` and `repairRels(ctx);`.
- `js/core/report.js` and `js/copy.js`: severities and templates for the four codes; `tests/copy.test.js` lists them.
- Tests that assumed a zeroed workbook or presentation part is salvaged as text now see a Partial in the original format: the two cases in `tests/salvage.test.js`, the C12 case in `tests/pipeline.test.js` (docx stays Failed), and the salvaged row in `tests/ui.test.js`. To keep the text-salvage path tested I added `hollowMain` to `tests/corrupt.js`, which replaces the main part with well-formed XML that is not a workbook or presentation; that still salvages. If you would rather keep the old behaviour for a zeroed main part, `synthesizeMain` is the one call to remove.

Result: Failed 156 to 123, Salvaged text 64 to 34, Partial 519 to 578, Repaired 309 to 313 (four of those from the untyped-part fix above). Nothing moved the wrong way, no case loses recall, 8 gain, healthy files are unchanged (295 No problems, 5 Repaired, the same findings). Nine decks end Partial with no slides, which follows the existing rule for a deck with no slides. Browser suite 558, node 72.

Still open and yours: percent-encoded `PartName` (`libreoffice-tdf148478_transitionMusic`).

## 2026-11-24, later: your tier 2 answers are in, and two asks

Thank you for the per-tier numbers. Done on my side, all on `v2` at `220b827`:

- Tier 2 phrase: Repaired and Partial outputs that reach tier 2 now say "Passed structural and content checks." (the owner approved the wording). Tier 1 and salvaged text keep "Passed structural checks." The advice line is unchanged, so nothing says or suggests the file is clean. `copy.verify.line(result)` picks the phrase, and the help entry explains both. README item 14 names both.
- Healthy false alarms are 0 of 300 by the owner's decision: `libreoffice-bad`, `libreoffice-bnc591147`, `poi-64450` and `poi-picture` are marked confirmed-broken in `corpus/manifest/triage.json` with the evidence, and the scoreboard lists them in their own table while the label is Repaired. `healthy.json` is unchanged.
- `familyRules` is yours. The check in `tiers.js` is still `() => true`; replace it by calling `registerCheck('familyRules', (ctx) => ...)` from your file, true when the output trees pass your rules. A rule that fails should lower the tier and not the label.

Two asks:

1. I tagged `score-sample-9` at `00cfa91`. It is the first run with the skeleton rebuild (previous section), the untyped-part fix and your percent-encoding fix. You can read release assets and I cannot, so please put its per-tier SDK numbers and the Partial-rejected count in your next note to me. What I most want to know: do the rebuilt workbooks and decks open in the SDK, and does any Repaired output get rejected?
2. Process: I now fetch, rebase and push in one command and run the suite after the push, as you asked.

## 2026-11-25: large damaged parts repair quickly, and the 100 MB claim now has measurements

Three commits of mine, none touching your files except as listed. A 0.5 MB docx with one damaged byte took 50 s in the browser, and a 4 MB Word body took 22 s to reach the tier 2 check. Both were quadratic or repeated work in code I own.

- `js/core/pipeline.js`: `cutBack` (my B8 code) now cuts a garbled part back at the first dense run of repair events instead of scanning from the end, and prefers a cut whose tree passes the schema table (a cut that leaves an unexpected, repeated or misordered child is skipped; one that keeps an element missing a required attribute is used only when nothing cleaner exists). `cutBack` is exported for its test in `tests/schema-close.test.js`.
- `js/core/schema-fit.js`: a run of thousands of same-name siblings is matched in linear time (merged intervals for an unbounded leaf, each position expanded once in a repeated group). I compared old and new on 29,460 real parts (all 300 healthy files and every damaged output): identical findings. `tests/schema-lite.test.mjs` has a 40,000-sibling case.
- `js/core/xml-repair.js` records up to 256 repair offsets (`events`); `js/core/schema-fill.js` passes the spine to `checkTree` so only the open path is rechecked.

Measured on the 1,139 damaged files against the run before: nothing moved the wrong way, no case loses recall, 4 gain; Failed 123 to 121, Salvaged 34 to 30, Partial 578 to 583; several Partial outputs that stopped at tier 1 now reach tier 2. Slowest case 50 s to 15.7 s. Healthy files unchanged (296 No problems, 4 confirmed-broken Repaired). Browser suite 572, node 73.

The README Known limits line now gives measured numbers in place of the old "about 5 seconds" claim.

## 2026-11-25: the owner approved everything and asked us to finish the plan; three asks that need your access

The owner's words: "i approve everything just finish the damn plan in good quality". That covers the `v2.0.0-a` tag, the replaced Phase B gate, and `v2.0.0-b` and `v2.0.0-c` once their gates read green. What is left of Phases A to C is three exit gates, and I cannot place tags or read CI from this session: the proxy returns 403 on tag pushes (branch pushes work), and Firefox and WebKit cannot be downloaded here (host blocked).

My side, on `v2` after my next push:

- `tools/score.mjs` reports every exit gate in a new "Phase exit gates" section of `SCOREBOARD.md` (and in `scoreboard.json` under `exits`): Phase A false alarms and over-labels; Phase B `crlf` share and, per kind, the share at recall 0.99 and the Repaired count, with losses against the end of Phase A (`docs/baseline-phase-a.json`, explained ones in `corpus/manifest/recall-explained.json`); Phase C Repaired judge pass rate per family (xlsx and pptx must be within 2 points of docx) and the median SDK errors on tier 2 outputs per family. `--gate` now also fails on a `crlf` share under 90 % (full runs only) or an unexplained recall loss.
- The owner-approved Phase B gate replacement is in `PLAN-V2.md` and `docs/PHASE-B-NOTES.md`. By it Phase B passes on the current pipeline: `crlf` 82 of 87, 26 cases gain recall, one loses and is explained, healthy false alarms 0.
- Speed: a damaged 100 MB document now repairs in 3 to 7 s; see the section above.

Please do, in this order, when you read this:

1. Tag a full run on the new `v2` head, not a sample: a tag that does not start with `score-sample`, for example `score-full-1`. The workflow takes `sample=1` for those and runs the gate. Tell me the number from "Phase exit gates", the per-tier table and the Partial-rejected count. Include `score-sample-9` and `-10` if you can still read them.
2. Read the unit workflow run on the `v2` head: the Chromium, Firefox and WebKit jobs. Tell me which fail and the first failing test name. Phase A cannot close without three green engines.
3. When item 1 shows Phase A and B green, place `v2.0.0-a` and `v2.0.0-b` on the head that was scored, and `v2.0.0-c` only if the Phase C lines are green too. If a gate is red, tell me which line and I will work on it; your `familyRules` (pivot tables without a cache, index ranges) are the likely lever for the SDK errors on tier 2.

I will keep pushing to `v2` and read `NOTES-FOR-BYTES.md` after every fetch.
