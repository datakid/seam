import { test, assert, eq } from './harness.js';
import { createQueue, canAddCopy, LIMITS } from '../js/queue.js';
import { docxEntries, pack, randomBytes, docx, xlsx } from './fixtures.js';
import { deleteDirectory, truncate } from './corrupt.js';

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

test('queue: another copy is read together with the original and the row is checked again', async () => {
  const { queue, log } = harness();
  try {
    queue.add([file(truncate(xlsx(), 0.5), 'Budget.xlsx', 1)]);
    await waitFor(() => queue.items()[0].status === 'done', 20000, 'first result');
    const item = queue.items()[0];
    eq(item.result.outcome, 'partial');
    assert(canAddCopy(item), 'a partly repaired row accepts another copy');
    const notices = queue.addCopies(item.id, [file(xlsx(), 'Backup.xlsx', 2)]);
    eq(notices.duplicates, 0);
    eq(item.result, null);
    assert(item.status === 'queued' || item.status === 'working', `status ${item.status}`);
    await waitFor(() => item.status === 'done', 20000, 'second result');
    eq(item.result.outcome, 'repaired');
    assert(item.result.findings.some((f) => f.code === 'MULTI_PART_FROM' && f.data.from === 'Backup.xlsx'), 'part taken from the copy');
    assert(item.result.output, 'output');
    eq(item.file, null);
    eq(item.copies.length, 0);
    assert(!canAddCopy(item), 'a repaired row takes no more copies');
    const before = item.result;
    queue.addCopies(item.id, [file(xlsx(), 'Another.xlsx', 3)]);
    eq(item.status, 'done');
    assert(item.result === before, 'the result is untouched');
    await waitFor(() => log.idle >= 2, 2000, 'idle after both runs');
  } finally {
    queue.clear();
  }
});

test('queue: a copy that duplicates the original or exceeds the copy limit does not start another run', async () => {
  const saved = LIMITS.copies;
  const { queue } = harness();
  try {
    LIMITS.copies = 1;
    queue.add([file(truncate(xlsx(), 0.5), 'Budget.xlsx', 1)]);
    await waitFor(() => queue.items()[0].status === 'done', 20000, 'first result');
    const item = queue.items()[0];
    const first = item.result;
    const same = queue.addCopies(item.id, [file(truncate(xlsx(), 0.5), 'Budget.xlsx', 1)]);
    eq(same.duplicates, 1);
    assert(item.result === first, 'duplicate did not start a run');
    queue.addCopies(item.id, [file(new TextEncoder().encode('%PDF-1.7 not a package'), 'Notes.xlsx', 2)]);
    await waitFor(() => item.status === 'done' && item.result !== first, 20000, 'run with the junk copy');
    eq(item.result.outcome, 'partial');
    assert(item.result.findings.some((f) => f.code === 'MULTI_COPY_UNUSED'), 'unused copy reported');
    const second = item.result;
    const full = queue.addCopies(item.id, [file(xlsx(), 'Backup.xlsx', 3)]);
    eq(full.copiesFull, true);
    assert(item.result === second, 'no run past the limit');
  } finally {
    LIMITS.copies = saved;
    queue.clear();
  }
});
