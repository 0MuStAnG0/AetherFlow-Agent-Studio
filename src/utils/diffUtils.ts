import type { DiffLine, FileDiffEntry } from '../types/workflow';

const MAX_DIFF_LINES_PER_SIDE = 450;

export function computeLineDiff(
  oldText: string,
  newText: string,
): {
  additions: number;
  deletions: number;
  lines: DiffLine[];
  truncated: boolean;
} {
  const normOld = oldText.replace(/\r\n/g, '\n');
  const normNew = newText.replace(/\r\n/g, '\n');

  if (normOld === normNew) {
    return { additions: 0, deletions: 0, lines: [], truncated: false };
  }

  const rawOldLines = normOld.length === 0 ? [] : normOld.split('\n');
  const rawNewLines = normNew.length === 0 ? [] : normNew.split('\n');

  const truncated =
    rawOldLines.length > MAX_DIFF_LINES_PER_SIDE ||
    rawNewLines.length > MAX_DIFF_LINES_PER_SIDE;

  const oldLines = rawOldLines.slice(0, MAX_DIFF_LINES_PER_SIDE);
  const newLines = rawNewLines.slice(0, MAX_DIFF_LINES_PER_SIDE);

  const m = oldLines.length;
  const n = newLines.length;

  // Compute LCS DP table cleanly for bounded file slices
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i];
    const nextRow = dp[i + 1];
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        row[j] = nextRow[j + 1] + 1;
      } else {
        row[j] = row[j + 1] >= nextRow[j] ? row[j + 1] : nextRow[j];
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNum = 1;
  let newNum = 1;
  let additions = 0;
  let deletions = 0;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      lines.push({
        type: 'context',
        oldLine: oldNum++,
        newLine: newNum++,
        text: oldLines[i],
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({
        type: 'removed',
        oldLine: oldNum++,
        text: oldLines[i],
      });
      deletions++;
      i++;
    } else {
      lines.push({
        type: 'added',
        newLine: newNum++,
        text: newLines[j],
      });
      additions++;
      j++;
    }
  }

  while (i < m) {
    lines.push({ type: 'removed', oldLine: oldNum++, text: oldLines[i++] });
    deletions++;
  }
  while (j < n) {
    lines.push({ type: 'added', newLine: newNum++, text: newLines[j++] });
    additions++;
  }

  return { additions, deletions, lines, truncated };
}

export function buildProjectDiffEntries(params: {
  originals: Array<{ path: string; content: string }>;
  current: Array<{ path: string; content: string }>;
}): FileDiffEntry[] {
  const origMap = new Map(params.originals.map((f) => [f.path, f.content]));
  const currMap = new Map(params.current.map((f) => [f.path, f.content]));
  const allPaths = Array.from(new Set([...origMap.keys(), ...currMap.keys()])).sort((a, b) =>
    a.localeCompare(b),
  );

  const diffs: FileDiffEntry[] = [];
  for (const filePath of allPaths) {
    const oldContent = origMap.get(filePath);
    const newContent = currMap.get(filePath);

    if (oldContent === undefined && newContent !== undefined) {
      const diff = computeLineDiff('', newContent);
      diffs.push({
        path: filePath,
        status: 'added',
        additions: diff.additions,
        deletions: 0,
        lines: diff.lines,
        truncated: diff.truncated,
      });
    } else if (oldContent !== undefined && newContent === undefined) {
      const diff = computeLineDiff(oldContent, '');
      diffs.push({
        path: filePath,
        status: 'deleted',
        additions: 0,
        deletions: diff.deletions,
        lines: diff.lines,
        truncated: diff.truncated,
      });
    } else if (oldContent !== undefined && newContent !== undefined && oldContent !== newContent) {
      const diff = computeLineDiff(oldContent, newContent);
      if (diff.additions > 0 || diff.deletions > 0) {
        diffs.push({
          path: filePath,
          status: 'modified',
          additions: diff.additions,
          deletions: diff.deletions,
          lines: diff.lines,
          truncated: diff.truncated,
        });
      }
    }
  }

  return diffs;
}
