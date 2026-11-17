import { identify } from './identify.js';
import { strictRead } from './zip-read.js';
import { recoverEntries, mergeEntries } from './zip-recover.js';
import { writeZip } from './zip-write.js';
import { decodeXml, cleanChars, encodeUtf8 } from './xml-clean.js';
import { repairXml } from './xml-repair.js';
import {
  PartIndex, isXmlPath, resolveTarget, readRelationships, readContentTypes, contentTypeOf,
  repairRootRels, repairRels, auditReferences, repairContentTypes, flushTrees, addFinding, getTree
} from './package.js';
import { applyDocx } from './formats/docx.js';
import { applyXlsx, normalizeXlsx } from './formats/xlsx.js';
import { applyPptx } from './formats/pptx.js';
import { verifyPackage, familyOfMain, checkWellFormed } from './verify.js';
import { salvage } from './salvage.js';
import { notSupportedResult, failedResult, sentenceFor, countLoss, detectedLabel, baseName, finding } from './report.js';
import { isMainRelType, MAIN_PARTS, OUTPUT_MIME, STAGE_WEIGHTS, stageStart, CT_MAIN, FAMILY_KEYS, STANDARD_KEYS } from './constants.js';
import { copy } from '../copy.js';

const STRUCTURAL = new Set(['NO_EOCD', 'BAD_CD', 'BAD_CD_ENTRY', 'BAD_LOCAL', 'NAME_MISMATCH', 'SHORT_DATA']);

function inputExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function createContext(input) {
  return {
    name: input.name,
    size: input.size,
    inputExt: inputExtension(input.name),
    findings: [],
    parts: new Map(),
    index: new PartIndex([]),
    trees: new Map(),
    dirty: new Set(),
    removedRels: new Map(),
    silentParts: new Set(),
    lost: new Map(),
    changed: false,
    strictIntact: false,
    extCorrected: false,
    family: null,
    format: null,
    main: null,
    slideCount: null
  };
}

function loadEntries(ctx, bytes, identity) {
  const prefix = identity.prefix || 0;
  const strict = strictRead(bytes, prefix);
  let entries = strict.entries;
  const dropped = strict.dropped.slice();
  let endsEarly = false;
  const directoryBroken = !strict.eocdFound || strict.errors.some((e) => STRUCTURAL.has(e)) || strict.parsed !== strict.total;
  if (!strict.intact) {
    const recovered = recoverEntries(bytes);
    entries = mergeEntries(strict.entries, recovered.entries);
    dropped.push(...recovered.dropped);
    endsEarly = recovered.endsEarly;
  }
  const autoShift = (strict.shift === undefined ? 0 : strict.shift) - prefix;
  ctx.strictIntact = strict.intact && prefix === 0 && autoShift === 0 && !identity.damagedStart;
  if (autoShift > 0 && !identity.prefixGarbage) addFinding(ctx, 'ZIP_PREFIX_DATA', null, { bytes: autoShift });
  if (identity.prefixGarbage) {
    addFinding(ctx, 'ZIP_PREFIX_DATA', null, { bytes: identity.prefixGarbage });
  }
  if ((!strict.intact && directoryBroken) || autoShift < 0) addFinding(ctx, 'ZIP_DIRECTORY_REBUILT', null, { n: entries.length });
  if (endsEarly) addFinding(ctx, 'ZIP_ENDS_EARLY', null, {});
  for (const raw of dropped) addFinding(ctx, 'ZIP_PATH_DROPPED', raw, {});
  if (dropped.length > 0) ctx.changed = true;

  for (const entry of entries) {
    if (entry.state === 'unreadable') {
      ctx.changed = true;
      addFinding(ctx, 'ZIP_ENTRY_UNREADABLE', entry.name, {});
      continue;
    }
    if (entry.state === 'unsupported') {
      ctx.changed = true;
      addFinding(ctx, 'ZIP_UNSUPPORTED_METHOD', entry.name, { method: entry.method });
      continue;
    }
    if (entry.state === 'partial') {
      const pct = entry.expectedSize > 0 ? Math.min(99, Math.floor((entry.data.length / entry.expectedSize) * 100)) : null;
      addFinding(ctx, 'ZIP_ENTRY_TRUNCATED', entry.name, { pct, bytes: entry.data.length });
    } else if (entry.state === 'crcMismatch') {
      addFinding(ctx, 'ZIP_ENTRY_CRC', entry.name, {});
    }
    ctx.parts.set(entry.name, { name: entry.name, bytes: entry.data, text: null, isXml: isXmlPath(entry.name), changed: false, state: entry.state, mtime: entry.mtime, raw: null, repairedXml: false });
    ctx.index.add(entry.name);
  }
}

async function processXml(ctx, part, env) {
  const decoded = decodeXml(part.bytes);
  const cleaned = cleanChars(decoded.text);
  let text = cleaned.text;
  let changed = cleaned.changed || decoded.invalid > 0;
  const found = [];
  if (decoded.invalid > 0) found.push(['XML_INVALID_BYTES', { n: decoded.invalid }]);
  if (cleaned.changed) found.push(['XML_CHARS_REMOVED', { n: cleaned.removed + cleaned.escaped }]);

  if (!(await checkWellFormed(env, text))) {
    const repaired = repairXml(text);
    if (!repaired.hasRoot || !(await checkWellFormed(env, repaired.text))) {
      ctx.lost.set(part.name, text);
      ctx.parts.delete(part.name);
      ctx.index.remove(part.name);
      ctx.changed = true;
      addFinding(ctx, 'XML_UNRECOVERABLE', part.name, {});
      for (const [code, data] of found) addFinding(ctx, code, part.name, data);
      return;
    }
    part.raw = text;
    part.repairedXml = true;
    text = repaired.text;
    changed = true;
    const s = repaired.stats;
    const counted = s.autoClosed + s.strayClosed + s.dupAttrs + s.quotedAttrs + s.droppedAttrs + s.escaped + s.trailingContent + (repaired.truncated ? 0 : s.dropped);
    if (counted > 0) found.push(['XML_REPAIRED', { ...s, dropped: repaired.truncated ? 0 : s.dropped }]);
    if (repaired.truncated) found.push(['XML_TRUNCATED_CLOSED', { at: repaired.truncatedAt }]);
  }
  part.text = text;
  part.changed = changed;
  if (changed) ctx.changed = true;
  for (const [code, data] of found) addFinding(ctx, code, part.name, data);
}

async function xmlStage(ctx, env, progress) {
  const names = Array.from(ctx.parts.keys()).filter((n) => ctx.parts.get(n).isXml);
  for (let i = 0; i < names.length; i++) {
    progress('xml', names.length === 0 ? 1 : i / names.length);
    const part = ctx.parts.get(names[i]);
    if (part) await processXml(ctx, part, env);
  }
  progress('xml', 1);
}

function topFolderFamily(path) {
  return familyOfMain(path);
}

function classify(ctx) {
  let main = null;
  const rootRels = ctx.index.canonical('_rels/.rels');
  const tree = rootRels ? getTree(ctx, rootRels) : null;
  if (tree) {
    const rel = readRelationships(tree).find((r) => isMainRelType(r.type) && !r.external);
    if (rel) {
      const path = ctx.index.canonical(resolveTarget('', rel.target));
      if (path && topFolderFamily(path)) main = path;
    }
  }
  if (!main) {
    for (const [family, path] of Object.entries(MAIN_PARTS)) {
      const canonical = ctx.index.canonical(path);
      if (canonical) {
        main = canonical;
        break;
      }
    }
  }
  let family = main ? topFolderFamily(main) : null;
  if (!main) {
    const guess = Object.keys(FAMILY_KEYS).find((f) => FAMILY_KEYS[f].includes(ctx.inputExt));
    const folder = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' }[guess];
    if (guess && ctx.index.names().some((n) => n.toLowerCase().startsWith(folder))) family = guess;
  }
  ctx.main = main;
  ctx.family = family;
  if (!family) return;
  const folder = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' }[family];
  let macro = ctx.index.names().some((n) => n.toLowerCase().startsWith(folder) && /(^|\/)vbaProject\.bin$/i.test(n));
  if (!macro && main) {
    const ctName = ctx.index.canonical('[Content_Types].xml');
    const ctTree = ctName ? getTree(ctx, ctName) : null;
    if (ctTree) {
      const type = contentTypeOf(main, readContentTypes(ctTree));
      if (type && type.includes('macroEnabled')) macro = true;
    }
  }
  let key = macro ? `${family.slice(0, 3)}m` : family;
  if (main) {
    const ctName = ctx.index.canonical('[Content_Types].xml');
    const ctTree = ctName ? getTree(ctx, ctName) : null;
    const type = ctTree ? contentTypeOf(main, readContentTypes(ctTree)) : null;
    const exact = type ? FAMILY_KEYS[family].find((k) => CT_MAIN[k] === type) : null;
    if (exact && !STANDARD_KEYS.includes(exact) && !STANDARD_KEYS.includes(ctx.inputExt)) key = exact;
  }
  ctx.format = { key, ext: key, family };
  if (ctx.inputExt !== key) {
    ctx.extCorrected = true;
    addFinding(ctx, 'EXTENSION_CORRECTED', null, { from: ctx.inputExt, to: key });
  }
}

function detectedFor(ctx) {
  if (ctx.format) return { kind: ctx.format.key, chip: ctx.format.key.toUpperCase(), label: detectedLabel(null, { key: ctx.format.key, ext: ctx.format.ext }) };
  return { kind: 'ZIP', chip: 'ZIP', label: copy.formats.ZIP };
}

function outputParts(ctx) {
  const parts = [];
  for (const part of ctx.parts.values()) {
    parts.push({ name: part.name, data: part.isXml && part.changed ? encodeUtf8(part.text) : part.bytes, mtime: part.mtime });
  }
  return parts;
}

function sourcesOf(ctx) {
  const sources = new Map();
  for (const part of ctx.parts.values()) if (part.isXml && typeof part.text === 'string') sources.set(part.name, part.raw === null ? part.text : part.raw);
  for (const [name, text] of ctx.lost) sources.set(name, text);
  return sources;
}

const REASONS = {
  noMain: 'noMain',
  mainBroken: 'mainBroken',
  noSheets: 'noSheets',
  noMaster: 'noMaster',
  noLayout: 'noLayout',
  verify: 'verify'
};

async function salvageOutcome(ctx, env, reason, verifyFailure) {
  const findings = ctx.findings.filter((f) => f.severity === 'loss');
  if (verifyFailure) findings.push(finding('VERIFY_FAILED', null, { check: verifyFailure }));
  const salvaged = salvage(sourcesOf(ctx), ctx.family, baseName(ctx.name));
  if (salvaged.ok) {
    const verdict = await verifyPackage(salvaged.bytes, env, { key: salvaged.key, ext: salvaged.key });
    if (verdict.ok) {
      findings.push(finding('SALVAGE_TEXT_ONLY'));
      return {
        outcome: 'salvaged',
        detected: detectedFor(ctx),
        findings,
        sentence: sentenceFor('salvaged', findings),
        output: { bytes: salvaged.bytes, name: salvaged.name, mime: salvaged.mime },
        extraOutput: null,
        preview: salvaged.preview,
        verified: true
      };
    }
  }
  const text = copy.reasons[REASONS[reason] || 'nothing'];
  return {
    outcome: 'failed',
    detected: detectedFor(ctx),
    findings,
    sentence: sentenceFor('failed', findings, text),
    output: null,
    extraOutput: null,
    preview: null,
    verified: false
  };
}

async function extraSalvage(ctx, env) {
  const salvaged = salvage(sourcesOf(ctx), 'pptx', baseName(ctx.name));
  if (!salvaged.ok) return { extra: null, preview: null };
  const verdict = await verifyPackage(salvaged.bytes, env, { key: salvaged.key, ext: salvaged.key });
  if (!verdict.ok) return { extra: null, preview: null };
  return { extra: { bytes: salvaged.bytes, name: salvaged.name, mime: salvaged.mime }, preview: salvaged.preview };
}

async function execute(input, env) {
  const progress = (stage, fraction) => env.progress(stage, Math.round(stageStart(stage) + STAGE_WEIGHTS[stage] * Math.min(1, Math.max(0, fraction))));
  progress('identify', 0);
  const bytes = new Uint8Array(input.buffer);
  const identity = identify(bytes);
  progress('identify', 1);
  if (identity.kind !== 'ZIP') return notSupportedResult(identity);

  const ctx = createContext(input);
  progress('zip', 0);
  loadEntries(ctx, bytes, identity);
  progress('zip', 1);
  await xmlStage(ctx, env, progress);

  progress('package', 0);
  classify(ctx);
  if (!ctx.main) {
    addFinding(ctx, 'NO_MAIN_PART', null, {});
    return salvageOutcome(ctx, env, 'noMain');
  }

  repairRootRels(ctx);
  repairRels(ctx);
  progress('package', 0.4);
  const rules = { docx: applyDocx, xlsx: applyXlsx, pptx: applyPptx }[ctx.family];
  const verdictRules = rules(ctx);
  if (verdictRules.salvage) return salvageOutcome(ctx, env, verdictRules.salvage);
  if (ctx.changed && ctx.family === 'xlsx') normalizeXlsx(ctx);
  progress('package', 0.8);
  repairContentTypes(ctx, ctx.silentParts);
  flushTrees(ctx);
  if (ctx.changed) auditReferences(ctx);
  progress('package', 1);

  if (!ctx.changed && ctx.strictIntact) {
    if (!ctx.extCorrected) {
      return {
        outcome: 'noProblems',
        detected: detectedFor(ctx),
        findings: ctx.findings,
        sentence: sentenceFor('noProblems', ctx.findings),
        output: null,
        extraOutput: null,
        preview: null,
        verified: false
      };
    }
    progress('verify', 0);
    const verdict = await verifyPackage(bytes, env, ctx.format);
    if (verdict.ok) {
      return {
        outcome: 'repaired',
        detected: detectedFor(ctx),
        findings: ctx.findings,
        sentence: sentenceFor('repaired', ctx.findings),
        output: { bytes, name: `${baseName(ctx.name)} (repaired).${ctx.format.ext}`, mime: OUTPUT_MIME[ctx.format.key] },
        extraOutput: null,
        preview: null,
        verified: true
      };
    }
  }

  progress('verify', 0);
  const out = writeZip(outputParts(ctx));
  const verdict = await verifyPackage(out, env, ctx.format);
  progress('verify', 1);
  if (!verdict.ok) return salvageOutcome(ctx, env, 'verify', verdict.failed[0].check);
  progress('write', 0);

  const outcome = countLoss(ctx.findings) > 0 ? 'partial' : 'repaired';
  let extraOutput = null;
  let preview = null;
  if (ctx.family === 'pptx' && ctx.slideCount === 0) {
    const extra = await extraSalvage(ctx, env);
    extraOutput = extra.extra;
    preview = extra.preview;
  }
  progress('write', 1);
  return {
    outcome,
    detected: detectedFor(ctx),
    findings: ctx.findings,
    sentence: sentenceFor(outcome, ctx.findings),
    output: { bytes: out, name: `${baseName(ctx.name)} (repaired).${ctx.format.ext}`, mime: OUTPUT_MIME[ctx.format.key] },
    extraOutput,
    preview,
    verified: true
  };
}

export async function runPipeline(input, env) {
  try {
    return await execute(input, env);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return failedResult('INTERNAL_ERROR', copy.reasons.internal);
  }
}

