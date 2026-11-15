import { useEffect, useState } from 'react';
import { FileDiff, FilePlus2, FileEdit, FileMinus2 } from 'lucide-react';
import type { FileDiffEntry } from '../types/workflow';

interface CodeDiffViewerProps {
  diffs: FileDiffEntry[];
  lang?: 'en' | 'fa';
  emptyLabel?: string;
}

export function CodeDiffViewer({ diffs, lang = 'en', emptyLabel }: CodeDiffViewerProps) {
  const isFa = lang === 'fa';
  const [selectedPath, setSelectedPath] = useState<string | null>(diffs[0]?.path ?? null);

  useEffect(() => {
    if (diffs.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !diffs.some((d) => d.path === selectedPath)) {
      setSelectedPath(diffs[0].path);
    }
  }, [diffs, selectedPath]);

  const activeDiff = diffs.find((d) => d.path === selectedPath) ?? diffs[0] ?? null;

  if (diffs.length === 0) {
    return (
      <div
        data-testid="code-diff-empty"
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center dark:border-slate-800 dark:bg-slate-950/50"
      >
        <FileDiff className="mb-2 h-6 w-6 text-slate-400" />
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {emptyLabel ??
            (isFa
              ? 'هنوز هیچ تغییر خط‌به‌خطی نسبت به نسخه پایه ثبت نشده است.'
              : 'No line-level file changes detected compared to baseline.')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="code-diff-viewer" className="space-y-2.5">
      {/* Changed Files Selector */}
      <div dir="ltr" className="flex flex-wrap gap-1.5">
        {diffs.map((entry) => {
          const isSelected = activeDiff?.path === entry.path;
          const StatusIcon =
            entry.status === 'added'
              ? FilePlus2
              : entry.status === 'deleted'
                ? FileMinus2
                : FileEdit;
          return (
            <button
              key={entry.path}
              type="button"
              data-testid={`diff-file-btn-${entry.path}`}
              onClick={() => setSelectedPath(entry.path)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                isSelected
                  ? 'border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <StatusIcon
                className={`h-3 w-3 shrink-0 ${
                  entry.status === 'added'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : entry.status === 'deleted'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              />
              <span className="max-w-[200px] truncate">{entry.path}</span>
              <span className="tabular-nums text-[10px] text-emerald-700 dark:text-emerald-400">
                +{entry.additions}
              </span>
              <span className="tabular-nums text-[10px] text-rose-700 dark:text-rose-400">
                -{entry.deletions}
              </span>
            </button>
          );
        })}
      </div>

      {/* Unified Line-by-Line Diff Pane */}
      {activeDiff && (
        <div
          dir="ltr"
          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800"
        >
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-slate-300">
            <span className="truncate font-semibold text-slate-100">{activeDiff.path}</span>
            <div className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 uppercase text-slate-300">
                {activeDiff.status}
              </span>
              <span className="text-emerald-400">+{activeDiff.additions}</span>
              <span className="text-rose-400">-{activeDiff.deletions}</span>
            </div>
          </div>

          <div className="max-h-[340px] overflow-auto font-mono text-[11px] leading-relaxed">
            {activeDiff.lines.map((line, idx) => {
              const rowClass =
                line.type === 'added'
                  ? 'bg-emerald-950/60 text-emerald-200'
                  : line.type === 'removed'
                    ? 'bg-rose-950/60 text-rose-200'
                    : 'text-slate-300';
              const gutterChar =
                line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
              const gutterColor =
                line.type === 'added'
                  ? 'text-emerald-400'
                  : line.type === 'removed'
                    ? 'text-rose-400'
                    : 'text-slate-600';
              return (
                <div key={idx} className={`flex whitespace-pre ${rowClass}`}>
                  <span className="w-9 shrink-0 select-none border-r border-slate-800/80 px-1.5 text-right tabular-nums text-[10px] text-slate-500">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="w-9 shrink-0 select-none border-r border-slate-800/80 px-1.5 text-right tabular-nums text-[10px] text-slate-500">
                    {line.newLine ?? ''}
                  </span>
                  <span className={`w-5 shrink-0 select-none text-center font-bold ${gutterColor}`}>
                    {gutterChar}
                  </span>
                  <span className="min-w-0 flex-1 pr-3">{line.text}</span>
                </div>
              );
            })}
            {activeDiff.truncated && (
              <div className="border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-amber-300">
                {isFa
                  ? 'فایل بزرگ‌تر از حد مجاز است؛ بخشی از خطوط خلاصه شد.'
                  : 'File exceeded 450-line diff cap; remaining lines truncated.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
