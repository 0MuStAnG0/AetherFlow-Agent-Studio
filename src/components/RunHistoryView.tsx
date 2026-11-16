import { useEffect, useMemo, useState } from 'react';
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDiff,
  FileText,
  Languages,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { ExecutionRunSummary, RunChangeReport } from '../types/workflow';

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

const REPORT_COPY = {
  en: {
    modalTitle: 'Complete Applied Changes Report',
    chatLanguageLabel: 'Conversation Language: English',
    statusLabel: 'Status',
    roundsLabel: 'Rounds',
    durationLabel: 'Duration',
    summaryHeading: 'Executive Change Summary',
    addedFiles: 'Added Files',
    modifiedFiles: 'Modified Files',
    deletedFiles: 'Deleted Files',
    lineDelta: 'Line Changes',
    commandsCount: 'Commands Run',
    bugsCount: 'Issues Logged',
    fileChangesHeading: 'Applied File Changes & Diffs',
    noFileChanges: 'No files were created, modified, or deleted during this run.',
    agentsLabel: 'Agents:',
    truncatedNotice: 'Diff truncated for large file preview.',
    commandsHeading: 'Executed Commands',
    exitCodeLabel: 'Exit',
    bugsHeading: 'Logged Bugs & Improvements',
    copyReport: 'Copy Report',
    copied: 'Copied',
    inspectChat: 'Inspect Full Chat',
    close: 'Close',
    loadingReport: 'Loading complete change report...',
    statusText: {
      completed: 'Completed',
      running: 'Running',
      awaiting_approval: 'Awaiting Approval',
      cancelled: 'Cancelled',
      failed: 'Failed',
    },
    fileStatusText: {
      added: 'Added',
      modified: 'Modified',
      deleted: 'Deleted',
    },
  },
  fa: {
    modalTitle: 'گزارش کامل تغییرات اعمال‌شده',
    chatLanguageLabel: 'زبان مکالمه: فارسی',
    statusLabel: 'وضعیت',
    roundsLabel: 'راندها',
    durationLabel: 'مدت اجرا',
    summaryHeading: 'خلاصه جامع تغییرات و اقدامات',
    addedFiles: 'فایل‌های اضافه‌شده',
    modifiedFiles: 'فایل‌های ویرایش‌شده',
    deletedFiles: 'فایل‌های حذف‌شده',
    lineDelta: 'تغییرات خطوط',
    commandsCount: 'دستورات اجراشده',
    bugsCount: 'موارد گزارش‌شده',
    fileChangesHeading: 'فایل‌های تغییریافته و Diff خطوط',
    noFileChanges: 'در این اجرا هیچ فایلی ایجاد، ویرایش یا حذف نشده است.',
    agentsLabel: 'ایجنت‌های مسئول:',
    truncatedNotice: 'نمایش تغییرات برای فایل بزرگ خلاصه شده است.',
    commandsHeading: 'دستورات اجراشده در ترمینال',
    exitCodeLabel: 'کد خروج',
    bugsHeading: 'باگ‌ها و بهبودهای ثبت‌شده',
    copyReport: 'کپی متن گزارش',
    copied: 'کپی شد',
    inspectChat: 'مشاهده مکالمه کامل',
    close: 'بستن',
    loadingReport: 'در حال بارگذاری گزارش کامل تغییرات...',
    statusText: {
      completed: 'تکمیل‌شده',
      running: 'در حال اجرا',
      awaiting_approval: 'در انتظار تایید',
      cancelled: 'لغوشده',
      failed: 'ناموفق',
    },
    fileStatusText: {
      added: 'ایجادشده',
      modified: 'ویرایش‌شده',
      deleted: 'حذف‌شده',
    },
  },
} as const;

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
  const [activeReportRun, setActiveReportRun] = useState<ExecutionRunSummary | null>(null);
  const [loadedReport, setLoadedReport] = useState<RunChangeReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [copiedReport, setCopiedReport] = useState(false);

  const isFa = lang === 'fa';

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        r.workflowName.toLowerCase().includes(q) ||
        r.taskPrompt.toLowerCase().includes(q) ||
        (r.changeReport?.summaryText ?? '').toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [runs, query, statusFilter]);

  useEffect(() => {
    if (!activeReportRun) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveReportRun(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeReportRun]);

  const openChangeReport = async (run: ExecutionRunSummary) => {
    setActiveReportRun(run);
    setReportError(null);
    setCopiedReport(false);

    if (run.changeReport) {
      setLoadedReport(run.changeReport);
      const initialExpanded: Record<string, boolean> = {};
      run.changeReport.fileChanges.slice(0, 3).forEach((fc) => {
        initialExpanded[fc.path] = true;
      });
      setExpandedDiffs(initialExpanded);
    } else {
      setLoadedReport(null);
      setExpandedDiffs({});
    }

    setReportLoading(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/report`);
      const data = (await res.json().catch(() => ({}))) as {
        changeReport?: RunChangeReport;
        error?: string;
      };
      if (!res.ok || !data.changeReport) {
        if (!run.changeReport) {
          setReportError(data.error || 'Failed to load run change report.');
        }
        return;
      }
      setLoadedReport(data.changeReport);
      const nextExpanded: Record<string, boolean> = {};
      data.changeReport.fileChanges.slice(0, 3).forEach((fc) => {
        nextExpanded[fc.path] = true;
      });
      setExpandedDiffs(nextExpanded);
    } catch {
      if (!run.changeReport) {
        setReportError('Network error while loading change report.');
      }
    } finally {
      setReportLoading(false);
    }
  };

  const report = loadedReport ?? activeReportRun?.changeReport ?? null;
  const reportLang: 'en' | 'fa' = report?.language ?? activeReportRun?.chatLanguage ?? lang;
  const rt = REPORT_COPY[reportLang];

  const handleCopyReportText = async () => {
    if (!report) return;
    const lines: string[] = [
      `${rt.modalTitle} — ${report.workflowName}`,
      `${rt.chatLanguageLabel} | ${rt.statusLabel}: ${rt.statusText[report.status]} | ${rt.roundsLabel}: ${report.roundsExecuted}`,
      '',
      report.summaryText,
    ];
    if (report.fileChanges.length > 0) {
      lines.push('', `--- ${rt.fileChangesHeading} ---`);
      for (const fc of report.fileChanges) {
        lines.push(
          `[${rt.fileStatusText[fc.status]}] ${fc.path} (+${fc.additions} / -${fc.deletions})${
            fc.agents.length > 0 ? ` — ${fc.agents.join(', ')}` : ''
          }`,
        );
      }
    }
    if (report.commands.length > 0) {
      lines.push('', `--- ${rt.commandsHeading} ---`);
      for (const cmd of report.commands) {
        lines.push(
          `$ ${cmd.command} (${cmd.agentName}${typeof cmd.exitCode === 'number' ? `, exit ${cmd.exitCode}` : ''})`,
        );
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      // Clipboard API unavailable in restricted frames
    }
  };

  return (
    <section
      dir={isFa ? 'rtl' : 'ltr'}
      className="mx-auto flex h-full w-full max-w-[1280px] flex-col p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            {isFa ? 'تاریخچه اجراهای ورکفلو و گزارش تغییرات' : 'Execution Run History & Change Reports'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {isFa
              ? 'گزارش مکالمات GroupChat، گزارش کامل تغییرات اعمال‌شده به زبان مکالمه، مدت‌زمان اجرا و فایل‌های سندباکس.'
              : 'Persisted GroupChat transcripts, language-matched applied change reports, duration telemetry, and replay controls.'}
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
          <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Filter execution runs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isFa
                ? 'جستجو بر اساس نام پروژه، پرامپت یا گزارش...'
                : 'Filter by workflow, prompt, or report summary...'
            }
            className="w-full rounded-lg border border-slate-200 bg-white py-2 ps-9 pe-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                ? 'یک ورکفلو را از بوم جریان کار اجرا کنید تا لاگ‌ها و گزارش تغییرات آن اینجا نمایش داده شوند.'
                : 'Launch a workflow from the Workflow Canvas to inspect GroupChat logs, change reports, and sandbox files here.'}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-start text-sm" data-testid="run-history-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-4 py-3 text-start">{isFa ? 'ورکفلو' : 'Workflow'}</th>
                <th className="px-4 py-3 text-start">{isFa ? 'دستور اجرا' : 'Task Prompt'}</th>
                <th className="px-4 py-3 text-start">{isFa ? 'زبان / تغییرات' : 'Language / Changes'}</th>
                <th className="px-4 py-3 text-end">{isFa ? 'راندها' : 'Rounds'}</th>
                <th className="px-4 py-3 text-end">{isFa ? 'مدت' : 'Duration'}</th>
                <th className="px-4 py-3 text-start">{isFa ? 'وضعیت' : 'Status'}</th>
                <th className="px-4 py-3 text-end">{isFa ? 'زمان' : 'Timestamp'}</th>
                <th className="px-4 py-3 text-end">{isFa ? 'عملیات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((run) => {
                const isActive = run.status === 'running' || run.status === 'awaiting_approval';
                const detectedLang = run.changeReport?.language ?? run.chatLanguage;
                const stats = run.changeReport?.stats;
                const totalChangedFiles = stats
                  ? stats.addedFiles + stats.modifiedFiles + stats.deletedFiles
                  : 0;

                return (
                  <tr
                    key={run.id}
                    data-testid={`run-row-${run.id}`}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      <div>{run.workflowName}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {run.mode}
                      </div>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-600 dark:text-slate-300" dir="auto">
                      {run.taskPrompt}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {detectedLang && (
                          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Languages className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            {detectedLang === 'fa' ? 'فارسی' : 'English'}
                          </span>
                        )}
                        {stats ? (
                          <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                            {totalChangedFiles > 0 ? (
                              <>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  +{stats.addedFiles}
                                </span>{' '}
                                <span className="text-blue-600 dark:text-blue-400">
                                  ~{stats.modifiedFiles}
                                </span>{' '}
                                <span className="text-rose-600 dark:text-rose-400">
                                  -{stats.deletedFiles}
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-400">
                                {isFa ? 'بدون تغییر فایل' : 'No file edits'}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {run.roundsExecuted}/{run.maxRounds}
                    </td>
                    <td className="px-4 py-3 text-end font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                      {formatDurationMs(run.durationMs)}
                    </td>
                    <td className={`px-4 py-3 text-xs font-semibold capitalize ${STATUS_STYLES[run.status]}`}>
                      {run.status.replace('_', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-end font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-end">
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
                          data-testid={`report-run-${run.id}`}
                          onClick={() => void openChangeReport(run)}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>{isFa ? 'گزارش تغییرات' : 'Change Report'}</span>
                        </button>
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

      {/* Language-Matched Change Report Modal */}
      {activeReportRun && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveReportRun(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-change-report-title"
            data-testid="run-change-report-modal"
            dir={reportLang === 'fa' ? 'rtl' : 'ltr'}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="run-change-report-title"
                    className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
                  >
                    {rt.modalTitle}
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                    <Languages className="h-3 w-3" />
                    {rt.chatLanguageLabel}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {report?.workflowName ?? activeReportRun.workflowName}
                  </span>
                  <span>
                    {rt.statusLabel}:{' '}
                    <span className={`font-semibold ${STATUS_STYLES[report?.status ?? activeReportRun.status]}`}>
                      {rt.statusText[report?.status ?? activeReportRun.status]}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {rt.roundsLabel}: {report?.roundsExecuted ?? activeReportRun.roundsExecuted}
                  </span>
                  <span className="font-mono tabular-nums">
                    {rt.durationLabel}: {formatDurationMs(report?.durationMs ?? activeReportRun.durationMs)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveReportRun(null)}
                aria-label={rt.close}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              {reportLoading && !report ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span>{rt.loadingReport}</span>
                </div>
              ) : reportError && !report ? (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
                >
                  {reportError}
                </div>
              ) : report ? (
                <>
                  {/* Narrative Summary */}
                  <section
                    data-testid="run-report-summary"
                    className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/70"
                  >
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {rt.summaryHeading}
                    </h3>
                    <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {report.summaryText}
                    </p>
                  </section>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.addedFiles}
                      </div>
                      <div className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {report.stats.addedFiles}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.modifiedFiles}
                      </div>
                      <div className="mt-1 font-mono text-base font-bold tabular-nums text-blue-600 dark:text-blue-400">
                        {report.stats.modifiedFiles}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.deletedFiles}
                      </div>
                      <div className="mt-1 font-mono text-base font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {report.stats.deletedFiles}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.lineDelta}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold tabular-nums" dir="ltr">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          +{report.stats.totalAdditions}
                        </span>{' '}
                        <span className="text-rose-600 dark:text-rose-400">
                          -{report.stats.totalDeletions}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.commandsCount}
                      </div>
                      <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {report.stats.totalCommands}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.bugsCount}
                      </div>
                      <div className="mt-1 font-mono text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">
                        {report.stats.totalBugs}
                      </div>
                    </div>
                  </div>

                  {/* Applied File Changes */}
                  <section>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <FileDiff className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span>
                        {rt.fileChangesHeading} ({report.fileChanges.length})
                      </span>
                    </div>

                    {report.fileChanges.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {rt.noFileChanges}
                      </div>
                    ) : (
                      <div className="space-y-2" data-testid="run-report-file-changes">
                        {report.fileChanges.map((fc) => {
                          const isOpen = Boolean(expandedDiffs[fc.path]);
                          const statusBadgeClass =
                            fc.status === 'added'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : fc.status === 'deleted'
                                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                                : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300';

                          return (
                            <div
                              key={fc.path}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedDiffs((prev) => ({
                                    ...prev,
                                    [fc.path]: !prev[fc.path],
                                  }))
                                }
                                className="flex w-full flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-slate-900"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  {isOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  )}
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass}`}
                                  >
                                    {rt.fileStatusText[fc.status]}
                                  </span>
                                  <span
                                    dir="ltr"
                                    className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100"
                                  >
                                    {fc.path}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  {fc.agents.length > 0 && (
                                    <span className="text-slate-500 dark:text-slate-400">
                                      {rt.agentsLabel}{' '}
                                      <span className="font-medium text-slate-700 dark:text-slate-300">
                                        {fc.agents.join('، ')}
                                      </span>
                                    </span>
                                  )}
                                  <span dir="ltr" className="font-mono tabular-nums">
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      +{fc.additions}
                                    </span>{' '}
                                    <span className="text-rose-600 dark:text-rose-400">
                                      -{fc.deletions}
                                    </span>
                                  </span>
                                </div>
                              </button>

                              {isOpen && (
                                <div
                                  dir="ltr"
                                  className="max-h-72 overflow-auto border-t border-slate-200 bg-slate-950 font-mono text-[11px] leading-relaxed dark:border-slate-800"
                                >
                                  {fc.lines.map((line, idx) => {
                                    const rowCls =
                                      line.type === 'added'
                                        ? 'bg-emerald-950/60 text-emerald-200'
                                        : line.type === 'removed'
                                          ? 'bg-rose-950/60 text-rose-200'
                                          : 'text-slate-400';
                                    const prefix =
                                      line.type === 'added'
                                        ? '+'
                                        : line.type === 'removed'
                                          ? '-'
                                          : ' ';
                                    return (
                                      <div key={idx} className={`flex whitespace-pre px-3 py-0.5 ${rowCls}`}>
                                        <span className="w-8 shrink-0 select-none text-slate-500">
                                          {line.oldLine ?? ''}
                                        </span>
                                        <span className="w-8 shrink-0 select-none text-slate-500">
                                          {line.newLine ?? ''}
                                        </span>
                                        <span className="w-4 shrink-0 select-none">{prefix}</span>
                                        <span className="min-w-0 flex-1">{line.text}</span>
                                      </div>
                                    );
                                  })}
                                  {fc.truncated && (
                                    <div className="border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[10px] text-slate-400">
                                      {rt.truncatedNotice}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Commands Executed */}
                  {report.commands.length > 0 && (
                    <section>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                        <Terminal className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                        <span>
                          {rt.commandsHeading} ({report.commands.length})
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {report.commands.map((cmd, idx) => (
                          <div
                            key={`${cmd.command}-${idx}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <code
                                dir="ltr"
                                className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100"
                              >
                                $ {cmd.command}
                              </code>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-slate-500 dark:text-slate-400">
                                  {cmd.agentName}
                                </span>
                                {typeof cmd.exitCode === 'number' && (
                                  <span
                                    className={`font-mono font-semibold ${
                                      cmd.exitCode === 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                    }`}
                                  >
                                    {rt.exitCodeLabel}: {cmd.exitCode}
                                  </span>
                                )}
                              </div>
                            </div>
                            {cmd.outputPreview && (
                              <pre
                                dir="ltr"
                                className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 font-mono text-[10px] text-slate-200"
                              >
                                {cmd.outputPreview}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Logged Bugs / Improvements */}
                  {report.bugs.length > 0 && (
                    <section>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                        <Bug className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <span>
                          {rt.bugsHeading} ({report.bugs.length})
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {report.bugs.map((bug) => (
                          <div
                            key={bug.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900 dark:text-slate-100" dir="auto">
                                {bug.title}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {bug.agentName} · {bug.category} · {bug.severity}
                              </div>
                            </div>
                            <span className="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:border-slate-700 dark:text-slate-300">
                              {bug.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                disabled={!report}
                onClick={() => void handleCopyReportText()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copiedReport ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedReport ? rt.copied : rt.copyReport}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetId = activeReportRun.id;
                    setActiveReportRun(null);
                    onInspectRun(targetId);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{rt.inspectChat}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReportRun(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {rt.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

