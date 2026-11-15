import { test, assert, eq } from './harness.js';
import { createQueue, LIMITS } from '../js/queue.js';
import { docxEntries, pack, randomBytes, docx } from './fixtures.js';
import { deleteDirectory } from './corrupt.js';

async function waitFor(check, ms = 20000, label = 'condition') {
  const started = performance.now();
  for (;;) {
    if (check()) return;
    if (performance.now() - started > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function harness() {
  const log = { working: 0, maxWorking: 0, busy: [], idle: 0, lists: [] };
  const queue = createQueue({
    onList(items, notices) {
      log.lists.push({ count: items.length, notices });
    },
    onItem(item) {
      log.working = queue.items().filter((i) => i.status === 'working').length;
      log.maxWorking = Math.max(log.maxWorking, log.working);
    },
    onSummary() {},
    onBusy(n) {
      log.busy.push(n);
    },
    onIdle() {
      log.idle++;
    }
  });
  return { queue, log };
}

const file = (bytes, name, modified = 1) => new File([bytes], name, { lastModified: modified });

test('queue: a file that exceeds the time budget ends as Could not repair with TIMEOUT and the worker is replaced', async () => {
  const saved = LIMITS.budgetMs;
  LIMITS.budgetMs = 15;
  const { queue } = harness();
  try {
    const slow = pack([...docxEntries(), ['word/media/big.png', randomBytes(3, 24 * 1024 * 1024)]]);
    queue.add([file(deleteDirectory(slow), 'Slow.docx')]);
    await waitFor(() => queue.items()[0].status === 'done', 20000, 'timeout result');
    const result = queue.items()[0].result;
    eq(result.outcome, 'failed');
    assert(result.findings.some((f) => f.code === 'TIMEOUT'), 'TIMEOUT finding');
    assert(result.sentence.includes('longer than 120 seconds'), result.sentence);
    LIMITS.budgetMs = saved;
    queue.add([file(new TextEncoder().encode('%PDF-1.7 follow-up'), 'After.docx')]);
    await waitFor(() => queue.items()[1].status === 'done', 10000, 'follow-up file');
    eq(queue.items()[1].result.outcome, 'notSupported');
  } finally {
    LIMITS.budgetMs = saved;
    queue.clear();
  }
});

test('queue: at most two files are processed at the same time', async () => {
  const { queue, log } = harness();
  try {
    const files = [];
    for (let i = 0; i < 6; i++) files.push(file(deleteDirectory(docx()), `Doc ${i}.docx`, i + 1));
    queue.add(files);
    await waitFor(() => queue.items().every((i) => i.status === 'done'), 20000, 'all done');
    assert(log.maxWorking <= LIMITS.concurrency, `max working ${log.maxWorking}`);
    eq(queue.items().map((i) => i.result.outcome), ['repaired', 'repaired', 'repaired', 'repaired', 'repaired', 'repaired']);
    eq(log.busy, [6]);
    await waitFor(() => log.idle === 1, 2000, 'idle callback');
  } finally {
    queue.clear();
  }
});

test('queue: files are processed in the order they were added', async () => {
  const { queue } = harness();
  try {
    queue.add([file(deleteDirectory(docx()), 'First.docx', 1), file(new TextEncoder().encode('%PDF'), 'Second.docx', 2), file(deleteDirectory(docx()), 'Third.docx', 3)]);
    await waitFor(() => queue.items().every((i) => i.status === 'done'), 20000, 'all done');
    eq(queue.items().map((i) => i.name), ['First.docx', 'Second.docx', 'Third.docx']);
  } finally {
    queue.clear();
  }
});

test('queue: duplicates are skipped by name, size and modified time, and the 50 file cap applies to the list', () => {
  const { queue } = harness();
  try {
    const a = file(new Uint8Array(10), 'A.docx', 7);
    const first = queue.add([a, a]);
    eq(first.duplicates, 1);
    eq(queue.items().length, 1);
    const many = [];
    for (let i = 0; i < 60; i++) many.push(file(new Uint8Array(i + 1), `F${i}.docx`, 100 + i));
    const second = queue.add(many);
    eq(second.overflow, true);
    eq(queue.items().length, LIMITS.files);
    const third = queue.add([file(new Uint8Array(5), 'Late.docx', 999)]);
    eq(third.overflow, true);
    eq(queue.items().length, LIMITS.files);
  } finally {
    queue.clear();
  }
});

test('queue: clear while work is running leaves an empty list and no late updates', async () => {
  const { queue, log } = harness();
  queue.add([file(deleteDirectory(docx()), 'a.docx', 1), file(deleteDirectory(docx()), 'b.docx', 2), file(deleteDirectory(docx()), 'c.docx', 3)]);
  queue.clear();
  await new Promise((resolve) => setTimeout(resolve, 400));
  eq(queue.items().length, 0);
  eq(log.lists[log.lists.length - 1].count, 0);
  queue.add([file(new TextEncoder().encode('%PDF'), 'again.docx', 50)]);
  await waitFor(() => queue.items().length === 1 && queue.items()[0].status === 'done', 10000, 'new batch after clear');
  eq(queue.items()[0].result.outcome, 'notSupported');
  queue.clear();
});

test('queue: files over the size limit are Not processed without being read', () => {
  const { queue } = harness();
  try {
    const big = { name: 'Big.docx', size: LIMITS.bytes + 1, lastModified: 1, arrayBuffer: () => { throw new Error('must not be read'); } };
    queue.add([big]);
    eq(queue.items()[0].status, 'done');
    eq(queue.items()[0].result.outcome, 'notProcessed');
  } finally {
    queue.clear();
  }
});
