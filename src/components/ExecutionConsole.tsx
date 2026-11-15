import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Brain,
  Bug,
  CheckCircle2,
  FolderOpen,
  Lightbulb,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  UploadCloud,
  Wand2,
  Wrench,
} from 'lucide-react';
import type {
  AgentRole,
  BugReportCategory,
  BugReportItem,
  BugReportStatus,
  ContinuousWorkSession,
  ExecutionEvent,
  FileDiffEntry,
  SandboxFile,
  WorkflowNode,
} from '../types/workflow';
import { CodeDiffViewer } from './CodeDiffViewer';

interface ExecutionConsoleProps {
  nodes: WorkflowNode[];
  lang?: 'en' | 'fa';
  targetAgentId: string;
  onTargetAgentChange: (agentId: string) => void;
  chatInput: string;
  onChatInputChange: (val: string) => void;
  onSendChat: () => void;
  onConvertToPrompt: () => Promise<void>;
  onStartRun: () => void;
  onStopRun?: () => void;
  onRunTestAndDeploy?: () => void;
  onClearFeed?: () => void;
  isRunning: boolean;
  isSendingChat: boolean;
  isConvertingPrompt: boolean;
  promptEnhancedNotice: string | null;
  validationError: string | null;
  events: ExecutionEvent[];
  streamingEvents?: Record<string, ExecutionEvent>;
  sandboxFiles: SandboxFile[];
  sandboxDiffs?: FileDiffEntry[];
  bugReports: BugReportItem[];
  onUpdateBugStatus: (id: string, status: BugReportStatus) => Promise<void>;
  onDeleteBug: (id: string) => Promise<void>;
  onAskAgentToFixBug: (bug: BugReportItem) => void;
  pendingApproval: {
    approvalId: string;
    agentName: string;
    command: string;
    reason: string;
  } | null;
  onResolveApproval: (approvalId: string, approved: boolean) => void;
  executionMode: 'live' | 'dry_run';
  onExecutionModeChange: (mode: 'live' | 'dry_run') => void;
  geminiConfigured: boolean;
  onDownloadZip?: () => void;
  onOpenGitHubPush?: () => void;
  continuousActive?: boolean;
  continuousSession?: ContinuousWorkSession | null;
  continuousBusy?: boolean;
  onToggleContinuous?: () => void;
  memoryEnabled?: boolean;
  onToggleMemory?: (enabled: boolean) => void;
  onClearMemory?: () => void;
}

const ROLE_LABELS: Record<'en' | 'fa', Record<AgentRole, string>> = {
  en: {
    manager: 'Manager',
    backend: 'Backend',
    frontend: 'Frontend',
    security_qa: 'Security & QA',
    executor: 'Executor',
    custom: 'Custom',
  },
  fa: {
    manager: 'مدیریت (Manager)',
    backend: 'بک‌اند (Backend)',
    frontend: 'فرانت‌اند (Frontend)',
    security_qa: 'امنیت و تست (QA)',
    executor: 'اجراگر (Executor)',
    custom: 'سفارشی',
  },
};

const CHAT_COPY = {
  en: {
    liveLabel: 'Live LLM',
    dryRunLabel: 'Sandbox Dry-Run',
    runWorkflow: 'Run Workflow',
    testAndDeploy: 'Test & Deploy Audit',
    executing: 'Executing...',
    delegationTitle: 'Manager Delegation',
    delegationPhaseTest: 'TEST AUDIT',
    delegationPhaseDeploy: 'DEPLOY AUDIT',
    delegationPhaseReview: 'TEAM REVIEW',
    groupChat: 'GroupChat',
    sandbox: 'Sandbox',
    bugReport: 'Bug Report',
    talkTo: 'Chat with:',
    allAgents: 'All Agents (GroupChat Team)',
    placeholder:
      'Write a simple instruction or question in plain language (Enter to send, Shift+Enter for new line)...',
    convertToPrompt: 'Convert to Prompt',
    convertingPrompt: 'Converting...',
    send: 'Send',
    sending: 'Sending...',
    emptyTitle: 'Interactive Multi-Agent GroupChat',
    emptyHint:
      'Select All Agents for a collaborative team discussion where every specialist responds and interacts, or pick a single agent.',
    sandboxEmptyTitle: 'Sandbox Workspace Empty',
    sandboxEmptyHint:
      'Files written by Backend, Frontend, or Security agents during execution appear here for inspection.',
    bugEmptyTitle: 'No Bugs or Ideas Reported Yet',
    bugEmptyHint:
      'As agents collaborate in GroupChat or run workflows, they automatically log domain bugs and improvement ideas here.',
    filterAll: 'All',
    filterBugs: 'Bugs',
    filterIdeas: 'Ideas',
    allRoles: 'All Roles',
    categoryBug: 'Bug',
    categoryIdea: 'Improvement',
    suggestedFix: 'Suggested Fix',
    askAgentFix: 'Ask Agent to Fix',
    resolve: 'Resolve',
    reopen: 'Reopen',
    resolvedBadge: 'Resolved',
    openBadge: 'Open',
    viewInBugTab: 'Open Bug Report Tab',
    clearChat: 'New Chat',
    stopRun: 'Stop Run',
    memoryOn: 'Team Memory: On',
    memoryOff: 'Team Memory: Off',
    clearMemory: 'Clear memory',
  },
  fa: {
    liveLabel: 'اجرای زنده',
    dryRunLabel: 'تست سندباکس',
    runWorkflow: 'اجرای کامل ورکفلو',
    testAndDeploy: 'تست و دپلوی خودکار',
    executing: 'در حال اجرا...',
    delegationTitle: 'ارجاع خودکار مدیر',
    delegationPhaseTest: 'بررسی تست',
    delegationPhaseDeploy: 'بررسی دپلوی',
    delegationPhaseReview: 'بررسی تیم',
    groupChat: 'چت گروهی',
    sandbox: 'فایل‌ها',
    bugReport: 'باگ رپورت',
    talkTo: 'مکالمه با:',
    allAgents: 'همه ایجنت‌ها (GroupChat تیمی)',
    placeholder:
      'دستور یا سوال خود را به زبان ساده بنویسید (Enter برای ارسال، Shift+Enter برای خط جدید)...',
    convertToPrompt: 'تبدیل به پرامپت',
    convertingPrompt: 'در حال تبدیل...',
    send: 'ارسال',
    sending: 'در حال پاسخ...',
    emptyTitle: 'گفت‌وگوی گروهی زنده با تیم ایجنت‌ها',
    emptyHint:
      'با انتخاب «همه ایجنت‌ها»، تمام متخصصان (مدیریت، بک‌اند، فرانت‌اند، امنیت و اجراگر) هم‌زمان پاسخ می‌دهند و با هم تبادل نظر می‌کنند.',
    sandboxEmptyTitle: 'فضای سندباکس خالی است',
    sandboxEmptyHint:
      'فایل‌هایی که توسط ایجنت‌ها ایجاد یا ویرایش شوند در این بخش قابل مشاهده هستند.',
    bugEmptyTitle: 'هنوز باگ یا پیشنهادی ثبت نشده است',
    bugEmptyHint:
      'در جریان چت گروهی یا اجرای ورکفلو، هر ایجنت در حوزه تخصصی خود باگ‌ها یا ایده‌های بهبود را اینجا ثبت می‌کند.',
    filterAll: 'همه',
    filterBugs: 'باگ‌ها',
    filterIdeas: 'ایده‌ها',
    allRoles: 'همه بخش‌ها',
    categoryBug: 'باگ',
    categoryIdea: 'ایده بهبود',
    suggestedFix: 'راهکار پیشنهادی',
    askAgentFix: 'ارسال به ایجنت برای اصلاح',
    resolve: 'حل شد',
    reopen: 'بازگشایی',
    resolvedBadge: 'حل‌شده',
    openBadge: 'باز',
    viewInBugTab: 'مشاهده در باگ رپورت',
    clearChat: 'چت جدید',
    stopRun: 'توقف اجرا',
    memoryOn: 'حافظه تیم: روشن',
    memoryOff: 'حافظه تیم: خاموش',
    clearMemory: 'پاک‌سازی حافظه',
  },
};

function severityStyle(severity: BugReportItem['severity']): string {
  switch (severity) {
    case 'critical':
      return 'border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/70 dark:text-red-200';
    case 'high':
      return 'border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-950/70 dark:text-orange-200';
    case 'medium':
      return 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-200';
    default:
      return 'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
}

export function ExecutionConsole({
  nodes,
  lang = 'en',
  targetAgentId,
  onTargetAgentChange,
  chatInput,
  onChatInputChange,
  onSendChat,
  onConvertToPrompt,
  onStartRun,
  onStopRun,
  onRunTestAndDeploy,
  onClearFeed,
  isRunning,
  isSendingChat,
  isConvertingPrompt,
  promptEnhancedNotice,
  validationError,
  events,
  streamingEvents = {},
  sandboxFiles,
  sandboxDiffs = [],
  bugReports,
  onUpdateBugStatus,
  onDeleteBug,
  onAskAgentToFixBug,
  pendingApproval,
  onResolveApproval,
  executionMode,
  onExecutionModeChange,
  geminiConfigured,
  onDownloadZip,
  onOpenGitHubPush,
  continuousActive = false,
  continuousSession = null,
  continuousBusy = false,
  onToggleContinuous,
  memoryEnabled = true,
  onToggleMemory,
  onClearMemory,
}: ExecutionConsoleProps) {
  const [subTab, setSubTab] = useState<'stream' | 'sandbox' | 'bugs'>('stream');
  const [sandboxViewMode, setSandboxViewMode] = useState<'files' | 'diff'>('files');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [bugCategoryFilter, setBugCategoryFilter] = useState<'all' | BugReportCategory>('all');
  const [bugRoleFilter, setBugRoleFilter] = useState<'all' | AgentRole>('all');
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const t = CHAT_COPY[lang];
  const roleNames = ROLE_LABELS[lang];
  const selectedFile =
    sandboxFiles.find((f) => f.path === selectedFilePath) ?? sandboxFiles[0] ?? null;
  const activeStreamBubbles = useMemo(() => Object.values(streamingEvents), [streamingEvents]);

  const filteredBugs = useMemo(() => {
    return bugReports.filter((b) => {
      if (bugCategoryFilter !== 'all' && b.category !== bugCategoryFilter) return false;
      if (bugRoleFilter !== 'all' && b.role !== bugRoleFilter) return false;
      return true;
    });
  }, [bugReports, bugCategoryFilter, bugRoleFilter]);

  const openBugsCount = useMemo(
    () => bugReports.filter((b) => b.status !== 'resolved').length,
    [bugReports],
  );

  const tokenTotals = useMemo(() => {
    let totalTokens = 0;
    let savedTokens = 0;
    let estimated = false;
    for (const evt of events) {
      if (evt.tokenUsage) {
        totalTokens += evt.tokenUsage.totalTokens || 0;
        savedTokens += evt.tokenUsage.savedTokens || 0;
        if (evt.tokenUsage.estimated) estimated = true;
      }
    }
    return { totalTokens, savedTokens, estimated };
  }, [events]);

  useEffect(() => {
    if (subTab === 'stream') {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, activeStreamBubbles.length, subTab]);

  const busy = isRunning || isSendingChat;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Compact Header Bar */}
      <div className="shrink-0 space-y-2 border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => onExecutionModeChange('live')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                executionMode === 'live'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {t.liveLabel}
            </button>
            <button
              type="button"
              onClick={() => onExecutionModeChange('dry_run')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                executionMode === 'dry_run'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {t.dryRunLabel}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {onToggleMemory && (
              <button
                type="button"
                data-testid="memory-toggle-btn"
                onClick={() => onToggleMemory(!memoryEnabled)}
                aria-pressed={memoryEnabled}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                  memoryEnabled
                    ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                }`}
              >
                <Brain className="h-3 w-3 shrink-0" />
                <span>{memoryEnabled ? t.memoryOn : t.memoryOff}</span>
              </button>
            )}
            {onClearMemory && memoryEnabled && (
              <button
                type="button"
                data-testid="clear-memory-btn"
                onClick={onClearMemory}
                title={t.clearMemory}
                aria-label={t.clearMemory}
                className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 p-1 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            {events.length > 0 && onClearFeed && !busy && (
              <button
                type="button"
                onClick={onClearFeed}
                title={t.clearChat}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3 w-3" />
                {t.clearChat}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {isRunning && onStopRun ? (
            <button
              type="button"
              data-testid="stop-run-btn"
              onClick={onStopRun}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-rose-700"
            >
              <Square className="h-3.5 w-3.5 shrink-0" />
              <span>{t.stopRun}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onStartRun}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 shrink-0" />
              <span>{isRunning ? t.executing : t.runWorkflow}</span>
            </button>
          )}

          {onRunTestAndDeploy && (
            <button
              type="button"
              data-testid="test-deploy-btn"
              disabled={busy}
              onClick={onRunTestAndDeploy}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Rocket className="h-3.5 w-3.5 shrink-0" />
              <span>{t.testAndDeploy}</span>
            </button>
          )}
        </div>

        {onToggleContinuous && (
          <div
            dir={lang === 'fa' ? 'rtl' : 'ltr'}
            data-testid="console-continuous-strip"
            className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
              continuousActive
                ? 'border-blue-300 bg-blue-50/80 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <RefreshCw
                  className={`h-3 w-3 shrink-0 ${
                    continuousActive ? 'animate-spin text-blue-600 dark:text-blue-400' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">
                  {lang === 'fa'
                    ? continuousActive
                      ? `کار مداوم فعال · چرخه #${continuousSession?.cyclesCompleted ?? 0}`
                      : 'کار مداوم خودکار (متوقف)'
                    : continuousActive
                      ? `Continuous 24/7 Active · Cycle #${continuousSession?.cyclesCompleted ?? 0}`
                      : 'Continuous Autonomous Work (Paused)'}
                </span>
              </div>
              {continuousActive && continuousSession && (
                <div className="mt-0.5 truncate text-[10px] opacity-80">
                  {continuousSession.status === 'running'
                    ? lang === 'fa'
                      ? 'ایجنت‌ها در حال اجرای چرخه فعلی...'
                      : 'Running active cycle...'
                    : continuousSession.status === 'error_backoff'
                      ? lang === 'fa'
                        ? 'بازیابی خودکار پس از خطای موقت...'
                        : 'Retrying after transient error...'
                      : continuousSession.nextCycleAt
                        ? `${lang === 'fa' ? 'چرخه بعدی:' : 'Next cycle:'} ${new Date(
                            continuousSession.nextCycleAt,
                          ).toLocaleTimeString()}`
                        : `${continuousSession.intervalSec}s interval`}
                </div>
              )}
            </div>

            <button
              type="button"
              data-testid="console-continuous-toggle-btn"
              disabled={continuousBusy}
              onClick={onToggleContinuous}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                continuousActive
                  ? 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {continuousActive ? (
                <>
                  <Pause className="h-3 w-3" />
                  <span>{lang === 'fa' ? 'توقف' : 'Pause'}</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  <span>{lang === 'fa' ? 'شروع مداوم' : 'Start 24/7'}</span>
                </>
              )}
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            data-testid="tab-groupchat"
            onClick={() => setSubTab('stream')}
            className={`inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              subTab === 'stream'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t.groupChat} ({events.length})
            </span>
          </button>
          <button
            type="button"
            data-testid="tab-sandbox"
            onClick={() => setSubTab('sandbox')}
            className={`inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              subTab === 'sandbox'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t.sandbox} ({sandboxFiles.length})
            </span>
          </button>
          <button
            type="button"
            data-testid="tab-bug-report"
            onClick={() => setSubTab('bugs')}
            className={`inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              subTab === 'bugs'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <Bug className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t.bugReport} ({openBugsCount > 0 ? openBugsCount : bugReports.length})
            </span>
          </button>
        </div>

        {tokenTotals.totalTokens > 0 && (
          <div
            data-testid="run-token-telemetry"
            dir="ltr"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 font-mono text-[11px] tabular-nums text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            <span>
              {lang === 'fa' ? 'مصرف توکن:' : 'Tokens:'}{' '}
              {tokenTotals.estimated ? '~' : ''}
              {tokenTotals.totalTokens.toLocaleString()}
            </span>
            {tokenTotals.savedTokens > 0 && (
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                -{tokenTotals.savedTokens.toLocaleString()}{' '}
                {lang === 'fa' ? 'صرفه‌جویی' : 'saved'}
              </span>
            )}
          </div>
        )}

        {!geminiConfigured && executionMode === 'live' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            {lang === 'fa'
              ? 'کلید API در Settings تنظیم نشده است. مدل‌های رایگان OpenCode یا حالت Sandbox Dry-Run فعال هستند.'
              : 'No live LLM API key configured in Settings yet. OpenCode free models or Sandbox Dry-Run remain available.'}
          </p>
        )}
      </div>

      {/* Human-in-the-Loop Gate */}
      {pendingApproval && (
        <div
          role="region"
          aria-label="Human in the Loop Approval Gate"
          className="shrink-0 border-b border-amber-300 bg-amber-50 p-3.5 dark:border-amber-800 dark:bg-amber-950/60"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-semibold text-amber-950 dark:text-amber-200">
                Human-in-the-Loop Approval Required
              </h4>
              <p className="mt-1 text-xs text-amber-900 dark:text-amber-300">
                {pendingApproval.agentName} requested bash execution ({pendingApproval.reason}):
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded-md bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                {pendingApproval.command}
              </pre>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onResolveApproval(pendingApproval.approvalId, true)}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                >
                  Approve &amp; Execute
                </button>
                <button
                  type="button"
                  onClick={() => onResolveApproval(pendingApproval.approvalId, false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  Reject Command
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Feed / Sandbox Explorer / Bug Report Tab */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {subTab === 'stream' ? (
          events.length === 0 && activeStreamBubbles.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="mb-2 h-7 w-7 text-slate-300 dark:text-slate-700" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t.emptyTitle}
              </p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t.emptyHint}
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="execution-feed">
              {events.map((evt) => {
                const isUser = evt.type === 'user_message';
                const isError = evt.type === 'run_error';
                const isDone = evt.type === 'run_completed';
                const isCancelled = evt.type === 'run_cancelled';
                const isBugEvt = evt.type === 'bug_reported' && evt.bugReport;
                const isDelegationEvt = evt.type === 'manager_delegation' && evt.delegation;

                if (isDelegationEvt && evt.delegation) {
                  const del = evt.delegation;
                  const phaseText =
                    del.phase === 'deploy'
                      ? t.delegationPhaseDeploy
                      : del.phase === 'test'
                        ? t.delegationPhaseTest
                        : t.delegationPhaseReview;
                  return (
                    <article
                      key={evt.id}
                      data-testid="manager-delegation-card"
                      className="rounded-lg border border-blue-300 bg-blue-50/80 p-3 text-xs text-slate-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-slate-100"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-blue-900 dark:text-blue-200">
                          <ShieldCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          {t.delegationTitle}
                        </span>
                        <span className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-800 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300">
                          {phaseText}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                        <span>{del.managerName}</span>
                        <ArrowRight className="h-3 w-3 text-blue-600" />
                        <span className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-blue-800 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200">
                          {del.targetAgentName} ({roleNames[del.targetRole] ?? del.targetRole})
                        </span>
                      </div>
                      <p dir="auto" className="mt-1.5 font-medium">
                        {del.issue}
                      </p>
                      {del.reason && del.reason !== del.issue && (
                        <p dir="auto" className="mt-0.5 text-[11px] opacity-85">
                          {del.reason}
                        </p>
                      )}
                    </article>
                  );
                }

                if (isBugEvt && evt.bugReport) {
                  const br = evt.bugReport;
                  const isIdea = br.category === 'improvement';
                  return (
                    <article
                      key={evt.id}
                      data-testid="stream-bug-card"
                      className={`rounded-lg border p-3 text-xs ${
                        isIdea
                          ? 'border-indigo-200 bg-indigo-50/70 text-slate-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-slate-100'
                          : 'border-amber-200 bg-amber-50/70 text-slate-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          {isIdea ? (
                            <Lightbulb className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          ) : (
                            <Bug className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
                          )}
                          {br.agentName} · {roleNames[br.role] ?? br.role}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityStyle(
                            br.severity,
                          )}`}
                        >
                          {isIdea ? t.categoryIdea : `${t.categoryBug} · ${br.severity}`}
                        </span>
                      </div>
                      <p dir="auto" className="mt-1.5 font-semibold">
                        {br.title}
                      </p>
                      <p dir="auto" className="mt-1 text-[11px] leading-relaxed opacity-90">
                        {br.description}
                      </p>
                      <div className="mt-2 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => setSubTab('bugs')}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          {t.viewInBugTab}
                        </button>
                      </div>
                    </article>
                  );
                }

                const latencyLabel =
                  typeof evt.durationMs === 'number'
                    ? evt.durationMs < 1000
                      ? `${Math.round(evt.durationMs)}ms`
                      : `${(evt.durationMs / 1000).toFixed(1)}s`
                    : null;
                const tokenLabel =
                  evt.tokenUsage && evt.tokenUsage.totalTokens > 0
                    ? `${evt.tokenUsage.estimated ? '~' : ''}${evt.tokenUsage.totalTokens} tok${
                        evt.tokenUsage.savedTokens && evt.tokenUsage.savedTokens > 0
                          ? ` (-${evt.tokenUsage.savedTokens} saved)`
                          : ''
                      }`
                    : null;

                return (
                  <article
                    key={evt.id}
                    className={`rounded-lg border p-3 text-xs ${
                      isUser
                        ? 'ml-4 border-blue-200 bg-blue-50/80 text-slate-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-slate-100'
                        : isError
                          ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                          : isCancelled
                            ? 'border-slate-300 bg-slate-100/80 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200'
                            : isDone
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : 'border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {evt.agentName ?? 'Orchestrator'}
                        {evt.role ? (
                          <span className="ml-1.5 text-[10px] font-normal text-slate-500 dark:text-slate-400">
                            [{roleNames[evt.role] ?? evt.role}]
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                        {evt.round > 0 ? `Round ${evt.round}` : evt.type}
                        {evt.model ? ` · ${evt.model}` : ''}
                        {latencyLabel ? ` · ${latencyLabel}` : ''}
                        {tokenLabel ? ` · ${tokenLabel}` : ''}
                      </span>
                    </div>

                    <pre
                      dir="auto"
                      className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed"
                    >
                      {evt.content}
                    </pre>

                    {evt.toolCalls && evt.toolCalls.length > 0 && (
                      <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                        {evt.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="rounded-md bg-slate-900 p-2 font-mono text-[11px] text-slate-100"
                          >
                            <div className="flex items-center justify-between gap-2 text-slate-400">
                              <span>
                                {tc.tool}: {tc.target}
                              </span>
                              <span>exit {tc.exitCode ?? 0}</span>
                            </div>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-slate-200">
                              {tc.result}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {activeStreamBubbles.map((chunk) => (
                <article
                  key={`stream-${chunk.agentId ?? chunk.id}`}
                  data-testid="live-streaming-bubble"
                  className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs text-slate-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-blue-800 dark:text-blue-300">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      {chunk.agentName ?? 'Agent'}
                    </span>
                    <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">
                      {lang === 'fa' ? 'در حال نگارش...' : 'Streaming...'}
                    </span>
                  </div>
                  <pre
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed"
                  >
                    {chunk.content}
                  </pre>
                </article>
              ))}
              <div ref={feedEndRef} />
            </div>
          )
        ) : subTab === 'sandbox' ? (
          <div className="space-y-3">
            {(onDownloadZip || onOpenGitHubPush) && (
              <div
                dir={lang === 'fa' ? 'rtl' : 'ltr'}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/60"
              >
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  {lang === 'fa'
                    ? 'خروجی فایل‌های سندباکس و پروژه:'
                    : 'Export sandbox & project bundle:'}
                </span>
                <div className="flex items-center gap-1.5">
                  {onDownloadZip && (
                    <button
                      type="button"
                      data-testid="sandbox-download-zip-btn"
                      onClick={onDownloadZip}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <Archive className="h-3 w-3 text-blue-600" />
                      {lang === 'fa' ? 'دانلود ZIP' : 'Save ZIP'}
                    </button>
                  )}
                  {onOpenGitHubPush && (
                    <button
                      type="button"
                      data-testid="sandbox-github-push-btn"
                      onClick={onOpenGitHubPush}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-800"
                    >
                      <UploadCloud className="h-3 w-3" />
                      {lang === 'fa' ? 'Push در گیت‌هاب' : 'Push to GitHub'}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  data-testid="sandbox-view-files-btn"
                  onClick={() => setSandboxViewMode('files')}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    sandboxViewMode === 'files'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {lang === 'fa' ? `فایل‌ها (${sandboxFiles.length})` : `Files (${sandboxFiles.length})`}
                </button>
                <button
                  type="button"
                  data-testid="sandbox-view-diff-btn"
                  onClick={() => setSandboxViewMode('diff')}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    sandboxViewMode === 'diff'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {lang === 'fa' ? `تغییرات Diff (${sandboxDiffs.length})` : `Diff (${sandboxDiffs.length})`}
                </button>
              </div>
            </div>

            {sandboxViewMode === 'diff' ? (
              <CodeDiffViewer diffs={sandboxDiffs} lang={lang} />
            ) : sandboxFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t.sandboxEmptyTitle}
                </p>
                <p className="mt-1.5 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                  {t.sandboxEmptyHint}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {sandboxFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                        selectedFile?.path === file.path
                          ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
                {selectedFile && (
                  <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <span>{selectedFile.path}</span>
                      <span className="tabular-nums">{selectedFile.size} bytes</span>
                    </div>
                    <pre className="max-h-[340px] overflow-auto bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                      {selectedFile.content}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3" data-testid="bug-report-panel">
            {/* Category & Agent Role Filters */}
            <div
              dir={lang === 'fa' ? 'rtl' : 'ltr'}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/60"
            >
              <div className="flex items-center gap-1">
                {(['all', 'bug', 'improvement'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setBugCategoryFilter(cat)}
                    className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                      bugCategoryFilter === cat
                        ? 'bg-slate-900 text-white dark:bg-blue-600'
                        : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {cat === 'all' ? t.filterAll : cat === 'bug' ? t.filterBugs : t.filterIdeas}
                  </button>
                ))}
              </div>

              <select
                aria-label={t.allRoles}
                value={bugRoleFilter}
                onChange={(e) => setBugRoleFilter(e.target.value as 'all' | AgentRole)}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="all">{t.allRoles}</option>
                {(['manager', 'backend', 'frontend', 'security_qa', 'executor', 'custom'] as AgentRole[]).map(
                  (r) => (
                    <option key={r} value={r}>
                      {roleNames[r]}
                    </option>
                  ),
                )}
              </select>
            </div>

            {filteredBugs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Bug className="mb-2 h-7 w-7 text-slate-300 dark:text-slate-700" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t.bugEmptyTitle}
                </p>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {t.bugEmptyHint}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredBugs.map((bug) => {
                  const isIdea = bug.category === 'improvement';
                  const isResolved = bug.status === 'resolved';
                  return (
                    <article
                      key={bug.id}
                      data-testid="bug-report-card"
                      className={`rounded-lg border p-3 text-xs transition-colors ${
                        isResolved
                          ? 'border-slate-200 bg-slate-50/70 opacity-80 dark:border-slate-800 dark:bg-slate-900/40'
                          : isIdea
                            ? 'border-indigo-200 bg-white dark:border-indigo-900/50 dark:bg-slate-900'
                            : 'border-amber-200 bg-white dark:border-amber-900/50 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">
                              {isIdea ? (
                                <Lightbulb className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                              ) : (
                                <Bug className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                              )}
                              {bug.agentName}
                            </span>
                            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {roleNames[bug.role] ?? bug.role}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityStyle(
                              bug.severity,
                            )}`}
                          >
                            {isIdea ? t.categoryIdea : `${t.categoryBug} · ${bug.severity}`}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                              isResolved
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {isResolved ? t.resolvedBadge : t.openBadge}
                          </span>
                        </div>
                      </div>

                      <h4 dir="auto" className="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                        {bug.title}
                      </h4>
                      <p
                        dir="auto"
                        className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300"
                      >
                        {bug.description}
                      </p>

                      {bug.suggestedFix && (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] dark:border-slate-800 dark:bg-slate-950">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {t.suggestedFix}:{' '}
                          </span>
                          <span dir="auto" className="text-slate-600 dark:text-slate-400">
                            {bug.suggestedFix}
                          </span>
                        </div>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            onAskAgentToFixBug(bug);
                            setSubTab('stream');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300"
                        >
                          <Wrench className="h-3 w-3" />
                          {t.askAgentFix}
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateBugStatus(bug.id, isResolved ? 'open' : 'resolved')
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            {isResolved ? t.reopen : t.resolve}
                          </button>
                          <button
                            type="button"
                            aria-label="Delete bug report"
                            onClick={() => void onDeleteBug(bug.id)}
                            className="inline-flex items-center rounded border border-slate-200 bg-white p-1 text-slate-500 transition-colors hover:border-red-300 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Interactive Chat & Prompt Composer */}
      <div
        dir={lang === 'fa' ? 'rtl' : 'ltr'}
        className="shrink-0 border-t border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/70"
      >
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="chat-target-agent"
            className="shrink-0 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
          >
            {t.talkTo}
          </label>
          <select
            id="chat-target-agent"
            value={targetAgentId}
            onChange={(e) => onTargetAgentChange(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="all">{t.allAgents}</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label} ({n.data.role})
              </option>
            ))}
          </select>
        </div>

        <textarea
          id="chat-message-input"
          dir="auto"
          rows={3}
          value={chatInput}
          onChange={(e) => onChatInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy && chatInput.trim()) {
                onSendChat();
              }
            }
          }}
          placeholder={t.placeholder}
          className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />

        {validationError && (
          <p role="alert" className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
            {validationError}
          </p>
        )}

        {promptEnhancedNotice && (
          <p
            data-testid="prompt-enhanced-notice"
            className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
          >
            {promptEnhancedNotice}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="convert-to-prompt-btn"
            disabled={busy || isConvertingPrompt || !chatInput.trim()}
            onClick={() => void onConvertToPrompt()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-500 hover:bg-blue-50/60 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-400"
          >
            <Wand2 className={`h-3.5 w-3.5 ${isConvertingPrompt ? 'animate-spin' : ''}`} />
            {isConvertingPrompt ? t.convertingPrompt : t.convertToPrompt}
          </button>

          <button
            type="button"
            data-testid="send-chat-btn"
            disabled={busy || !chatInput.trim()}
            onClick={onSendChat}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            <Send className="h-3.5 w-3.5" />
            {isSendingChat || isRunning ? t.sending : t.send}
          </button>
        </div>
      </div>
    </div>
  );
}
