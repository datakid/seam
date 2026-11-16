# Corpus manifests

Files in `healthy.json` and `wild-public.json` are fetched by `npm run corpus`. They are never committed. Each entry is pinned to a commit and a SHA-256, and a changed hash fails the run.

| Source | Repository | Licence | Use |
|---|---|---|---|
| Apache POI | apache/poi, `test-data/` | Apache-2.0 | Many producers and edge cases |
| Open XML SDK | dotnet/Open-XML-SDK, `test/` | MIT | Files made by Office, with charts, SmartArt and comments |
| LibreOffice core | LibreOffice/core, `sw/qa`, `sc/qa`, `sd/qa` | MPL-2.0 | Files made by LibreOffice and many Office-made bug reproducers |
| Generated | `tools/corpus-gen/` | MIT | python-docx, openpyxl, python-pptx and LibreOffice conversions |

The licence column is the repository licence. Individual test files can have other origins. Redistribution is not needed because only manifests are committed, but the owner should confirm the licence for each source before any file is bundled.

`broken: true` marks files that fail to unzip, lack `[Content_Types].xml`, or have a name that points at a fault. They are kept out of `healthy.json` and the 100 chosen from them form `wild-public.json`. A file in `healthy.json` that LibreOffice cannot load is treated as a quarantine candidate by the scoreboard.

Refresh the catalog with `node tools/corpus-index.mjs` and reselect with `node tools/corpus-select.mjs`. The catalog stays in `corpus/cache/` and is not committed.
