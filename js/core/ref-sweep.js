import { decodeEntities, documentElement, localName, prefixOf, removeNode, unwrapNode } from './xml-repair.js';
import { REL_NS, REL_NS_STRICT } from './constants.js';
import { getTree, touch, addFinding, readRelationships, relsPathFor } from './package.js';
import { REF_POLICY } from './data/ref-policy.js';

const REL_URIS = new Set([REL_NS, REL_NS_STRICT]);
const DECLARED = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*["'](?:http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships|http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/relationships)["']/g;

function relPrefixesIn(text) {
  const prefixes = new Set();
  DECLARED.lastIndex = 0;
  let match;
  while ((match = DECLARED.exec(text)) !== null) prefixes.add(match[1]);
  if (prefixes.size === 0) prefixes.add('r');
  return prefixes;
}

function idsOf(ctx, name) {
  const relsName = ctx.index.canonical(relsPathFor(name));
  const relsTree = relsName ? getTree(ctx, relsName) : null;
  return new Set(relsTree ? readRelationships(relsTree).map((rel) => rel.id) : []);
}

function mentionsMissing(text, ids) {
  const prefixes = relPrefixesIn(text);
  for (const prefix of prefixes) {
    const pattern = new RegExp(`\\s${prefix.replace(/[.\-]/g, '\\$&')}:[A-Za-z][\\w.-]*\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = decodeEntities(match[1] !== undefined ? match[1] : match[2]);
      if (id !== '' && !ids.has(id)) return true;
    }
  }
  return false;
}

function scopeFor(node, scope) {
  let next = scope;
  for (const [attrName, value] of node.attrs) {
    if (!attrName.startsWith('xmlns:')) continue;
    if (next === scope) next = new Map(scope);
    next.set(attrName.slice(6), REL_URIS.has(decodeEntities(value)));
  }
  return next;
}

function missingReferences(root, ids) {
  const hits = [];
  const stack = [[root, new Map()]];
  while (stack.length > 0) {
    const [node, parentScope] = stack.pop();
    const scope = scopeFor(node, parentScope);
    const missing = [];
    for (const [attrName, value] of node.attrs) {
      const prefix = prefixOf(attrName);
      if (!prefix || prefix === 'xmlns') continue;
      const known = scope.get(prefix);
      if (known === undefined ? prefix !== 'r' : !known) continue;
      const id = decodeEntities(value);
      if (id !== '' && !ids.has(id)) missing.push(attrName);
    }
    if (missing.length > 0) hits.push({ node, missing });
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child.type === 'el') stack.push([child, scope]);
    }
  }
  return hits;
}

function policyFor(node, attrName) {
  const local = localName(node.name);
  const attr = localName(attrName);
  return REF_POLICY[`${local}@${attr}`] || REF_POLICY[`${local}@*`] || REF_POLICY['*'];
}

function outermostAncestor(node, names) {
  let found = null;
  for (let current = node.parent; current; current = current.parent) {
    if (current.name && names.includes(localName(current.name))) found = current;
  }
  return found;
}

function hasAncestorIn(node, set) {
  for (let current = node.parent; current; current = current.parent) if (set.has(current)) return true;
  return false;
}

function partsToScan(ctx) {
  const out = [];
  for (const name of ctx.parts.keys()) {
    if (name === '[Content_Types].xml' || name.toLowerCase().endsWith('.rels')) continue;
    const part = ctx.parts.get(name);
    if (typeof part.text !== 'string') continue;
    out.push(name);
  }
  return out;
}

function scanPart(ctx, name) {
  const part = ctx.parts.get(name);
  const ids = idsOf(ctx, name);
  if (!mentionsMissing(part.text, ids)) return null;
  const tree = getTree(ctx, name);
  const root = tree ? documentElement(tree) : null;
  if (!root) return null;
  const hits = missingReferences(root, ids);
  return hits.length > 0 ? hits : null;
}

function plan(hits) {
  const doomed = new Map();
  const unwrapped = new Map();
  const dropped = [];
  for (const { node, missing } of hits) {
    const policy = policyFor(node, missing[0]);
    if (policy.action === 'keep') continue;
    if (policy.action === 'unwrap') {
      unwrapped.set(node, policy);
    } else if (policy.action === 'remove') {
      doomed.set(node, policy);
    } else if (policy.action === 'removeContainer') {
      const holder = outermostAncestor(node, policy.container);
      if (holder) doomed.set(holder, policy);
      else if (policy.otherwise === 'dropAttribute') dropped.push({ node, missing, policy });
      else if (policy.otherwise === 'remove') doomed.set(node, policy);
    }
  }
  const doomedSet = new Set(doomed.keys());
  for (const node of [...doomed.keys()]) if (hasAncestorIn(node, doomedSet)) doomed.delete(node);
  for (const node of [...unwrapped.keys()]) if (hasAncestorIn(node, doomedSet)) unwrapped.delete(node);
  return { doomed, unwrapped, dropped: dropped.filter(({ node }) => !hasAncestorIn(node, doomedSet)) };
}

function elementChildCount(node) {
  let n = 0;
  for (const child of node.children) if (child.type === 'el') n++;
  return n;
}

function fixParent(parent, policy, before) {
  if (!parent || !parent.attrs) return;
  const countAt = parent.attrs.findIndex(([name]) => name === 'count');
  if (countAt !== -1 && String(before) === decodeEntities(parent.attrs[countAt][1])) parent.attrs[countAt][1] = String(elementChildCount(parent));
  if (policy.dropEmptyParent && elementChildCount(parent) === 0) removeNode(parent);
}

function apply(plans) {
  const counts = new Map();
  const bump = (loss, n = 1) => counts.set(loss, (counts.get(loss) || 0) + n);
  const parents = new Map();
  for (const [node, policy] of plans.doomed) {
    if (policy.parentCount || policy.dropEmptyParent) {
      if (!parents.has(node.parent)) parents.set(node.parent, { before: elementChildCount(node.parent), policy });
    }
    removeNode(node);
    bump(policy.loss);
  }
  for (const [node, policy] of plans.unwrapped) {
    unwrapNode(node);
    bump(policy.loss);
  }
  for (const { node, missing, policy } of plans.dropped) {
    const before = node.attrs.length;
    node.attrs = node.attrs.filter(([attrName]) => !missing.includes(attrName));
    bump(policy.loss, before - node.attrs.length);
  }
  for (const [parent, { before, policy }] of parents) fixParent(parent, policy, before);
  return counts;
}

export function sweepReferences(ctx) {
  for (const name of partsToScan(ctx)) {
    const hits = scanPart(ctx, name);
    if (!hits) continue;
    const counts = apply(plan(hits));
    if (counts.size === 0) continue;
    touch(ctx, name);
    for (const [loss, n] of counts) addFinding(ctx, 'REF_REMOVED', name, { n, loss });
  }
}

export function auditReferences(ctx) {
  for (const name of partsToScan(ctx)) {
    const hits = scanPart(ctx, name);
    if (!hits) continue;
    let missing = 0;
    const elements = new Set();
    for (const hit of hits) {
      missing += hit.missing.length;
      for (const attrName of hit.missing) elements.add(`${localName(hit.node.name)}@${localName(attrName)}`);
    }
    addFinding(ctx, 'REF_DANGLING', name, { n: missing, elements: [...elements].sort() });
  }
}
