import { useEffect, useState } from 'react';
import {
  Check,
  CopyPlus,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Pencil,
  Plus,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type { ImportedProjectAnalysis, WorkflowConfig } from '../types/workflow';
import { clampMaxRounds } from '../utils/workflowEngine';

interface ProjectManagerModalProps {
  isOpen: boolean;
  lang: 'en' | 'fa';
  workflows: WorkflowConfig[];
  activeWorkflow: WorkflowConfig;
  importedProjects: ImportedProjectAnalysis[];
  onClose: () => void;
  onSelectWorkflow: (wf: WorkflowConfig) => void;
  onSaveWorkflow: (wf: WorkflowConfig) => Promise<void>;
  onDuplicateWorkflow: (wf: WorkflowConfig) => Promise<void>;
  onDeleteWorkflow: (workflowId: string) => Promise<void>;
  onCreateNewWorkflow: () => void;
  onUpdateImportedProject: (
    projectId: string,
    patch: Partial<ImportedProjectAnalysis>,
  ) => Promise<void>;
  onDeleteImportedProject: (projectId: string) => Promise<void>;
  onOpenImportModal: () => void;
}

export function ProjectManagerModal({
  isOpen,
  lang,
  workflows,
  activeWorkflow,
  importedProjects,
  onClose,
  onSelectWorkflow,
  onSaveWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onCreateNewWorkflow,
  onUpdateImportedProject,
  onDeleteImportedProject,
  onOpenImportModal,
}: ProjectManagerModalProps) {
  const isFa = lang === 'fa';

  const [editingWorkflowId, setEditingWorkflowId] = useState<string>(activeWorkflow.id);
  const [wfName, setWfName] = useState(activeWorkflow.name);
  const [wfDescription, setWfDescription] = useState(activeWorkflow.description);
  const [wfMaxRounds, setWfMaxRounds] = useState(activeWorkflow.maxRounds);
  const [wfHitl, setWfHitl] = useState(activeWorkflow.humanInTheLoop);
  const [wfRepoName, setWfRepoName] = useState(activeWorkflow.projectContext?.name ?? '');
  const [wfRepoUrl, setWfRepoUrl] = useState(activeWorkflow.projectContext?.sourceUrl ?? '');
  const [wfBranch, setWfBranch] = useState(activeWorkflow.projectContext?.branch ?? '');
  const [savingWf, setSavingWf] = useState(false);

  const [editingImportedId, setEditingImportedId] = useState<string | null>(null);
  const [impName, setImpName] = useState('');
  const [impUrl, setImpUrl] = useState('');
  const [impBranch, setImpBranch] = useState('');
  const [impSummary, setImpSummary] = useState('');
  const [savingImp, setSavingImp] = useState(false);

  const targetWorkflow =
    workflows.find((w) => w.id === editingWorkflowId) ?? activeWorkflow;

  useEffect(() => {
    if (!isOpen) return;
    setEditingWorkflowId(activeWorkflow.id);
    setWfName(activeWorkflow.name);
    setWfDescription(activeWorkflow.description);
    setWfMaxRounds(activeWorkflow.maxRounds);
    setWfHitl(activeWorkflow.humanInTheLoop);
    setWfRepoName(activeWorkflow.projectContext?.name ?? '');
    setWfRepoUrl(activeWorkflow.projectContext?.sourceUrl ?? '');
    setWfBranch(activeWorkflow.projectContext?.branch ?? '');
    setEditingImportedId(null);
  }, [isOpen, activeWorkflow]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const loadWorkflowIntoForm = (wf: WorkflowConfig) => {
    setEditingWorkflowId(wf.id);
    setWfName(wf.name);
    setWfDescription(wf.description);
    setWfMaxRounds(wf.maxRounds);
    setWfHitl(wf.humanInTheLoop);
    setWfRepoName(wf.projectContext?.name ?? '');
    setWfRepoUrl(wf.projectContext?.sourceUrl ?? '');
    setWfBranch(wf.projectContext?.branch ?? '');
  };

  const handleSaveWorkflowForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wfName.trim()) return;
    setSavingWf(true);
    try {
      const hasRepoContext = Boolean(
        wfRepoName.trim() || wfRepoUrl.trim() || targetWorkflow.projectContext,
      );
      const updated: WorkflowConfig = {
        ...targetWorkflow,
        name: wfName.trim(),
        description: wfDescription.trim() || 'Custom multi-agent project workflow',
        maxRounds: clampMaxRounds(wfMaxRounds),
        humanInTheLoop: wfHitl,
        projectContext: hasRepoContext
          ? {
              projectId:
                targetWorkflow.projectContext?.projectId || `proj-${targetWorkflow.id}`,
              name: wfRepoName.trim() || wfName.trim(),
              sourceType: wfRepoUrl.trim()
                ? 'github'
                : targetWorkflow.projectContext?.sourceType ?? 'zip',
              sourceUrl: wfRepoUrl.trim() || undefined,
              branch: wfBranch.trim() || undefined,
              summary:
                targetWorkflow.projectContext?.summary ||
                wfDescription.trim() ||
                'Project workflow context',
              frameworks: targetWorkflow.projectContext?.frameworks ?? [],
            }
          : undefined,
        updatedAt: new Date().toISOString(),
      };
      await onSaveWorkflow(updated);
    } finally {
      setSavingWf(false);
    }
  };

  const handleStartEditImported = (proj: ImportedProjectAnalysis) => {
    setEditingImportedId(proj.id);
    setImpName(proj.name);
    setImpUrl(proj.sourceUrl ?? '');
    setImpBranch(proj.branch ?? '');
    setImpSummary(proj.managerSummary);
  };

  const handleSaveImported = async (projectId: string) => {
    if (!impName.trim()) return;
    setSavingImp(true);
    try {
      await onUpdateImportedProject(projectId, {
        name: impName.trim(),
        sourceUrl: impUrl.trim() || undefined,
        branch: impBranch.trim() || undefined,
        managerSummary: impSummary.trim(),
      });
      setEditingImportedId(null);
    } finally {
      setSavingImp(false);
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
        aria-labelledby="project-manager-title"
        data-testid="project-manager-modal"
        dir={isFa ? 'rtl' : 'ltr'}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2
              id="project-manager-title"
              className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-slate-100"
            >
              <FolderKanban className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>
                {isFa
                  ? 'مدیریت، ویرایش و حذف پروژه‌ها (Projects & Workflows)'
                  : 'Manage, Edit & Delete Projects'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isFa
                ? 'نام، توضیحات، مخزن گیت‌هاب و تنظیمات پروژه‌های محیط کاری و پروژه‌های واردشده را ویرایش یا حذف کنید.'
                : 'Edit project names, descriptions, linked GitHub repositories, duplicate workflows, or delete projects.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isFa ? 'بستن پنجره مدیریت پروژه‌ها' : 'Close project manager'}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Left Column: Workflow Projects List + Imported Projects List */}
          <div className="flex flex-col space-y-5 overflow-y-auto border-b border-slate-200 p-5 dark:border-slate-800 lg:col-span-5 lg:border-b-0 lg:border-e">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Workflow className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    {isFa
                      ? `پروژه‌ها و ورکفلوهای محیط کاری (${workflows.length})`
                      : `Workspace Projects (${workflows.length})`}
                  </span>
                </h3>
                <button
                  type="button"
                  data-testid="pm-create-workflow-btn"
                  onClick={() => {
                    onCreateNewWorkflow();
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                >
                  <Plus className="h-3 w-3" />
                  <span>{isFa ? 'پروژه جدید' : 'New Project'}</span>
                </button>
              </div>

              <div className="mt-2.5 space-y-2" data-testid="pm-workflows-list">
                {workflows.map((wf) => {
                  const isEditingThis = wf.id === targetWorkflow.id;
                  const isCurrentActive = wf.id === activeWorkflow.id;
                  return (
                    <div
                      key={wf.id}
                      className={`rounded-lg border p-2.5 text-xs transition-colors ${
                        isEditingThis
                          ? 'border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectWorkflow(wf);
                            loadWorkflowIntoForm(wf);
                          }}
                          className="min-w-0 flex-1 text-start"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                              {wf.name}
                            </span>
                            {isCurrentActive && (
                              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                {isFa ? 'فعال' : 'Active'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {wf.description}
                          </p>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {wf.nodes.length} {isFa ? 'ایجنت' : 'agents'} · {wf.edges.length}{' '}
                            {isFa ? 'ارتباط' : 'edges'}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            data-testid={`pm-edit-workflow-${wf.id}`}
                            aria-label={`Edit ${wf.name}`}
                            title={isFa ? 'ویرایش پروژه' : 'Edit project'}
                            onClick={() => {
                              onSelectWorkflow(wf);
                              loadWorkflowIntoForm(wf);
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-white hover:text-blue-600 dark:hover:bg-slate-900"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`pm-duplicate-workflow-${wf.id}`}
                            aria-label={`Duplicate ${wf.name}`}
                            title={isFa ? 'کپی پروژه (+1)' : 'Duplicate project'}
                            onClick={() => void onDuplicateWorkflow(wf)}
                            className="rounded p-1 text-slate-500 hover:bg-white hover:text-emerald-600 dark:hover:bg-slate-900"
                          >
                            <CopyPlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`pm-delete-workflow-${wf.id}`}
                            aria-label={`Delete ${wf.name}`}
                            title={isFa ? 'حذف پروژه' : 'Delete project'}
                            onClick={() => void onDeleteWorkflow(wf.id)}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Imported GitHub / ZIP Repositories */}
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <FolderGit2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    {isFa
                      ? `پروژه‌های واردشده گیت‌هاب / ZIP (${importedProjects.length})`
                      : `Imported GitHub / ZIP Projects (${importedProjects.length})`}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenImportModal();
                  }}
                  className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {isFa ? '+ ایمپورت جدید' : '+ Import New'}
                </button>
              </div>

              {importedProjects.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {isFa
                    ? 'هنوز پروژه‌ای از گیت‌هاب یا فایل ZIP وارد نشده است.'
                    : 'No GitHub or ZIP projects imported yet.'}
                </p>
              ) : (
                <div className="mt-2 space-y-2" data-testid="pm-imported-projects-list">
                  {importedProjects.map((proj) => {
                    const isEditingImp = editingImportedId === proj.id;
                    return (
                      <div
                        key={proj.id}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                              {proj.name}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {proj.sourceType.toUpperCase()} · {proj.totalFiles}{' '}
                              {isFa ? 'فایل' : 'files'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              data-testid={`pm-edit-imported-${proj.id}`}
                              onClick={() =>
                                isEditingImp
                                  ? setEditingImportedId(null)
                                  : handleStartEditImported(proj)
                              }
                              className="rounded p-1 text-slate-500 hover:bg-white hover:text-blue-600 dark:hover:bg-slate-900"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              data-testid={`pm-delete-imported-${proj.id}`}
                              onClick={() => void onDeleteImportedProject(proj.id)}
                              className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {isEditingImp && (
                          <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                            <input
                              type="text"
                              data-testid="pm-imported-name-input"
                              value={impName}
                              onChange={(e) => setImpName(e.target.value)}
                              placeholder={isFa ? 'نام پروژه' : 'Project Name'}
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="text"
                                dir="ltr"
                                value={impUrl}
                                onChange={(e) => setImpUrl(e.target.value)}
                                placeholder="https://github.com/..."
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                              <input
                                type="text"
                                dir="ltr"
                                value={impBranch}
                                onChange={(e) => setImpBranch(e.target.value)}
                                placeholder="main"
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                            </div>
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingImportedId(null)}
                                className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600"
                              >
                                {isFa ? 'لغو' : 'Cancel'}
                              </button>
                              <button
                                type="button"
                                data-testid="pm-save-imported-btn"
                                disabled={savingImp}
                                onClick={() => void handleSaveImported(proj.id)}
                                className="rounded bg-blue-600 px-2.5 py-0.5 text-[10px] font-semibold text-white"
                              >
                                {isFa ? 'ذخیره' : 'Save'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Edit Selected Workflow Project Form */}
          <form
            onSubmit={(e) => void handleSaveWorkflowForm(e)}
            className="flex flex-col justify-between overflow-y-auto p-6 lg:col-span-7"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {isFa ? 'ویرایش مشخصات پروژه انتخاب‌شده' : 'Edit Selected Project Details'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ID: <span className="font-mono">{targetWorkflow.id}</span>
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="pm-delete-current-workflow-btn"
                  onClick={() => void onDeleteWorkflow(targetWorkflow.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isFa ? 'حذف این پروژه' : 'Delete Project'}</span>
                </button>
              </div>

              <div>
                <label
                  htmlFor="pm-workflow-name-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isFa ? 'نام پروژه / ورکفلو' : 'Project / Workflow Name'}
                </label>
                <input
                  id="pm-workflow-name-input"
                  data-testid="pm-workflow-name-input"
                  type="text"
                  required
                  value={wfName}
                  onChange={(e) => setWfName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="pm-workflow-desc-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isFa ? 'توضیحات و هدف پروژه' : 'Project Description & Goal'}
                </label>
                <textarea
                  id="pm-workflow-desc-input"
                  data-testid="pm-workflow-desc-input"
                  rows={3}
                  value={wfDescription}
                  onChange={(e) => setWfDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="pm-workflow-rounds-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {isFa ? 'حداکثر راند اجرا (max_rounds)' : 'Max Execution Rounds (max_rounds)'}
                  </label>
                  <input
                    id="pm-workflow-rounds-input"
                    type="number"
                    min={1}
                    max={25}
                    value={wfMaxRounds}
                    onChange={(e) => setWfMaxRounds(clampMaxRounds(Number(e.target.value)))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={wfHitl}
                      onChange={(e) => setWfHitl(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    <span>
                      {isFa
                        ? 'تایید انسانی دستورات حساس (Human-in-the-Loop)'
                        : 'Human-in-the-Loop Approval Gate'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <FolderGit2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    {isFa
                      ? 'مشخصات مخزن گیت‌هاب مرتبط با این پروژه (اختیاری)'
                      : 'Linked Repository Context (Optional)'}
                  </span>
                </h4>
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {isFa ? 'عنوان مخزن / کدبیس' : 'Codebase Label'}
                    </label>
                    <input
                      type="text"
                      value={wfRepoName}
                      onChange={(e) => setWfRepoName(e.target.value)}
                      placeholder="owner/repo"
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {isFa ? 'آدرس مخزن گیت‌هاب' : 'GitHub Repository URL'}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      data-testid="pm-workflow-repo-input"
                      value={wfRepoUrl}
                      onChange={(e) => setWfRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {isFa ? 'شاخه / Branch' : 'Branch'}
                    </label>
                    <div className="relative mt-1">
                      <GitBranch className="pointer-events-none absolute top-1.5 left-2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        dir="ltr"
                        data-testid="pm-workflow-branch-input"
                        value={wfBranch}
                        onChange={(e) => setWfBranch(e.target.value)}
                        placeholder="main"
                        className="w-full rounded border border-slate-200 bg-white py-1 pr-2 pl-7 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
              <button
                type="submit"
                data-testid="pm-save-workflow-btn"
                disabled={savingWf || !wfName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>
                  {savingWf
                    ? isFa
                      ? 'در حال ذخیره...'
                      : 'Saving...'
                    : isFa
                      ? 'ذخیره تغییرات پروژه'
                      : 'Save Project Changes'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
