import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import type {
  PrelaunchCategoryId,
  PrelaunchTestReport,
  PrelaunchTestResult,
  PrelaunchTestStatus,
  WorkflowConfig,
} from '../types/workflow';
import {
  PRELAUNCH_CATEGORIES,
  PRELAUNCH_TEST_DEFINITIONS,
  buildPrelaunchFixPrompt,
} from '../utils/prelaunchTests';

interface PreLaunchTestSuiteProps {
  lang?: 'en' | 'fa';
  workflow: WorkflowConfig;
  activeRunId: string | null;
  report: PrelaunchTestReport | null;
  onReportChange: (report: PrelaunchTestReport | null) => void;
  strictMode: boolean;
  onStrictModeChange: (strict: boolean) => void;
  onAskAgentsToFix: (prompt: string) => void;
}

function statusBadgeStyle(status: PrelaunchTestStatus | 'pending'): string {
  switch (status) {
    case 'pass':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
    case 'warn':
      return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
    case 'fail':
      return 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export function PreLaunchTestSuite({
  lang = 'en',
  workflow,
  activeRunId,
  report,
  onReportChange,
  strictMode,
  onStrictModeChange,
  onAskAgentsToFix,
}: PreLaunchTestSuiteProps) {
  const isFa = lang === 'fa';
  const [selectedCategory, setSelectedCategory] = useState<'all' | PrelaunchCategoryId>('all');
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/prelaunch-tests/latest?workflowId=${encodeURIComponent(workflow.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { report?: PrelaunchTestReport | null } | null) => {
        if (!active || !data) return;
        onReportChange(data.report ?? null);
      })
      .catch(() => {
        // ignore offline errors
      });
    return () => {
      active = false;
    };
    // Only re-fetch when active workflow changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  const resultMap = useMemo(() => {
    const map = new Map<string, PrelaunchTestResult>();
    if (report) {
      for (const r of report.results) {
        map.set(r.id, r);
      }
    }
    return map;
  }, [report]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, { total: number; passed: number; failed: number; warn: number }> =
      {};
    for (const cat of PRELAUNCH_CATEGORIES) {
      const defs = PRELAUNCH_TEST_DEFINITIONS.filter((d) => d.category === cat.id);
      let passed = 0;
      let failed = 0;
      let warn = 0;
      for (const def of defs) {
        const res = resultMap.get(def.id);
        if (res?.status === 'pass') passed += 1;
        else if (res?.status === 'fail') failed += 1;
        else if (res?.status === 'warn') warn += 1;
      }
      counts[cat.id] = { total: defs.length, passed, failed, warn };
    }
    return counts;
  }, [resultMap]);

  const visibleDefinitions = useMemo(() => {
    if (selectedCategory === 'all') return PRELAUNCH_TEST_DEFINITIONS;
    return PRELAUNCH_TEST_DEFINITIONS.filter((d) => d.category === selectedCategory);
  }, [selectedCategory]);

  const handleRunSuite = async () => {
    setErrorMsg(null);
    setRunning(true);
    try {
      const res = await fetch('/api/prelaunch-tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          workflow,
          runId: activeRunId ?? undefined,
          strictMode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        report?: PrelaunchTestReport;
        error?: string;
      };
      if (!res.ok || !data.report) {
        setErrorMsg(
          data.error ||
            (isFa
              ? 'خطا در اجرای مجموعه تست‌های سخت قبل از لانچ.'
              : 'Failed to execute pre-launch strict test suite.'),
        );
        return;
      }
      onReportChange(data.report);
    } catch {
      setErrorMsg(
        isFa
          ? 'خطای شبکه هنگام اجرای تست‌های پیش از لانچ.'
          : 'Network error running pre-launch test suite.',
      );
    } finally {
      setRunning(false);
    }
  };

  const handleSendFixesToAgents = () => {
    if (!report) return;
    const prompt = buildPrelaunchFixPrompt({ report, lang });
    onAskAgentsToFix(prompt);
  };

  const hasIssuesToFix = Boolean(
    report && (report.failedCount > 0 || report.warnCount > 0),
  );

  return (
    <section
      dir={isFa ? 'rtl' : 'ltr'}
      data-testid="prelaunch-test-suite"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {isFa
                ? 'تست سخت قبل از لانچ نهایی (۴ دسته اصلی · ۱۴ تست فنی و عملکردی)'
                : 'Strict Pre-Launch Final Test Gate (4 Categories · 14 Test Types)'}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {isFa
              ? 'پیش از انتشار پروژه، تمام تست‌های پایه (Unit/Integration/System)، عملکردی و امنیتی (Functional/Performance/Stress/Security)، تجربه کاربری و سازگاری (Usability/Compatibility/Regression) و تست‌های نهایی (Smoke/Alpha/Beta/UAT) را با سخت‌گیری کامل اجرا و بررسی کنید.'
              : 'Run strict real checks across all 14 release criteria (Unit, Integration, System, Functional, Performance, Stress, Security, Usability, Compatibility, Regression, Smoke, Alpha, Beta, UAT) before shipping.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
            <input
              type="checkbox"
              data-testid="prelaunch-strict-toggle"
              checked={strictMode}
              onChange={(e) => onStrictModeChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
            />
            <span>{isFa ? 'حالت سخت‌گیرانه (Strict Gate)' : 'Strict Gate Mode'}</span>
          </label>

          <button
            type="button"
            data-testid="run-strict-prelaunch-btn"
            disabled={running}
            onClick={() => void handleRunSuite()}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>
              {running
                ? isFa
                  ? 'در حال اجرای ۱۴ تست...'
                  : 'Running 14 Tests...'
                : isFa
                  ? 'اجرای کامل ۱۴ تست قبل از لانچ'
                  : 'Run All 14 Strict Pre-Launch Tests'}
            </span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {/* Verdict Banner */}
      {report && (
        <div
          data-testid="prelaunch-gate-banner"
          className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5 ${
            report.gateStatus === 'approved'
              ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100'
              : 'border-rose-300 bg-rose-50/80 text-rose-950 dark:border-rose-800 dark:bg-rose-950/35 dark:text-rose-100'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {report.gateStatus === 'approved' ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide">
                  {report.gateStatus === 'approved'
                    ? isFa
                      ? 'گیت لانچ: تایید شده (آماده انتشار)'
                      : 'Launch Gate: APPROVED'
                    : isFa
                      ? 'گیت لانچ: مسدود (نیازمند اصلاح قبل از انتشار)'
                      : 'Launch Gate: BLOCKED'}
                </span>
                <span className="rounded border border-current/20 bg-white/70 px-2 py-0.5 font-mono text-[11px] font-bold dark:bg-slate-900/70">
                  {report.overallScore}%
                </span>
                <span className="text-[11px] opacity-80">
                  {report.passedCount} {isFa ? 'موفق' : 'pass'} · {report.warnCount}{' '}
                  {isFa ? 'هشدار' : 'warn'} · {report.failedCount} {isFa ? 'خطا' : 'fail'} ·{' '}
                  {report.durationMs}ms
                </span>
              </div>
              <p className="mt-0.5 text-[11px] opacity-85">
                {isFa ? 'دامنه بررسی:' : 'Scope:'} <span className="font-mono">{report.targetScope}</span>
                {' · '}
                {new Date(report.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {hasIssuesToFix && (
            <button
              type="button"
              data-testid="send-prelaunch-fixes-to-agents-btn"
              onClick={handleSendFixesToAgents}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>
                {isFa
                  ? 'ارسال موارد خطا و هشدار به ایجنت‌ها برای اصلاح'
                  : 'Ask Agents to Fix Failures'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3 dark:border-slate-800">
        <button
          type="button"
          data-testid="prelaunch-category-tab-all"
          onClick={() => setSelectedCategory('all')}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            selectedCategory === 'all'
              ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
          }`}
        >
          {isFa ? 'همه ۱۴ تست (۴ دسته)' : 'All 14 Tests (4 Categories)'}
        </button>
        {PRELAUNCH_CATEGORIES.map((cat) => {
          const stat = categoryCounts[cat.id];
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              data-testid={`prelaunch-category-tab-${cat.id}`}
              onClick={() => setSelectedCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
              }`}
            >
              <span>{isFa ? cat.titleFa : cat.titleEn}</span>
              <span className="rounded bg-slate-200/80 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {report ? `${stat.passed}/${stat.total}` : `${stat.total}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Category Header Hint when filtered */}
      {selectedCategory !== 'all' && (
        <div className="mt-3 text-xs text-slate-600 dark:text-slate-400">
          {(() => {
            const cat = PRELAUNCH_CATEGORIES.find((c) => c.id === selectedCategory);
            if (!cat) return null;
            return isFa ? cat.subtitleFa : cat.subtitleEn;
          })()}
        </div>
      )}

      {/* 14 Test Cards Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleDefinitions.map((def) => {
          const result = resultMap.get(def.id);
          const status: PrelaunchTestStatus | 'pending' = result?.status ?? 'pending';
          const catMeta = PRELAUNCH_CATEGORIES.find((c) => c.id === def.category);

          return (
            <article
              key={def.id}
              data-testid={`prelaunch-test-card-${def.id}`}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {isFa ? catMeta?.titleFa : catMeta?.titleEn}
                    </div>
                    <h3 className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      {isFa ? def.titleFa : def.titleEn}
                    </h3>
                  </div>

                  <span
                    data-testid={`prelaunch-status-${def.id}`}
                    className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusBadgeStyle(
                      status,
                    )}`}
                  >
                    {status === 'pass' && <CheckCircle2 className="h-3 w-3" />}
                    {status === 'warn' && <AlertTriangle className="h-3 w-3" />}
                    {status === 'fail' && <XCircle className="h-3 w-3" />}
                    <span>
                      {status === 'pending'
                        ? isFa
                          ? 'آماده'
                          : 'READY'
                        : status.toUpperCase()}
                    </span>
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {result
                    ? isFa
                      ? result.summaryFa
                      : result.summaryEn
                    : isFa
                      ? def.descriptionFa
                      : def.descriptionEn}
                </p>

                {result && result.evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {result.evidence.slice(0, 3).map((ev, i) => (
                      <li key={i} className="truncate" title={ev}>
                        • {ev}
                      </li>
                    ))}
                  </ul>
                )}

                {result && (isFa ? result.recommendationFa : result.recommendationEn) && (
                  <p className="mt-2 rounded border border-amber-200 bg-amber-50/70 px-2 py-1 text-[10px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    {isFa ? result.recommendationFa : result.recommendationEn}
                  </p>
                )}
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-slate-200/70 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span className="uppercase">
                  {isFa ? 'اولویت:' : 'Severity:'} <strong>{def.severity}</strong>
                </span>
                {result ? (
                  <span className="font-mono tabular-nums">
                    {result.score}% · {result.durationMs}ms
                  </span>
                ) : (
                  <span>{isFa ? 'اجرا نشده' : 'Not run yet'}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
