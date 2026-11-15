import fs from 'node:fs';
import path from 'node:path';

export function pruneBufferedRunEvents<T>(
  buffers: Map<string, T[]>,
  maxRuns = 60,
  protectedRunIds?: Set<string>,
): number {
  if (buffers.size <= maxRuns) return 0;
  let removed = 0;
  for (const runId of buffers.keys()) {
    if (buffers.size - removed <= maxRuns) break;
    if (protectedRunIds?.has(runId)) continue;
    buffers.delete(runId);
    removed += 1;
  }
  return removed;
}

export function cleanupStaleSandboxDirs(params: {
  sandboxBaseDir: string;
  maxAgeMs?: number;
  protectedIds?: Set<string>;
}): number {
  const { sandboxBaseDir, maxAgeMs = 24 * 60 * 60 * 1000, protectedIds } = params;
  if (!fs.existsSync(sandboxBaseDir)) return 0;

  const now = Date.now();
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sandboxBaseDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (protectedIds?.has(entry.name)) continue;
    const fullPath = path.join(sandboxBaseDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // ignore transient filesystem errors
    }
  }

  return removed;
}
