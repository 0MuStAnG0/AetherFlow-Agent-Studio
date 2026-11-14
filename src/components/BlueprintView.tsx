import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  FileCode2,
  FolderTree,
  GitBranch,
  Link2,
  ShieldCheck,
  Terminal,
  UploadCloud,
} from 'lucide-react';
import type { BlueprintFile } from '../types/workflow';
import {
  DEFAULT_GITHUB_REPO_URL,
  buildLinuxOneLineCommand,
  type LinuxInstallMode,
} from '../utils/githubDeploy';

interface BlueprintViewProps {
  lang?: 'en' | 'fa';
  defaultRepoUrl?: string;
  defaultBranch?: string;
  onRunDeployAudit?: () => void;
  onDownloadZip?: () => void;
  onOpenGitHubPush?: () => void;
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
  defaultRepoUrl,
  defaultBranch,
  onRunDeployAudit,
  onDownloadZip,
  onOpenGitHubPush,
}: BlueprintViewProps) {
  const [files, setFiles] = useState<BlueprintFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('install-linux.sh');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);
  const [copiedGitClone, setCopiedGitClone] = useState(false);

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
      }),
    [repoInput, branchInput, installMode, installDir, portInput]
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

  return (
    <section className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-4 overflow-y-auto p-6">
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
          {onDownloadZip && (
            <button
              type="button"
              data-testid="blueprint-download-zip-btn"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Archive className="h-4 w-4 text-blue-600" />
              {lang === 'fa' ? 'دانلود فایل ZIP کامل' : 'Download Full ZIP'}
            </button>
          )}
          {onOpenGitHubPush && (
            <button
              type="button"
              data-testid="blueprint-github-push-btn"
              onClick={onOpenGitHubPush}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <UploadCloud className="h-4 w-4" />
              {lang === 'fa' ? 'Push در گیت‌هاب' : 'Push to GitHub'}
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
              {lang === 'fa'
                ? 'تست خودکار و بررسی مدیر پیش از دپلوی'
                : 'Auto Test & Manager Audit before Deploy'}
            </button>
          )}
        </div>
      </div>

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
