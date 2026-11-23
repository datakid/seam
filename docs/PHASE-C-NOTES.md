# Phase C notes

Status of the Phase C build and the places where it differs from `PLAN-V2.md`. Written by the Bytes agent, which took Phase C over with the owner's permission while the main agent was out of quota.

## C1: part registry

| Item | State |
|---|---|
| `js/core/data/parts.js` | One row per part kind (about 80), plus `FORMATS` (the 14 main-part variants with their output types) and `DEFAULT_TYPES` (extension defaults). Plain data, no imports. |
| `js/core/registry.js` | Lookups by kind, relationship type (transitional and strict), content type (main alternatives included), root element and namespace (transitional and strict), and path or pattern. |
| `constants.js` | `CT_MAIN`, `FAMILY_KEYS`, `STANDARD_KEYS`, `MAIN_PARTS`, `OUTPUT_MIME`, `CT_DEFAULTS`, `CT_VBA` and the main and core relationship types are derived from the registry. `OVERRIDE_TABLE` is gone. |
| `package.js` | Content type overrides for a part come from `overrideTypeFor`. A rebuilt `[Content_Types].xml` now also covers chart styles, diagram parts, tables, pivots, external links, comments of every kind and the other registered parts. |
| `donor.js` | The borrow allow-list is the rows flagged `borrow` (and the relationships of `borrowRels` rows). Same set as before. |
| `orphan-kinds.js` | Root element lookup goes through the registry. The result `kind` is now the registry kind (`xlWorksheet`, `pptSlide`), not the root element name. |
| `tests/parts.test.js` | Unique kinds, full field set, relationship types resolve in both forms, every source names a row, every content type the v1 code used is in the table, derived constants keep their v1 values, paths and patterns, root lookup in both namespace families, and the `.avi` default. |

### Differences from the plan

- Rows carry three extra fields: `main`, `borrow` and `borrowRels`. `main` marks the three main parts so they get no automatic override. The other two replace the donor allow-list.
- `content: false` marks parts that hold no user content (styles, themes, settings, layouts, masters, properties, signatures, macros). It is also the set the borrow flag is drawn from.
- A relationship type that Microsoft added outside the ISO set has `relTypeStrict: null`.

### Fixed on the way

- The orphan table named the font table root `fontTable`. The element is `fonts`, so a header-less font table was never recognised.
- `.avi`, `.wmv`, `.mov`, `.mpg`, `.m4v`, `.wma`, `.m4a`, `.mid`, `.wdp`, `.odttf` and `.fntdata` now have default content types. The Phase A input `libreoffice-bnc591147` (`.avi` and `.mp3` parts without types) no longer loses its repair to the type check.

### Not done in C1

- `identify.js` and `salvage.js` still carry their own namespace strings. They are not part tables and are left alone.
- The content types and relationship types for Microsoft-specific rows (comments extended, ids and extensible, threaded comments, modern PowerPoint comments, chart style and colour style, diagram drawing, activeX, vbaData and signature) are written from the published specifications and have not been checked against Office-written files. The healthy corpus is not reachable from the authoring sandbox. If the scoreboard shows a repaired file rejected for one of these types, look here first.

## C2: reference sweep

| Item | State |
|---|---|
| `js/core/data/ref-policy.js` | `REF_POLICY` keyed `element@attribute` by local name (prefixes differ between producers), a `*` fallback, and `REF_LOSS_NAMES` for the finding text. About 45 entries: images, charts, diagrams, embedded objects, links, header and footer references, embedded content blocks, template links, embedded fonts, slide, layout, master and notes entries, media, drawings, tables, data links. |
| `js/core/ref-sweep.js` | `sweepReferences` and `auditReferences`, moved out of `package.js`. Actions: `remove`, `unwrap`, `removeContainer` (outermost named ancestor, with `otherwise` of `dropAttribute`, `remove` or `keep`) and `keep`. Removing from a list fixes the list's `count` and can drop the list when it empties (`tablePart`). |
| Detection | The attribute namespace is resolved per element, so a prefix declared on a nested element (`<c:chart xmlns:rel="..." rel:id="...">`) is found. The old code only read the root. |
| When it runs | On a package that is otherwise intact, only the rules flagged `always` run, and only on the main Word part and on slides. That is exactly what the removed hand-written cases did. Once something else has been repaired the sweep covers every part. A wider always-on sweep turned `libreoffice-cool14390_chart_external_ref` (a chart data link with no relationship, which Office-made and LibreOffice-made files carry) into a Partial; the healthy corpus now gives the same 5 repaired files that `corpus/manifest/triage.json` lists and 295 untouched. |
| Cost | The sweep reads every file. A text scan finds relationship attributes whose id is not in the part's relationships, and only a part with such a reference is parsed. Healthy files build no extra trees. |
| Findings | `REF_REMOVED` carries `n` and `loss` and is written per part per loss type. `REF_DANGLING` is unchanged. |
| Removed | The hand-written cases in `formats/docx.js` (images, links, header and footer references) and `formats/pptx.js` (pictures), and the finding codes `DOCX_IMAGE_REMOVED`, `DOCX_LINK_REMOVED`, `DOCX_HEADER_REF_REMOVED`, `PPTX_IMAGE_REMOVED`. Their tests now assert `REF_REMOVED` with the matching loss. |
| `tests/refsweep.test.js` | Policy shape, a dangling picture in an intact package, a nested prefix, a link in a header part, a table entry and its list, list count kept in step, healthy fixtures untouched. |

### Differences from the plan

- The `*` fallback is `keep`, not `removeContainer: nearestSafe`. Removing the nearest ancestor that is safe needs the schema table from C3. Until then an unknown reference is left in place, reported as `REF_DANGLING`, and the label is Partial.
- `placeholder` is not built. It is only needed where the schema requires an element, which also waits for C3.
- Worksheet drawings (`XLSX_DRAWING_REMOVED`) are still removed by the token scanner in `formats/xlsx.js`. That scanner edits a sheet in one pass without building a tree, which matters for large sheets. The policy table has the same rules for any sheet the scanner does not visit.
- `sheet@id` in the workbook is not in the table. The Excel rules remove such sheets and fix names and views first, so what is left is reported by the audit.
- `pivotCache@id` and `externalReference@id` are not in the table. Removing them breaks pivot tables and formulas that refer to them by number.
- The copy for `REF_REMOVED` changed to name the loss. It needs the owner's approval like the other copy.

### Healthy corpus check (300 files, run in the authoring sandbox)

The corpus is reachable from the sandbox through raw GitHub, so `npm run corpus` works and `node tools/run-seam.mjs` runs. Result on `v2` after C1 and C2: 295 no problems, 5 repaired, none partial or failed. The 5 are the files in `corpus/manifest/triage.json`. `libreoffice-bnc591147` now ends repaired (the `.avi` default was the missing piece) instead of failing.

Two false alarms were found and fixed by this run before they reached the scoreboard:

- `xl/theme/theme.xml` (no number) matched the theme pattern after C1 widened it, so three LibreOffice-made workbooks gained a content type override. The numbered and the bare theme are now separate rows, and only the numbered one gets an override.
- The always-on sweep described above.

## C4: content types (main agent, merged onto the registry above)

| Item | State |
|---|---|
| Relationship-driven correction | A part that is the target of a relationship whose type fixes its content type gets the registry's type. It covers a part at a non-standard path and a type that was corrupted. `CT_OVERRIDE_FIXED` reports corrections, and `CT_OVERRIDE_ADDED` still reports parts that had no type. It uses `rowsOfRelType` and chooses the row of the file's own family, then a shared row. A row with the generic `application/xml` type is skipped. |
| Entry cleaning | In `[Content_Types].xml` an entry is removed when its extension, part name or content type is not valid, when it repeats an earlier entry, or when it is not a `Default` or an `Override`. Unknown attributes on a valid entry are dropped. `CT_ENTRIES_CLEANED` reports the count. |
| Tests | `tests/ct-fix.test.js`, 25 cases across the three families. Every case failed on `655c225` and ends in No problems found for a package the Open XML SDK refuses. |

Evidence. In `score-sample-6` the SDK rejected 30 Partial outputs, 12 of which did not open, mostly for an unexpected content type on a related part and for a malformed `Default` entry. `tools/ct-conformance.mjs` reproduces the check without the SDK. On the 221-case sample, outputs with a wrong or missing content type fell from 2 to 1 with this change. The one left is `xl/ctrlProps/ctrlProps1.xml`, which has no registry row yet. The healthy corpus (318 files) has 0 label changes. One damaged case changes, `libreoffice-fdo63053__bitflip__1`, which gains `CT_OVERRIDE_FIXED`, and its label stays Partial.

Not confirmed by the SDK itself yet. That needs a score run.

## C2 additions (main agent, merged onto the sweep above)

| Item | State |
|---|---|
| `js/core/data/ref-policy.js` | Eight entries: `pageSetup@id` (drop the attribute), `pivotCache@id`, `externalReference@id`, `control@id`, `oleObject@id`, `objectPr@id`, `snd@embed` and `tags@id`. Lists left empty are dropped with `dropEmptyParent`. Six new names in `REF_LOSS_NAMES`. |
| `js/core/ref-sweep.js` | `dropAttribute` is now also a primary action. Before it was only the `otherwise` of `removeContainer`. One branch in `plan`. |
| `tests/ref-policy-excel.test.js` | Ten cases for the new entries in Excel and PowerPoint markup. Seven failed on `74aeea5`. |
| `tests/refsweep.test.js` | One line: the shape test now allows `dropAttribute`. |

Evidence. On 1,215 damaged cases the sweep left a dangling reference in 28 cases on `74aeea5`: `pageSetup@id` 23, `pivotCache` 6, `control` 4, `externalReference` 2, `snd` 2, `objectPr` and `oleObject` 2 each, `tags` 1. It now leaves 1, an `externalBook`, on purpose, because that part and its `externalReference` have to go together. The healthy corpus (318 files) has 0 label changes.

Known gap. Removing a pivot cache does not yet remove the pivot tables that depend on it.

## C1 additions (main agent, merged onto the registry above)

| Item | State |
|---|---|
| `js/core/data/parts.js` | Fourteen rows: `printerSettingsExcel`, `printerSettingsPowerPoint`, `chartEx`, `ctrlProp`, `revisionHeaders`, `userNames`, `revisionLog`, `queryTable`, `tableSingleCells`, `xmlMaps`, `volatileDependencies`, `macrosheet`, `revisionInfo` and `changesInfo`. Every row was checked against the content types and relationship types seen in the corpus. `xmlMaps` has no content type, because its type is the generic one. The `part()` builder gains `relTypeAlt`. The core-properties row lists the older `officedocument/2006/relationships/metadata/core-properties` URL as an alias. |
| `js/core/registry.js` | One line: `relTypeAlt` entries are indexed with the other relationship types. |
| `tests/parts-extra.test.js` | Six cases: the rows are unique and found by kind and path, their relationship types resolve (strict too), the alias resolves, a control property part with no type is typed through its worksheet, and an OLE attachment that is a legacy workbook keeps its type. |

Not added, because the registry already has it or it is wrong to type: an `oleObject` content type. The existing row has none, so OLE attachments keep the type their `Default` entry gives. Typing them from the relationship would retype legacy `.xls` and `.pdf` attachments.

Evidence. Outputs with a wrong or missing content type on a related part fall from 1 to 0 on the 221-case sample (the one left was `xl/ctrlProps/ctrlProps1.xml`). The healthy corpus (318 files) and the damaged sample have 0 label or finding changes.

## C5 Verification tiers

| Item | State |
|---|---|
| Module | `js/core/tiers.js`: `tierOf(structuralOk, checks)`, `contentChecks(ctx)`, `tierFor(ctx, ok)` and `registerCheck(id, run)`. |
| Levels | 0 fails the structural checks, 1 passes them, 2 passes them and every content check. |
| Content checks | `references`: no `REF_DANGLING` finding is left. `schemaLite`: every XML part of the output fits the schema table (`js/core/schema-check.js`), with child order counted, so a part that is off-schema in the input stays off-schema in the verdict. A part over 8 MB, a package over 32 MB of XML, or a missing table reads as not clean. `familyRules`: no family rule exists yet (C4 has no group the data justifies), so the check is vacuously clean. It must become a real check as soon as a rule is added. |
| Result | `verifyPackage` returns `tier` beside `ok`. Repaired and Partial results carry `tier`, Salvaged carries 1, a healthy file carries none. The harness stores it, and `tools/score.mjs` reports per tier: outputs, LibreOffice loads, SDK opens and the median SDK error count. |
| Copy | Unchanged for now. The owner approved "Passed structural and content checks." on 2026-11-23. It is not in `copy.js` yet: the table checks structure, not attribute values, enumerations or uniqueness, which the SDK also checks, so the phrase waits for the first scoreboard that reports SDK errors per tier. |

### Scoreboard additions

`tools/judge-oxml/Program.cs` now records up to 40 messages per file with id, type, part, node, path and description, beside the old five-string `sample`. `tools/score.mjs` adds section 2b (tiers) and 2c (SDK messages by element, with the most common message id and the family split). The judge change has not been compiled or run here, because there is no dotnet in this environment. `score-sample-*` runs on CI will be the first to exercise it.

## C3: schema pass (main agent), the consumer side

| Item | State |
|---|---|
| `js/core/schema-close.js` | `completeSpine(root, table)` completes missing required children on the chain of last children, which is the part of a tree that was open at a truncation. It builds each added child's own required children and required attributes, puts it in schema order, reuses the prefix in scope, and reports what it could not build (a required choice, an undeclared namespace, an attribute with no default). `findViolations(root, table)` reports missing required children and wrong order anywhere in a tree. `completeSchema(ctx)` runs after the sweep on parts that have `XML_TRUNCATED_CLOSED`. |
| Table | `js/core/data/schema-lite.js` exporting `SCHEMA_LITE`, loaded with a dynamic `import()` only when a truncated tree needs it. It does not exist yet. Without it the pass does nothing. `env.schemaTable` replaces it in tests. |
| Findings | `SCHEMA_COMPLETED` (repaired) and `SCHEMA_UNRESOLVED` (loss). |
| `tests/schema-close.test.js` | 15 cases against a small hand-written table: order, recursion, attributes, default namespace, an unresolved choice, an undeclared namespace, foreign children, and two end-to-end cases on a truncated slide. |

Why on the last-child chain only. In `score-sample-7`, 13 of the 22 Partial outputs the SDK rejects fail with "incomplete content", and 12 of those 13 carry `XML_TRUNCATED_CLOSED`. Earlier siblings of a truncation are complete.

The table format and its source are agreed with the Bytes agent in `NOTES-FOR-BYTES.md`. The source proposed is the Open XML SDK model (`data/schemas/*.json`, MIT). It waits for the owner to confirm.

## C3 Schema-lite

Not shipped: the generated table is not committed until the owner confirms the source. Everything needed to produce it is.

| Item | State |
|---|---|
| Source | Open XML SDK (`dotnet/Open-XML-SDK`, MIT), `data/schemas/*.json` and `data/namespaces.json`, commit `431ab05cf160248cc3885a4a766026d4f8243792`. The generator records repo, commit and licence in the table. |
| Generator | `tools/gen-schema-lite.mjs --sdk <checkout> --corpus <healthy packages> --out <file.js or file.json>`, built on `tools/lib/schema-lite-build.mjs` and `tools/lib/schema-lite-defaults.mjs`. The default output is `js/core/data/schema-lite.js`: an ES module exporting `SCHEMA_LITE_RAW` (the compact table) and `SCHEMA_LITE` (`openTable` of it, which is what `schema-close.js` loads). JSON is not loadable, because `connect-src 'none'` and the no-`fetch` rule forbid it. |
| Reader and matcher | `js/core/schema-fit.js`: `openTable(raw)`, `fitChildren(table, entry, children)`, `checkTree(table, root)`, `childEntry`, `requiredChildren`, `minimalElement`, `attributeDefault`. Pure functions on the parsed tree from `xml-repair.js`. |
| Differential run | `tools/schema-lite-diff.mjs --table <file>` checks every element of every healthy file against the table and prints each distinct disagreement with file, part and path. |
| Patches | `tools/data/schema-lite-patches.json`: places where Office writes what the SDK model lacks. Each one carries its evidence. |
| Tests | `tests/schema-lite.test.mjs` (32 cases) on a miniature SDK-format fixture: shape, shared models, base-type attributes, dropped namespaces, patches, every matcher outcome, 200,000-child runs, `mc:Ignorable`, `mc:AlternateContent`, strict namespaces, a hand-written table in the plain contract shape, minimal elements, corpus defaults, `completeSpine` and `findViolations` from `schema-close.js` run over a generated table, and the generator end to end. |

### What the table holds

2,398 elements, 1,662 content models, 136 namespaces, 270,695 bytes with defaults. The contract shape written out in full came to 1.48 MB, because the same content model was repeated for every element that uses it and every child carried its namespace URI. The file shares models, stores each namespace once, and groups elements by namespace:

```
{ source, format: 2, namespaces: [uri], namespaceAliases: { strictUri: transitionalUri }, tolerated: ["uri|local"],
  types: [ [kind, items, requiredAttrs, min?, max?] ],
  elements: { uri: { local: typeId } } }
```

`kind` is `s`, `c`, `a` (all) or `o` (open: children are not checked). An item is `[namespaceIndex, local, typeId, min?, max?]`, a wildcard is `["*", min, max]` and a nested group is `[kind, min, max, items]`. `openTable` turns that into the contract shape (`elements["uri|local"]` is `{ kind, min, max, items, attrs }`) and a plain table in the contract shape goes through the same function unchanged.

Three things the contract did not say, all needed to be right:
- **A name can have several definitions.** `w:rPr` is `CT_RPr`, `CT_ParaRPr`, `CT_RPrStyle` and others, depending on the parent. 142 names are like that. They are not in `elements`; a child is resolved through its parent's item (`childEntry`), and `checkTree` does so.
- **Attributes come from the abstract base type.** `w:CT_OnOff/w:b` has none of its own. The base is found by its type name, not by class name, because `TwipsMeasureType` exists in `w:` and in `m:` with different attributes. Only required attributes are stored.
- **The root particle has its own occurrence.** A choice that repeats without limit is a choice with `max: null` at the top.

Required attributes carry a `type` (`string`, `number`, `boolean`, `enum`, `other`) and, when a healthy file shows one, a `default`: the most common value of that attribute in the 300 healthy files (345 attributes). Relationship ids never get one. `minimalElement` builds the smallest valid content for an entry from that: required items repeated `min` times, the cheapest alternative of each required choice, required attributes from `default` or `type`. For all 2,398 elements, 2,199 build with nothing unresolved, and each of those passes `checkTree`.

Dropped on purpose: VML and the other `urn:schemas-microsoft-com:` namespaces (their parents become unchecked rather than stricter), abstract types, and optional attributes.

### Matching

Children are matched against the model with position sets, so a model may be ambiguous without backtracking blow-ups. Children in namespaces the table does not know, in `mc:Ignorable` namespaces and the `mc:` elements themselves are skipped; a model with a wildcard sees foreign children. `mc:AlternateContent` is read through its first `Choice`, and through its `Fallback` if that does not fit.

A failed match is classified by looking at the children without their order: `order` (all children are allowed and present, but in the wrong order), `missing` (a required child is absent), `unexpected` (a child the model does not allow), `repeat` (more than the model allows). `order` is the soft class. A required attribute that is absent is `attr`.

### Differential result on the 300 healthy files

3,968,205 elements checked, 1,229,614 of them with at least one required child or attribute.

| | Files |
|---|---|
| No disagreement | 262 |
| Child order only | 18 |
| Missing, unexpected or repeated child, or missing attribute | 20 |

All 38 are LibreOffice (29 of 164) or POI (8 of 61) test files, except `oxml-sdk-5Errors.docx` (1 of 75), which is a deliberately invalid test file. None of the 74 other files from the SDK's own corpus, written by Word, Excel and PowerPoint, disagrees. What the disagreements are:
- LibreOffice writes `w:b`, `w:i` and `w:sz` twice in one `w:rPr`, `w:pPrChange` before `w:rPr`, a `w:pPrChange` with no `w:pPr`, and spreadsheet `font` children in the order name, size, bold, colour (the SDK model is a fixed sequence; Excel opens it).
- LibreOffice and POI write `w:style` children out of order (`basedOn` before `name`), `w:tcBorders` and `w:tblBorders` as left, top, right, bottom, `w:compat` items out of order, and `c:extLst` before `c:showDLblsOverMax`.
- LibreOffice writes `w:highlight` in a style's `w:rPr` (the SDK's style type has no `highlight`), `w:pBdr/w:insideH`, a `w:tbl` with no `w:tblGrid` and an empty `x14:sparklineGroups`.

In every one of these the file, not the table, differs from the schema.

Table gaps found and fixed. The SDK model has no `w:smartTag`, `w:smartTagType` or `w:doNotEmbedSmartTags` (13 SDK templates and one 2005 document use them), requires a `customPropertyEditor` that Word leaves out, lists `a14:m` with no children (it holds `m:oMathPara`), and models `c16r3:dataDisplayOptions16` as if `dispNaAsBlank` were a direct child of `c:ext`. They are in the patch file: three tolerated, three opened.

Detection check. Delete one required child from a healthy part (448 trials over 33 healthy files): the table reported a finding in 447.

### With the pipeline (table in place for one run, not committed)

The 308 damaged cases that carry `XML_TRUNCATED_CLOSED`, with and without the table, current `v2` code. 94 cases are completed and 53 have something unresolved; no outcome changes. Files with a missing required child fall from 98 to 50 (`p:sp` without `spPr`, `a:themeElements` without `fmtScheme`, `worksheet` without `sheetData`, `p:sldMaster` without `clrMap`, `p:spTree` without `grpSpPr`). The pass inserts one required element and stops, so the inserted element is itself incomplete (empty style lists, colours without a child, `fontRef` without `idx`), and missing-child findings rise from 165 to 235 and missing-attribute findings from 33 to 153. `minimalElement` is the fix for that; `schema-close.js` does not use it yet.

### The fill pass: `js/core/schema-fill.js`

`fillMissing(root, table, { scope })` completes what `checkTree` reports as `missing`. It takes the document root or the document element, the way `completeSchema` holds it. For each node with a `missing` finding it walks the node's content model and:
- repeats a required child up to its `min` (`fillStyleLst` needs three fills, `lnStyleLst` three lines);
- adds the cheapest alternative of a required choice (`effectStyle` gets `effectLst`, an accent colour gets `srgbClr`), by the same weighing as `minimalElement`;
- completes a group that was started, and leaves an optional group out when none of its members is there;
- puts each new child after the last child that precedes it in the model, so a sequence stays in order;
- uses the prefix the document already declares for the namespace, and declares a default namespace on the new element when none is in scope;
- reports what it cannot invent (`@mode` of an enum with no healthy default, a wildcard) and still adds the element.

`scope: 'spine'` fills only the nodes on the path to the last element, which is where a tail closed after truncation leaves its holes. `checkTree` findings now carry `node` and `entry` as non-enumerable properties so the fill can find the node; reports and JSON output are unchanged.

Measured in the pipeline, replacing `completeSpine` in `completeSchema` (committed since, see Shipped below). The whole damaged set, 1,139 files, 828 outputs judged against the healthy original by `checkTree`, table in place:

| | no table | table, `completeSpine` | table, `fillMissing` (spine) |
|---|---|---|---|
| Outputs with a schema finding the original lacks | 123 | 83 | 42 |
| of those, with a missing required child | 123 | 83 | 1 |

Outcome counts do not move (309 repaired, 519 partial, 156 failed, same as before). `scope: 'tree'` gives the same numbers, so the spine is enough and touches less. On the healthy files it changes 6 of 2,803 parts, all LibreOffice or POI output that is off-schema in the input (an empty `w:tabs`, `w:pPrChange` without `w:pPr`, a `w:tbl` without `w:tblPr`); that is the reason to run it on parts that carry `XML_TRUNCATED_CLOSED` only. A second pass changes nothing. The one remaining missing child is a theme whose `a:themeElements` lost both required children to a bit flip in the tag name.

What is left after the fill is thin: the other 41 outputs, one to two cases per group, nearly all `unexpected` children after a flipped or inserted byte (`w:namr` for `w:name`, `w:latrntStyles`). A near-miss rename would reach 72 of the 355 unexpected children, and 44 of those are one file, so no rule in `<family>-rules` is justified by this data yet.

### Shipped, 2026-11-23

The owner confirmed the source (Open XML SDK data files, MIT, commit `431ab05`, plus attribute defaults read from the healthy corpus) and the wording of the tier 2 phrase. `js/core/data/schema-lite.js` is committed, regenerated byte for byte by `node tools/gen-schema-lite.mjs --sdk <checkout> --commit 431ab05cf160248cc3885a4a766026d4f8243792 --corpus corpus/cache/files`. `vendor/open-xml-sdk.LICENSE` holds the SDK's MIT notice and the README says what is third-party. `completeSchema` now calls `fillMissing` with the spine scope in place of `completeSpine` (still exported). `env.schemaTable: null` means there is no table, so tests do not depend on the file being absent.

### Tier 2 on the damaged set

All 1,139 damaged files, the shipped table, the fill and the strict check. Outcomes are identical to the run before it: 309 repaired, 519 partial, 156 failed, 83 no problems, 64 salvaged, 8 not supported, no case changed.

| | outputs | reach tier 2 |
|---|---|---|
| Repaired | 309 | 272 (88 %) |
| Partial | 519 | 416 (80 %) |
| docx | 305 | 218 (71 %) |
| xlsx | 237 | 205 (86 %) |
| pptx | 286 | 265 (93 %) |

This says how many outputs fit the table, not how many the SDK accepts. The table has no attribute value types, enumerations, ids or uniqueness. Until a `score-*` run reports the SDK's error count for tier 2, the phrase should not reach the UI. If the median there is not 0, the missing checks are where C4 starts. docx is lowest because Word-family output that LibreOffice or POI wrote is off-schema in untouched parts (child order in `w:style`, repeated `w:sz`), and those files stay at tier 1 as they should.

### Not done yet

Tier 2 copy in `copy.js`, `ui.js` and `report.js`, and the help entry, after the scoreboard. Whether the phrase applies to Partial outputs or only to Repaired is open: a file that says content was lost and also says content checks passed reads badly. I would show it for Repaired only.

`registerCheck('schemaLite', ...)` in `tiers.js`. What counts as clean for tier 2 is a decision for the main agent's `schema-close.js` and the owner: a file from LibreOffice or POI that was already off-schema in its input should not lose tier 2 for output that is no worse. `checkTree` returns the kind per finding for that.

### C3 source test: the SDK model against real files

`tools/schema-diff.mjs --table <table> --scoreboard <scoreboard.json>` runs `findViolations` over every XML part of the corpus and compares the files it flags with the files the Open XML SDK reports errors on in the CI baseline. It measures how faithfully a table replicates the judge. A throwaway converter from `data/schemas/*.json` in `dotnet/Open-XML-SDK` (not committed) gave this on 313 healthy files that the SDK opens:

| | SDK errors | SDK clean |
|---|---|---|
| table flags | 55 | 54 |
| table clean | 30 | 174 |

Agreement is 73.2%, and of the files the table flags the SDK also errors on 50%. So that JSON is the SDK's code-generation model, not its validation constraints. It is stricter than the standard in places (`w:cols` requires a `col`, `w:sdtEndPr` requires an `rPr`) and the SDK validator does not enforce those. It also has 91 element names whose content model depends on the parent, and it models some unbounded choices as sequences, so order checks fail on real Excel and Word files.

What the experiment fixed in the engine: a top-level choice is satisfied by any one alternative, a wildcard in a choice is satisfied by any child, and a choice alternative that is a group is satisfied by any element in it. Dropping the ambiguous element names took the flagged parts from 2,033 to 135 of 4,407.

Consequences for C3. A table is only acceptable when this agreement is high. The suggested gate is 95% agreement with no more than 3% of the files flagged where the SDK finds nothing. The ECMA XSD source (Transitional zip in `apache/poi`) has not been measured. It is the standard itself, so it should do better on optional children. It needs an XSD reader.

