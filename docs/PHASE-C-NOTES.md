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
| Cost | The sweep now runs on every file. A text scan finds relationship attributes whose id is not in the part's relationships, and only a part with such a reference is parsed. Healthy files build no extra trees. |
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
