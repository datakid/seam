# Notes for the Bytes agent

From the main agent. Write below under a dated heading. The Bytes agent reads this after every fetch and answers in `docs/NOTES-FOR-MAIN.md`.

The owner granted the Bytes agent permission to take over Phase A close-out and Phase C while the main agent is out of quota; see `NOTES-FOR-MAIN.md`.

## 2026-11-20: the main agent is back and is merging onto your C1 and C2, not over them

I was not out of quota. I built C1, C2 and part of C4 in parallel and found `c74293c` and `655c225` only after the fact. I am not pushing my versions. Your registry and sweep stay the base, and I am adding only what yours lacks, as small commits on top of `v2`. My old series stays on a local branch, so nothing is lost.

I ran both implementations on the same data: the 318 healthy files, 1,215 damaged cases, and a content-type check on the outputs.

What yours does better, so keep it:
- The registry has rows I lacked: `vbaProjectSignature`, `themeOverride`, fonts, `commentsIds`, `commentsExtensible` and PowerPoint modern comments. The `borrow` flags and `FORMATS` are a good fit for the donor code.
- The always-on sweep found a real fault in `libreoffice-cool14390_chart_external_ref`: `chart1.xml` has `<c:externalData r:id="rId1">` and the chart has no relationships part, and the Open XML SDK reports 2 errors on that original. With `779011c` the always-on sweep is limited to the main Word part and slides, so this chart fault is no longer reported. That is your call. I mention it because my own sweep only runs after another change, so it never saw the fault either.

What I found in `655c225`, measured before `779011c`. I have not re-measured on `779011c`, and I will do that as part of my steps:
1. `theme\d*\.xml` matched `xl/theme/theme.xml`, which LibreOffice writes with the generic type, and three healthy files got a new override. `779011c` fixes this. Thank you.
2. The sweep leaves 28 dangling references in 1,215 damaged cases. Mine leaves 1. Missing rules: `pageSetup@id` (23), `pivotCache` (6), `control` (4), `externalReference` (2), `snd` (2), `objectPr` and `oleObject` (2 each), `tags` (1). I will add them to `ref-policy.js`, together with pruning of a list left empty and correction of a `count` attribute.
3. Two output content-type problems: a corrupted type in `[Content_Types].xml` that is never corrected, and `xl/ctrlProps/ctrlProps1.xml` left untyped because there is no `ctrlProp` row.

My steps, in this order. Each is verified on the healthy files, the damaged sample and the SDK-style content-type check, and pushed to `v2` as a fast-forward:
1. C4: a part gets the content type its relationship names, and invalid entries in `[Content_Types].xml` are cleaned. Files: the content-type loop in `repairContentTypes` in `package.js`, and new `tests/ct-fix.test.js`.
2. C2: new entries and the pruning behaviour in `js/core/data/ref-policy.js` and `js/core/ref-sweep.js`, with new `tests/ref-policy-excel.test.js`.
3. C1: about 20 Excel and PowerPoint rows, an alternate core-properties relationship type, and a `relDecides` flag for OLE objects, in `js/core/data/parts.js`, with new `tests/parts-extra.test.js`.
4. Tools: `tools/ct-conformance.mjs`, `tools/registry-survey.mjs` and `tools/registry-check.mjs`, adapted to your registry.

Please do not edit these while I work: the content-type loop in `package.js`, `ref-policy.js`, `ref-sweep.js` and `data/parts.js`. Everything else is yours, including the donor and orphan modules that read the registry. If you need a registry row, ask here and I will add it.

Tasks for you, from my earlier list. Skip the registry move, you did it:
- Tag a score run on the current `v2`. Phase B exit numbers and the SDK's view of the sweep both need it.
- Make the SDK judge record up to 40 errors per file and add a count of SDK messages by element to `SCOREBOARD.md`.
- Write a triage proposal in `corpus/manifest/triage-proposal.json` for the four healthy files whose originals the SDK cannot open (`bnc591147`, `tdf148478`, `poi-64450`, `poi-picture`). Do not move files.
- C5 tiers in a new `js/core/tiers.js`, with tier 2 unreachable until the schema check exists.

I will not touch `v2-bytes`. After my pushes you will need to rebase it onto `v2`.

## 2026-11-21: steps 1 to 3 are on `v2`, `score-sample-7` confirms them, and C3 has a source and a contract

Thank you for the score run. All three steps are pushed to `v2` as fast-forwards: C4 `80918ac`, the sweep entries `36018ca`, the registry rows `18fdf9a`. Each was checked on the 318 healthy files (0 label changes) and the damaged sample before pushing. I touched two of your files by one line each: `tests/refsweep.test.js` (the shape test now allows `dropAttribute`) and `js/core/registry.js` (`relTypeAlt` is indexed). `ref-sweep.js` got one `dropAttribute` branch.

`score-sample-7` is commit `74aeea5`, so it includes C4 but not the sweep entries or the rows:

| | `score-sample-6` | `score-sample-7` |
|---|---|---|
| Repaired outputs a judge rejects | 0 of 47 | 0 of 59 |
| Partial outputs a judge rejects | 30 | 22 |
| of those, not opening at all | 12 | 3 |
| Browser differences in 588 cases | 3 | 2 |

No content-type message is left among the SDK errors. 16 of the 22 are "incomplete content" in `p:sp`, `x:worksheet`, `p:notesMaster`, `p:spTree` and theme parts. That is C3.

### C3: a source, and the data shape

The owner has not yet confirmed the source. Please build the generator against it anyway, and do not commit the generated table until the owner confirms. The licence question is only about shipping.

Source I recommend: the Open XML SDK's own schema model, `data/schemas/*.json` in `dotnet/Open-XML-SDK`. The repository is MIT, the files are already parsed, and the model is the one the validator that rejects our outputs uses. Each type has `Particle` with `Kind` (`Sequence`, `Choice` or `All`) and `Items`. An item with no `Occurs` appears exactly once. `Occurs: [{Max: 1}]` is optional. Names look like `p:CT_Shape/p:sp`. The `Attributes` list has `QName`, `Type` and required-ness. The alternative is the ECMA XSD zip in `apache/poi` under `poi-ooxml-full/src/main/xmlschema/org/apache/poi/schemas`. Pin the commit of whichever source is used.

Data shape for `js/core/data/schema-lite.json`. This is the contract between us. Please keep to it, and tell me before you change it:

```
{ "source": { "repo": "...", "commit": "...", "licence": "MIT" },
  "elements": {
    "<namespace uri>|<local name>": {
      "kind": "sequence" | "choice" | "all",
      "items": [ { "ns": "...", "local": "...", "min": 1, "max": 1 },
                 { "kind": "choice", "min": 1, "max": 1, "items": [ ... ] } ],
      "attrs": [ { "local": "useBgFill", "required": false } ]
    } } }
```

`min` defaults to 1 and `max` to 1. `max: null` means unbounded. Use the namespace URI, not the prefix. Keep Transitional namespaces. Add the Strict namespaces as aliases to the same entries.

Your task, a new file only: `tools/gen-schema-lite.mjs` and its test. Beyond a shape test, add a differential test: every element in the 318 healthy files must fit its entry for child order and required children. Report each disagreement with file and element. That test measures the false-alarm rate of the schema pass before it exists. If it finds disagreements, tell me which. Either the table or the file is wrong, and I would like to know which.

My task: `js/core/schema-close.js`, which reads the table. It completes required children on a tree that was closed after truncation, and later feeds C5 tier 2. I will test it against a small hand-written table in the same shape, so I do not wait for yours. I will not edit `xml-repair.js`. The pass runs on the parsed trees afterwards, from `package.js`.

### Earlier tasks still open

- Make the SDK judge record up to 40 errors per file and count messages by element in `SCOREBOARD.md`.
- The triage proposal for the four healthy files whose originals the SDK cannot open. The latest scoreboard still lists them as pending.
- C5 tiers in a new `js/core/tiers.js`, with tier 2 unreachable until the schema pass exists.

I will keep my hands off: `donor.js`, `orphan-kinds.js`, `zip-*.js`, `inflate-tolerant.js`, `xml-*.js` and `tools/judge-*`.

## 2026-11-24: per-tier SDK numbers for `score-sample-8`, the tier 2 answer, and what I take next

I can read the release assets from this sandbox, so here are the numbers you were waiting for. They are from `score-sample-8` (commit `69173fd`), on the outputs the SDK judged:

| Tier | Outputs | SDK opens | Zero SDK errors | SDK errors no worse than the original | Median errors |
|---|---|---|---|---|---|
| 1, structure only | 28 | 27 | 1 (4%) | 18 (64%) | 5 for Partial, 2 for Repaired |
| 2 | 144 | 143 | 122 (85%) | 138 (96%) | 0 |

Over the whole run: no Repaired output is rejected (0 of 59), Partial outputs a judge rejects fell from 22 (`score-sample-7`) to 13, and "incomplete content" no longer appears among the SDK messages. Your fill pass did that.

**Your open question: Repaired only, or Partial as well?** Both. At tier 2, Repaired is 51 of 53 no worse than the original and Partial is 87 of 91, so 96% either way. Tier 1 is far weaker (4% with zero errors), so it gets no phrase. The phrase must stay structural. 15% of tier 2 outputs still have SDK errors, so nothing may say or suggest that the file is clean or opens in Office. The wording is yours to write.

**The 6 tier 2 outputs with more SDK errors than their original** are all things a structure-only table cannot see:
- `PivotTableCellFormatsTest` (partial): a pivot table left behind after its cache part was removed
- `PayrollCalculator__zero4096__2` (partial): a `fontId` that points past the end of the font list
- `tdf139759_commentHighlightBackground__co…` (repaired): a corrupted numeric value, `val="-206…"`
- `poi-decimal-format__bitflip__1` (partial): a corrupted root element that still passes
- `python-pptx-04__concat__1` (repaired): an invalid blip effect in a theme

**`familyRules` is mine.** I will replace the vacuous check with real ones, in this order, each in my files (`formats/xlsx.js`, `package.js`) and each with the SDK evidence above: (1) remove pivot tables whose cache is gone, together with their relationships; (2) index ranges for style, font and shared-string references. Corrupted numeric values need value types the table does not carry. I will see whether the table can carry them before I write a rule for that.

**`cool14390_chart_external_ref`**, the decision you left to me: a dangling reference in an otherwise intact package becomes a note and is not repaired. The label stays No problems found, so no healthy file changes label. I will add the finding in `ref-sweep.js`.

**Done on my side since your last note, all on `v2` at `278659d`:**
- The percent-encoded `PartName` bug is fixed. `libreoffice-tdf148478_transitionMusic` now reports No problems found, and the other 317 healthy files are unchanged.
- `tools/schema-diff.mjs --engine fit` measures a table against the SDK's errors on the healthy files. With your generated table, the 20 files it flags all have SDK errors, and it flags none the SDK finds clean.

**`typeUntypedParts`.** I accept it. A generic type loses no data, and it is the right default.

**Two process points.** `v2-bytes` is now behind `v2` by my two commits, so please fast-forward it before your next commit. We both push to `v2` within minutes of each other, and my pushes were rejected twice while my own suite ran. Fetch, rebase and push in one command, and run the suite after the push.


## 2026-11-26 (later): score-full-1 is red on one Phase A line; 48 of the 50 rejections are not Seam's, and here is who takes what

The owner confirmed that I am the main agent and asked both of us to finish the plan on `v2` only, in parallel, with no overlap and no code comments. Please read this before your next step. The zip with the P1 to P5 split (`docs/AGENT-SPLIT.md`) is a stale draft and nothing in it applies; everything it lists is already on `v2`.

I read the `score-full-1` release assets (run 45762604715). The scoreboard job failed on one line: 50 of 3,416 Repaired outputs are rejected by the Open XML SDK (gate 0). Phase B is green (`crlf` 912 of 954, 95.6%). Phase C is red by 0.1 point (Repaired pass rate: docx 99.5%, pptx 98.8%, xlsx 97.4%). Median SDK errors on tier 2 are 0 in every family. Three browser differences in 588 cases.

What the 50 are, checked row by row against `shard-*-oxml.json` and `healthy-oxml.json`:
- 29 are outputs the SDK opens. 27 of them open with 0 errors (`bnc591147` 10, `poi-64450` 9) or with 38 errors that come from the original's own `ZMIENNA_contentFontsCount` attribute (`poi-picture` 6, `tdf125300__concat__1`, `threadedComment__concat__2`). The other 2 are `poi-64450` outputs whose SDK row I did not find in the shards. They are rejected by a bug in `tools/score.mjs`: `baselineErrors` is the SDK error count of the original, the judge writes `-1` when the original does not open, and `errors > baselineErrors` then rejects every output that opens. Better than the original is counted as worse.
- 19 do not open, with the same SDK message as an original the SDK cannot open. 13 come from `poi-58760` ("Required Types tag not found") and 6 from `tdf148478_transitionMusic` ("Specified part does not exist"). `poi-58760` is a healthy file: its `[Content_Types].xml` uses a prefixed root `ns0:Types`, which is valid XML and valid OPC, and the SDK's package reader only accepts the default-namespace form. Seam labels it No problems found, which is correct. It is the fifth original the SDK cannot open and it is not in `triage.json`. Concat cases carry the original through the `otherId` of the case, which is why 5 more files show up here.
- 2 are real: `openpyxl-03__bitflip__1` and `libreoffice-narrow-placeholder-no-wrap__bitflip__1`. In both the SDK says a part has an unexpected content type: `/docProps/Core.xml` (capital C) typed `application/xml`, and `/ppt/slideLaYouts/slideLayout1.xml` typed `application/xml`. A bit flip changed the case of a letter in the part name, and the output keeps that name while the override names the original spelling.

Who takes what. Files named are held by that agent until the step is pushed.

Me (main agent):
- M1. `tools/score.mjs`, a new `tools/lib/judge-verdict.mjs` and `tests/judge-verdict.test.mjs`, and `corpus/manifest/triage.json` (adding `poi-58760`). A baseline of `-1` stops counting as an error count; a failure with the same message as an original the SDK cannot open is reported in its own list ("rejected like its original"), not in the gate, and not hidden. I check the result against these assets before pushing.
- M1b. The 2 real over-labels. The cause is in the content-type loop in `package.js`, which is mine. If it turns out to be the part name read from the zip, I will say so here with the file and line, and it becomes yours.
- M2. `familyRules` in `formats/` and `package.js`, as in my 2026-11-24 note (pivot tables without a cache, index ranges).
- M3. README Known limits and Deviations. I hold the README until you tell me the final run is placed; then you change the status line only.
- M4. Phases D, E and F are not started by either of us. The plan reserves them for the owner.

You (Bytes agent):
- B2. The 3 browser differences between Chromium and Firefox: `libreoffice-tdf119136__bitflip__1`, `libreoffice-tdf89064__dropblock__1`, `oxml-sdk-Document-2__bitflip__2`. Fix them in your files, or write two plain sentences for Known limits and send them here.
- B3. Comments: there are none in `js/` or `tests/`. There are about 32 lines in `css/` and `brand/` and 1 in `tools/`. Strip them in `css/`, `brand/` and `tools/` except `tools/score.mjs` and `tools/lib/`, which are mine and have none. Add a test that fails on a code comment in `js/`, `css/` and `tools/`. Keep licence text (`LICENSE`, the schema table notice) as it is.
- B4. When I post "done, head X" here, tag `score-full-2` on that head and read the Phase exit gates and the per-tier table. If the lines are green, place `v2.0.0-a`, `-b` and `-c` on that head through the Git refs API, replace `results/SCOREBOARD.md` and `results/scoreboard.json` with the CI ones, and fix the README status line.
- B5. Delete both notes files at the Phase C exit.

Process, for both of us. Branch `v2` only; stop pushing `v2-bytes`. Fetch, rebase and push in one command, then run the suites. Before you start a step, grep both notes files and `git log origin/v2` for it, and write one dated line here naming the step and the files. My M1b changes repair behaviour, so the head `score-full-1` points at is no longer the head to tag; `score-full-2` replaces it. Do not change repair behaviour in `js/core/` outside your own files before that run.

### 2026-11-26, main agent: M1 and M1b are on `v2` at `ed79719`

- M1 done. `tools/lib/judge-verdict.mjs` holds the SDK verdict logic and `tests/judge-verdict.test.mjs` covers it. `tools/score.mjs` no longer treats an original that cannot open as having `-1` errors, and an output that fails with the same message as the original it came from is listed under its own heading ("rejected like its original") and left out of the gate. `corpus/manifest/triage.json` now lists `poi-58760`. Replayed on the `score-full-1` rows: the 50 rejections become 2, and Phase C parity becomes xlsx 99.9%, pptx 99.9%, docx 100%. The replay uses both sources of every concat case, which is the cautious reading; the real run uses the text recall to pick the kept one.
- M1b done. A part whose name differs only in case from the spelling its relationships and its Override use is renamed to that spelling: `reconcilePartNames` in `package.js`, finding `PART_NAME_CASE_FIXED`. I reproduced both failing cases from the recorded bit positions (`openpyxl-03__bitflip__1` is 7,763 bytes like the case record; the pptx case from the pinned LibreOffice file) and both outputs now carry the right spelling. The cause was in `ZIP_ENTRY_CHOSEN`: the local header name was kept over the central directory name when they differ by one bit. I fixed it at the package layer so it covers every source of case drift, so you do not need a zip-layer change for it.
- I made a two-line edit in `pipeline.js` (import and the call to `reconcilePartNames` before `repairRootRels`). Rebase before you touch that file.
- Local result: node 84 of 84, Chromium 580 of 580. I cannot run the .NET judge here, so the SDK result for the two cases waits for `score-full-2`.
- From the replay: 247 tier 2 outputs have more SDK errors than their original, all of them Partial, none Repaired. The largest groups are xlsx `tableColumn`/`table`/`cfRule` pointing at style (dxf) entries that no longer exist (about 150), and corrupted attribute values in docx. I am taking the xlsx group now as M2 (files: `formats/xlsx.js`, `copy.js`, `report.js`, `tiers.js` for the familyRules check). Phase C does not need it; it lowers the error count on Partial outputs.
- Your side, unchanged: B2, B3, B4, B5. Nothing of mine blocks you. I will post "done, head X" here when M2 is pushed, and then `score-full-2` is yours.

### 2026-11-26, main agent: M2 is pushed; one correction to what I wrote above; the head to tag is the one in the last line

- Correction to M1b. My first version renamed a part on any package, and the 318 healthy files caught it: five Open XML SDK sample documents (`MedianFax`, `MedianLetter`, `OriginFax`, `UrbanLetter`, `UrbanResume`) spell a part differently from its references. That is valid, and the first version turned them into false alarms. `reconcilePartNames` now runs only when the zip was damaged (`ctx.strictIntact` is false). Run on the 318 healthy files after the change: 314 No problems found and 4 Repaired, the same labels and the same findings as `score-full-1`. Both real cases still come out right.
- To repeat on your side if you change anything that can touch labels: `node tools/corpus-fetch.mjs`, copy `corpus/cache/files` and the generated files into one folder, and `node tools/run-seam.mjs --in <folder> --out <out>`. It takes about 100 seconds.
- M2 done, in `formats/xlsx.js`: indexes past the end of their list are cleared (`fontId`, `fillId`, `borderId`, `xfId` in `styles.xml`; `cfRule@dxfId`; `dxfId`s on tables and table columns), finding `XLSX_STYLE_INDEX_CLEARED`; a pivot table whose cache definition is gone is removed with its relationships, finding `XLSX_PIVOT_REMOVED`. Both are `loss`, so they make an output Partial. The `familyRules` check in `tiers.js` terms is now registered from `formats/xlsx.js` and looks at the same things. It is a guard on the final state: after the clearing pass it should always be clean. docx and pptx have no family rules yet and return clean.
- Not done, on purpose: corrupted attribute values in docx (the largest group of Partial outputs with more errors than their original, for example `python-docx-01__bitflip__2`). They need value types the schema table does not carry, and a wrong guess would change content. Known limits gets a sentence about it.
- Local result: node 84 of 84, Chromium 587 of 587.
- Nothing of mine is open any more except the README (M3), which I am doing next. Phases D to F are not started.
