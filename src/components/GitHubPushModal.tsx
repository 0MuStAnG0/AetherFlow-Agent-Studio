import { useEffect, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ExternalLink,
  FileArchive,
  FolderGit2,
  GitBranch,
  KeyRound,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import type { CapabilitiesState, WorkflowConfig } from '../types/workflow';
import {
  validateGitHubPushParams,
  type BundleFileChangeType,
  type ExportBundleScope,
  type ExportChangeSummary,
} from '../utils/exportBundle';
import { DEFAULT_GITHUB_REPO_URL } from '../utils/githubDeploy';

interface GitHubPushModalProps {
  isOpen: boolean;
  initialScope?: ExportBundleScope;
  lang: 'en' | 'fa';
  workflow: WorkflowConfig;
  activeRunId: string | null;
  capabilities: CapabilitiesState;
  onCapabilitiesUpdated: (cap: CapabilitiesState) => void;
  onClose: () => void;
  onDownloadZip: (
    scope: ExportBundleScope,
  ) => Promise<{ ok: boolean; error?: string; filename?: string; fileCount?: number }>;
}

interface PreviewSummary {
  filename: string;
  scope: ExportBundleScope;
  fileCount: number;
  totalBytes: number;
  changeSummary?: ExportChangeSummary;
  files: Array<{ path: string; size: number; changeType?: BundleFileChangeType }>;
}

interface PushResult {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  repoUrl: string;
  filesPushed: number;
}

const STORAGE_PUSH_REPO_KEY = 'aetherflow_github_push_repo';
const STORAGE_PUSH_BRANCH_KEY = 'aetherflow_github_push_branch';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function GitHubPushModal({
  isOpen,
  initialScope = 'project_bundle',
  lang,
  workflow,
  activeRunId,
  capabilities,
  onCapabilitiesUpdated,
  onClose,
  onDownloadZip,
}: GitHubPushModalProps) {
  const isFa = lang === 'fa';
  const [scope, setScope] = useState<ExportBundleScope>(initialScope);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [zipDownloading, setZipDownloading] = useState(false);

  const [repoUrl, setRepoUrl] = useState<string>(() => {
    if (workflow.projectContext?.sourceType === 'github' && workflow.projectContext.sourceUrl) {
      return workflow.projectContext.sourceUrl;
    }
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(STORAGE_PUSH_REPO_KEY) || DEFAULT_GITHUB_REPO_URL;
    }
    return DEFAULT_GITHUB_REPO_URL;
  });
  const [branch, setBranch] = useState<string>(() => {
    if (workflow.projectContext?.branch) return workflow.projectContext.branch;
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(STORAGE_PUSH_BRANCH_KEY) || 'main';
    }
    return 'main';
  });
  const [commitMessage, setCommitMessage] = useState<string>(
    `feat: export ${workflow.name} workflow & project bundle`,
  );
  const [token, setToken] = useState<string>('');
  const [saveTokenToVault, setSaveTokenToVault] = useState<boolean>(true);
  const [createIfMissing, setCreateIfMissing] = useState<boolean>(true);
  const [isPrivate, setIsPrivate] = useState<boolean>(false);

  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  const githubTokenStatus = capabilities.secrets?.GITHUB_TOKEN;
  const hasSavedToken = Boolean(githubTokenStatus?.configured);

  useEffect(() => {
    if (!isOpen) return;
    setScope(initialScope);
    setError(null);
    setPushResult(null);
    setCommitMessage(`feat: apply agent changes & export ${workflow.name}`);
    if (workflow.projectContext?.sourceType === 'github' && workflow.projectContext.sourceUrl) {
      setRepoUrl(workflow.projectContext.sourceUrl);
    }
    if (workflow.projectContext?.branch) {
      setBranch(workflow.projectContext.branch);
    }
  }, [isOpen, initialScope, workflow.id, workflow.name, workflow.projectContext]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setPreviewLoading(true);
    fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope,
        workflow,
        runId: activeRunId ?? undefined,
      }),
    })
      .then((res) => res.json())
      .then((data: PreviewSummary & { error?: string }) => {
        if (!active) return;
        if (data && Array.isArray(data.files)) {
          setPreview(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, scope, workflow, activeRunId]);

  if (!isOpen) return null;

  const handleTriggerZip = async () => {
    setError(null);
    setZipDownloading(true);
    try {
      const result = await onDownloadZip(scope);
      if (result && !result.ok) {
        setError(result.error || 'Failed to download ZIP archive.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download ZIP archive.');
    } finally {
      setZipDownloading(false);
    }
  };

  const handlePushToGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPushResult(null);

    const validation = validateGitHubPushParams({
      repoInput: repoUrl,
      branch,
      commitMessage,
    });
    if (!validation.valid) {
      setError(
        validation.error ||
          (isFa
            ? 'آدرس مخزن گیت‌هاب یا نام برنچ معتبر نیست.'
            : 'Invalid GitHub repository URL or branch name.'),
      );
      return;
    }

    if (!hasSavedToken && !token.trim()) {
      setError(
        isFa
          ? 'برای ارسال به گیت‌هاب، وارد کردن توکن دسترسی شخصی (GITHUB_TOKEN) الزامی است.'
          : 'GitHub Personal Access Token (GITHUB_TOKEN) is required to push commits.',
      );
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_PUSH_REPO_KEY, repoUrl.trim());
      window.localStorage.setItem(STORAGE_PUSH_BRANCH_KEY, branch.trim() || 'main');
    }

    setPushing(true);
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          branch: branch.trim() || 'main',
          commitMessage: commitMessage.trim(),
          scope,
          workflow,
          runId: activeRunId ?? undefined,
          token: token.trim() || undefined,
          saveTokenToVault,
          createIfMissing,
          isPrivate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as PushResult & {
        error?: string;
        capabilities?: CapabilitiesState;
      };
      if (!res.ok) {
        setError(
          data.error ||
            (isFa
              ? 'خطا در ارسال فایل‌ها به گیت‌هاب. لطفاً لینک مخزن و توکن دسترسی را بررسی کنید.'
              : 'Failed to push bundle to GitHub. Check repository URL and Personal Access Token.'),
        );
        return;
      }
      if (data.capabilities) {
        onCapabilitiesUpdated(data.capabilities);
      }
      setToken('');
      setPushResult(data);
    } catch {
      setError(
        isFa
          ? 'خطای شبکه هنگام ارتباط با سرور برای Push در گیت‌هاب.'
          : 'Network error while pushing bundle to GitHub.',
      );
    } finally {
      setPushing(false);
    }
  };

  const scopeOptions: Array<{
    id: ExportBundleScope;
    titleEn: string;
    titleFa: string;
    descEn: string;
    descFa: string;
  }> = [
    {
      id: 'project_bundle',
      titleEn: 'Project + Sandbox + Workflow Bundle',
      titleFa: 'بسته کامل پروژه + خروجی سندباکس + ورکفلو',
      descEn:
        'Includes imported project files, agent-generated sandbox files, .aetherflow/*.workflow.json, and AETHERFLOW_WORKFLOW.md.',
      descFa:
        'شامل فایل‌های پروژه ایمپورت‌شده، کدهای تولیدی ایجنت‌ها در سندباکس، فایل JSON ورکفلو و مستندات تیم.',
    },
    {
      id: 'sandbox_only',
      titleEn: 'Sandbox Generated Files + Workflow',
      titleFa: 'فقط فایل‌های تولیدشده سندباکس + ورکفلو',
      descEn:
        'Lightweight archive with only the files generated during execution plus workflow JSON and summary.',
      descFa:
        'بسته سبک شامل کدها و تست‌های نوشته‌شده توسط ایجنت‌ها در سندباکس به همراه تنظیمات ورکفلو.',
    },
    {
      id: 'full_studio',
      titleEn: 'Full AetherFlow Studio + Linux Installer',
      titleFa: 'کل سورس نرم‌افزار AetherFlow + اسکریپت نصب لینوکس',
      descEn:
        'Complete self-hosted studio source (install-linux.sh, Dockerfile, server.ts, src/, deploy/) with your workflow bundled.',
      descFa:
        'کل سورس نرم‌افزار، اسکریپت نصب لینوکس، داکر و فایل‌های استقرار به همراه ورکفلوی فعلی شما.',
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isFa ? 'ذخیره فایل ZIP و Push در گیت‌هاب' : 'Save as ZIP & Push to GitHub'}
      dir={isFa ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
    >
      <div
        data-testid="github-push-modal"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <FolderGit2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {isFa ? 'ذخیره به صورت فایل ZIP و Push در گیت‌هاب' : 'Save as ZIP & Push to GitHub'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isFa
                  ? 'خروجی پروژه، فایل‌های سندباکس و گراف ایجنت‌ها را به صورت ZIP دانلود کنید یا مستقیم روی مخزن GitHub قرار دهید.'
                  : 'Download your project, sandbox files, and agent graph as a ZIP archive or push directly to GitHub.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* 1. Bundle Scope Selection & Instant ZIP Download */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
              {isFa ? '۱. انتخاب محتوای بسته خروجی (Bundle Scope)' : '1. Select Export Bundle Scope'}
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {scopeOptions.map((opt) => {
                const active = scope === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`export-scope-${opt.id}`}
                    onClick={() => setScope(opt.id)}
                    className={`flex flex-col items-start rounded-xl border p-3 text-start transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 text-slate-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-slate-100'
                        : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300'
                    }`}
                  >
                    <span className="text-xs font-semibold">
                      {isFa ? opt.titleFa : opt.titleEn}
                    </span>
                    <span className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {isFa ? opt.descFa : opt.descEn}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live Manifest Bar + Download ZIP Button */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <FileArchive className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                {previewLoading ? (
                  <span className="text-slate-500">
                    {isFa ? 'در حال محاسبه فایل‌ها...' : 'Calculating bundle files...'}
                  </span>
                ) : preview ? (
                  <>
                    <span
                      data-testid="export-preview-summary"
                      className="font-mono font-semibold text-slate-900 dark:text-slate-100"
                    >
                      {preview.filename}
                    </span>
                    <span className="rounded bg-slate-200/80 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {preview.fileCount} {isFa ? 'فایل' : 'files'} · {formatBytes(preview.totalBytes)}
                    </span>
                    {preview.changeSummary &&
                      (preview.changeSummary.modifiedCount > 0 ||
                        preview.changeSummary.addedCount > 0) && (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {isFa
                            ? `${preview.changeSummary.modifiedCount} ویرایش + ${preview.changeSummary.addedCount} فایل جدید ایجنت`
                            : `${preview.changeSummary.modifiedCount} modified + ${preview.changeSummary.addedCount} new by agents`}
                        </span>
                      )}
                    <button
                      type="button"
                      onClick={() => setShowFileList((prev) => !prev)}
                      className="text-[11px] font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                    >
                      {showFileList
                        ? isFa
                          ? 'بستن لیست فایل‌ها'
                          : 'Hide files'
                        : isFa
                          ? 'مشاهده لیست فایل‌ها'
                          : 'View files'}
                    </button>
                  </>
                ) : null}
              </div>

              <button
                type="button"
                data-testid="modal-download-zip-btn"
                disabled={zipDownloading}
                onClick={() => void handleTriggerZip()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
              >
                {zipDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                <span>
                  {isFa ? 'دانلود مستقیم فایل ZIP' : 'Download as .ZIP Archive'}
                </span>
              </button>
            </div>

            {showFileList && preview && (
              <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200 dark:border-slate-800" dir="ltr">
                {preview.files.map((f) => (
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
                      <span className="text-slate-400">{formatBytes(f.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. GitHub Direct Push Form */}
          <form onSubmit={(e) => void handlePushToGitHub(e)} className="space-y-3.5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isFa
                  ? '۲. ارسال مستقیم به مخزن گیت‌هاب (Push to GitHub)'
                  : '2. Push Directly to GitHub Repository'}
              </h3>
              <span className="text-[11px] text-slate-500">
                {isFa ? 'ایجاد Commit اتمیک از طریق GitHub API' : 'Atomic Git Tree Commit via GitHub API'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <label className="flex flex-col gap-1 sm:col-span-8">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isFa ? 'آدرس مخزن گیت‌هاب یا owner/repo' : 'GitHub Repository URL or owner/repo'}
                </span>
                <input
                  type="text"
                  dir="ltr"
                  required
                  data-testid="github-push-repo-input"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/0MuStAnG0/AetherFlow-Agent-Studio"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>

              <label className="flex flex-col gap-1 sm:col-span-4">
                <span className="flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <GitBranch className="h-3.5 w-3.5 text-slate-500" />
                  {isFa ? 'برنچ مقصد (Branch)' : 'Target Branch'}
                </span>
                <input
                  type="text"
                  dir="ltr"
                  required
                  data-testid="github-push-branch-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {isFa ? 'پیام کامیت (Commit Message)' : 'Commit Message'}
              </span>
              <input
                type="text"
                dir="auto"
                required
                data-testid="github-push-message-input"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

            {/* GitHub Personal Access Token */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <KeyRound className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  {isFa
                    ? 'توکن دسترسی گیت‌هاب (GitHub Personal Access Token)'
                    : 'GitHub Personal Access Token (PAT)'}
                </span>
                {hasSavedToken && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    {isFa
                      ? `توکن ذخیره شده فعال است (${githubTokenStatus?.maskedHint || 'GITHUB_TOKEN'})`
                      : `Saved token active (${githubTokenStatus?.maskedHint || 'GITHUB_TOKEN'})`}
                  </span>
                )}
              </div>

              <input
                type="password"
                dir="ltr"
                data-testid="github-push-token-input"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  hasSavedToken
                    ? isFa
                      ? 'خالی بگذارید تا از GITHUB_TOKEN ذخیره‌شده استفاده شود یا توکن جدید وارد کنید'
                      : 'Leave blank to use saved GITHUB_TOKEN, or enter a new ghp_... token'
                    : 'ghp_... (GitHub Personal Access Token)'
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />

              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={saveTokenToVault}
                    onChange={(e) => setSaveTokenToVault(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  <span>
                    {isFa
                      ? 'ذخیره امن توکن در سرور (GITHUB_TOKEN)'
                      : 'Save token in server vault (GITHUB_TOKEN)'}
                  </span>
                </label>

                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={createIfMissing}
                    onChange={(e) => setCreateIfMissing(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  <span>
                    {isFa
                      ? 'ساخت خودکار مخزن در صورت وجود نداشتن'
                      : 'Create repo if missing'}
                  </span>
                </label>

                {createIfMissing && (
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
                    />
                    <span>{isFa ? 'مخزن خصوصی (Private)' : 'Private repository'}</span>
                  </label>
                )}
              </div>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="github-push-error"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
              >
                {error}
              </div>
            )}

            {pushResult && (
              <div
                data-testid="github-push-success"
                className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-3.5 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    {isFa
                      ? `${pushResult.filesPushed} فایل با موفقیت روی ${pushResult.owner}/${pushResult.repo} (${pushResult.branch}) قرار گرفت!`
                      : `Successfully pushed ${pushResult.filesPushed} files to ${pushResult.owner}/${pushResult.repo} (${pushResult.branch})!`}
                  </span>
                  <a
                    href={pushResult.commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-800 underline dark:text-emerald-300"
                  >
                    <span>{pushResult.commitSha.slice(0, 7)}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
              <button
                type="submit"
                data-testid="github-push-submit-btn"
                disabled={pushing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
              >
                {pushing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                <span>
                  {pushing
                    ? isFa
                      ? 'در حال Push به گیت‌هاب...'
                      : 'Pushing to GitHub...'
                    : isFa
                      ? 'Push در گیت‌هاب'
                      : 'Push to GitHub'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
