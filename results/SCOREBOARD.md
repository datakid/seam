# Seam scoreboard

Run `score-main-2-12` on 2026-11-27, commit 74c64c2. Browser: 159.0.8154.6. LibreOffice: LibreOffice 24.2.7.2 420(Build:2).
Healthy files: 318. Damaged cases: 12402.

## 1. Healthy files: false alarms

A false alarm is any label other than No problems found on a healthy file. Total: 0 of 318 (0%). On files LibreOffice also loads: 0 of 316.

| Producer | Files | False alarms | Rate |
|---|---|---|---|
| excel | 55 | 0 | 0% |
| libreoffice | 62 | 0 | 0% |
| other | 60 | 0 | 0% |
| poi | 8 | 0 | 0% |
| powerpoint | 57 | 0 | 0% |
| python | 18 | 0 | 0% |
| word | 56 | 0 | 0% |
| wps | 2 | 0 | 0% |

Findings that appear on false alarms:

| Finding | Files |
|---|---|

Healthy by manifest but confirmed broken, repaired correctly, and not counted above: 4. Each has evidence in `corpus/manifest/triage.json`.

| File | Findings | Open XML SDK on the original |
|---|---|---|
| libreoffice-bad | EXTENSION_CORRECTED | opens, 1 errors |
| libreoffice-bnc591147 | CT_DEFAULT_ADDED | does not open |
| poi-64450 | REL_REMOVED, XLSX_SST_COUNTS | does not open |
| poi-picture | REL_REMOVED, XLSX_SST_COUNTS, CT_OVERRIDE_REMOVED | does not open |

Quarantine candidates (healthy by manifest, not loaded by LibreOffice): libreoffice-comment-in-footnote, libreoffice-tdf173266.

## 2. Damaged files by kind

Pass rate is the share of outputs labelled Repaired that every available judge accepts. Recall is the share of the original text found in the output, as the median over cases. The baseline is LibreOffice opening the damaged file with no help.

| Kind | Cases | No problems | Repaired | Partial | Salvaged | Failed | Not supported | Judge pass (Repaired) | Recall, Seam | Recall, baseline | Seam better |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bitflip | 954 | 37 | 26 | 670 | 53 | 168 | 0 | 26/26 | 1 | 0 | 556/954 |
| concat | 954 | 2 | 952 | 0 | 0 | 0 | 0 | 952/952 | 1 | 0 | 954/954 |
| crlf | 954 | 0 | 912 | 42 | 0 | 0 | 0 | 912/912 | 1 | 0 | 942/954 |
| dropblock | 954 | 0 | 11 | 772 | 56 | 115 | 0 | 11/11 | 1 | 0 | 837/954 |
| head | 954 | 0 | 229 | 476 | 55 | 177 | 17 | 229/229 | 1 | 0 | 727/954 |
| insert | 954 | 18 | 266 | 661 | 6 | 3 | 0 | 266/266 | 1 | 0 | 928/954 |
| losttail | 954 | 0 | 15 | 747 | 23 | 169 | 0 | 15/15 | 1 | 0 | 754/954 |
| padzero | 954 | 0 | 35 | 816 | 10 | 93 | 0 | 35/35 | 1 | 0 | 835/954 |
| prefix | 954 | 0 | 954 | 0 | 0 | 0 | 0 | 954/954 | 1 | 0 | 954/954 |
| suffix | 954 | 942 | 12 | 0 | 0 | 0 | 0 | 12/12 | 1 | 1 | 192/954 |
| truncate | 954 | 0 | 4 | 695 | 28 | 227 | 0 | 4/4 | 1 | 0 | 736/954 |
| zero4096 | 954 | 0 | 0 | 649 | 54 | 218 | 33 | n/a | 1 | 0 | 665/954 |
| zero512 | 954 | 0 | 0 | 818 | 20 | 116 | 0 | n/a | 1 | 0 | 650/954 |

## 2b. Verification tiers

Per tier of the output Seam produced: how many outputs, how many each judge accepted, and the median number of Open XML SDK errors on files it opens.

| Tier | Meaning | Outputs | LibreOffice loads | Open XML SDK opens | SDK median errors |
|---|---|---|---|---|---|
| 0 | Fails structural checks | 0 | n/a | n/a | n/a |
| 1 | Structural checks | 1845 | 1796/1812 | 1770/1845 | 2 |
| 2 | Structural and content checks | 8222 | 8140/8156 | 8107/8222 | 0 |

## 2c. Open XML SDK messages by element

Counted over the first 40 messages the SDK reported for each output. Element is the node the message names.

| Element | Messages | Files | Most common message ID | By family |
|---|---|---|---|---|
| rPr | 3137 | 239 | Sch_UnexpectedElementContentExpectingComplex | docx 2751, pptx 208, xlsx 178 |
| font | 2072 | 321 | Sch_UnexpectedElementContentExpectingComplex | xlsx 1878, docx 127, pptx 67 |
| style | 1456 | 97 | Sch_UnexpectedElementContentExpectingComplex | docx 1341, xlsx 79, pptx 36 |
| pPr | 1275 | 221 | Sch_UnexpectedElementContentExpectingComplex | docx 1151, pptx 34, xlsx 90 |
| xf | 995 | 30 | Sch_UndeclaredAttribute | xlsx 957, docx 38 |
| color | 890 | 47 | Sch_AttributeValueDataTypeDetailed | xlsx 736, docx 72, pptx 82 |
| pageSetup | 646 | 281 | Sem_AttributeValueDataTypeDetailed | xlsx 571, docx 37, pptx 38 |
| tcBorders | 635 | 34 | Sch_UnexpectedElementContentExpectingComplex | docx 616, xlsx 19 |
| scrgbClr | 630 | 35 | Sch_AttributeValueDataTypeDetailed | docx 612, xlsx 18 |
| tcPr | 628 | 34 | Sch_UnexpectedElementContentExpectingComplex | docx 609, xlsx 19 |
| settings | 580 | 580 | Sch_InvalidElementContentExpectingComplex | docx 537, pptx 18, xlsx 25 |
| duotone | 400 | 100 | Sch_UndeclaredAttribute | pptx 120, docx 260, xlsx 20 |
| xmlColumnPr | 377 | 24 | Sem_MissingReferenceElement | xlsx 377 |
| c | 297 | 20 | Sem_MissingIndexedElement | xlsx 297 |
| pgMar | 248 | 38 | Sch_AttributeValueDataTypeDetailed | docx 241, xlsx 7 |
| spcPct | 211 | 36 | Sch_AttributeValueDataTypeDetailed | docx 204, pptx 1, xlsx 6 |
| axId | 208 | 52 | Sch_AttributeValueDataTypeDetailed | pptx 188, docx 12, xlsx 8 |
| cantSplit | 186 | 46 | Sch_AttributeValueDataTypeDetailed | docx 174, xlsx 12 |
| rect | 184 | 68 | Sch_UndeclaredAttribute | docx 173, pptx 9, xlsx 2 |
| lsdException | 178 | 20 | Sch_UndeclaredAttribute | docx 178 |
| dLbls | 156 | 26 | Sch_UnexpectedElementContentExpectingComplex | docx 12, xlsx 144 |
| row | 130 | 29 | Sem_AttributeValueDataTypeDetailed | xlsx 122, docx 4, pptx 4 |
| name | 129 | 34 | Sch_AttributeValueDataTypeDetailed | docx 116, pptx 12, xlsx 1 |
| docGrid | 123 | 97 | Sch_AttributeValueDataTypeDetailed | docx 118, pptx 2, xlsx 3 |
| phoneticPr | 121 | 65 | Sem_MissingIndexedElement | xlsx 121 |

## 2d. Phase exit gates

Phase A: healthy false alarms 0 (gate 0); outputs labelled Repaired that a judge rejects 0 (gate 0), not counting 19 that fail like their original.

Phase B: `crlf` cases that reach Repaired with recall of at least 0.99: 912 of 954 (95.6%; gate 90%). The plan's +15 point median gate cannot be met because the median was already 1.000 before Phase B; the owner replaced it on 2026-11-25 with the share of outputs at recall 0.99 and the Repaired count per kind below, and no case losing more than 0.02 of recall without an explanation.

| Kind | Cases | Recall at least 0.99 | Repaired |
|---|---|---|---|
| bitflip | 954 | 67.1% | 26 |
| concat | 954 | 100% | 952 |
| crlf | 954 | 98.7% | 912 |
| dropblock | 954 | 76.2% | 11 |
| head | 954 | 74.6% | 229 |
| insert | 954 | 95.3% | 266 |
| losttail | 954 | 69.1% | 15 |
| padzero | 954 | 80.1% | 35 |
| prefix | 954 | 100% | 954 |
| suffix | 954 | 100% | 12 |
| truncate | 954 | 71.4% | 4 |
| zero4096 | 954 | 70.2% | 0 |
| zero512 | 954 | 79.1% | 0 |

Against the end of Phase A (1139 cases): 26 gain more than 0.02 of recall, 1 lose more than 0.02, 0 of those without an explanation.

- poi-52348__padzero__0 (padzero): 0.286 to 0.196. Not a loss. After the first zero run the old decoder replayed earlier text out of the zero bits, 533 cells of which 56 differed; the new output holds the 56 real cells. See docs/PHASE-B-NOTES.md, B8.

Phase C: Repaired outputs that every judge accepts, by family, and the median Open XML SDK errors on tier 2 outputs the SDK opens. Gate: xlsx and pptx within 2 points of docx, and median 0 for each family.

| Family | Repaired judged | Accepted | Rate | Tier 2 outputs judged | SDK median errors |
|---|---|---|---|---|---|
| docx | 1148 | 1148 | 100% | 2522 | 0 |
| pptx | 1128 | 1128 | 100% | 3066 | 0 |
| xlsx | 1140 | 1140 | 100% | 2519 | 0 |

## 3. Over-labels

Outputs labelled Repaired that a judge rejects: 0 of 3416 judged.

Outputs labelled Repaired that the Open XML SDK cannot open, with the same message as the original they were repaired from (the SDK cannot read that original, so it is blind on them; listed, not gated): 19.

| File | Kind | Same message as | Findings |
|---|---|---|---|
| libreoffice-tdf148478_transitionMusic__prefix__2 | prefix | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA |
| libreoffice-tdf125300__concat__2 | concat | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| poi-58760__crlf__2 | crlf | poi-58760 | TRANSFER_CRLF_REVERSED |
| poi-58760__prefix__1 | prefix | poi-58760 | ZIP_PREFIX_DATA |
| libreoffice-tdf125298_crossreflink_nonascii_charlimit__concat__2 | concat | poi-58760 | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| libreoffice-n777345__concat__0 | concat | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| poi-58760__crlf__0 | crlf | poi-58760 | TRANSFER_CRLF_REVERSED |
| libreoffice-tdf148478_transitionMusic__prefix__1 | prefix | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA |
| libreoffice-threadedComment__concat__1 | concat | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| poi-58760__insert__1 | insert | poi-58760 | ZIP_PREFIX_DATA |
| libreoffice-fdo63053__concat__2 | concat | poi-58760 | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| poi-58760__prefix__0 | prefix | poi-58760 | ZIP_PREFIX_DATA |
| poi-picture__concat__2 | concat | poi-58760 | ZIP_PREFIX_DATA |
| libreoffice-tdf148478_transitionMusic__prefix__0 | prefix | libreoffice-tdf148478_transitionMusic | ZIP_PREFIX_DATA |
| poi-58760__crlf__1 | crlf | poi-58760 | TRANSFER_CRLF_REVERSED |
| poi-58760__prefix__2 | prefix | poi-58760 | ZIP_PREFIX_DATA |
| oxml-sdk-Document__concat__2 | concat | poi-58760 | ZIP_PREFIX_DATA, EXTENSION_CORRECTED |
| poi-58760__insert__2 | insert | poi-58760 | ZIP_PREFIX_DATA |
| poi-52348__concat__2 | concat | poi-58760 | ZIP_PREFIX_DATA |

Outputs labelled Partially repaired that a judge rejects (tracked, not gated): 661.

## 4. Time and memory

Median 72 ms, 95th percentile 351 ms, slowest 56371 ms. Highest heap growth 1654.1 MB. Method: js-heap-sampled (Chromium performance.memory, sampled at stage boundaries).

## 5. Browsers

588 cases across chromium, firefox, webkit: 0 differences


## 6. Gaps

- Google: 0 of 5 files
- Apple: 0 of 5 files
- WPS: 2 of 5 files
- Office judge: not run
- 99 cases derived from files LibreOffice cannot load were not judged by LibreOffice
