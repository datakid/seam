# Seam scoreboard

Run `local-n3` on 2026-11-25, commit c52f74f. Browser: 153.0.8010.0. LibreOffice: LibreOffice 24.2.7.2 420(Build:2).
Healthy files: 300. Damaged cases: 1139.

## 1. Healthy files: false alarms

A false alarm is any label other than No problems found on a healthy file. Total: 0 of 300 (0%). On files LibreOffice also loads: 0 of 300.

| Producer | Files | False alarms | Rate |
|---|---|---|---|
| excel | 55 | 0 | 0% |
| libreoffice | 62 | 0 | 0% |
| other | 60 | 0 | 0% |
| poi | 8 | 0 | 0% |
| powerpoint | 57 | 0 | 0% |
| word | 56 | 0 | 0% |
| wps | 2 | 0 | 0% |

Findings that appear on false alarms:

| Finding | Files |
|---|---|

Healthy by manifest but confirmed broken, repaired correctly, and not counted above: 4. Each has evidence in `corpus/manifest/triage.json`.

| File | Findings | Open XML SDK on the original |
|---|---|---|
| libreoffice-bad | EXTENSION_CORRECTED | not run |
| libreoffice-bnc591147 | CT_DEFAULT_ADDED | not run |
| poi-64450 | REL_REMOVED, XLSX_SST_COUNTS | not run |
| poi-picture | REL_REMOVED, XLSX_SST_COUNTS, CT_OVERRIDE_REMOVED | not run |

Quarantine candidates (healthy by manifest, not loaded by LibreOffice): none.

## 2. Damaged files by kind

Pass rate is the share of outputs labelled Repaired that every available judge accepts. Recall is the share of the original text found in the output, as the median over cases. The baseline is LibreOffice opening the damaged file with no help.

| Kind | Cases | No problems | Repaired | Partial | Salvaged | Failed | Not supported | Judge pass (Repaired) | Recall, Seam | Recall, baseline | Seam better |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bitflip | 80 | 4 | 5 | 55 | 4 | 12 | 0 | 5/5 | 1 | n/a | n/a |
| concat | 82 | 0 | 82 | 0 | 0 | 0 | 0 | 79/79 | 1 | n/a | n/a |
| crlf | 87 | 0 | 82 | 5 | 0 | 0 | 0 | 81/81 | 1 | n/a | n/a |
| dropblock | 96 | 0 | 1 | 74 | 5 | 16 | 0 | 1/1 | 1 | n/a | n/a |
| head | 87 | 0 | 31 | 32 | 6 | 15 | 3 | 31/31 | 1 | n/a | n/a |
| insert | 82 | 1 | 21 | 57 | 1 | 2 | 0 | 21/21 | 1 | n/a | n/a |
| losttail | 100 | 0 | 1 | 81 | 2 | 16 | 0 | 1/1 | 1 | n/a | n/a |
| padzero | 78 | 0 | 1 | 66 | 2 | 9 | 0 | 1/1 | 1 | n/a | n/a |
| prefix | 87 | 0 | 87 | 0 | 0 | 0 | 0 | 86/86 | 1 | n/a | n/a |
| suffix | 80 | 79 | 1 | 0 | 0 | 0 | 0 | 1/1 | 1 | n/a | n/a |
| truncate | 95 | 0 | 0 | 73 | 0 | 22 | 0 | n/a | 1 | n/a | n/a |
| zero4096 | 92 | 0 | 0 | 60 | 8 | 19 | 5 | n/a | 1 | n/a | n/a |
| zero512 | 93 | 0 | 0 | 81 | 2 | 10 | 0 | n/a | 1 | n/a | n/a |

## 2b. Verification tiers

Per tier of the output Seam produced: how many outputs, how many each judge accepted, and the median number of Open XML SDK errors on files it opens.

| Tier | Meaning | Outputs | LibreOffice loads | Open XML SDK opens | SDK median errors |
|---|---|---|---|---|---|
| 0 | Fails structural checks | 0 | n/a | n/a | n/a |
| 1 | Structural checks | 177 | 172/172 | n/a | n/a |
| 2 | Structural and content checks | 749 | 739/740 | n/a | n/a |

## 2c. Open XML SDK messages by element

No per-message data. The judge records up to 40 messages per file; run it again to fill this table.

## 2d. Phase exit gates

Phase A: healthy false alarms 0 (gate 0); outputs labelled Repaired that a judge rejects 0 (gate 0).

Phase B: `crlf` cases that reach Repaired with recall of at least 0.99: 82 of 87 (94.3%; gate 90%). The plan's +15 point median gate cannot be met because the median was already 1.000 before Phase B; the owner replaced it on 2026-11-25 with the share of outputs at recall 0.99 and the Repaired count per kind below, and no case losing more than 0.02 of recall without an explanation.

| Kind | Cases | Recall at least 0.99 | Repaired |
|---|---|---|---|
| bitflip | 80 | 76.3% | 5 |
| concat | 82 | 100% | 82 |
| crlf | 87 | 100% | 82 |
| dropblock | 96 | 79.2% | 1 |
| head | 87 | 78.2% | 31 |
| insert | 82 | 91.5% | 21 |
| losttail | 100 | 72% | 1 |
| padzero | 78 | 84.6% | 1 |
| prefix | 87 | 100% | 87 |
| suffix | 80 | 100% | 1 |
| truncate | 95 | 72.6% | 0 |
| zero4096 | 92 | 71.7% | 0 |
| zero512 | 93 | 82.8% | 0 |

Against the end of Phase A (1139 cases): 26 gain more than 0.02 of recall, 1 lose more than 0.02, 0 of those without an explanation.

- poi-52348__padzero__0 (padzero): 0.286 to 0.196. Not a loss. After the first zero run the old decoder replayed earlier text out of the zero bits, 533 cells of which 56 differed; the new output holds the 56 real cells. See docs/PHASE-B-NOTES.md, B8.

Phase C: Repaired outputs that every judge accepts, by family, and the median Open XML SDK errors on tier 2 outputs the SDK opens. Gate: xlsx and pptx within 2 points of docx, and median 0 for each family.

| Family | Repaired judged | Accepted | Rate | Tier 2 outputs judged | SDK median errors |
|---|---|---|---|---|---|
| docx | 110 | 110 | 100% | 0 | n/a |
| pptx | 102 | 102 | 100% | 0 | n/a |
| xlsx | 95 | 95 | 100% | 0 | n/a |

## 3. Over-labels

Outputs labelled Repaired that a judge rejects: 0 of 307 judged.

Outputs labelled Partially repaired that a judge rejects (tracked, not gated): 1.

## 4. Time and memory

Median 62 ms, 95th percentile 435 ms, slowest 14716 ms. Highest heap growth 382 MB. Method: js-heap-sampled (Chromium performance.memory, sampled at stage boundaries).

## 5. Browsers

Not compared.

## 6. Gaps

- Google: 0 of 5 files
- Apple: 0 of 5 files
- WPS: 2 of 5 files
- python-docx, openpyxl or python-pptx: 0 of 5 files
- Open XML SDK judge: not run
- Office judge: not run
- Browsers run: chromium
- 5 outputs labelled Repaired have no judge verdict
- 14 cases derived from files LibreOffice cannot load were not judged by LibreOffice
- LibreOffice judge on healthy files: not run
