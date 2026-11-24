import { identify, findTextModeTransfer, removeAddedCarriageReturns } from './identify.js';
import { restoreCarriageReturns } from './crlf-restore.js';
import { tierFor, TIER_STRUCTURAL } from './tiers.js';
import { strictRead } from './zip-read.js';
import { recoverEntries, mergeEntries, mergeCopies } from './zip-recover.js';
import { writeZip } from './zip-write.js';
import { crc32 } from './crc32.js';
import { decodeXml, cleanChars, encodeUtf8 } from './xml-clean.js';
import { repairXml } from './xml-repair.js';
import { spliceHoles, resolveHoles } from './xml-holes.js';
import { familyOfNames, wantedFromDonor } from './donor.js';
import { identifyContent } from './orphan-kinds.js';
import { sweepReferences, auditReferences } from './ref-sweep.js';
import { completeSchema } from './schema-close.js';
import { loadSchemaTable } from './schema-check.js';
import { rebuildRels } from './rels-rebuild.js';
import { synthesizeMain } from './main-synth.js';
import {
  PartIndex, isXmlPath, resolveTarget, readRelationships, readContentTypes, contentTypeOf,
  repairRootRels, repairRels, repairContentTypes, typeUntypedParts, flushTrees, addFinding, getTree, referencedParts, sourceOfRels
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
    slideCount: null,
    orphans: []
  };
}

function readCopy(bytes, prefix) {
  const strict = strictRead(bytes, prefix);
  let entries = strict.entries;
  const dropped = strict.dropped.slice();
  let endsEarly = false;
  let orphans = [];
  if (!strict.intact) {
    const recovered = recoverEntries(bytes, strict.entries);
    orphans = recovered.orphans || [];
    entries = mergeEntries(strict.entries, recovered.entries);
    dropped.push(...recovered.dropped);
    endsEarly = recovered.endsEarly;
  }
  return { strict, entries, dropped, endsEarly, orphans };
}

function readExtras(copies) {
  const reads = [];
  for (const extra of copies) {
    const bytes = new Uint8Array(extra.buffer);
    const identity = identify(bytes);
    reads.push(identity.kind === 'ZIP' ? readCopy(bytes, identity.prefix || 0) : null);
  }
  return reads;
}

function reportUnusedCopies(ctx, copies, extras, merged, entries) {
  const contributed = new Set(entries.map((entry) => entry.copy));
  for (let i = 0; i < copies.length; i++) {
    if (contributed.has(i + 1)) continue;
    const why = extras[i] === null ? 'unreadable' : merged.used[i + 1] ? 'unused' : 'different';
    addFinding(ctx, 'MULTI_COPY_UNUSED', null, { name: copies[i].name, why });
  }
}

function loadEntries(ctx, bytes, identity, copies) {
  const prefix = identity.prefix || 0;
  const first = readCopy(bytes, prefix);
  const strict = first.strict;
  let entries = first.entries;
  const dropped = first.dropped;
  let endsEarly = first.endsEarly;
  ctx.orphans = first.orphans;
  const directoryBroken = !strict.eocdFound || strict.errors.some((e) => STRUCTURAL.has(e)) || strict.parsed !== strict.total;
  const extras = readExtras(copies);
  let merged = null;
  if (extras.length > 0) {
    merged = mergeCopies([first.entries, ...extras.map((read) => (read === null ? [] : read.entries))]);
    entries = merged.entries;
    if (extras.some((read, i) => read !== null && merged.used[i + 1] && !read.endsEarly)) endsEarly = false;
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
    let bytes = entry.data;
    let holeBytes = 0;
    if (entry.holes && isXmlPath(entry.name)) {
      const spliced = spliceHoles(entry.whole, entry.holes);
      if (spliced !== null) {
        bytes = spliced.bytes;
        holeBytes = spliced.lost;
      }
    }
    if (entry.rejected > 0) addFinding(ctx, 'ZIP_ENTRY_CHOSEN', entry.name, { n: entry.rejected + 1 });
    if (entry.copy > 0) {
      ctx.changed = true;
      addFinding(ctx, 'MULTI_PART_FROM', entry.name, { from: copies[entry.copy - 1].name, n: entry.copy + 1 });
    }
    if (entry.state === 'partial') {
      const kept = holeBytes > 0 ? entry.whole.length - holeBytes : entry.data.length;
      const pct = entry.expectedSize > 0 ? Math.min(99, Math.floor((kept / entry.expectedSize) * 100)) : null;
      addFinding(ctx, 'ZIP_ENTRY_TRUNCATED', entry.name, { pct, bytes: kept });
    } else if (entry.state === 'crcMismatch') {
      addFinding(ctx, 'ZIP_ENTRY_CRC', entry.name, {});
    }
    ctx.parts.set(entry.name, { name: entry.name, bytes, holeBytes, text: null, isXml: isXmlPath(entry.name), changed: false, state: entry.state, mtime: entry.mtime, raw: null, repairedXml: false });
    ctx.index.add(entry.name);
  }
  if (merged !== null) reportUnusedCopies(ctx, copies, extras, merged, entries);
}

const CUT_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];

async function cutBack(env, text, fallback) {
  let at = text.length;
  let tags = 0;
  for (const step of CUT_STEPS) {
    while (tags < step && at > 0) {
      at = text.lastIndexOf('<', at - 1);
      tags++;
      if (at <= 0) return fallback;
    }
    const candidate = repairXml(text.slice(0, at));
    if (candidate.hasRoot && (await checkWellFormed(env, candidate.text))) return candidate;
  }
  return fallback;
}

async function processXml(ctx, part, env) {
  const decoded = decodeXml(part.bytes);
  const holed = resolveHoles(decoded.text);
  const cleaned = cleanChars(holed.text);
  let text = cleaned.text;
  let changed = cleaned.changed || decoded.invalid > 0 || holed.holes > 0;
  const found = [];
  if (decoded.invalid > 0) found.push(['XML_INVALID_BYTES', { n: decoded.invalid }]);
  if (holed.holes > 0) found.push(['XML_HOLE_DROPPED', { n: holed.holes, bytes: part.holeBytes }]);
  if (cleaned.changed) found.push(['XML_CHARS_REMOVED', { n: cleaned.removed + cleaned.escaped }]);

  if (!(await checkWellFormed(env, text))) {
    let repaired = repairXml(text);
    if ((!repaired.hasRoot || !(await checkWellFormed(env, repaired.text))) && (part.state === 'partial' || part.state === 'crcMismatch')) repaired = await cutBack(env, text, repaired);
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

const SUPERSEDED = new Set([
  'ZIP_ENTRY_TRUNCATED', 'ZIP_ENTRY_CRC', 'ZIP_ENTRY_UNREADABLE', 'ZIP_UNSUPPORTED_METHOD', 'ZIP_ENTRY_CHOSEN', 'MULTI_PART_FROM',
  'XML_REENCODED', 'XML_INVALID_BYTES', 'XML_CHARS_REMOVED', 'XML_REPAIRED', 'XML_TRUNCATED_CLOSED', 'XML_UNRECOVERABLE', 'XML_HOLE_DROPPED'
]);

function forgetPart(ctx, name) {
  const key = name.toLowerCase();
  ctx.findings = ctx.findings.filter((f) => !(f.part !== null && f.part.toLowerCase() === key && SUPERSEDED.has(f.code)));
  for (const lost of Array.from(ctx.lost.keys())) if (lost.toLowerCase() === key) ctx.lost.delete(lost);
  const have = ctx.index.canonical(name);
  if (have) {
    ctx.parts.delete(have);
    ctx.index.remove(have);
    ctx.trees.delete(have);
    ctx.dirty.delete(have);
  }
}

function orphanPath(ctx, id, referenced) {
  if (id.kind === 'rels') {
    if (!id.path) return null;
    const source = sourceOfRels(id.path);
    if (source === null || (source !== '' && !ctx.index.has(source))) return null;
    return ctx.index.has(id.path) ? null : id.path;
  }
  if (id.path) return ctx.index.has(id.path) ? null : id.path;
  if (id.pattern) {
    const open = Array.from(referenced.values()).filter((path) => id.pattern.test(path) && !ctx.index.has(path));
    return open.length === 1 ? open[0] : null;
  }
  return null;
}

function sameAsExisting(ctx, data) {
  const sum = crc32(data);
  for (const part of ctx.parts.values()) {
    if (part.bytes && part.bytes.length === data.length && part.state === 'ok' && crc32(part.bytes) === sum) return true;
  }
  return false;
}

async function adoptOrphan(ctx, env, path, orphan) {
  const part = { name: path, bytes: orphan.data, holeBytes: 0, text: null, isXml: isXmlPath(path), changed: true, state: 'ok', mtime: null, raw: null, repairedXml: false };
  ctx.parts.set(path, part);
  ctx.index.add(path);
  ctx.changed = true;
  if (part.isXml) await processXml(ctx, part, env);
  return ctx.parts.has(path);
}

async function placeOrphans(ctx, env) {
  let pending = ctx.orphans
    .filter((orphan) => !sameAsExisting(ctx, orphan.data))
    .map((orphan) => ({ orphan, id: identifyContent(orphan.data) }));
  for (let round = 0; round < 3 && pending.length > 0; round++) {
    const referenced = referencedParts(ctx);
    const rest = [];
    for (const item of pending) {
      const path = orphanPath(ctx, item.id, referenced);
      if (path === null) {
        rest.push(item);
      } else if (await adoptOrphan(ctx, env, path, item.orphan)) {
        addFinding(ctx, 'ZIP_ORPHAN_NAMED', path, { kind: item.id.kind });
      }
    }
    if (rest.length === pending.length) break;
    pending = rest;
  }
  let number = 1;
  for (const item of pending) {
    while (ctx.index.has(`seam-recovered/part${number}.${item.id.ext === 'rels' ? 'xml' : item.id.ext}`)) number++;
    const path = `seam-recovered/part${number}.${item.id.ext === 'rels' ? 'xml' : item.id.ext}`;
    if (await adoptOrphan(ctx, env, path, item.orphan)) addFinding(ctx, 'ZIP_ORPHAN_KEPT', path, { kind: item.id.kind });
  }
}

async function borrowFromDonor(ctx, donor, env) {
  const bytes = new Uint8Array(donor.buffer);
  const identity = identify(bytes);
  if (identity.kind !== 'ZIP') {
    addFinding(ctx, 'DONOR_UNUSED', null, { name: donor.name, why: 'unreadable' });
    return;
  }
  const read = readCopy(bytes, identity.prefix || 0);
  if (familyOfNames(read.entries.map((entry) => entry.name)) !== ctx.family) {
    addFinding(ctx, 'DONOR_UNUSED', null, { name: donor.name, why: 'kind' });
    return;
  }
  const good = read.entries.filter((entry) => entry.state === 'ok');
  const taken = new Set();
  let count = 0;
  for (let round = 0; round < 4; round++) {
    const wanted = wantedFromDonor(ctx, good, taken);
    if (wanted.length === 0) break;
    for (const entry of wanted) {
      taken.add(entry.name.toLowerCase());
      forgetPart(ctx, entry.name);
      const part = { name: entry.name, bytes: entry.data, holeBytes: 0, text: null, isXml: isXmlPath(entry.name), changed: true, state: 'ok', mtime: entry.mtime, raw: null, repairedXml: false };
      ctx.parts.set(part.name, part);
      ctx.index.add(part.name);
      if (part.isXml) await processXml(ctx, part, env);
      if (ctx.parts.has(part.name)) {
        count++;
        addFinding(ctx, 'DONOR_PART_BORROWED', part.name, { from: donor.name });
      }
    }
  }
  if (count === 0) addFinding(ctx, 'DONOR_UNUSED', null, { name: donor.name, why: 'nothing' });
  else ctx.changed = true;
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
  const findings = ctx.findings.filter((f) => f.severity === 'loss' || f.code.startsWith('MULTI_') || f.code.startsWith('DONOR_') || f.code.startsWith('ZIP_ORPHAN_'));
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
        verified: true,
        tier: TIER_STRUCTURAL
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

async function execute(input, env, transfer) {
  const progress = (stage, fraction) => env.progress(stage, Math.round(stageStart(stage) + STAGE_WEIGHTS[stage] * Math.min(1, Math.max(0, fraction))));
  progress('identify', 0);
  const bytes = new Uint8Array(input.buffer);
  const identity = identify(bytes);
  progress('identify', 1);
  if (identity.kind !== 'ZIP') return notSupportedResult(identity);

  const ctx = createContext(input);
  if (transfer) {
    ctx.changed = true;
    addFinding(ctx, 'TRANSFER_CRLF_REVERSED', null, { n: transfer.pairs, restored: transfer.restored || 0 });
  }
  progress('zip', 0);
  loadEntries(ctx, bytes, identity, input.copies || []);
  progress('zip', 1);
  await xmlStage(ctx, env, progress);

  progress('package', 0);
  if (ctx.orphans.length > 0) await placeOrphans(ctx, env);
  classify(ctx);
  synthesizeMain(ctx);
  if (!ctx.main) {
    addFinding(ctx, 'NO_MAIN_PART', null, {});
    if (input.donor) addFinding(ctx, 'DONOR_UNUSED', null, { name: input.donor.name, why: 'nothing' });
    return salvageOutcome(ctx, env, 'noMain');
  }

  if (input.donor) await borrowFromDonor(ctx, input.donor, env);

  repairRootRels(ctx);
  rebuildRels(ctx);
  repairRels(ctx);
  progress('package', 0.4);
  const rules = { docx: applyDocx, xlsx: applyXlsx, pptx: applyPptx }[ctx.family];
  const verdictRules = rules(ctx);
  if (verdictRules.salvage) return salvageOutcome(ctx, env, verdictRules.salvage);
  if (ctx.changed && ctx.family === 'xlsx') normalizeXlsx(ctx);
  progress('package', 0.8);
  repairContentTypes(ctx, ctx.silentParts);
  sweepReferences(ctx);
  await completeSchema(ctx, env.schemaTable !== undefined ? async () => env.schemaTable : undefined);
  ctx.schemaTable = await loadSchemaTable(env);
  flushTrees(ctx);
  if ((ctx.changed || !ctx.strictIntact || ctx.extCorrected) && typeUntypedParts(ctx)) flushTrees(ctx);
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
        verified: true,
        tier: tierFor(ctx, true)
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
    verified: true,
    tier: tierFor(ctx, true)
  };
}

const NEEDS_HELP = new Set(['partial', 'salvaged', 'failed', 'notSupported']);
const OUTCOME_RANK = { repaired: 3, partial: 2, salvaged: 1 };

export async function runPipeline(input, env) {
  try {
    const first = await execute(input, env, null);
    if (!NEEDS_HELP.has(first.outcome)) return first;
    const original = new Uint8Array(input.buffer);
    const transfer = findTextModeTransfer(original);
    if (!transfer) return first;
    const reversed = removeAddedCarriageReturns(original);
    const restored = restoreCarriageReturns(reversed);
    const bytes = restored ? restored.bytes : reversed;
    const second = await execute({ ...input, size: bytes.length, buffer: bytes.buffer }, env, { ...transfer, restored: restored ? restored.restored : 0 });
    return (OUTCOME_RANK[second.outcome] || 0) > (OUTCOME_RANK[first.outcome] || 0) ? second : first;
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return failedResult('INTERNAL_ERROR', copy.reasons.internal);
  }
}

