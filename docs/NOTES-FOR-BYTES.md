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
