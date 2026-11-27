const PARTIAL_STATES = new Set(['partial', 'crcMismatch']);

export function partInventory(strict, entries) {
  if (!strict.eocdFound || strict.parsed !== strict.total) return null;
  const listed = new Set(strict.entries.map((entry) => entry.name.toLowerCase()));
  const best = new Map();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (!listed.has(key)) continue;
    const rank = entry.state === 'ok' ? 2 : PARTIAL_STATES.has(entry.state) ? 1 : 0;
    if (!best.has(key) || rank > best.get(key)) best.set(key, rank);
  }
  let recovered = 0;
  let partial = 0;
  for (const rank of best.values()) {
    if (rank === 2) recovered++;
    else if (rank === 1) partial++;
  }
  return { expected: listed.size, recovered, partial };
}

const REBUILT = {
  sheets: 'XLSX_WORKBOOK_REBUILT',
  slides: 'PPTX_PRESENTATION_REBUILT'
};

export function buildInventory(ctx) {
  const rows = [];
  const counts = ctx.inventory || {};
  for (const id of ['parts', 'sheets', 'slides']) {
    const row = counts[id];
    if (!row || !Number.isInteger(row.expected) || !Number.isInteger(row.recovered)) continue;
    if (REBUILT[id] && ctx.findings.some((finding) => finding.code === REBUILT[id])) continue;
    if (row.recovered > row.expected) continue;
    rows.push({ id, ...row });
  }
  return rows;
}
