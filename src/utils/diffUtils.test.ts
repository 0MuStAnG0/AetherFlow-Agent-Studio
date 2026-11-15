import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectDiffEntries, computeLineDiff } from './diffUtils';

test('computeLineDiff computes additions, deletions, and context lines accurately', () => {
  const same = computeLineDiff('const a = 1;\n', 'const a = 1;\r\n');
  assert.equal(same.additions, 0);
  assert.equal(same.deletions, 0);
  assert.deepEqual(same.lines, []);

  const diff = computeLineDiff(
    'line 1\nline 2\nline 3',
    'line 1\nline 2 updated\nline 3\nline 4',
  );
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 1);
  assert.equal(diff.truncated, false);
  assert.ok(diff.lines.some((l) => l.type === 'removed' && l.text === 'line 2'));
  assert.ok(diff.lines.some((l) => l.type === 'added' && l.text === 'line 2 updated'));
  assert.ok(diff.lines.some((l) => l.type === 'added' && l.text === 'line 4'));
});

test('buildProjectDiffEntries classifies added, modified, deleted, and unchanged files', () => {
  const entries = buildProjectDiffEntries({
    originals: [
      { path: 'src/unchanged.ts', content: 'export const x = 1;' },
      { path: 'src/app.ts', content: 'const v = 1;\nconsole.log(v);' },
      { path: 'src/obsolete.ts', content: 'export const old = true;' },
    ],
    current: [
      { path: 'src/unchanged.ts', content: 'export const x = 1;' },
      { path: 'src/app.ts', content: 'const v = 2;\nconsole.log(v);' },
      { path: 'src/newFile.ts', content: 'export function hi() { return "ok"; }' },
    ],
  });

  assert.equal(entries.length, 3);
  assert.equal(entries[0].path, 'src/app.ts');
  assert.equal(entries[0].status, 'modified');
  assert.equal(entries[0].additions, 1);
  assert.equal(entries[0].deletions, 1);

  assert.equal(entries[1].path, 'src/newFile.ts');
  assert.equal(entries[1].status, 'added');
  assert.equal(entries[1].additions, 1);

  assert.equal(entries[2].path, 'src/obsolete.ts');
  assert.equal(entries[2].status, 'deleted');
  assert.equal(entries[2].deletions, 1);
});
