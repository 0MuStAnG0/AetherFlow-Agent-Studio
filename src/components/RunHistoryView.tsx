import { useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Search, Square, Trash2 } from 'lucide-react';
import type { ExecutionRunSummary } from '../types/workflow';

interface RunHistoryViewProps {
  runs: ExecutionRunSummary[];
  loading: boolean;
  lang?: 'en' | 'fa';
  onRefresh: () => void;
  onInspectRun: (runId: string) => void;
  onStopRun?: (runId: string) => void;
  onRerun?: (run: ExecutionRunSummary) => void;
  onDeleteRun?: (runId: string) => void;
}

const STATUS_STYLES: Record<ExecutionRunSummary['status'], string> = {
  completed: 'text-emerald-700 dark:text-emerald-400',
  running: 'text-blue-700 dark:text-blue-400',
  awaiting_approval: 'text-amber-700 dark:text-amber-400',
  cancelled: 'text-slate-600 dark:text-slate-400',
  failed: 'text-red-700 dark:text-red-400',
};

function formatDurationMs(durationMs?: number): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const secs = durationMs / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return `${mins}m ${rem}s`;
}

export function RunHistoryView({
  runs,
  loading,
  lang = 'en',
  onRefresh,
  onInspectRun,
  onStopRun,
  onRerun,
  onDeleteRun,
}: RunHistoryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const isFa = lang === 'fa';

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        r.workflowName.toLowerCase().includes(q) ||
        r.taskPrompt.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [runs, query, statusFilter]);

  return (
    <section
      dir={isFa ? 'rtl' : 'ltr'}
      className="mx-auto flex h-full w-full max-w-[1280px] flex-col p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            {isFa ? 'تاریخچه اجراهای ورکفلو' : 'Execution Run History'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {isFa
              ? 'گزارش مکالمات GroupChat، مدت‌زمان اجرا، فایل‌های سندباکس و امکان اجرای مجدد یا توقف.'
              : 'Persisted GroupChat transcripts, duration telemetry, replay controls, and sandbox artifacts stored in SQLite.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {isFa ? 'به‌روزرسانی' : 'Refresh History'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Filter execution runs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isFa ? 'جستجو بر اساس نام پروژه یا پرامپت...' : 'Filter by workflow or task prompt...'
            }
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          {['all', 'completed', 'running', 'awaiting_approval', 'cancelled', 'failed'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-10 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isFa ? 'هیچ اجرایی ثبت نشده است' : 'No Execution Runs Recorded'}
            </h3>
            <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              {isFa
                ? 'یک ورکفلو را از بوم جریان کار اجرا کنید تا لاگ‌ها و فایل‌های آن اینجا نمایش داده شوند.'
                : 'Launch a workflow from the Workflow Canvas to inspect GroupChat logs, round metrics, and sandbox files here.'}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm" data-testid="run-history-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-4 py-3">{isFa ? 'ورکفلو' : 'Workflow'}</th>
                <th className="px-4 py-3">{isFa ? 'دستور اجرا' : 'Task Prompt'}</th>
                <th className="px-4 py-3">{isFa ? 'حالت' : 'Mode'}</th>
                <th className="px-4 py-3 text-right">{isFa ? 'راندها' : 'Rounds'}</th>
                <th className="px-4 py-3 text-right">{isFa ? 'مدت' : 'Duration'}</th>
                <th className="px-4 py-3">{isFa ? 'وضعیت' : 'Status'}</th>
                <th className="px-4 py-3 text-right">{isFa ? 'زمان' : 'Timestamp'}</th>
                <th className="px-4 py-3 text-right">{isFa ? 'عملیات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((run) => {
                const isActive = run.status === 'running' || run.status === 'awaiting_approval';
                return (
                  <tr
                    key={run.id}
                    data-testid={`run-row-${run.id}`}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {run.workflowName}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-600 dark:text-slate-300">
                      {run.taskPrompt}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                      {run.mode}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {run.roundsExecuted}/{run.maxRounds}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                      {formatDurationMs(run.durationMs)}
                    </td>
                    <td className={`px-4 py-3 text-xs font-semibold capitalize ${STATUS_STYLES[run.status]}`}>
                      {run.status.replace('_', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {isActive && onStopRun && (
                          <button
                            type="button"
                            onClick={() => onStopRun(run.id)}
                            aria-label={`Stop run ${run.id}`}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
                          >
                            <Square className="h-3 w-3" />
                            <span>{isFa ? 'توقف' : 'Stop'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onInspectRun(run.id)}
                          className="whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {isFa ? 'بررسی' : 'Inspect'}
                        </button>
                        {onRerun && (
                          <button
                            type="button"
                            onClick={() => onRerun(run)}
                            aria-label={`Re-run ${run.workflowName}`}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>{isFa ? 'تکرار' : 'Re-run'}</span>
                          </button>
                        )}
                        {onDeleteRun && (
                          <button
                            type="button"
                            onClick={() => onDeleteRun(run.id)}
                            aria-label={`Delete run ${run.id}`}
                            title={isFa ? 'حذف اجرا' : 'Delete run'}
                            className="inline-flex items-center rounded-md border border-slate-200 p-1.5 text-slate-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
