import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  FolderGit2,
  FolderTree,
  GitBranch,
  Globe,
  Key,
  Layers,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  UploadCloud,
} from 'lucide-react';
import type {
  BlueprintFile,
  ExecutionRunSummary,
  FileDiffEntry,
  PrelaunchTestReport,
  WorkflowConfig,
} from '../types/workflow';
import type {
  BundleFileChangeType,
  ExportBundleScope,
  ExportChangeSummary,
} from '../utils/exportBundle';
import {
  DEFAULT_GITHUB_REPO_URL,
  buildLinuxOneLineCommand,
  type LinuxInstallMode,
} from '../utils/githubDeploy';
import { CodeDiffViewer } from './CodeDiffViewer';
import { NginxDomainPanel } from './NginxDomainPanel';
import { PreLaunchTestSuite } from './PreLaunchTestSuite';

interface ExportableRunSummary extends ExecutionRunSummary {
  sandboxFileCount: number;
}

interface ExportableProjectInfo {
  workflowId: string;
  workflowName: string;
  hasImportedProject: boolean;
  importedFileCount: number;
  completedRunCount: number;
  totalRunCount: number;
  mergedAgentFileCount: number;
  runs: ExportableRunSummary[];
}

interface ExportPreviewPayload {
  filename: string;
  scope: ExportBundleScope;
  fileCount: number;
  totalBytes: number;
  changeSummary?: ExportChangeSummary;
  files: Array<{ path: string; size: number; changeType?: BundleFileChangeType }>;
}

interface BlueprintViewProps {
  lang?: 'en' | 'fa';
  workflow: WorkflowConfig;
  workflows?: WorkflowConfig[];
  activeRunId: string | null;
  prelaunchReport: PrelaunchTestReport | null;
  onPrelaunchReportChange: (report: PrelaunchTestReport | null) => void;
  strictPrelaunchMode: boolean;
  onStrictPrelaunchModeChange: (strict: boolean) => void;
  onFixPrelaunchIssues: (prompt: string) => void;
  defaultRepoUrl?: string;
  defaultBranch?: string;
  onRunDeployAudit?: () => void;
  onDownloadZip?: (
    scope?: ExportBundleScope,
    targetWorkflow?: WorkflowConfig,
    targetRunId?: string | null,
  ) => void;
  downloadingZip?: boolean;
  onOpenGitHubPush?: (
    scope?: ExportBundleScope,
    targetWorkflow?: WorkflowConfig,
    targetRunId?: string | null,
  ) => void;
  onUpdateWorkflowWebhook?: (
    workflowId: string,
    patch: { webhookEnabled?: boolean; webhookSecret?: string },
  ) => Promise<void> | void;
}

const STORAGE_REPO_KEY = 'aetherflow_github_deploy_repo';
const STORAGE_BRANCH_KEY = 'aetherflow_github_deploy_branch';

const DIRECTORY_TREE = `aetherflow-agent-studio/
├── install-linux.sh             # One-line GitHub bootstrap & local installer
├── Dockerfile                   # Production Linux image (Node 22 + Python 3 + Vite dist)
├── docker-compose.yml           # Persistent SQLite + Sandbox + Host Ollama networking
├── .env.example                 # Linux runtime & LLM provider environment template
├── README.md                    # Step-by-step GitHub + Linux install guide
├── server.ts                    # Express + WebSocket + SQLite production server
├── deploy/
│   ├── systemd/
│   │   └── aetherflow-studio.service
│   ├── docker-compose.yml       # Optional Python FastAPI + Sandbox compose stack
│   ├── backend/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── main.py              # FastAPI REST + WebSocket (/ws/run/{run_id})
│   │   ├── agent_engine.py      # LiteLLM (Gemini/OpenAI/Claude/Ollama) + GroupChat
│   │   ├── sandbox.py           # Docker SDK for Python isolated Linux execution
│   │   ├── database.py          # SQLite persistence for workflows & transcripts
│   │   └── models.py            # Pydantic v2 schemas
│   ├── sandbox/
│   │   └── Dockerfile.sandbox   # Non-root hardened Linux container (pytest, ruff)
│   └── frontend/
│       ├── Dockerfile           # Multi-stage Vite + Nginx static bundle
│       └── nginx.conf           # SPA + /api/* & /ws reverse proxy config
└── src/
    ├── components/
    │   ├── WorkflowCanvas.tsx   # React Flow v12 n8n-style graph canvas
    │   ├── AgentNode.tsx        # Custom node renderer with handles & status
    │   ├── AgentInspector.tsx   # Provider, model, temperature & prompt editor
    │   └── ExecutionConsole.tsx # WebSocket live stream + HITL approval gate
    └── utils/
        ├── githubDeploy.ts      # GitHub one-line Linux script generator
        └── workflowEngine.ts    # Speaker routing, max_rounds & HITL guard`;

export function BlueprintView({
  lang = 'en',
  workflow,
  workflows = [],
  activeRunId,
  prelaunchReport,
  onPrelaunchReportChange,
  strictPrelaunchMode,
  onStrictPrelaunchModeChange,
  onFixPrelaunchIssues,
  defaultRepoUrl,
  defaultBranch,
  onRunDeployAudit,
  onDownloadZip,
  downloadingZip = false,
  onOpenGitHubPush,
  onUpdateWorkflowWebhook,
}: BlueprintViewProps) {
  const isFa = lang === 'fa';
  const [files, setFiles] = useState<BlueprintFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('install-linux.sh');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);
  const [copiedGitClone, setCopiedGitClone] = useState(false);
  const [copiedWebhookCurl, setCopiedWebhookCurl] = useState(false);
  const [webhookEnabledInput, setWebhookEnabledInput] = useState<boolean>(
    workflow.webhookEnabled !== false,
  );
  const [webhookSecretInput, setWebhookSecretInput] = useState<string>(
    workflow.webhookSecret ?? '',
  );
  const [webhookTestBusy, setWebhookTestBusy] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{
    ok: boolean;
    message: string;
    runId?: string;
  } | null>(null);

  // Selective project & completed-run export state
  const [exportProjects, setExportProjects] = useState<ExportableProjectInfo[]>([]);
  const [exportProjectsLoading, setExportProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(workflow.id);
  const [selectedRunId, setSelectedRunId] = useState<string>('__merged_completed__');
  const [selectedScope, setSelectedScope] = useState<ExportBundleScope>('project_bundle');
  const [exportPreview, setExportPreview] = useState<ExportPreviewPayload | null>(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [showExportFiles, setShowExportFiles] = useState(false);

  const [repoInput, setRepoInput] = useState<string>(() => {
    if (defaultRepoUrl?.trim()) return defaultRepoUrl.trim();
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(STORAGE_REPO_KEY);
      if (saved?.trim()) return saved.trim();
    }
    return DEFAULT_GITHUB_REPO_URL;
  });
  const [branchInput, setBranchInput] = useState<string>(() => {
    if (defaultBranch?.trim()) return defaultBranch.trim();
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(STORAGE_BRANCH_KEY) || 'main';
    }
    return 'main';
  });
  const [installMode, setInstallMode] = useState<LinuxInstallMode>('auto');
  const [installDir, setInstallDir] = useState<string>('');
  const [portInput, setPortInput] = useState<string>('3000');
  const [domainInput, setDomainInput] = useState<string>('');
  const [exportInspectorTab, setExportInspectorTab] = useState<'files' | 'diff'>('files');
  const [exportDiffs, setExportDiffs] = useState<FileDiffEntry[]>([]);
  const [exportDiffLoading, setExportDiffLoading] = useState(false);

  const availableWorkflows = useMemo(() => {
    const map = new Map<string, WorkflowConfig>();
    map.set(workflow.id, workflow);
    for (const w of workflows) {
      if (!map.has(w.id)) map.set(w.id, w);
    }
    return Array.from(map.values());
  }, [workflow, workflows]);

  const selectedWorkflow = useMemo(
    () => availableWorkflows.find((w) => w.id === selectedProjectId) ?? workflow,
    [availableWorkflows, selectedProjectId, workflow],
  );

  const selectedProjectMeta = useMemo(
    () => exportProjects.find((p) => p.workflowId === selectedWorkflow.id) ?? null,
    [exportProjects, selectedWorkflow.id],
  );

  const fetchExportProjects = () => {
    setExportProjectsLoading(true);
    fetch('/api/export/projects')
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: ExportableProjectInfo[] }) => {
        if (Array.isArray(data.projects)) {
          setExportProjects(data.projects);
        }
      })
      .catch(() => {})
      .finally(() => setExportProjectsLoading(false));
  };

  useEffect(() => {
    fetchExportProjects();
  }, [workflow.id, activeRunId]);

  useEffect(() => {
    if (!availableWorkflows.some((w) => w.id === selectedProjectId)) {
      setSelectedProjectId(workflow.id);
    }
  }, [availableWorkflows, selectedProjectId, workflow.id]);

  // Reset run selector & sync webhook settings when switching project
  useEffect(() => {
    setSelectedRunId('__merged_completed__');
    setWebhookEnabledInput(selectedWorkflow.webhookEnabled !== false);
    setWebhookSecretInput(selectedWorkflow.webhookSecret ?? '');
    setWebhookTestResult(null);
  }, [selectedProjectId, selectedWorkflow.webhookEnabled, selectedWorkflow.webhookSecret]);

  // Fetch live export bundle preview (with agent-modified/added counts)
  useEffect(() => {
    let active = true;
    setExportPreviewLoading(true);
    fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: selectedScope,
        workflow: selectedWorkflow,
        runId: selectedRunId,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ExportPreviewPayload | null) => {
        if (!active) return;
        if (data && Array.isArray(data.files)) {
          setExportPreview(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setExportPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedScope, selectedWorkflow, selectedRunId, exportProjects]);

  useEffect(() => {
    if (!showExportFiles) return;
    let active = true;
    const effectiveRunId =
      selectedRunId && selectedRunId !== '__merged_completed__'
        ? selectedRunId
        : selectedProjectMeta?.runs.find((r) => r.status === 'completed')?.id ??
          selectedProjectMeta?.runs[0]?.id ??
          activeRunId ??
          null;
    const projectId = selectedWorkflow.projectContext?.projectId;
    const endpoint =
      effectiveRunId
        ? `/api/runs/${encodeURIComponent(effectiveRunId)}/diff`
        : projectId
          ? `/api/projects/${encodeURIComponent(projectId)}/diff`
          : null;
    if (!endpoint) {
      setExportDiffs([]);
      return;
    }
    setExportDiffLoading(true);
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : { diffs: [] }))
      .then((data: { diffs?: FileDiffEntry[] }) => {
        if (active && Array.isArray(data.diffs)) {
          setExportDiffs(data.diffs);
        }
      })
      .catch(() => {
        if (active) setExportDiffs([]);
      })
      .finally(() => {
        if (active) setExportDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showExportFiles, selectedRunId, selectedProjectMeta, selectedWorkflow, activeRunId]);

  useEffect(() => {
    if (defaultRepoUrl?.trim() && !repoInput.trim()) {
      setRepoInput(defaultRepoUrl.trim());
    }
    if (defaultBranch?.trim()) {
      setBranchInput(defaultBranch.trim());
    }
  }, [defaultRepoUrl, defaultBranch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_REPO_KEY, repoInput);
  }, [repoInput]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_BRANCH_KEY, branchInput || 'main');
  }, [branchInput]);

  useEffect(() => {
    let active = true;
    fetch('/api/blueprint')
      .then((res) => res.json())
      .then((data: { files?: BlueprintFile[] }) => {
        if (!active) return;
        const list = data.files ?? [];
        setFiles(list);
        if (list.length > 0) {
          setSelectedPath(list[0].path);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const generated = useMemo(
    () =>
      buildLinuxOneLineCommand({
        repoInput,
        branch: branchInput,
        mode: installMode,
        installDir,
        port: portInput,
        domain: domainInput,
      }),
    [repoInput, branchInput, installMode, installDir, portInput, domainInput]
  );

  const currentFile = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;

  const handleCopy = async () => {
    if (!currentFile) return;
    await navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyOneLiner = async () => {
    await navigator.clipboard.writeText(generated.oneLineCurlCommand);
    setCopiedOneLiner(true);
    setTimeout(() => setCopiedOneLiner(false), 1800);
  };

  const handleCopyGitClone = async () => {
    await navigator.clipboard.writeText(generated.gitCloneCommand);
    setCopiedGitClone(true);
    setTimeout(() => setCopiedGitClone(false), 1800);
  };

  const formatByteSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const webhookEndpointUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/${selectedWorkflow.id}`
      : `/api/webhooks/${selectedWorkflow.id}`;

  const webhookCurlSnippet = `curl -X POST "${webhookEndpointUrl}" \\
  -H "Content-Type: application/json" \\${
    webhookSecretInput.trim()
      ? `\n  -H "x-webhook-secret: ${webhookSecretInput.trim()}" \\`
      : ''
  }
  -d '{"prompt":"Audit new pull request and run QA checks","mode":"dry_run"}'`;

  const handleCopyWebhookCurl = async () => {
    await navigator.clipboard?.writeText(webhookCurlSnippet).catch(() => {});
    setCopiedWebhookCurl(true);
    setTimeout(() => setCopiedWebhookCurl(false), 1800);
  };

  const handleSaveWebhookSettings = async (
    nextEnabled = webhookEnabledInput,
    nextSecret = webhookSecretInput,
  ) => {
    if (onUpdateWorkflowWebhook) {
      await onUpdateWorkflowWebhook(selectedWorkflow.id, {
        webhookEnabled: nextEnabled,
        webhookSecret: nextSecret.trim(),
      });
    }
  };

  const handleTestWebhook = async () => {
    setWebhookTestBusy(true);
    setWebhookTestResult(null);
    try {
      await handleSaveWebhookSettings(webhookEnabledInput, webhookSecretInput);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (webhookSecretInput.trim()) {
        headers['x-webhook-secret'] = webhookSecretInput.trim();
      }
      const res = await fetch(`/api/webhooks/${encodeURIComponent(selectedWorkflow.id)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: `Webhook test dispatch for ${selectedWorkflow.name}`,
          mode: 'dry_run',
          source: 'deploy-panel',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accepted?: boolean;
        runId?: string;
        error?: string;
      };
      if (!res.ok) {
        setWebhookTestResult({
          ok: false,
          message: data.error || `HTTP ${res.status}`,
        });
        return;
      }
      setWebhookTestResult({
        ok: true,
        runId: data.runId,
        message: isFa
          ? `وب‌هوک با موفقیت پذیرفته شد (شناسه اجرا: ${data.runId})`
          : `Accepted (HTTP 202) · Run ID: ${data.runId}`,
      });
      fetchExportProjects();
    } catch {
      setWebhookTestResult({
        ok: false,
        message: isFa ? 'خطای شبکه در ارسال درخواست وب‌هوک' : 'Network error calling webhook',
      });
    } finally {
      setWebhookTestBusy(false);
    }
  };

  return (
    <section
      dir={isFa ? 'rtl' : 'ltr'}
      className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-4 overflow-y-auto p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            {lang === 'fa'
              ? 'نصب تک‌خطی از گیت‌هاب روی سرور لینوکس'
              : 'GitHub One-Line Linux Installer & Deployment'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {lang === 'fa'
              ? 'لینک مخزن گیت‌هاب پروژه خود را وارد کنید تا دستور نصب تک‌خطی آماده اجرا روی سرور لینوکس ساخته شود.'
              : 'Enter your GitHub repository link to generate a ready-to-run one-line Linux server installer command.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {prelaunchReport && (
            <span
              data-testid="blueprint-gate-pill"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                prelaunchReport.gateStatus === 'approved'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {prelaunchReport.gateStatus === 'approved'
                ? lang === 'fa'
                  ? `تست لانچ: تایید (${prelaunchReport.overallScore}%)`
                  : `Gate: APPROVED (${prelaunchReport.overallScore}%)`
                : lang === 'fa'
                  ? `تست لانچ: مسدود (${prelaunchReport.failedCount} خطا)`
                  : `Gate: BLOCKED (${prelaunchReport.failedCount} failed)`}
            </span>
          )}
          {onDownloadZip && (
            <button
              type="button"
              data-testid="blueprint-download-zip-btn"
              disabled={downloadingZip}
              onClick={() => onDownloadZip(selectedScope, selectedWorkflow, selectedRunId)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Archive className="h-4 w-4 text-blue-600" />
              {isFa ? 'دانلود ZIP پروژه انتخابی' : 'Download Selected ZIP'}
            </button>
          )}
          {onOpenGitHubPush && (
            <button
              type="button"
              data-testid="blueprint-github-push-btn"
              onClick={() => onOpenGitHubPush(selectedScope, selectedWorkflow, selectedRunId)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <UploadCloud className="h-4 w-4" />
              {isFa ? 'Push در گیت‌هاب' : 'Push to GitHub'}
            </button>
          )}
          {onRunDeployAudit && (
            <button
              type="button"
              data-testid="blueprint-deploy-audit-btn"
              onClick={onRunDeployAudit}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
            >
              <ShieldCheck className="h-4 w-4" />
              {isFa
                ? 'تست خودکار و بررسی مدیر پیش از دپلوی'
                : 'Auto Test & Manager Audit before Deploy'}
            </button>
          )}
        </div>
      </div>

      {/* Selective Completed Project Export (ZIP & GitHub with Agent Changes Applied) */}
      <div
        data-testid="selective-project-export-panel"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              <FolderGit2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>
                {isFa
                  ? 'خروجی انتخابی پروژه‌های تکمیل‌شده (اعمال خودکار تغییرات تیم ایجنت‌ها روی پروژه)'
                  : 'Selective Completed Project Export (Apply Agent Team Changes to GitHub / ZIP)'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {isFa
                ? 'پروژه تکمیل‌شده و نسخه خروجی ایجنت‌ها را انتخاب کنید تا تمام فایل‌های ویرایش‌شده و جدید مستقیماً داخل پوشه و مسیر خود کدها اعمال و لیست تغییرات فقط در README.md ثبت شود.'
                : 'Select a completed project and agent run snapshot to apply all modified and created files directly inside the project code folders, with the changelog written only in README.md.'}
            </p>
          </div>

          <button
            type="button"
            data-testid="deploy-export-refresh-btn"
            onClick={fetchExportProjects}
            disabled={exportProjectsLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${exportProjectsLoading ? 'animate-spin' : ''}`} />
            <span>{isFa ? 'به‌روزرسانی لیست' : 'Refresh Projects'}</span>
          </button>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-3 md:grid-cols-12">
          {/* 1. Select Project */}
          <label className="flex flex-col gap-1 md:col-span-4">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? '۱. انتخاب پروژه تکمیل‌شده' : '1. Select Project / Workflow'}
            </span>
            <select
              data-testid="deploy-export-project-select"
              value={selectedWorkflow.id}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {availableWorkflows.map((wf) => {
                const meta = exportProjects.find((p) => p.workflowId === wf.id);
                const completedCount = meta?.completedRunCount ?? 0;
                const agentFiles = meta?.mergedAgentFileCount ?? 0;
                const statusSuffix =
                  completedCount > 0
                    ? isFa
                      ? ` — ${completedCount} اجرا تکمیل‌شده (${agentFiles} فایل ایجنت)`
                      : ` — ${completedCount} completed (${agentFiles} agent files)`
                    : isFa
                      ? ' — بدون اجرای تکمیل‌شده'
                      : ' — No completed runs yet';
                return (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                    {statusSuffix}
                  </option>
                );
              })}
            </select>
          </label>

          {/* 2. Select Completed Run / Merged Snapshot */}
          <label className="flex flex-col gap-1 md:col-span-4">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? '۲. انتخاب نسخه تغییرات تیم ایجنت‌ها' : '2. Agent Output Snapshot'}
            </span>
            <select
              data-testid="deploy-export-run-select"
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="__merged_completed__">
                {isFa
                  ? `ادغام تمام تغییرات تکمیل‌شده (${selectedProjectMeta?.mergedAgentFileCount ?? 0} فایل)`
                  : `All Completed Agent Changes Merged (${selectedProjectMeta?.mergedAgentFileCount ?? 0} files)`}
              </option>
              {(selectedProjectMeta?.runs ?? []).map((run) => {
                const statusLabel =
                  run.status === 'completed'
                    ? isFa
                      ? 'تکمیل‌شده'
                      : 'Completed'
                    : run.status;
                const dateLabel = new Date(run.completedAt || run.createdAt).toLocaleString();
                return (
                  <option key={run.id} value={run.id}>
                    [{statusLabel}] {run.roundsExecuted} rounds · {run.sandboxFileCount} files · {dateLabel}
                  </option>
                );
              })}
            </select>
          </label>

          {/* 3. Select Export Scope */}
          <label className="flex flex-col gap-1 md:col-span-4">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? '۳. نحوه ترکیب فایل‌ها در خروجی' : '3. Export Bundle Mode'}
            </span>
            <select
              data-testid="deploy-export-scope-select"
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value as ExportBundleScope)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="project_bundle">
                {isFa
                  ? 'پروژه اصلی + اعمال تغییرات ایجنت‌ها (پیشنهادی)'
                  : 'Project + Agent Changes Applied (Recommended)'}
              </option>
              <option value="sandbox_only">
                {isFa
                  ? 'فقط فایل‌های تغییریافته / تولیدی تیم ایجنت‌ها'
                  : 'Agent-Modified & New Files Only'}
              </option>
              <option value="full_studio">
                {isFa
                  ? 'کل سورس استودیو + نصاب لینوکس + خروجی پروژه'
                  : 'Full Studio Source + Linux Installer'}
              </option>
            </select>
          </label>
        </div>

        {/* Live Preview Summary & Action Bar */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
              <Layers className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              {exportPreviewLoading
                ? isFa
                  ? 'در حال محاسبه فایل‌ها...'
                  : 'Calculating bundle...'
                : exportPreview
                  ? `${exportPreview.filename} (${exportPreview.fileCount} ${isFa ? 'فایل' : 'files'} · ${formatByteSize(exportPreview.totalBytes)})`
                  : selectedWorkflow.name}
            </span>

            {exportPreview?.changeSummary && (
              <div
                data-testid="deploy-export-change-summary"
                className="flex flex-wrap items-center gap-2 font-mono text-[11px]"
              >
                <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  {isFa
                    ? `${exportPreview.changeSummary.modifiedCount} ویرایش ایجنت`
                    : `${exportPreview.changeSummary.modifiedCount} modified`}
                </span>
                <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {isFa
                    ? `${exportPreview.changeSummary.addedCount} فایل جدید ایجنت`
                    : `${exportPreview.changeSummary.addedCount} added`}
                </span>
                {exportPreview.changeSummary.projectCount > 0 && (
                  <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {isFa
                      ? `${exportPreview.changeSummary.projectCount} فایل اصلی پروژه`
                      : `${exportPreview.changeSummary.projectCount} base files`}
                  </span>
                )}
              </div>
            )}

            {exportPreview && exportPreview.files.length > 0 && (
              <button
                type="button"
                data-testid="deploy-export-toggle-files-btn"
                onClick={() => setShowExportFiles((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                <span>
                  {showExportFiles
                    ? isFa
                      ? 'بستن لیست فایل‌ها'
                      : 'Hide file diff'
                    : isFa
                      ? 'مشاهده فایل‌های خروجی'
                      : 'Inspect output files'}
                </span>
                {showExportFiles ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onDownloadZip && (
              <button
                type="button"
                data-testid="deploy-export-zip-btn"
                disabled={downloadingZip}
                onClick={() => onDownloadZip(selectedScope, selectedWorkflow, selectedRunId)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>
                  {isFa ? 'ذخیره پروژه انتخابی (ZIP)' : 'Download Selected Project (.ZIP)'}
                </span>
              </button>
            )}

            {onOpenGitHubPush && (
              <button
                type="button"
                data-testid="deploy-export-github-btn"
                onClick={() => onOpenGitHubPush(selectedScope, selectedWorkflow, selectedRunId)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>
                  {isFa ? 'Push پروژه انتخابی در گیت‌هاب' : 'Push Selected Project to GitHub'}
                </span>
              </button>
            )}
          </div>
        </div>

        {showExportFiles && exportPreview && (
          <div
            data-testid="deploy-export-files-list"
            className="mt-2.5 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 rounded-md bg-slate-200/70 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  data-testid="deploy-export-tab-files"
                  onClick={() => setExportInspectorTab('files')}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    exportInspectorTab === 'files'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {isFa
                    ? `فایل‌های خروجی (${exportPreview.files.length})`
                    : `Output Files (${exportPreview.files.length})`}
                </button>
                <button
                  type="button"
                  data-testid="deploy-export-tab-diff"
                  onClick={() => setExportInspectorTab('diff')}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    exportInspectorTab === 'diff'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {isFa
                    ? `تغییرات خط‌به‌خط (${exportDiffs.length})`
                    : `Line Diff (${exportDiffs.length})`}
                </button>
              </div>
              {exportDiffLoading && (
                <span className="text-[11px] text-slate-500">
                  {isFa ? 'در حال بارگذاری Diff...' : 'Loading diff...'}
                </span>
              )}
            </div>

            {exportInspectorTab === 'diff' ? (
              <CodeDiffViewer diffs={exportDiffs} lang={lang} />
            ) : (
              <div
                dir="ltr"
                className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-200"
              >
                {exportPreview.files.map((f) => (
                  <div key={f.path} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="min-w-0 truncate">{f.path}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {f.changeType === 'modified' && (
                        <span className="rounded bg-amber-900/60 px-1.5 py-0.2 text-[9px] font-semibold text-amber-300">
                          MODIFIED
                        </span>
                      )}
                      {f.changeType === 'added' && (
                        <span className="rounded bg-emerald-900/60 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300">
                          NEW
                        </span>
                      )}
                      {f.changeType === 'project' && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] text-slate-300">
                          PROJECT
                        </span>
                      )}
                      {f.changeType === 'metadata' && (
                        <span className="rounded bg-blue-950 px-1.5 py-0.2 text-[9px] text-blue-300">
                          META
                        </span>
                      )}
                      <span className="tabular-nums text-slate-400">{formatByteSize(f.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Strict Pre-Launch Final Test Gate (4 Categories, 14 Test Types) */}
      <PreLaunchTestSuite
        lang={lang}
        workflow={selectedWorkflow}
        activeRunId={selectedRunId === '__merged_completed__' ? activeRunId : selectedRunId}
        report={prelaunchReport}
        onReportChange={onPrelaunchReportChange}
        strictMode={strictPrelaunchMode}
        onStrictModeChange={onStrictPrelaunchModeChange}
        onAskAgentsToFix={onFixPrelaunchIssues}
      />

      {/* External Webhook Trigger API (n8n-style event-driven workflow dispatch) */}
      <div
        data-testid="webhook-trigger-panel"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>
                {isFa
                  ? 'راه‌انداز Webhook خارجی (Webhook Trigger API)'
                  : 'External Webhook Trigger API (Event-Driven Dispatch)'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {isFa
                ? 'با ارسال درخواست POST به این آدرس از گیت‌هاب، CI/CD یا ابزارهای دیگر، تیم ایجنت‌ها به‌صورت خودکار فعال می‌شود.'
                : 'Trigger this multi-agent pipeline automatically from CI/CD, GitHub Actions, or external apps via HTTP POST.'}
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              data-testid="webhook-enable-checkbox"
              checked={webhookEnabledInput}
              onChange={(e) => {
                const next = e.target.checked;
                setWebhookEnabledInput(next);
                void handleSaveWebhookSettings(next, webhookSecretInput);
              }}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>{isFa ? 'فعال‌سازی Webhook' : 'Enable Webhook'}</span>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="flex flex-col gap-1 md:col-span-6">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? 'آدرس Webhook Endpoint' : 'Webhook POST Endpoint'}
            </span>
            <div
              dir="ltr"
              data-testid="webhook-endpoint-url"
              className="truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {webhookEndpointUrl}
            </div>
          </div>

          <div className="flex flex-col gap-1 md:col-span-4">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Key className="h-3.5 w-3.5 text-slate-500" />
              {isFa ? 'کلید امنیتی (اختیاری)' : 'Webhook Secret (Optional)'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="webhook-secret-input"
              value={webhookSecretInput}
              onChange={(e) => setWebhookSecretInput(e.target.value)}
              onBlur={() => void handleSaveWebhookSettings(webhookEnabledInput, webhookSecretInput)}
              placeholder={isFa ? 'خالی = بدون احراز هویت' : 'Leave blank or enter secret token'}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex items-end gap-2 md:col-span-2">
            <button
              type="button"
              data-testid="test-webhook-btn"
              disabled={webhookTestBusy || !webhookEnabledInput}
              onClick={() => void handleTestWebhook()}
              className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{webhookTestBusy ? (isFa ? 'در حال ارسال...' : 'Testing...') : isFa ? 'تست Webhook' : 'Test Webhook'}</span>
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <pre
            dir="ltr"
            className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-200"
          >
            <code>{webhookCurlSnippet}</code>
          </pre>
          <button
            type="button"
            onClick={() => void handleCopyWebhookCurl()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {copiedWebhookCurl ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{copiedWebhookCurl ? (isFa ? 'کپی شد' : 'Copied') : isFa ? 'کپی curl' : 'Copy curl'}</span>
          </button>
        </div>

        {webhookTestResult && (
          <p
            data-testid="webhook-test-result"
            className={`mt-2.5 text-xs font-medium ${
              webhookTestResult.ok
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {webhookTestResult.message}
          </p>
        )}
      </div>

      {/* Custom Domain & Nginx SSL Reverse Proxy Manager */}
      <NginxDomainPanel
        lang={lang}
        onDomainSelected={(selectedDomain) => {
          if (!domainInput.trim()) {
            setDomainInput(selectedDomain);
          }
        }}
      />

      {/* GitHub One-Line Linux Command Builder */}
      <div
        data-testid="github-oneline-builder"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <label className="flex flex-col gap-1 md:col-span-5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Link2 className="h-3.5 w-3.5 text-blue-600" />
              {lang === 'fa' ? 'لینک پروژه در GitHub (یا owner/repo)' : 'GitHub Repository URL (or owner/repo)'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="github-deploy-repo-input"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="https://github.com/username/aetherflow-studio"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <GitBranch className="h-3.5 w-3.5 text-slate-500" />
              {lang === 'fa' ? 'برنچ (Branch)' : 'Branch'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="github-deploy-branch-input"
              value={branchInput}
              onChange={(e) => setBranchInput(e.target.value)}
              placeholder="main"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? 'روش نصب لینوکس' : 'Install Mode'}
            </span>
            <select
              data-testid="github-deploy-mode-select"
              value={installMode}
              onChange={(e) => setInstallMode(e.target.value as LinuxInstallMode)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="auto">{lang === 'fa' ? 'خودکار (Auto)' : 'Auto (Docker or Native)'}</option>
              <option value="docker">{lang === 'fa' ? 'Docker Compose' : 'Docker Compose (--docker)'}</option>
              <option value="systemd">{lang === 'fa' ? 'سرویس systemd' : 'Systemd Service (--systemd)'}</option>
              <option value="native">{lang === 'fa' ? 'اجرای مستقیم Node 22+' : 'Native Node 22+ (--native)'}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? 'مسیر نصب (اختیاری)' : 'Install Dir (Optional)'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="github-deploy-dir-input"
              value={installDir}
              onChange={(e) => setInstallDir(e.target.value)}
              placeholder="/opt/aetherflow-studio"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? 'پورت' : 'Port'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="github-deploy-port-input"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="3000"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-1 items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <span className="shrink-0 font-semibold">
              {lang === 'fa' ? 'دامنه Nginx + SSL (اختیاری):' : 'Nginx + SSL Domain (Optional):'}
            </span>
            <input
              type="text"
              dir="ltr"
              data-testid="github-deploy-domain-input"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="studio.example.com"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 sm:max-w-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {lang === 'fa'
              ? 'Nginx و گواهی رایگان Let’s Encrypt را نصب می‌کند (تغییری در محدودیت جغرافیایی Google API نمی‌دهد).'
              : 'Installs Nginx + Let’s Encrypt HTTPS for your domain (does not bypass Google outbound geo-blocks).'}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Terminal className="h-3.5 w-3.5 text-emerald-600" />
              {lang === 'fa'
                ? 'دستور نصب تک‌خطی روی سرور لینوکس (با یک لینک):'
                : 'One-Line Linux Server Command:'}
            </span>
            {!generated.valid && repoInput.trim() && (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {generated.target.error}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <pre
              dir="ltr"
              data-testid="github-oneline-cmd"
              className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-emerald-300"
            >
              <code>{generated.oneLineCurlCommand}</code>
            </pre>
            <button
              type="button"
              data-testid="copy-oneline-cmd-btn"
              onClick={handleCopyOneLiner}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              {copiedOneLiner ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedOneLiner
                ? lang === 'fa'
                  ? 'کپی شد'
                  : 'Copied'
                : lang === 'fa'
                  ? 'کپی دستور نصب'
                  : 'Copy One-Liner'}
            </button>
          </div>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300" dir="ltr">
              <span className="mr-2 font-sans font-semibold text-slate-500">git clone:</span>
              <code data-testid="github-gitclone-cmd">{generated.gitCloneCommand}</code>
            </div>
            <button
              type="button"
              onClick={handleCopyGitClone}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {copiedGitClone ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              {copiedGitClone ? (lang === 'fa' ? 'کپی شد' : 'Copied') : lang === 'fa' ? 'کپی دستی' : 'Copy git clone'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[480px] flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
        <aside className="flex flex-col gap-4 overflow-y-auto lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <FolderTree className="h-4 w-4 text-blue-600" />
              <span>Phase 1 · Linux Project Structure</span>
            </div>
            <pre
              dir="ltr"
              className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200"
            >
              {DIRECTORY_TREE}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="px-2 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? 'فایل‌های نصب لینوکس و معماری سیستم' : 'Linux Installer & Source Files'}
            </h2>
            {loading ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                {files.map((file) => {
                  const active = currentFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <FileCode2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs font-medium">{file.path}</div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {file.phase}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
          {currentFile ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {currentFile.path}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {currentFile.phase} · {currentFile.summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy Code'}
                </button>
              </div>
              <pre
                dir="ltr"
                className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100"
              >
                <code>{currentFile.content}</code>
              </pre>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
              Loading blueprint source files...
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
