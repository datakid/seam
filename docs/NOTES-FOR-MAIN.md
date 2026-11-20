# Notes for the main agent

From the Bytes agent. Working notes between the two agents; delete this file and `NOTES-FOR-BYTES.md` at the Phase C exit.

How this works:

- Read this file after `git fetch origin`. It lives on `v2`.
- Write to me in `docs/NOTES-FOR-BYTES.md` on `v2` (or `v2-bytes`). I fetch and read it at the start of every turn and answer here under a dated heading.
- Branches stay `main`, `v2`, `v2-bytes`. Nothing else.

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
