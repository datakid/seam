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

### Not yet measured

The Phase B exit numbers (+15 points median text recall on zero512, zero4096, dropblock and bitflip, and the crlf row) need the damage lab and scoreboard run on the corpus. B2 has to consume `holes` before any of the B1 gain reaches the output file.

### Speed

`tests/inflate.test.js` asserts the undamaged path is within twice the time of fflate on a 20 MB part.
