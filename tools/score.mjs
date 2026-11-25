import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extractText, recall } from './text-extract.mjs';
import { loadManifest, cachePath } from './corpus-fetch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const healthyDir = resolve(root, flag('healthy', 'results/work/healthy'));
const damagedDirs = flag('damaged', 'results/work/damaged').split(',').map((d) => resolve(root, d));
const outDir = resolve(root, flag('out', 'results'));
const label = flag('label', 'local');
const gate = args.includes('--gate');
const browsersPath = join(outDir, 'browsers.txt');
const browsersText = existsSync(browsersPath) ? readFileSync(browsersPath, 'utf8').trim() : '';
const triage = (() => {
  const path = join(root, 'corpus', 'manifest', 'triage.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
})();

function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function readJsonl(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      out[row.id] = row;
    } catch {}
  }
  return out;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const pct = (n, d) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 1000) / 10}%`);
const num = (v, digits = 2) => (v === null || v === undefined ? 'n/a' : String(Math.round(v * 10 ** digits) / 10 ** digits));

const blind = readJson(join(root, 'corpus', 'manifest', 'judge-blind.json'), {});
let blindCases = 0;

const manifest = Object.fromEntries(loadManifest('healthy').map((e) => [e.id, e]));
const pristineCache = new Map();

function pristineTokens(sourceId) {
  if (!pristineCache.has(sourceId)) {
    const entry = manifest[sourceId];
    const path = entry ? cachePath(entry) : null;
    pristineCache.set(sourceId, path && existsSync(path) ? extractText(new Uint8Array(readFileSync(path))).tokens : []);
  }
  return pristineCache.get(sourceId);
}

function withoutTrailingData(bytes) {
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x05 && bytes[at + 3] === 0x06) {
      return bytes.subarray(0, Math.min(bytes.length, at + 22 + bytes[at + 20] + (bytes[at + 21] << 8)));
    }
  }
  return bytes;
}

function tokensOfFile(path) {
  if (!existsSync(path)) return [];
  const bytes = new Uint8Array(readFileSync(path));
  const direct = extractText(bytes);
  if (direct.ok !== false) return direct.tokens;
  return extractText(withoutTrailingData(bytes)).tokens;
}

const healthySeam = readJson(join(healthyDir, 'seam.json'), { cases: {} });
const healthyLoIn = readJsonl(join(healthyDir, 'judge-lo-in', 'lo.jsonl'));
const healthyOxml = readJson(join(healthyDir, 'judge-oxml.json'), {});
const healthyRows = Object.entries(healthySeam.cases).map(([id, s]) => ({
  id,
  family: manifest[id] ? manifest[id].family : null,
  producerClass: manifest[id] ? manifest[id].producerClass : 'unknown',
  producer: manifest[id] ? manifest[id].producer : 'unknown',
  label: s.outcome,
  findings: s.findings.map((f) => f.code),
  loLoads: healthyLoIn[id] ? healthyLoIn[id].load : null,
  oxml: healthyOxml[id] ? { opens: healthyOxml[id].opens, errors: healthyOxml[id].errors } : null,
  ms: s.ms,
  peakMB: s.peakMB
}));
for (const r of healthyRows) r.triage = triage[r.id] ? triage[r.id].status : null;
const quarantine = healthyRows.filter((r) => r.loLoads === false).map((r) => r.id);
const knownBroken = healthyRows.filter((r) => r.label === 'repaired' && r.triage === 'confirmed-broken');
const falseAlarms = healthyRows.filter((r) => r.label !== 'noProblems' && !knownBroken.includes(r));
const falseAlarmsLoadable = falseAlarms.filter((r) => r.loLoads !== false);

const rows = [];
const damagedSeam = { cases: {}, browser: null, browserVersion: null };
const anyJudge = { oxml: false, office: false };

function judgeVerdict(judges) {
  const reasons = [];
  if (judges.lo && judges.lo.load === false) reasons.push('lo');
  if (judges.oxml) {
    const worse = typeof judges.oxml.baselineErrors === 'number' && judges.oxml.errors > judges.oxml.baselineErrors;
    if (judges.oxml.opens === false || worse) reasons.push('oxml');
  }
  if (judges.office && judges.office.verdict && judges.office.verdict !== 'open') reasons.push('office');
  return reasons;
}

const sdkByElement = new Map();

for (const damagedDir of damagedDirs) {
  const seam = readJson(join(damagedDir, 'seam.json'), { cases: {} });
  damagedSeam.browser = damagedSeam.browser || seam.browser || null;
  damagedSeam.browserVersion = damagedSeam.browserVersion || seam.browserVersion || null;
  Object.assign(damagedSeam.cases, seam.cases);
  const cases = readJson(join(damagedDir, 'cases.json'), {});
  const loOut = readJsonl(join(damagedDir, 'judge-lo-out', 'lo.jsonl'));
  const loIn = readJsonl(join(damagedDir, 'judge-lo-in', 'lo.jsonl'));
  const oxml = readJson(join(damagedDir, 'judge-oxml.json'), {});
  const office = readJson(join(damagedDir, 'judge-office.json'), {});
  if (Object.keys(oxml).length > 0) anyJudge.oxml = true;
  if (Object.keys(office).length > 0) anyJudge.office = true;
  for (const [id, s] of Object.entries(seam.cases)) {
    const c = cases[id];
    if (!c) continue;
    const pristine = pristineTokens(c.source);
    const out = s.outputs && s.outputs.output ? join(damagedDir, 'outputs', s.outputs.output.file) : null;
    let outTokens = [];
    if (out) outTokens = tokensOfFile(out);
    else if (s.outcome === 'noProblems') outTokens = tokensOfFile(join(damagedDir, 'files', `${id}.${c.ext}`));
    const textRecall = c.kind === 'concat' && c.otherId ? Math.max(recall(pristine, outTokens), recall(pristineTokens(c.otherId), outTokens)) : recall(pristine, outTokens);
    let baselineRecall = 0;
    const lo = loIn[id];
    if (lo && lo.rtFile) baselineRecall = recall(pristine, tokensOfFile(join(damagedDir, 'judge-lo-in', 'rt', lo.rtFile)));
    const isBlind = Boolean(blind[c.source] || (c.otherId && blind[c.otherId]));
    if (isBlind && out) blindCases++;
    const bases = [healthyOxml[c.source], c.otherId ? healthyOxml[c.otherId] : null].filter(Boolean).map((r) => r.errors).filter((v) => typeof v === 'number');
    if (out && oxml[id] && Array.isArray(oxml[id].list)) {
      for (const message of oxml[id].list) {
        const key = message.node || 'unknown';
        const row = sdkByElement.get(key) || { messages: 0, files: new Set(), ids: new Map(), families: new Map() };
        row.messages++;
        row.files.add(id);
        row.ids.set(message.id, (row.ids.get(message.id) || 0) + 1);
        row.families.set(c.family, (row.families.get(c.family) || 0) + 1);
        sdkByElement.set(key, row);
      }
    }
    const { list: dropped, ...oxmlSlim } = oxml[id] || {};
    const oxmlRow = out && oxml[id] ? { ...oxmlSlim, baselineErrors: bases.length > 0 ? Math.max(...bases) : undefined } : null;
    const judges = {
      lo: out && loOut[id] && !isBlind ? { load: loOut[id].load, roundtrip: loOut[id].roundtrip } : null,
      oxml: oxmlRow,
      office: out && office[id] ? office[id] : null
    };
    rows.push({
      file: id,
      source: c.source,
      family: c.family,
      producer: c.producerClass,
      kind: c.kind,
      seed: c.seed,
      seamLabel: s.outcome,
      tier: typeof s.tier === 'number' ? s.tier : null,
      findings: s.findings.map((f) => f.code),
      judges,
      rejectedBy: out ? judgeVerdict(judges) : [],
      judged: out ? Boolean(judges.lo || judges.oxml || judges.office) : false,
      textRecall: Math.round(textRecall * 1000) / 1000,
      baselineRecall: lo ? Math.round(baselineRecall * 1000) / 1000 : null,
      ms: s.ms,
      peakMB: s.peakMB
    });
  }
}

const LABELS = ['noProblems', 'repaired', 'partial', 'salvaged', 'failed', 'notSupported', 'timeout'];
const kinds = [...new Set(rows.map((r) => r.kind))].sort();
const perKind = kinds.map((kind) => {
  const list = rows.filter((r) => r.kind === kind);
  const labels = Object.fromEntries(LABELS.map((l) => [l, list.filter((r) => r.seamLabel === l).length]));
  const repaired = list.filter((r) => r.seamLabel === 'repaired' && r.judged);
  const withBase = list.filter((r) => r.baselineRecall !== null);
  return {
    kind,
    n: list.length,
    labels,
    repairedJudged: repaired.length,
    repairedPass: repaired.filter((r) => r.rejectedBy.length === 0).length,
    medianRecall: median(list.map((r) => r.textRecall)),
    medianBaseline: median(withBase.map((r) => r.baselineRecall)),
    betterThanBaseline: withBase.filter((r) => r.textRecall > r.baselineRecall).length,
    withBaseline: withBase.length
  };
});

const TIERS = [[0, 'Fails structural checks'], [1, 'Structural checks'], [2, 'Structural and content checks']];
const perTier = TIERS.map(([tier, name]) => {
  const list = rows.filter((r) => r.tier === tier && r.seamLabel !== 'noProblems');
  const judged = list.filter((r) => r.judged);
  const lo = judged.filter((r) => r.judges.lo);
  const sdk = judged.filter((r) => r.judges.oxml);
  return {
    tier,
    name,
    outputs: list.length,
    judged: judged.length,
    loPass: lo.filter((r) => r.judges.lo.load === true).length,
    loJudged: lo.length,
    sdkOpens: sdk.filter((r) => r.judges.oxml.opens === true).length,
    sdkJudged: sdk.length,
    sdkMedianErrors: median(sdk.filter((r) => r.judges.oxml.opens === true).map((r) => r.judges.oxml.errors))
  };
});
const sdkElements = [...sdkByElement.entries()]
  .map(([element, v]) => ({ element, messages: v.messages, files: v.files.size, topId: [...v.ids.entries()].sort((a, b) => b[1] - a[1])[0][0], families: Object.fromEntries(v.families) }))
  .sort((a, b) => b.messages - a.messages);

const overLabels = rows.filter((r) => r.seamLabel === 'repaired' && r.rejectedBy.length > 0);
const partialRejected = rows.filter((r) => r.seamLabel === 'partial' && r.rejectedBy.length > 0);
const judgedRepaired = rows.filter((r) => r.seamLabel === 'repaired' && r.judged);

const RECALL_OK = 0.99;
const RECALL_LOSS = 0.02;
const CRLF_GATE = 0.9;
const PARITY_POINTS = 2;
const phaseABaseline = readJson(resolve(root, flag('baseline', 'docs/baseline-phase-a.json')), null);
const explainedLosses = readJson(join(root, 'corpus', 'manifest', 'recall-explained.json'), {});
const crlfRows = rows.filter((r) => r.kind === 'crlf');
const crlfGood = crlfRows.filter((r) => r.seamLabel === 'repaired' && r.textRecall >= RECALL_OK).length;
const recallLosses = phaseABaseline
  ? rows
    .filter((r) => typeof phaseABaseline.recall[r.file] === 'number' && phaseABaseline.recall[r.file] - r.textRecall > RECALL_LOSS)
    .map((r) => ({ file: r.file, kind: r.kind, from: phaseABaseline.recall[r.file], to: r.textRecall, explained: explainedLosses[r.file] || null }))
  : [];
const recallGains = phaseABaseline ? rows.filter((r) => typeof phaseABaseline.recall[r.file] === 'number' && r.textRecall - phaseABaseline.recall[r.file] > RECALL_LOSS).length : 0;
const exitKinds = perKind.map((k) => {
  const list = rows.filter((r) => r.kind === k.kind);
  return { kind: k.kind, cases: list.length, atRecall: list.filter((r) => r.textRecall >= RECALL_OK).length, repaired: list.filter((r) => r.seamLabel === 'repaired').length };
});
const exitFamilies = [...new Set(rows.map((r) => r.family))].filter(Boolean).sort().map((family) => {
  const list = rows.filter((r) => r.family === family);
  const repaired = list.filter((r) => r.seamLabel === 'repaired' && r.judged);
  const tier2 = list.filter((r) => r.tier === 2 && r.seamLabel !== 'noProblems' && r.judges.oxml && r.judges.oxml.opens === true);
  return {
    family,
    repairedJudged: repaired.length,
    repairedPass: repaired.filter((r) => r.rejectedBy.length === 0).length,
    tier2Judged: tier2.length,
    tier2MedianErrors: median(tier2.map((r) => r.judges.oxml.errors))
  };
});
const rateOf = (f) => (f && f.repairedJudged > 0 ? f.repairedPass / f.repairedJudged : null);
const docxRate = rateOf(exitFamilies.find((f) => f.family === 'docx'));
const parity = exitFamilies
  .filter((f) => f.family !== 'docx')
  .map((f) => ({ family: f.family, rate: rateOf(f), ok: docxRate === null || rateOf(f) === null ? null : rateOf(f) >= docxRate - PARITY_POINTS / 100 }));
const exits = {
  a: { falseAlarms: falseAlarms.length, overLabels: overLabels.length },
  b: {
    crlfCases: crlfRows.length,
    crlfAtRecall: crlfGood,
    crlfOk: crlfRows.length === 0 ? null : crlfGood / crlfRows.length >= CRLF_GATE,
    kinds: exitKinds,
    baseline: phaseABaseline ? phaseABaseline.cases : null,
    losses: recallLosses,
    gains: recallGains,
    unexplainedLosses: recallLosses.filter((l) => !l.explained).length
  },
  c: { families: exitFamilies, parity, tier2Zero: exitFamilies.map((f) => ({ family: f.family, ok: f.tier2Judged === 0 ? null : f.tier2MedianErrors === 0 })) }
};

const coverage = readJson(join(root, 'corpus', 'cache', 'coverage-healthy.json'), { gaps: [] });
const gaps = [...coverage.gaps];
const anyOxml = anyJudge.oxml;
const anyOffice = anyJudge.office;
if (!anyOxml) gaps.push('Open XML SDK judge: not run');
if (!anyOffice) gaps.push('Office judge: not run');
if (!browsersText) gaps.push(`Browsers run: ${[healthySeam.browser, damagedSeam.browser].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'}`);
const unjudged = rows.filter((r) => r.seamLabel === 'repaired' && !r.judged).length;
if (unjudged > 0) gaps.push(`${unjudged} outputs labelled Repaired have no judge verdict`);
if (blindCases > 0) gaps.push(`${blindCases} cases derived from files LibreOffice cannot load were not judged by LibreOffice`);
if (Object.keys(healthyLoIn).length === 0) gaps.push('LibreOffice judge on healthy files: not run');

let loVersion = '';
for (const dir of [healthyDir, ...damagedDirs]) {
  const path = join(dir, 'judge-lo-in', 'version.txt');
  if (!loVersion && existsSync(path)) loVersion = readFileSync(path, 'utf8').trim();
}
if (!loVersion) {
  try {
    loVersion = execFileSync('soffice', ['--version'], { encoding: 'utf8', timeout: 20000 }).trim();
  } catch {}
}

let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {}

const allMs = [...healthyRows.map((r) => r.ms), ...rows.map((r) => r.ms)];
const allMb = [...healthyRows.map((r) => r.peakMB), ...rows.map((r) => r.peakMB)].filter((v) => typeof v === 'number');

const board = {
  label,
  commit,
  date: new Date().toISOString().slice(0, 10),
  browser: damagedSeam.browserVersion || healthySeam.browserVersion || null,
  libreOffice: loVersion || null,
  healthy: {
    files: healthyRows.length,
    noProblems: healthyRows.filter((r) => r.label === 'noProblems').length,
    knownBroken: knownBroken.map((r) => r.id),
    falseAlarms: falseAlarms.length,
    falseAlarmsOnLoadable: falseAlarmsLoadable.length,
    quarantined: quarantine,
    byProducer: Object.fromEntries([...new Set(healthyRows.map((r) => r.producerClass))].sort().map((p) => [p, { files: healthyRows.filter((r) => r.producerClass === p).length, falseAlarms: falseAlarms.filter((r) => r.producerClass === p).length }])),
    triggers: Object.entries(falseAlarms.reduce((m, r) => {
      for (const code of new Set(r.findings)) m[code] = (m[code] || 0) + 1;
      return m;
    }, {})).sort((a, b) => b[1] - a[1])
  },
  exits,
  damaged: { cases: rows.length, perKind, perTier, sdkElements: sdkElements.slice(0, 40), overLabels: overLabels.map((r) => r.file), partialRejected: partialRejected.map((r) => r.file) },
  performance: { medianMs: median(allMs), p95Ms: percentile(allMs, 95), maxMs: Math.max(0, ...allMs), maxPeakMB: Math.max(0, ...allMb), memoryMethod: 'js-heap-sampled (Chromium performance.memory, sampled at stage boundaries)' },
  gaps,
  cases: rows,
  healthyCases: healthyRows
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'scoreboard.json'), JSON.stringify(board));

const md = [];
md.push('# Seam scoreboard');
md.push('');
md.push(`Run \`${label}\` on ${board.date}, commit ${commit || 'unknown'}. Browser: ${board.browser || 'unknown'}. LibreOffice: ${loVersion || 'not run'}.`);
md.push(`Healthy files: ${healthyRows.length}. Damaged cases: ${rows.length}.`);
md.push('');
md.push('## 1. Healthy files: false alarms');
md.push('');
md.push(`A false alarm is any label other than No problems found on a healthy file. Total: ${falseAlarms.length} of ${healthyRows.length} (${pct(falseAlarms.length, healthyRows.length)}). On files LibreOffice also loads: ${falseAlarmsLoadable.length} of ${healthyRows.length - quarantine.length}.`);
md.push('');
md.push('| Producer | Files | False alarms | Rate |');
md.push('|---|---|---|---|');
for (const [p, v] of Object.entries(board.healthy.byProducer)) md.push(`| ${p} | ${v.files} | ${v.falseAlarms} | ${pct(v.falseAlarms, v.files)} |`);
md.push('');
md.push('Findings that appear on false alarms:');
md.push('');
md.push('| Finding | Files |');
md.push('|---|---|');
for (const [code, n] of board.healthy.triggers.slice(0, 15)) md.push(`| ${code} | ${n} |`);
md.push('');
const pending = falseAlarms.filter((r) => r.triage === 'pending-judge');
if (falseAlarms.length > 0) {
  md.push('Each false alarm and its triage:');
  md.push('');
  md.push('| File | Label | Findings | Open XML SDK on the original | Triage |');
  md.push('|---|---|---|---|---|');
  for (const r of falseAlarms) md.push(`| ${r.id} | ${r.label} | ${[...new Set(r.findings)].join(', ')} | ${r.oxml ? (r.oxml.opens ? `opens, ${r.oxml.errors} errors` : 'does not open') : 'not run'} | ${r.triage ? `${r.triage}: ${triage[r.id].note}` : 'untriaged'} |`);
  md.push('');
}
if (knownBroken.length > 0) {
  md.push(`Healthy by manifest but confirmed broken, repaired correctly, and not counted above: ${knownBroken.length}. Each has evidence in \`corpus/manifest/triage.json\`.`);
  md.push('');
  md.push('| File | Findings | Open XML SDK on the original |');
  md.push('|---|---|---|');
  for (const r of knownBroken) md.push(`| ${r.id} | ${[...new Set(r.findings)].join(', ')} | ${r.oxml ? (r.oxml.opens ? `opens, ${r.oxml.errors} errors` : 'does not open') : 'not run'} |`);
  md.push('');
}
md.push(`Quarantine candidates (healthy by manifest, not loaded by LibreOffice): ${quarantine.length === 0 ? 'none' : quarantine.join(', ')}.`);
md.push('');
md.push('## 2. Damaged files by kind');
md.push('');
md.push('Pass rate is the share of outputs labelled Repaired that every available judge accepts. Recall is the share of the original text found in the output, as the median over cases. The baseline is LibreOffice opening the damaged file with no help.');
md.push('');
md.push('| Kind | Cases | No problems | Repaired | Partial | Salvaged | Failed | Not supported | Judge pass (Repaired) | Recall, Seam | Recall, baseline | Seam better |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const k of perKind) {
  md.push(`| ${k.kind} | ${k.n} | ${k.labels.noProblems} | ${k.labels.repaired} | ${k.labels.partial} | ${k.labels.salvaged} | ${k.labels.failed + k.labels.timeout} | ${k.labels.notSupported} | ${k.repairedJudged === 0 ? 'n/a' : `${k.repairedPass}/${k.repairedJudged}`} | ${num(k.medianRecall)} | ${num(k.medianBaseline)} | ${k.withBaseline === 0 ? 'n/a' : `${k.betterThanBaseline}/${k.withBaseline}`} |`);
}
md.push('');
md.push('## 2b. Verification tiers');
md.push('');
md.push('Per tier of the output Seam produced: how many outputs, how many each judge accepted, and the median number of Open XML SDK errors on files it opens. Tier 2 stays empty until the schema check and family rules exist.');
md.push('');
md.push('| Tier | Meaning | Outputs | LibreOffice loads | Open XML SDK opens | SDK median errors |');
md.push('|---|---|---|---|---|---|');
for (const t of perTier) md.push(`| ${t.tier} | ${t.name} | ${t.outputs} | ${t.loJudged === 0 ? 'n/a' : `${t.loPass}/${t.loJudged}`} | ${t.sdkJudged === 0 ? 'n/a' : `${t.sdkOpens}/${t.sdkJudged}`} | ${t.sdkJudged === 0 ? 'n/a' : num(t.sdkMedianErrors, 0)} |`);
md.push('');
md.push('## 2c. Open XML SDK messages by element');
md.push('');
if (sdkElements.length === 0) {
  md.push('No per-message data. The judge records up to 40 messages per file; run it again to fill this table.');
} else {
  md.push('Counted over the first 40 messages the SDK reported for each output. Element is the node the message names.');
  md.push('');
  md.push('| Element | Messages | Files | Most common message ID | By family |');
  md.push('|---|---|---|---|---|');
  for (const e of sdkElements.slice(0, 25)) md.push(`| ${e.element} | ${e.messages} | ${e.files} | ${e.topId} | ${Object.entries(e.families).map(([f, n]) => `${f} ${n}`).join(', ')} |`);
}
md.push('');
md.push('## 2d. Phase exit gates');
md.push('');
md.push(`Phase A: healthy false alarms ${falseAlarms.length} (gate 0); outputs labelled Repaired that a judge rejects ${overLabels.length} (gate 0).`);
md.push('');
md.push(`Phase B: \`crlf\` cases that reach Repaired with recall of at least ${RECALL_OK}: ${crlfGood} of ${crlfRows.length} (${pct(crlfGood, crlfRows.length)}; gate ${CRLF_GATE * 100}%). The plan's +15 point median gate cannot be met because the median was already 1.000 before Phase B; the owner replaced it on 2026-11-25 with the share of outputs at recall ${RECALL_OK} and the Repaired count per kind below, and no case losing more than ${RECALL_LOSS} of recall without an explanation.`);
md.push('');
md.push('| Kind | Cases | Recall at least 0.99 | Repaired |');
md.push('|---|---|---|---|');
for (const k of exitKinds) md.push(`| ${k.kind} | ${k.cases} | ${pct(k.atRecall, k.cases)} | ${k.repaired} |`);
md.push('');
if (phaseABaseline) {
  md.push(`Against the end of Phase A (${phaseABaseline.cases} cases): ${recallGains} gain more than ${RECALL_LOSS} of recall, ${recallLosses.length} lose more than ${RECALL_LOSS}, ${recallLosses.filter((l) => !l.explained).length} of those without an explanation.`);
  md.push('');
  for (const l of recallLosses) md.push(`- ${l.file} (${l.kind}): ${num(l.from, 3)} to ${num(l.to, 3)}. ${l.explained || 'No explanation recorded.'}`);
  if (recallLosses.length > 0) md.push('');
}
md.push(`Phase C: Repaired outputs that every judge accepts, by family, and the median Open XML SDK errors on tier 2 outputs the SDK opens. Gate: xlsx and pptx within ${PARITY_POINTS} points of docx, and median 0 for each family.`);
md.push('');
md.push('| Family | Repaired judged | Accepted | Rate | Tier 2 outputs judged | SDK median errors |');
md.push('|---|---|---|---|---|---|');
for (const f of exitFamilies) md.push(`| ${f.family} | ${f.repairedJudged} | ${f.repairedPass} | ${pct(f.repairedPass, f.repairedJudged)} | ${f.tier2Judged} | ${f.tier2Judged === 0 ? 'n/a' : num(f.tier2MedianErrors, 0)} |`);
md.push('');
md.push('## 3. Over-labels');
md.push('');
md.push(`Outputs labelled Repaired that a judge rejects: ${overLabels.length} of ${judgedRepaired.length} judged.`);
md.push('');
if (overLabels.length > 0) {
  md.push('| File | Kind | Rejected by | Findings |');
  md.push('|---|---|---|---|');
  for (const r of overLabels) md.push(`| ${r.file} | ${r.kind} | ${r.rejectedBy.join(', ')} | ${[...new Set(r.findings)].join(', ')} |`);
  md.push('');
}
md.push(`Outputs labelled Partially repaired that a judge rejects (tracked, not gated): ${partialRejected.length}.`);
md.push('');
md.push('## 4. Time and memory');
md.push('');
md.push(`Median ${num(board.performance.medianMs, 0)} ms, 95th percentile ${num(board.performance.p95Ms, 0)} ms, slowest ${num(board.performance.maxMs, 0)} ms. Highest heap growth ${num(board.performance.maxPeakMB, 1)} MB. Method: ${board.performance.memoryMethod}.`);
md.push('');
md.push('## 5. Browsers');
md.push('');
if (browsersText) {
  const lines = browsersText.split('\n');
  md.push(lines[0]);
  md.push('');
  for (const line of lines.slice(1)) md.push(`- ${line.trim()}`);
} else {
  md.push('Not compared.');
}
md.push('');
md.push('## 6. Gaps');
md.push('');
for (const g of gaps) md.push(`- ${g}`);
md.push('');
writeFileSync(join(outDir, 'SCOREBOARD.md'), md.join('\n'));
console.log(md.join('\n'));
if (gate) {
  const problems = [];
  if (falseAlarms.length > 0) problems.push(`${falseAlarms.length} false alarms on healthy files`);
  if (overLabels.length > 0) problems.push(`${overLabels.length} outputs labelled Repaired that a judge rejects`);
  if (crlfRows.length >= 30 && exits.b.crlfOk === false) problems.push(`crlf cases at Repaired with recall ${RECALL_OK}: ${crlfGood} of ${crlfRows.length}, gate ${CRLF_GATE * 100}%`);
  if (exits.b.unexplainedLosses > 0) problems.push(`${exits.b.unexplainedLosses} cases lose more than ${RECALL_LOSS} of recall against the end of Phase A without an explanation`);
  if (problems.length > 0) {
    console.error(`gate failed: ${problems.join('; ')}`);
    process.exit(1);
  }
}
