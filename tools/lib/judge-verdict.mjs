export function keptSources(entry, recallSource, recallOther) {
  if (entry.kind !== 'concat' || !entry.otherId) return [entry.source];
  if (recallSource > recallOther) return [entry.source];
  if (recallOther > recallSource) return [entry.otherId];
  return [entry.source, entry.otherId];
}

export function sdkJudgement(output, originals) {
  const blind = originals.filter((o) => o.opens === false);
  const sound = originals.filter((o) => o.opens === true && typeof o.errors === 'number' && o.errors >= 0);
  const baselineErrors = blind.length === 0 && sound.length > 0 ? Math.max(...sound.map((o) => o.errors)) : undefined;
  const message = Array.isArray(output.sample) && output.sample.length > 0 ? output.sample[0] : null;
  const twin = output.opens === false && message ? blind.find((o) => Array.isArray(o.sample) && o.sample[0] === message) : null;
  return { ...output, baselineErrors, inheritedFrom: twin ? twin.id : undefined };
}

export function sdkRejects(oxml) {
  if (!oxml) return false;
  if (oxml.opens === false) return !oxml.inheritedFrom;
  return typeof oxml.baselineErrors === 'number' && typeof oxml.errors === 'number' && oxml.errors > oxml.baselineErrors;
}

export function sdkBlind(oxml) {
  return Boolean(oxml && oxml.opens === false && oxml.inheritedFrom);
}

export function judgeVerdict(judges) {
  const reasons = [];
  if (judges.lo && judges.lo.load === false) reasons.push('lo');
  if (sdkRejects(judges.oxml)) reasons.push('oxml');
  if (judges.office && judges.office.verdict && judges.office.verdict !== 'open') reasons.push('office');
  return reasons;
}

export function hasVerdict(judges) {
  return Boolean(judges.lo || (judges.oxml && !sdkBlind(judges.oxml)) || judges.office);
}
