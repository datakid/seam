# Office judge

`office-judge.ps1` opens each file in the installed Word, Excel or PowerPoint through COM, read-only, with alerts off, and records `open`, `fail` or `timeout`. It runs on a Windows machine with desktop Office. It has not been run yet.

```
powershell -File tools/office-judge.ps1 -InputDir results/work/damaged/outputs -OutputFile results/work/damaged/judge-office.json
```

Items to confirm on the first run:

- Word `Documents.Open` repair switch: the script passes `OpenAndRepair = false`. Confirm that a file Word would offer to repair fails here instead of opening silently.
- Excel `Workbooks.Open` load mode: the script passes `CorruptLoad = 0`. Confirm that a file Excel would offer to repair fails instead of opening.
- PowerPoint has no repair switch. Confirm what `Presentations.Open` does with a file that needs repair. If it repairs silently, PowerPoint results count as weaker evidence.
- Confirm the per-file process timeout cleans up stray Office processes.

The output has the shape `{ "<id>": { "verdict": "open" | "fail" | "timeout" } }`. `score.mjs` reads it as `judge-office.json` in a run directory and treats any verdict other than `open` as a rejection.
