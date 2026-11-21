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
