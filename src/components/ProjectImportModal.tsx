import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  CopyPlus,
  FileArchive,
  FolderGit2,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  PlusCircle,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { AGENT_SECTIONS, POWER_LEVEL_META } from '../data/agentTemplates';
import type {
  AgentPowerLevel,
  AgentRole,
  AppSettings,
  ImportedProjectAnalysis,
  LLMProvider,
  RecommendedAgentSpec,
} from '../types/workflow';
import { getEffectiveProviderModels } from '../utils/catalogUtils';

interface ProjectImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'en' | 'fa';
  executionMode: 'live' | 'dry_run';
  appSettings?: AppSettings;
  projects: ImportedProjectAnalysis[];
  activeProjectId?: string;
  onProjectImported: (project: ImportedProjectAnalysis) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onApplyRecommendations: (
    project: ImportedProjectAnalysis,
    selectedSpecs: RecommendedAgentSpec[],
    mode: 'replace' | 'merge',
  ) => Promise<void>;
}

const COPY = {
  en: {
    modalTitle: 'Import Project & Manager Team Recommendation',
    modalSubtitle:
      'Connect a GitHub repository or upload a .zip archive so Manager Agent inspects the codebase and suggests the exact specialists needed.',
    tabGithub: 'GitHub Repository',
    tabZip: 'Upload .zip Archive',
    repoLabel: 'Repository URL or owner/repo',
    repoPlaceholder: 'https://github.com/fastapi/fastapi or owner/repo',
    branchLabel: 'Branch (optional)',
    branchPlaceholder: 'Auto-detect default branch',
    tokenLabel: 'GitHub Token (optional, private repos)',
    tokenPlaceholder: 'ghp_... (never stored)',
    connectAnalyze: 'Connect & Analyze with Manager',
    connecting: 'Fetching & Analyzing...',
    zipNameLabel: 'Project Name (optional)',
    zipNamePlaceholder: 'Derived from .zip filename if blank',
    zipDropLabel: 'Select a .zip project archive',
    zipDropHint: 'node_modules, .git, dist, and binary assets are automatically skipped.',
    chooseZip: 'Choose .zip File',
    uploadAnalyze: 'Upload & Analyze with Manager',
    uploading: 'Extracting & Analyzing...',
    recentProjects: 'Imported Projects',
    emptyAnalysisTitle: 'Ready for Manager Codebase Analysis',
    emptyAnalysisHint:
      'Import a GitHub repository or .zip project on the left. Manager Agent will inspect manifests, frameworks, tests, and containers to recommend the right team.',
    managerAssessment: 'Manager Agent Assessment',
    liveAiTag: 'Live AI Analysis',
    staticScanTag: 'Codebase Static Scan',
    filesLabel: 'Files',
    languagesLabel: 'Languages',
    frameworksLabel: 'Frameworks',
    keyFilesLabel: 'Key Files',
    recommendedTeam: 'Recommended Agents & Specialties',
    selectAll: 'Select All',
    priorityEssential: 'Essential',
    priorityRecommended: 'Recommended',
    priorityOptional: 'Optional',
    signalsLabel: 'Signals:',
    promptPreview: 'View tailored System Prompt',
    buildNewTeam: 'Create Workflow from Selected',
    addToCanvas: 'Add Selected to Current Canvas',
    applying: 'Applying...',
    deleteProj: 'Delete imported project',
    closeModal: 'Close project import dialog',
  },
  fa: {
    modalTitle: 'اتصال پروژه گیت‌هاب / ایمپورت ZIP و پیشنهاد تیم ایجنت‌ها',
    modalSubtitle:
      'مخزن گیت‌هاب را متصل کنید یا فایل فشرده .zip پروژه را بارگذاری کنید تا ایجنت مدیر ساختار کد را تحلیل کرده و ایجنت‌ها و تخصص‌های مورد نیاز را پیشنهاد دهد.',
    tabGithub: 'مخزن گیت‌هاب (GitHub)',
    tabZip: 'آپلود دستی فایل ZIP',
    repoLabel: 'آدرس مخزن گیت‌هاب یا owner/repo',
    repoPlaceholder: 'https://github.com/owner/repo یا owner/repo',
    branchLabel: 'شاخه / Branch (اختیاری)',
    branchPlaceholder: 'تشخیص خودکار شاخه پیش‌فرض',
    tokenLabel: 'توکن دسترسی گیت‌هاب (اختیاری برای مخازن خصوصی)',
    tokenPlaceholder: 'ghp_... (در دیتابیس ذخیره نمی‌شود)',
    connectAnalyze: 'اتصال و آنالیز با ایجنت مدیر',
    connecting: 'در حال دریافت و آنالیز...',
    zipNameLabel: 'نام پروژه (اختیاری)',
    zipNamePlaceholder: 'در صورت خالی بودن از نام فایل .zip استفاده می‌شود',
    zipDropLabel: 'انتخاب فایل فشرده پروژه (.zip)',
    zipDropHint: 'پوشه‌های node_modules، .git، dist و فایل‌های باینری به‌طور خودکار نادیده گرفته می‌شوند.',
    chooseZip: 'انتخاب فایل .zip',
    uploadAnalyze: 'بارگذاری و آنالیز با ایجنت مدیر',
    uploading: 'در حال استخراج و آنالیز...',
    recentProjects: 'پروژه‌های واردشده',
    emptyAnalysisTitle: 'آماده تحلیل پروژه توسط ایجنت مدیر',
    emptyAnalysisHint:
      'از بخش کناری یک مخزن گیت‌هاب متصل کنید یا فایل .zip پروژه را آپلود کنید تا ایجنت مدیر بر اساس فریم‌ورک‌ها، دیتابیس، تست و داکر، تیم تخصصی پیشنهادی را معرفی کند.',
    managerAssessment: 'گزارش تحلیل ایجنت مدیر',
    liveAiTag: 'تحلیل هوشمند AI',
    staticScanTag: 'اسکن ساختار کد',
    filesLabel: 'تعداد فایل',
    languagesLabel: 'زبان‌ها',
    frameworksLabel: 'فریم‌ورک‌ها و ابزارها',
    keyFilesLabel: 'فایل‌های کلیدی',
    recommendedTeam: 'ایجنت‌ها و تخصص‌های پیشنهادی',
    selectAll: 'انتخاب همه',
    priorityEssential: 'ضروری',
    priorityRecommended: 'پیشنهادی',
    priorityOptional: 'اختیاری',
    signalsLabel: 'نشانه‌های شناسایی‌شده:',
    promptPreview: 'مشاهده System Prompt پیشنهادی',
    buildNewTeam: 'ساخت ورکفلو جدید با تیم منتخب',
    addToCanvas: 'افزودن منتخب‌ها به بوم فعلی',
    applying: 'در حال اعمال...',
    deleteProj: 'حذف پروژه واردشده',
    closeModal: 'بستن پنجره ورود پروژه',
  },
};

const ROLE_BADGE_LABELS: Record<'en' | 'fa', Record<AgentRole, string>> = {
  en: {
    manager: 'Manager',
    backend: 'Backend',
    frontend: 'Frontend',
    security_qa: 'Security & QA',
    executor: 'Executor',
    custom: 'Specialist',
  },
  fa: {
    manager: 'مدیر',
    backend: 'بک‌اند',
    frontend: 'فرانت‌اند',
    security_qa: 'امنیت و تست',
    executor: 'اجراگر',
    custom: 'متخصص ویژه',
  },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file payload.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read ZIP file.'));
    reader.readAsDataURL(file);
  });
}

export function ProjectImportModal({
  isOpen,
  onClose,
  lang,
  executionMode,
  appSettings,
  projects,
  activeProjectId,
  onProjectImported,
  onDeleteProject,
  onApplyRecommendations,
}: ProjectImportModalProps) {
  const [sourceTab, setSourceTab] = useState<'github' | 'zip'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipProjectName, setZipProjectName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    activeProjectId ?? projects[0]?.id ?? null,
  );
  const [editableSpecs, setEditableSpecs] = useState<RecommendedAgentSpec[]>([]);
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [isEditingProjectMeta, setIsEditingProjectMeta] = useState(false);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectUrl, setEditProjectUrl] = useState('');
  const [editProjectBranch, setEditProjectBranch] = useState('');
  const [editProjectSummary, setEditProjectSummary] = useState('');
  const [isSavingProjectMeta, setIsSavingProjectMeta] = useState(false);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const t = COPY[lang];
  const roleLabels = ROLE_BADGE_LABELS[lang];

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (activeProjectId && projects.some((p) => p.id === activeProjectId)) {
      setSelectedProjectId(activeProjectId);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!activeProject) {
      setEditableSpecs([]);
      setIsEditingProjectMeta(false);
      return;
    }
    setEditableSpecs(activeProject.recommendations.map((r) => ({ ...r })));
    setEditingSpecId(null);
    setIsEditingProjectMeta(false);
    setEditProjectName(activeProject.name);
    setEditProjectUrl(activeProject.sourceUrl ?? '');
    setEditProjectBranch(activeProject.branch ?? '');
    setEditProjectSummary(activeProject.managerSummary);
    const next: Record<string, boolean> = {};
    for (const rec of activeProject.recommendations) {
      next[rec.id] = rec.priority !== 'optional';
    }
    setCheckedIds(next);
  }, [activeProject?.id]);

  if (!isOpen) return null;

  const handleSaveProjectMeta = async () => {
    if (!activeProject || !editProjectName.trim()) return;
    setIsSavingProjectMeta(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editProjectName.trim(),
          sourceUrl: editProjectUrl.trim() || undefined,
          branch: editProjectBranch.trim() || undefined,
          managerSummary: editProjectSummary.trim() || activeProject.managerSummary,
          recommendations: editableSpecs,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        project?: ImportedProjectAnalysis;
        error?: string;
      };
      if (!res.ok || !data.project) {
        setErrorMsg(data.error || 'Failed to update project.');
        return;
      }
      onProjectImported(data.project);
      setIsEditingProjectMeta(false);
    } catch {
      setErrorMsg('Network error while saving project changes.');
    } finally {
      setIsSavingProjectMeta(false);
    }
  };

  const handleGitHubImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!repoUrl.trim()) {
      setErrorMsg(
        lang === 'fa'
          ? 'لطفاً آدرس مخزن گیت‌هاب را وارد کنید.'
          : 'Please enter a GitHub repository URL or owner/repo.',
      );
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch('/api/projects/import/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          branch: branch.trim() || undefined,
          token: githubToken.trim() || undefined,
          language: lang,
          mode: executionMode,
        }),
      });
      const data = (await res.json()) as {
        project?: ImportedProjectAnalysis;
        error?: string;
      };
      if (!res.ok || !data.project) {
        setErrorMsg(data.error || 'Failed to import GitHub repository.');
        return;
      }
      onProjectImported(data.project);
      setSelectedProjectId(data.project.id);
      setGithubToken('');
    } catch {
      setErrorMsg('Network error while connecting to GitHub repository.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleZipImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!zipFile) {
      setErrorMsg(
        lang === 'fa'
          ? 'لطفاً ابتدا یک فایل .zip انتخاب کنید.'
          : 'Please select a .zip archive file first.',
      );
      return;
    }
    setIsImporting(true);
    try {
      const contentBase64 = await readFileAsBase64(zipFile);
      const res = await fetch('/api/projects/import/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: zipFile.name,
          contentBase64,
          projectName: zipProjectName.trim() || undefined,
          language: lang,
          mode: executionMode,
        }),
      });
      const data = (await res.json()) as {
        project?: ImportedProjectAnalysis;
        error?: string;
      };
      if (!res.ok || !data.project) {
        setErrorMsg(data.error || 'Failed to extract and analyze ZIP file.');
        return;
      }
      onProjectImported(data.project);
      setSelectedProjectId(data.project.id);
      setZipFile(null);
      setZipProjectName('');
    } catch {
      setErrorMsg('Failed to read or upload the ZIP file.');
    } finally {
      setIsImporting(false);
    }
  };

  const selectedRecommendations = activeProject
    ? editableSpecs.filter((r) => checkedIds[r.id])
    : [];

  const handleDuplicateSpec = (spec: RecommendedAgentSpec) => {
    const newId = `${spec.id}-copy-${Date.now().toString(36).slice(-4)}`;
    const baseTitle = spec.title.replace(/\s+#?\d+$/, '').trim();
    const copyNum =
      editableSpecs.filter((s) => s.title.toLowerCase().startsWith(baseTitle.toLowerCase())).length +
      1;
    const cloned: RecommendedAgentSpec = {
      ...spec,
      id: newId,
      title: `${baseTitle} ${copyNum}`,
    };
    setEditableSpecs((prev) => {
      const idx = prev.findIndex((s) => s.id === spec.id);
      if (idx === -1) return [...prev, cloned];
      const next = [...prev];
      next.splice(idx + 1, 0, cloned);
      return next;
    });
    setCheckedIds((prev) => ({ ...prev, [newId]: true }));
  };

  const handleDeleteSpec = (specId: string) => {
    setEditableSpecs((prev) => prev.filter((s) => s.id !== specId));
    setCheckedIds((prev) => {
      const next = { ...prev };
      delete next[specId];
      return next;
    });
    if (editingSpecId === specId) setEditingSpecId(null);
  };

  const handleAddCustomSpec = () => {
    const newId = `rec-custom-${Date.now().toString(36).slice(-4)}`;
    const defModels = getEffectiveProviderModels('gemini', appSettings?.providers.gemini);
    const created: RecommendedAgentSpec = {
      id: newId,
      title: lang === 'fa' ? 'متخصص جدید پروژه' : 'Custom Project Specialist',
      role: 'custom',
      section: 'Backend & API',
      positionTitle: lang === 'fa' ? 'متخصص بخش دلخواه' : 'Domain Specialist',
      powerLevel: 'pro',
      specialty:
        lang === 'fa'
          ? 'مسئولیت اختصاصی قابل تنظیم برای پروژه'
          : 'Configurable domain ownership for this project',
      reason:
        lang === 'fa'
          ? 'افزوده‌شده به‌صورت دستی متناسب با نیاز پروژه.'
          : 'Manually added to expand project capacity.',
      recommendedProvider: 'gemini',
      recommendedModel:
        appSettings?.providers.gemini?.defaultModel || defModels[0]?.id || 'gemini-4-hydrogen',
      systemPrompt: `You are a Custom Specialist working on "${activeProject?.name || 'Project'}".`,
      tools: { readFile: true, writeFile: true, execBash: false },
      priority: 'recommended',
      matchedSignals: [],
    };
    setEditableSpecs((prev) => [...prev, created]);
    setCheckedIds((prev) => ({ ...prev, [newId]: true }));
    setEditingSpecId(newId);
  };

  const handleUpdateSpec = (specId: string, patch: Partial<RecommendedAgentSpec>) => {
    setEditableSpecs((prev) => prev.map((s) => (s.id === specId ? { ...s, ...patch } : s)));
  };

  const handleApply = async (mode: 'replace' | 'merge') => {
    if (!activeProject || selectedRecommendations.length === 0) return;
    setIsApplying(true);
    try {
      await onApplyRecommendations(activeProject, selectedRecommendations, mode);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
        data-testid="project-import-modal"
        dir={lang === 'fa' ? 'rtl' : 'ltr'}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2
              id="project-import-title"
              className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
            >
              {t.modalTitle}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {t.modalSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeModal}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Left Panel: Import Form + Recent Projects */}
          <div className="flex flex-col overflow-y-auto border-b border-slate-200 p-5 dark:border-slate-800 lg:col-span-5 lg:border-b-0 lg:border-e">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                data-testid="tab-import-github"
                onClick={() => {
                  setSourceTab('github');
                  setErrorMsg(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  sourceTab === 'github'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <FolderGit2 className="h-3.5 w-3.5" />
                <span>{t.tabGithub}</span>
              </button>
              <button
                type="button"
                data-testid="tab-import-zip"
                onClick={() => {
                  setSourceTab('zip');
                  setErrorMsg(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  sourceTab === 'zip'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <FileArchive className="h-3.5 w-3.5" />
                <span>{t.tabZip}</span>
              </button>
            </div>

            {errorMsg && (
              <div
                role="alert"
                data-testid="project-import-error"
                className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
              >
                {errorMsg}
              </div>
            )}

            {sourceTab === 'github' ? (
              <form onSubmit={(e) => void handleGitHubImport(e)} className="mt-4 space-y-3.5">
                <div>
                  <label
                    htmlFor="github-repo-url"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.repoLabel}
                  </label>
                  <input
                    id="github-repo-url"
                    data-testid="github-repo-input"
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder={t.repoPlaceholder}
                    dir="ltr"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="github-branch"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.branchLabel}
                  </label>
                  <div className="relative mt-1.5">
                    <GitBranch className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-slate-400" />
                    <input
                      id="github-branch"
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder={t.branchPlaceholder}
                      dir="ltr"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-8 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="github-token"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.tokenLabel}
                  </label>
                  <input
                    id="github-token"
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={t.tokenPlaceholder}
                    dir="ltr"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  data-testid="github-import-submit"
                  disabled={isImporting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  {isImporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FolderGit2 className="h-3.5 w-3.5" />
                  )}
                  <span>{isImporting ? t.connecting : t.connectAnalyze}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleZipImport(e)} className="mt-4 space-y-3.5">
                <div>
                  <label
                    htmlFor="zip-project-name"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.zipNameLabel}
                  </label>
                  <input
                    id="zip-project-name"
                    type="text"
                    value={zipProjectName}
                    onChange={(e) => setZipProjectName(e.target.value)}
                    placeholder={t.zipNamePlaceholder}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 text-center dark:border-slate-700 dark:bg-slate-950/60">
                  <FileArchive className="mx-auto h-6 w-6 text-slate-400" />
                  <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {zipFile ? `${zipFile.name} (${Math.max(1, Math.round(zipFile.size / 1024))} KB)` : t.zipDropLabel}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {t.zipDropHint}
                  </p>
                  <button
                    type="button"
                    onClick={() => zipInputRef.current?.click()}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>{t.chooseZip}</span>
                  </button>
                  <input
                    ref={zipInputRef}
                    data-testid="zip-file-input"
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setZipFile(f);
                      setErrorMsg(null);
                    }}
                    className="sr-only"
                    aria-label={t.zipDropLabel}
                  />
                </div>

                <button
                  type="submit"
                  data-testid="zip-import-submit"
                  disabled={isImporting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  {isImporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <span>{isImporting ? t.uploading : t.uploadAnalyze}</span>
                </button>
              </form>
            )}

            {/* Recently Imported Projects */}
            {projects.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.recentProjects}
                </h3>
                <div className="mt-2 space-y-1.5">
                  {projects.map((proj) => {
                    const selected = activeProject?.id === proj.id;
                    return (
                      <div
                        key={proj.id}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-50/70 text-slate-900 dark:border-blue-500 dark:bg-blue-950/30 dark:text-slate-100'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedProjectId(proj.id)}
                          className="min-w-0 flex-1 text-start"
                        >
                          <div className="truncate font-semibold">{proj.name}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {proj.sourceType.toUpperCase()} · {proj.totalFiles}{' '}
                            {lang === 'fa' ? 'فایل' : 'files'} · {proj.recommendations.length}{' '}
                            {lang === 'fa' ? 'ایجنت' : 'agents'}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            data-testid={`edit-imported-project-${proj.id}`}
                            aria-label={`Edit ${proj.name}`}
                            title={lang === 'fa' ? 'ویرایش پروژه' : 'Edit project'}
                            onClick={() => {
                              setSelectedProjectId(proj.id);
                              setEditProjectName(proj.name);
                              setEditProjectUrl(proj.sourceUrl ?? '');
                              setEditProjectBranch(proj.branch ?? '');
                              setEditProjectSummary(proj.managerSummary);
                              setIsEditingProjectMeta(true);
                            }}
                            className="rounded p-1 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/40"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`delete-imported-project-${proj.id}`}
                            aria-label={`${t.deleteProj} ${proj.name}`}
                            onClick={() => void onDeleteProject(proj.id)}
                            className="rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Manager Agent Analysis & Recommended Team */}
          <div className="flex flex-col overflow-hidden lg:col-span-7">
            {!activeProject ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <ShieldCheck className="h-9 w-9 text-slate-300 dark:text-slate-700" />
                <h3 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t.emptyAnalysisTitle}
                </h3>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {t.emptyAnalysisHint}
                </p>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                  {/* Manager Assessment Overview */}
                  <section
                    data-testid="manager-project-analysis"
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                        <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        {t.managerAssessment}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {activeProject.name} · {activeProject.sourceType.toUpperCase()}
                          {activeProject.branch ? ` (${activeProject.branch})` : ''} ·{' '}
                          {activeProject.usedLiveAi ? t.liveAiTag : t.staticScanTag}
                        </span>
                        <button
                          type="button"
                          data-testid="edit-active-imported-project-btn"
                          onClick={() => {
                            if (!isEditingProjectMeta) {
                              setEditProjectName(activeProject.name);
                              setEditProjectUrl(activeProject.sourceUrl ?? '');
                              setEditProjectBranch(activeProject.branch ?? '');
                              setEditProjectSummary(activeProject.managerSummary);
                            }
                            setIsEditingProjectMeta((prev) => !prev);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-blue-500 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>{lang === 'fa' ? 'ویرایش پروژه' : 'Edit Project'}</span>
                        </button>
                        <button
                          type="button"
                          data-testid="delete-active-imported-project-btn"
                          onClick={() => void onDeleteProject(activeProject.id)}
                          className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>{lang === 'fa' ? 'حذف پروژه' : 'Delete'}</span>
                        </button>
                      </div>
                    </div>

                    {isEditingProjectMeta ? (
                      <div
                        data-testid="edit-imported-project-form"
                        className="mt-3 space-y-2.5 rounded-lg border border-blue-200 bg-white p-3 dark:border-blue-900/60 dark:bg-slate-900"
                      >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              {lang === 'fa' ? 'نام پروژه' : 'Project Name'}
                            </label>
                            <input
                              type="text"
                              data-testid="edit-project-name-input"
                              value={editProjectName}
                              onChange={(e) => setEditProjectName(e.target.value)}
                              className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              {lang === 'fa' ? 'آدرس مخزن (اختیاری)' : 'Repository URL (optional)'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid="edit-project-url-input"
                              value={editProjectUrl}
                              onChange={(e) => setEditProjectUrl(e.target.value)}
                              placeholder="https://github.com/owner/repo"
                              className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              {lang === 'fa' ? 'شاخه / Branch' : 'Branch'}
                            </label>
                            <input
                              type="text"
                              dir="ltr"
                              data-testid="edit-project-branch-input"
                              value={editProjectBranch}
                              onChange={(e) => setEditProjectBranch(e.target.value)}
                              placeholder="main"
                              className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            {lang === 'fa'
                              ? 'خلاصه تحلیل و یادداشت ایجنت مدیر'
                              : 'Manager Assessment Summary'}
                          </label>
                          <textarea
                            rows={2}
                            data-testid="edit-project-summary-input"
                            value={editProjectSummary}
                            onChange={(e) => setEditProjectSummary(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setIsEditingProjectMeta(false)}
                            className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                          >
                            {lang === 'fa' ? 'انصراف' : 'Cancel'}
                          </button>
                          <button
                            type="button"
                            data-testid="save-imported-project-btn"
                            disabled={isSavingProjectMeta || !editProjectName.trim()}
                            onClick={() => void handleSaveProjectMeta()}
                            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" />
                            <span>
                              {isSavingProjectMeta
                                ? lang === 'fa'
                                  ? 'در حال ذخیره...'
                                  : 'Saving...'
                                : lang === 'fa'
                                  ? 'ذخیره تغییرات پروژه'
                                  : 'Save Project Changes'}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        dir="auto"
                        className="mt-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300"
                      >
                        {activeProject.managerSummary}
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-200 pt-3 text-[11px] dark:border-slate-800 sm:grid-cols-3">
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">
                          {t.filesLabel}:{' '}
                        </span>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {activeProject.totalFiles}
                        </span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">
                          {t.languagesLabel}:{' '}
                        </span>
                        <span className="text-slate-800 dark:text-slate-200">
                          {activeProject.languages.length > 0
                            ? activeProject.languages
                                .slice(0, 4)
                                .map((l) => `${l.name} (${l.files})`)
                                .join(' · ')
                            : '—'}
                        </span>
                      </div>
                      <div className="sm:col-span-3">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">
                          {t.frameworksLabel}:{' '}
                        </span>
                        <span className="text-slate-800 dark:text-slate-200">
                          {activeProject.frameworks.length > 0
                            ? activeProject.frameworks.join(' · ')
                            : 'Standard Source Project'}
                        </span>
                      </div>
                      {activeProject.keyFiles.length > 0 && (
                        <div className="sm:col-span-3">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">
                            {t.keyFilesLabel}:{' '}
                          </span>
                          <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                            {activeProject.keyFiles.slice(0, 6).join(' · ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Recommended Agents List (Editable, Duplicable, Deletable) */}
                  <section>
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {t.recommendedTeam} ({selectedRecommendations.length}/{editableSpecs.length})
                      </h3>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          data-testid="add-custom-project-agent-btn"
                          onClick={handleAddCustomSpec}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                        >
                          <Plus className="h-3 w-3" />
                          {lang === 'fa' ? 'افزودن ایجنت دلخواه' : 'Add Custom Agent'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const allChecked = editableSpecs.every((r) => checkedIds[r.id]);
                            const next: Record<string, boolean> = {};
                            for (const r of editableSpecs) {
                              next[r.id] = !allChecked;
                            }
                            setCheckedIds(next);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                          {t.selectAll}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2.5" data-testid="recommended-agents-list">
                      {editableSpecs.map((rec) => {
                        const checked = Boolean(checkedIds[rec.id]);
                        const isEditing = editingSpecId === rec.id;
                        const priorityText =
                          rec.priority === 'essential'
                            ? t.priorityEssential
                            : rec.priority === 'optional'
                              ? t.priorityOptional
                              : t.priorityRecommended;
                        const providerModels = getEffectiveProviderModels(
                          rec.recommendedProvider,
                          appSettings?.providers[rec.recommendedProvider],
                        );
                        const powerKey: AgentPowerLevel = rec.powerLevel ?? 'pro';

                        return (
                          <article
                            key={rec.id}
                            className={`rounded-lg border p-3.5 transition-colors ${
                              checked
                                ? 'border-blue-300 bg-white dark:border-blue-800 dark:bg-slate-900'
                                : 'border-slate-200 bg-slate-50/50 opacity-75 dark:border-slate-800 dark:bg-slate-950'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                id={`rec-check-${rec.id}`}
                                checked={checked}
                                onChange={(e) =>
                                  setCheckedIds((prev) => ({
                                    ...prev,
                                    [rec.id]: e.target.checked,
                                  }))
                                }
                                className="mt-1 h-4 w-4 rounded border-slate-300 accent-blue-600"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label
                                    htmlFor={`rec-check-${rec.id}`}
                                    className="cursor-pointer text-xs font-bold text-slate-900 dark:text-slate-100"
                                  >
                                    {rec.title}
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                      {rec.section || roleLabels[rec.role] || rec.role} ·{' '}
                                      {POWER_LEVEL_META[powerKey].short}
                                    </span>
                                    <button
                                      type="button"
                                      aria-label={`Edit ${rec.title}`}
                                      onClick={() =>
                                        setEditingSpecId(isEditing ? null : rec.id)
                                      }
                                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
                                    >
                                      {isEditing ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                                      ) : (
                                        <Pencil className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Duplicate ${rec.title}`}
                                      title="Add another (+1)"
                                      onClick={() => handleDuplicateSpec(rec)}
                                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-emerald-600 dark:text-slate-400 dark:hover:bg-slate-800"
                                    >
                                      <CopyPlus className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${rec.title}`}
                                      onClick={() => handleDeleteSpec(rec.id)}
                                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {isEditing ? (
                                  <div className="mt-2.5 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-2">
                                    <input
                                      type="text"
                                      aria-label="Edit agent title"
                                      value={rec.title}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, { title: e.target.value })
                                      }
                                      placeholder="Agent Title"
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                    <input
                                      type="text"
                                      aria-label="Edit agent position"
                                      value={rec.positionTitle ?? ''}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, { positionTitle: e.target.value })
                                      }
                                      placeholder={lang === 'fa' ? 'پست و سمت' : 'Position / Post'}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                    <select
                                      aria-label="Edit agent section"
                                      value={rec.section ?? 'Backend & API'}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, { section: e.target.value })
                                      }
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {AGENT_SECTIONS.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {lang === 'fa' ? s.fa : s.en}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      aria-label="Edit agent power tier"
                                      value={powerKey}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, {
                                          powerLevel: e.target.value as AgentPowerLevel,
                                        })
                                      }
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="eco">Eco (Fast)</option>
                                      <option value="standard">Standard (Balanced)</option>
                                      <option value="pro">Pro (High Power)</option>
                                      <option value="ultra">Ultra (Deep Reasoning)</option>
                                    </select>
                                    <select
                                      aria-label="Edit agent provider"
                                      dir="ltr"
                                      value={rec.recommendedProvider}
                                      onChange={(e) => {
                                        const prov = e.target.value as LLMProvider;
                                        const list = getEffectiveProviderModels(
                                          prov,
                                          appSettings?.providers[prov],
                                        );
                                        handleUpdateSpec(rec.id, {
                                          recommendedProvider: prov,
                                          recommendedModel:
                                            appSettings?.providers[prov]?.defaultModel ||
                                            list[0]?.id ||
                                            '',
                                        });
                                      }}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="gemini">Google Gemini</option>
                                      <option value="opencode">OpenCode Zen</option>
                                      <option value="openai">OpenAI ChatGPT</option>
                                      <option value="anthropic">Anthropic Claude</option>
                                      <option value="ollama">Local Ollama</option>
                                    </select>
                                    <select
                                      aria-label="Edit agent model"
                                      dir="ltr"
                                      value={rec.recommendedModel}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, {
                                          recommendedModel: e.target.value,
                                        })
                                      }
                                      className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {providerModels.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.id} ({POWER_LEVEL_META[m.power].short})
                                        </option>
                                      ))}
                                      {!providerModels.some((m) => m.id === rec.recommendedModel) && (
                                        <option value={rec.recommendedModel}>
                                          {rec.recommendedModel}
                                        </option>
                                      )}
                                    </select>
                                    <input
                                      type="text"
                                      aria-label="Edit agent responsibility"
                                      value={rec.specialty}
                                      onChange={(e) =>
                                        handleUpdateSpec(rec.id, { specialty: e.target.value })
                                      }
                                      placeholder={lang === 'fa' ? 'مسئولیت و تخصص' : 'Specialty / Responsibility'}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-2"
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                      {rec.positionTitle && (
                                        <span className="font-medium text-slate-700 dark:text-slate-300">
                                          {rec.positionTitle}
                                        </span>
                                      )}
                                      <span>· {priorityText} ·</span>
                                      <span className="font-mono">
                                        {rec.recommendedProvider}/{rec.recommendedModel}
                                      </span>
                                    </div>

                                    <div
                                      dir="auto"
                                      className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-400"
                                    >
                                      {rec.specialty}
                                    </div>

                                    <p
                                      dir="auto"
                                      className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
                                    >
                                      {rec.reason}
                                    </p>

                                    {rec.matchedSignals.length > 0 && (
                                      <div className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                                        <span className="font-semibold">{t.signalsLabel} </span>
                                        <span className="font-mono">
                                          {rec.matchedSignals.join(' · ')}
                                        </span>
                                      </div>
                                    )}

                                    <details className="mt-2">
                                      <summary className="cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200">
                                        {t.promptPreview}
                                      </summary>
                                      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                                        {rec.systemPrompt}
                                      </pre>
                                    </details>
                                  </>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </div>

                {/* Footer Apply Actions */}
                <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950">
                  <button
                    type="button"
                    data-testid="apply-merge-team-btn"
                    disabled={isApplying || selectedRecommendations.length === 0}
                    onClick={() => void handleApply('merge')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>{isApplying ? t.applying : t.addToCanvas}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="apply-replace-team-btn"
                    disabled={isApplying || selectedRecommendations.length === 0}
                    onClick={() => void handleApply('replace')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Workflow className="h-3.5 w-3.5" />
                    <span>{isApplying ? t.applying : t.buildNewTeam}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
