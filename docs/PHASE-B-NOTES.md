# Phase B notes

Status of the Phase B build on the `v2-bytes` branch and where it differs from `PLAN-V2.md`. Each deviation needs owner sign-off.

## B1: tolerant inflater

`js/core/inflate-tolerant.js` exports `inflateTolerant(bytes, options)` and returns `{ data, holes, gaps, complete, aligned }`.

| Option | Meaning |
|---|---|
| `maxOut` | Hard cap on output bytes. |
| `budgetMs` | Time budget for resynchronisation searches. |
| `searchBytes` | How far past a failure to look for the next block. |
| `expectedSize` | Uncompressed size from the zip header. With it, the hole between the exact head and the recovered tail has a known length. |
| `zeroRuns` | Treat runs of 64 or more zero bytes in the compressed data as damage. |

`holes` are byte ranges of `data` that are unknown. `aligned` is true when the position of every recovered byte is known. `data` before the first hole is exact.

### Differences from the plan

| Change | Reason |
|---|---|
| `zeroRuns` is an option and is off by default. | A healthy stream of repetitive data can contain 64 or more zero bytes. Round trip case 58 in `tests/inflate.test.js` failed with it on. `zip-recover.js` turns it on only for entries already known to be damaged. |
| Decoding continues inside the damaged block after a zero run. | Zero bits decode as valid short codes, so plain decoding never fails at the damage and the stream resynchronises on its own with the wrong length. Stopping at the run and then searching for the next block header loses the rest of the block. |
| The continuation start is chosen by block end and a chain check, not by output. | All 64 start offsets after a run pass a one-block check. Output comparison picked a start that was not on the true path. The chosen start is the group that ends the block at one bit position, whose following blocks decode to the final block, and for which no chain-checked block starts earlier. Without the last condition a run that swallowed a block header continued with the previous block's tables and returned wrong bytes. |
| Everything before the point where all candidate starts agree is unknown. | Different start offsets reach the same symbol boundary after some symbols. Bytes before that boundary are marked unknown. |
| Bytes that depend on the lost window are kept as window pointers and resolved against the exact head. | Match-heavy XML copies from the 32 KB before the resume point. With the size known, those bytes are recovered from the head instead of being dropped. |
| `zip-recover.js` entries gain `holes` and `whole` when the tail was recovered and aligned. `data` stays the exact head. | The XML layer (B2) needs the tail. Nothing consumes the two fields yet. |
| An entry that inflates but fails its CRC is run through the tolerant decoder. It becomes a partial entry only if a zero run was found. | Zeroed bytes inside a deflate stream often inflate to garbage without an error, so the old path labelled them CRC mismatch and kept the garbage. |
| The data descriptor size is read for streamed zips. | The hole length needs it. |

### Limits

- Damage that decodes silently (flipped bits, random junk, a dropped block) is not improved. Plain decoding already reads past it as garbage and the stream has no marker to cut at. The tests for those kinds check only that nothing throws and that any reported hole is honest.
- Recovery after a long zero run is bounded by the window. On 1 MB of match-heavy synthetic XML the gain over plain decoding, as a share of the original bytes, was 25 to 33 points for 512 zeroed bytes, 1.3 to 3.6 for 4096 and 0.8 to 1.1 for 32768. After 4096 zeroed bytes about 24 KB of output is lost, and most later bytes copy from it directly or through other copies. Unknown bytes stay holes. The test thresholds are set under the measured minimums.
- A healthy but truncated stream that contains a genuine run of 64 or more zero bytes is cut at the run when `zeroRuns` is on. The old path kept the exact prefix beyond it.
- Known bytes after the first hole are never wrong in any seed tested. That is the property the tests protect first.
- Entries with more than one gap keep the exact head only, because the hole lengths are not known.

## B2: holes in the XML layer

`js/core/xml-holes.js` has two functions. `spliceHoles(whole, holes)` runs in `loadEntries` for XML parts whose entry has `holes`. It replaces each hole with one U+E000 and trims half a multi-byte character beside it. `resolveHoles(text)` is the one call added to `processXml`, before `cleanChars`. It removes every sentinel and returns the count, and the part gets `XML_HOLE_DROPPED` (severity loss, so the label is Partial).

| Rule | Reason |
|---|---|
| A known stretch of fewer than 16 bytes between two holes is merged into the holes. | Fragments that short are almost always copies of lost structure. |
| A hole in text cuts that text node. A partial entity before the hole is cut with it. | The plan's rule. Joining the text on both sides could make words that never existed. |
| A hole in a start tag drops that element up to its closing tag. If the closing tag is lost too, it stops at the next sibling of the same name or at the parent's closing tag. | Keeps the tree balanced. A sibling of the same name counts only after a child has closed, so `<b><b>` is still nesting. |
| A hole in a closing tag drops that tag only. | The next start tag decides the level. |
| The first start tag after a hole is attached to the nearest open element that the exact head shows holding that name. Open elements above it are closed. If none holds it, the head's parent for that name is added as a new element. | A hole usually swallows the closing tags. Without this, `<w:r>` nests inside `<w:t>`. The relations are learned only from the text before the first hole, because nesting seen after a hole is not reliable. |
| An entry whose tail has holes outranks a CRC mismatch in `mergeEntries`. | A CRC mismatch keeps full-length garbage after the damage. |

### B2 limits

- On match-heavy XML the unknown bytes are mostly the repeated markup, and the known ones are mostly text. After 512 zeroed bytes in a 580 KB `document.xml` of 5000 paragraphs, the repaired part kept more than half of the text runs, most of them cut at a hole. The tail's paragraphs end up in a few paragraphs of their own, not in their original ones. The output is valid, not faithful.
- Wrappers are added from what the head shows, not from a schema. An element that needs required children can come out incomplete. Phase C3 should check this.
- UTF-16 parts are not spliced. They keep the exact head only.

## B3: ZIP layer

| Item | State |
|---|---|
| ZIP64 | The local header scan reads the 0x0001 extra field for both sizes, and the 8-byte sizes in a ZIP64 data descriptor. The central directory and end records were already read by v1. |
| Entry selection | `mergeEntries` orders copies by state (ok, CRC mismatch, partial), then an ok copy from the central directory, then well-formed XML, then the longest. When the copies differ in content, the entry carries `rejected` and the pipeline reports `ZIP_ENTRY_CHOSEN` (Noted). |
| Central directory as a map | `strictRead` records each entry's data start and compressed size. `recoverEntries` takes them as hints: a streamed entry whose local header has no sizes is bounded by the central sizes and checked against the central CRC, with no scan for `PK` candidates. |
| CRLF | Done by the main agent. |
| Offset shift after a point | Not a separate finding. A central offset that is wrong after an insertion or a dropped block leaves that entry unreadable in the strict pass, the local scan recovers it, and the existing `ZIP_DIRECTORY_REBUILT` reports the rebuild. A separate `ZIP_OFFSETS_REBASED` would repeat it. |

### B3 differences from the plan

- The fixed 16-candidate limit is raised to 64, not removed. It still applies to a streamed entry that the central directory does not describe. A scan with no bound would try to inflate from every `PK` signature inside an embedded stored package.
- v1 test `merge: ok beats crcMismatch beats partial` expected a later ok copy to win a tie by length. The plan's order puts the central directory copy first, so the test now expects the central copy to stay. Changes an existing test.

## B4: orphan streams

| Item | State |
|---|---|
| Directory path | `strictRead` keeps each entry's local header offset and compressed size. When the local header is gone but the central directory entry survives, `recoverHeaderless` looks for the data where the next entry or the directory begins (with and without a data descriptor), and for a deflate entry also at the offsets a header of that name could end. A candidate counts only if it inflates to the directory's size and CRC. The part keeps its true name and ends up `ok`. |
| Gap scan | `findOrphans` in `zip-orphans.js`. It takes the byte ranges that no recovered entry covers, up to the central directory, and looks for a deflate stream within 800 bytes of the start of each gap. A 2 KB probe rules out almost every offset, and the full decode must finish a final block. The stream must then end exactly at the gap end, or at a data descriptor whose CRC matches. A stream that ends earlier is accepted only when its content is recognised, so two header-less parts in a row both come back. Stored PNG, JPEG and GIF are found by their end markers. |
| Identification | `orphan-kinds.js`. Root element and namespace for Word, Excel and PowerPoint parts, theme, content types, core and app properties. Relationships by their types. Media by magic bytes (PNG, JPEG, GIF, EMF, WMF, MP4, CFB for macros). |
| Naming | Placed in the pipeline after the XML stage and before the main part is classified. A part with one fixed path goes there if the path is free. A relationships part goes to its usual path if its source part exists. A numbered part (sheet, slide, layout, picture, theme) goes to the one referenced path of that kind that is free. If there is no such path, or more than one, it is kept as `seam-recovered/partN.<ext>`. |
| Findings | `ZIP_ORPHAN_NAMED` (Repaired) and `ZIP_ORPHAN_KEPT` (Noted). Both are kept in a Salvaged result. An orphan identical to a part already read is dropped without a finding. |

### B4 differences from the plan

- The part registry from C1 has not landed on `v2`. The root element to path table lives in `orphan-kinds.js` and is meant to be replaced by the registry.
- The directory path is new. It recovers a part under its real name, which the plan's gap scan cannot.
- Orphans come from the first copy only.

### B4 limits

- Two header-less sheets (or slides) at once are not told apart. The plan's rule is followed: both are kept under `seam-recovered`.
- A part whose bits were flipped but whose stream still decodes is named like any other. Its text can carry the flipped characters, as for any silent-garbage damage. In a damage run over three fixtures, bit flips gave seven such parts. Every dropblock orphan was byte-identical to an original part.
- A streamed entry whose descriptor scan swallows the following header-less data keeps that data inside the first entry.
- The scan costs under 0.4 s per file in the damage-kind runs on the fixtures. It stops after 3 s and 64 orphans.

## B5: several copies

| Item | State |
|---|---|
| UI | A row below Repaired (Partially repaired, Salvaged text, Could not repair) that still holds its file gets an "Add another copy" button and a one-line hint. The file picker is hidden and takes up to 4 extra copies per row. The row goes back to Queued and the job runs again with every buffer. A repaired row drops its file handles. |
| Worker | The `process` message carries `copies: [{name, buffer}]`. The time budget scales with the number of buffers. |
| Pipeline | Each copy goes through the strict read and `recoverEntries` on its own, with its own prefix and directory. `mergeCopies` then picks one entry per part name. |
| Selection | An earlier copy wins a tie. A later copy wins only with a strictly better state, using the B3.2 ranks (ok, then CRC mismatch, then partial with holes, then partial). Two intact copies of one part never swap. |
| Findings | `MULTI_PART_FROM` (Noted) names the copy a part came from. `MULTI_COPY_UNUSED` (Noted) names a copy that gave nothing, and says why: not a package, not the same file, or nothing more complete. |
| Cut-short flag | `ZIP_ENDS_EARLY` is dropped when an accepted copy ends cleanly. Otherwise it would stay a Lost line and keep the row at Partially repaired with nothing lost. |

### B5 same-file check

A copy is used only when it agrees with the copies already accepted. Parts that are intact in both must be byte-identical, and at least one such part, or one damaged part whose known bytes match, must exist. Otherwise the copy is refused as a different version and nothing is taken from it.

A damaged part is compared by its known bytes (the exact head, and the bytes after each hole). It counts as a conflict only when at least 4096 bytes are known, no 512-byte run matches, and more than half differ. A bit flip leaves garbage that the decoder cannot tell from text, so a lower bar rejected good copies in testing.

### B5 limits

- A different version whose damaged part is unreadable in the first copy cannot be told apart. If the other parts are identical (same template), its content part is taken, and `MULTI_PART_FROM` says so.
- Parts are selected whole. Two copies damaged in different places of the same part do not fill each other's holes. The better of the two is kept.
- The text-mode transfer reversal applies to the first copy only.
- Copies are compared on part bytes, so a copy saved by a different program that rewrites every part is refused.

## B6: donor file

| Item | State |
|---|---|
| UI | A Partially repaired or Salvaged row that still holds its file gets "Use a healthy file from the same source" and a hint saying what is never taken. One donor per row; a new one replaces the old. The row runs again. |
| Worker | The `process` message carries `donor: {name, buffer}`. |
| Allow-list | `js/core/donor.js`. Word styles, stylesWithEffects, numbering, fontTable, settings, webSettings and themes. Excel styles and themes. PowerPoint themes, tableStyles, presProps, viewProps, slide layouts and masters, and the rels files of layouts and masters. Nothing else, so no text, cells, slides, comments, pictures, charts, embeddings or macros. |
| Step | After the main part is found and before the rels are repaired. The donor is read like any package and only parts that are intact in it (CRC verified) can be used. |
| Which parts | A part is borrowed when it is on the allow-list, a relationship in this file still points at it, and this file's own copy is missing or not intact. The rels of a borrowed layout or master follow it, and the loop runs up to four rounds so that layouts named by a borrowed master are found. |
| Findings | `DONOR_PART_BORROWED` (Noted) per part. `DONOR_UNUSED` (Noted) when the donor is not a package, is another kind of file, or had nothing the file was missing. |
| Superseded lines | A borrowed part's own damage lines (truncated, CRC, unreadable, XML repaired or dropped) are removed, since the part is no longer the damaged one. |
| Salvage | Copy and donor findings are kept in a Salvaged or Could not repair result so the user sees why nothing was taken. |

### B6 limits

- The donor cannot be told apart from another document made from the same template. Styles, themes and layouts then come from the template, which is the intent, and the Noted line says the formatting may differ.
- A part that is intact in this file is never replaced, even if the donor's differs.
- A part with no relationship pointing at it is not borrowed.
- When the main part is missing the donor cannot help, and the row says so.

## Not yet measured

The Phase B exit numbers (+15 points median text recall on zero512, zero4096, dropblock and bitflip, and the crlf row) need the damage lab and scoreboard run on the corpus. The B1 and B2 gains reach the output file only for zero runs inside deflate entries. Nothing else in Phase B has been measured on the corpus. B5 is exercised only by copies damaged in the test suite, not by corpus files.

## Speed

`tests/inflate.test.js` asserts the undamaged path is within twice the time of fflate on a 20 MB part.
