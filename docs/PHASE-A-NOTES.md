# Phase A notes

Status of the Phase A build and the places where it differs from `PLAN-V2.md`. Each deviation needs owner sign-off.

## Changes to v1 behaviour

Each change was made because a real healthy file from the corpus was damaged or flagged. Each has a test in `tests/healthy.test.js`.

| Change | Evidence | Plan reference |
|---|---|---|
| Templates and shows (`dotx`, `dotm`, `xltx`, `xltm`, `potx`, `potm`, `ppsx`, `ppsm`) are recognised and left alone. A template type under a document extension is still fixed to match the extension. | 65 of 300 healthy files were rewritten as ordinary documents | Pulled forward from Phase E to A7. Needs approval. |
| Strict OOXML main relationship type and relationship namespace are recognised. | `libreoffice-strict-smartart` and `oxml-sdk-main_buautonum_type_ea1jpnkorperiod` had their relationship type rewritten to the Transitional URI | Phase E asks for Strict to be detected and not harmed. Pulled forward. |
| A part whose XML is valid UTF-16 is no longer treated as damage. The v1 test C18 now expects No problems found. | `oxml-sdk-Pitchbook_TP10176928` is written by Office with 18 UTF-16 parts. OPC allows UTF-8 and UTF-16. | A7. Changes an existing v1 test. |
| `Target="NULL"` relationships are skipped by the dangling-reference check and by verification check 3. | Six Office-written files from the Open XML SDK assets carry them. One lost a picture in v1. | A7. |
| `[Content_Types].xml` no longer gets forced `Default` entries for `rels` and `xml`. A main type supplied by a `Default` needs no override. | 24 LibreOffice files with explicit overrides were reported as repaired | A7. |

## Differences in tooling

- The harness runs `runPipeline` on the page's main thread with a real `DOMParser`. The app runs it in a worker that delegates the XML check to the main thread, so results should match. A worker-path run is still to do.
- Browsers: Playwright downloads are blocked in the authoring sandbox, so local runs use a Chromium bundled in an npm package. Firefox and WebKit run only in CI.
- The Open XML SDK judge, the Office judge and the full 11,700-case matrix have not been run. They are written and wired into `.github/workflows/score.yml`.
- Memory is the JS heap growth sampled at stage boundaries through `performance.memory`. It is a lower bound, not a peak.
- The catalog of 4,424 candidate files is not committed. `corpus/manifest/healthy.json` holds the 300 selected files and `wild-public.json` holds 100 files tagged broken.

## Open false alarms on healthy files

Five files still do not report No problems found. Each waits on a judge. See `corpus/manifest/triage.json`.

## Phase C input

`libreoffice-bnc591147` has `.avi` and `.mp3` parts with no content type. Seam adds a default for `.mp3` but has none for `.avi`, so verification fails and the whole repair is discarded. The part registry should supply the default.
