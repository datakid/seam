import test from 'node:test';
import assert from 'node:assert/strict';
import { keptSources, sdkJudgement, sdkRejects, sdkBlind, judgeVerdict, hasVerdict } from '../tools/lib/judge-verdict.mjs';

const sound = (id, errors) => ({ id, opens: true, errors, sample: [] });
const blindOriginal = (id, message) => ({ id, opens: false, errors: -1, sample: [message] });

test('an output that opens is not worse than an original that did not open', () => {
  const row = sdkJudgement({ opens: true, errors: 0, sample: [] }, [blindOriginal('a', 'x')]);
  assert.equal(row.baselineErrors, undefined);
  assert.equal(sdkRejects(row), false);
});

test('errors that an output has while its original cannot open are not a regression', () => {
  const row = sdkJudgement({ opens: true, errors: 38, sample: ['schema'] }, [blindOriginal('a', 'x')]);
  assert.equal(sdkRejects(row), false);
});

test('an output with more errors than an original that opens is rejected', () => {
  const row = sdkJudgement({ opens: true, errors: 4, sample: [] }, [sound('a', 2)]);
  assert.equal(row.baselineErrors, 2);
  assert.equal(sdkRejects(row), true);
});

test('an output with as many errors as its original is accepted', () => {
  assert.equal(sdkRejects(sdkJudgement({ opens: true, errors: 2, sample: [] }, [sound('a', 2)])), false);
});

test('an output that cannot open while its original opens is rejected', () => {
  const row = sdkJudgement({ opens: false, errors: -1, sample: ['invalid part'] }, [sound('a', 0)]);
  assert.equal(row.inheritedFrom, undefined);
  assert.equal(sdkRejects(row), true);
  assert.deepEqual(judgeVerdict({ oxml: row }), ['oxml']);
});

test('an output that fails with the message of its original is blind, not rejected', () => {
  const row = sdkJudgement({ opens: false, errors: -1, sample: ['Required Types tag not found.'] }, [blindOriginal('poi-58760', 'Required Types tag not found.')]);
  assert.equal(row.inheritedFrom, 'poi-58760');
  assert.equal(sdkRejects(row), false);
  assert.equal(sdkBlind(row), true);
  assert.deepEqual(judgeVerdict({ oxml: row }), []);
});

test('an output that fails with another message than its original is rejected', () => {
  const row = sdkJudgement({ opens: false, errors: -1, sample: ['invalid part'] }, [blindOriginal('a', 'Required Types tag not found.')]);
  assert.equal(row.inheritedFrom, undefined);
  assert.equal(sdkRejects(row), true);
});

test('a blind SDK verdict alone is not a verdict, another judge still counts', () => {
  const row = sdkJudgement({ opens: false, errors: -1, sample: ['m'] }, [blindOriginal('a', 'm')]);
  assert.equal(hasVerdict({ lo: null, oxml: row, office: null }), false);
  assert.equal(hasVerdict({ lo: { load: true }, oxml: row, office: null }), true);
});

test('other judges still reject on their own', () => {
  assert.deepEqual(judgeVerdict({ lo: { load: false }, oxml: null, office: { verdict: 'fail' } }), ['lo', 'office']);
  assert.deepEqual(judgeVerdict({ lo: { load: true }, oxml: null, office: null }), []);
});

test('a concat output with one original that opens and one that does not has no error baseline', () => {
  const row = sdkJudgement({ opens: true, errors: 38, sample: [] }, [sound('a', 0), blindOriginal('b', 'm')]);
  assert.equal(row.baselineErrors, undefined);
  assert.equal(sdkRejects(row), false);
});

test('the kept original of a concat case follows the text recall', () => {
  const entry = { kind: 'concat', source: 'a', otherId: 'b' };
  assert.deepEqual(keptSources(entry, 0.9, 0.1), ['a']);
  assert.deepEqual(keptSources(entry, 0.1, 0.9), ['b']);
  assert.deepEqual(keptSources(entry, 0, 0), ['a', 'b']);
  assert.deepEqual(keptSources({ kind: 'crlf', source: 'a' }, 0.5, 0), ['a']);
});
