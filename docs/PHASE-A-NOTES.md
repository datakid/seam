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
| A zip whose directory needed an offset shift is rebuilt instead of copied, and the shift is only allowed when the end-of-directory marker ends the file. | Joined files and a document with a zeroed tail were returned as byte copies of the input and labelled Repaired. An embedded stored package's marker was taken for the document's own. | A7. |
| A U+FFFD that is valid UTF-8 is no longer counted as an invalid byte. | A healthy document containing the character was labelled Partial, and a repaired file was reported as damaged again on every later pass. | A6, A7. |
| A package behind an HTML error page is recovered. A page with no zip signature after it is still reported as not an Office file. | All 12 prefix cases in the first sample came back not supported. | Phase B item pulled forward. Five lines. |
| After a repair, references in the relationships namespace that point at no relationship are reported (`REF_DANGLING`) and the label becomes Partial. | The Open XML SDK rejected a repaired file whose slide layout still referenced a removed image. | Phase A downgrade route. Phase C replaces it with removal. |
| `[Content_Types].xml` no longer gets forced `Default` entries for `rels` and `xml`. A main type supplied by a `Default` needs no override. | 24 LibreOffice files with explicit overrides were reported as repaired | A7. |

## Differences in tooling

- The harness runs `runPipeline` on the page's main thread with a real `DOMParser`. The app runs it in a worker that delegates the XML check to the main thread, so results should match. A worker-path run is still to do.
- Browsers: Playwright downloads are blocked in the authoring sandbox, so local runs use a Chromium bundled in an npm package. Firefox and WebKit run only in CI.
- The Office judge and the full 11,700-case matrix have not been run. The Open XML SDK judge, Firefox, WebKit and LibreOffice run in `.github/workflows/score.yml`, started by pushing a `score-*` tag. A `score-sample-*` tag runs 2% of the matrix.
- Job logs and artifacts cannot be downloaded from the authoring sandbox. The workflow publishes its data as release assets on the tag.
- Memory is the JS heap growth sampled at stage boundaries through `performance.memory` with `--enable-precise-memory-info`. It is a lower bound, not a peak.
- The catalog of 4,424 candidate files is not committed. `corpus/manifest/healthy.json` holds the 300 selected files and `wild-public.json` holds 100 files tagged broken.

## False alarms on healthy files

Zero as of 2026-11-24, owner-approved. 296 of the 300 report No problems found. Four are healthy by manifest and confirmed broken, with evidence in `corpus/manifest/triage.json`, and Seam repairs each of them correctly:

| File | What is wrong with the original |
|---|---|
| `libreoffice-bad` | A `.docm` whose main part has the plain document type |
| `libreoffice-bnc591147` | Parts `.avi` and `.mp3` with no content type |
| `poi-64450` | A relationship with no Id and no Target |
| `poi-picture` | A relationship and three overrides naming parts that are not in the package |

The scoreboard lists them in their own table and does not count them as false alarms, and only while the label is Repaired: a known-broken file that Seam fails to repair is counted. No file moved and `healthy.json` is unchanged. `libreoffice-tdf148478_transitionMusic` was a Seam fault (`PartName` not decoded), fixed on `v2`.

Three files that LibreOffice cannot load in its pristine form are listed in `corpus/manifest/judge-blind.json`. LibreOffice verdicts on cases derived from them are ignored.

## Performance and memory

Measured in Chromium 153 on the 1,139-case damaged set: median 62 ms, 95th percentile 412 ms, slowest 15.7 s (`poi-bug65649__insert__2`, a 12 MB main part garbled by inserted bytes, which took 50 s before the cut-back and linear-fit changes). Peak JS heap is sampled at stage boundaries and reaches 495 MB on the largest file.

Deliberate large files: a Word document with a 4.2 MB main part (about 19,000 paragraphs) plus a 96 MB image part, about 100 MB in total, built with throwaway scripts kept outside the repository. Undamaged it is checked in 0.8 s at 48 MB peak. Damaged in the main part or the ZIP directory it is repaired in 3.0 to 6.5 s at 170 to 680 MB peak:

| Damage | Outcome | Time | Peak heap |
| --- | --- | --- | --- |
| Directory deleted | Repaired, tier 2 | 3.2 s | 324 MB |
| Cut at 97% | Partial, tier 2 | 3.0 s | 320 MB |
| One flipped bit in the main part | Partial, tier 2 | 4.6 s | 248 MB |
| 4 KB zeroed | Partial, tier 2 | 3.7 s | 172 MB |
| 4 KB dropped | Partial, tier 2 | 5.0 s | 682 MB |
| 4 KB of bytes inserted | Partial, tier 2 | 6.5 s | 264 MB |

Two causes of slowness were fixed: the tier 2 child matcher was quadratic in the number of repeated siblings (22 s for those 19,000 paragraphs, now about 2 s), and a garbled part was cut back by scanning from its end, which scanned the same megabytes repeatedly.

## Phase C input

`libreoffice-bnc591147` has `.avi` and `.mp3` parts with no content type. Seam adds a default for `.mp3` but has none for `.avi`, so verification fails and the whole repair is discarded. The part registry should supply the default.

## Findings that need an owner decision

- Firefox and Chromium disagree on 3 of 588 damaged cases. In each, Seam repairs corrupt XML and the browsers' `DOMParser` disagree about the result. WebKit matched Chromium on all 588. This is the evidence for the guardrail 17 question: whether a checker inside the worker should replace `DOMParser` as the authority.
- When two packages are joined in one file, Seam keeps the later package and reports the removed bytes as leading data. It does not recover both.
