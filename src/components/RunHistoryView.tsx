import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { ExecutionRunSummary } from '../types/workflow';

interface RunHistoryViewProps {
  runs: ExecutionRunSummary[];
  loading: boolean;
  onRefresh: () => void;
  onInspectRun: (runId: string) => void;
}

const STATUS_STYLES: Record<ExecutionRunSummary['status'], string> = {
  completed: 'text-emerald-700 dark:text-emerald-400',
  running: 'text-blue-700 dark:text-blue-400',
  awaiting_approval: 'text-amber-700 dark:text-amber-400',
  failed: 'text-red-700 dark:text-red-400',
};

export function RunHistoryView({
  runs,
  loading,
  onRefresh,
  onInspectRun,
}: RunHistoryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

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
    <section className="mx-auto flex h-full w-full max-w-[1200px] flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            Execution Run History
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Persisted GroupChat transcripts, round counts, and sandbox artifacts stored in SQLite.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh History
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
            placeholder="Filter by workflow or task prompt..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          {['all', 'completed', 'running', 'awaiting_approval', 'failed'].map((st) => (
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
              No Execution Runs Recorded
            </h3>
            <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Launch a workflow from the Workflow Canvas to inspect GroupChat logs, round metrics, and sandbox files here.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Task Prompt</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3 text-right">Rounds</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Timestamp</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((run) => (
                <tr
                  key={run.id}
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
                  <td className={`px-4 py-3 text-xs font-semibold capitalize ${STATUS_STYLES[run.status]}`}>
                    {run.status.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onInspectRun(run.id)}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
