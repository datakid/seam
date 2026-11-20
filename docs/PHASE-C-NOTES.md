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
