import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import {
  Archive,
  Check,
  Download,
  FolderGit2,
  Languages,
  Link2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sun,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react';
import {
  DEFAULT_SEED_WORKFLOWS,
  POWER_LEVEL_META,
  type AgentRoleTemplate,
} from './data/agentTemplates';
import type {
  AgentNodeData,
  AgentRole,
  AppSettings,
  BugReportItem,
  BugReportStatus,
  CapabilitiesState,
  ContinuousWorkSession,
  ExecutionEvent,
  ExecutionRunSummary,
  ImportedProjectAnalysis,
  PrelaunchTestReport,
  RecommendedAgentSpec,
  SandboxFile,
  WorkflowConfig,
  WorkflowEdge,
  WorkflowNode,
} from './types/workflow';
import {
  createAgentNodesBatch,
  deleteAgentTemplate,
  duplicateWorkflowNode,
  getEffectiveAgentTemplates,
  getEffectiveProviderModels,
  restoreDefaultAgentTemplates,
  upsertCustomAgentTemplate,
} from './utils/catalogUtils';
import { buildWorkflowFromRecommendations } from './utils/projectAnalyzer';
import {
  DEFAULT_APP_SETTINGS,
  buildWorkflowShareUrl,
  clampContinuousIntervalSec,
  clampMaxRounds,
  decodeWorkflowFromShareParam,
  parseImportedWorkflowJson,
  serializeWorkflowForExport,
  syncWorkflowInList,
} from './utils/workflowEngine';
import type { ExportBundleScope } from './utils/exportBundle';
import {
  AgentBuilderModal,
  payloadToCustomTemplate,
  type AgentBuilderSubmitPayload,
} from './components/AgentBuilderModal';
import { AgentInspector } from './components/AgentInspector';
import { BlueprintView } from './components/BlueprintView';
import { ExecutionConsole } from './components/ExecutionConsole';
import { GitHubPushModal } from './components/GitHubPushModal';
import { ProjectImportModal } from './components/ProjectImportModal';
import { ProjectManagerModal } from './components/ProjectManagerModal';
import { RunHistoryView } from './components/RunHistoryView';
import { SettingsView } from './components/SettingsView';
import { WorkflowCanvas } from './components/WorkflowCanvas';

type TopView = 'canvas' | 'history' | 'blueprint' | 'settings';
type InspectorTab = 'inspector' | 'execution';
type UiLang = 'en' | 'fa';

const COPY = {
  en: {
    navCanvas: 'Workflow Canvas',
    navHistory: 'Run History',
    navBlueprint: 'Deploy & Code',
    navSettings: 'Settings',
    saveBtn: 'Save Workflow',
    savedBtn: 'Saved',
    newBtn: 'New Workflow',
    manageProjects: 'Manage Projects',
    editProject: 'Edit Project',
    deleteProject: 'Delete Project',
    exportJson: 'Export JSON',
    importJson: 'Import JSON',
    saveZip: 'Save ZIP',
    pushGitHub: 'Push to GitHub',
    importProject: 'Import Project',
    shareLink: 'Share Link',
    linkCopied: 'Link Copied',
    exportedNotice: 'Exported workflow JSON (secrets excluded).',
    sharedLoadedNotice: 'Loaded shared workflow from URL link.',
    importedNotice: 'Imported workflow JSON onto canvas.',
    importError: 'Could not import workflow JSON.',
    templatesTitle: 'Agent Role Templates',
    templatesHint: 'Click or drag a role onto the canvas',
    maxRounds: 'max_rounds',
    hitlLabel: 'Human-in-the-Loop Gate',
    tabInspector: 'Agent Inspector',
    tabExecution: 'Live GroupChat',
  },
  fa: {
    navCanvas: 'بوم جریان کار',
    navHistory: 'تاریخچه اجرا',
    navBlueprint: 'معماری و کد استقرار',
    navSettings: 'تنظیمات',
    saveBtn: 'ذخیره ورکفلو',
    savedBtn: 'ذخیره شد',
    newBtn: 'ورکفلو جدید',
    manageProjects: 'مدیریت پروژه‌ها',
    editProject: 'ویرایش پروژه',
    deleteProject: 'حذف پروژه',
    exportJson: 'خروجی JSON',
    importJson: 'ورود JSON',
    saveZip: 'ذخیره ZIP',
    pushGitHub: 'Push در گیت‌هاب',
    importProject: 'اتصال گیت‌هاب / ZIP',
    shareLink: 'لینک اشتراک',
    linkCopied: 'لینک کپی شد',
    exportedNotice: 'فایل JSON ورکفلو (بدون کلید محرمانه) دانلود شد.',
    sharedLoadedNotice: 'ورکفلو اشتراکی از طریق لینک با موفقیت بارگذاری شد.',
    importedNotice: 'ورکفلو از فایل JSON با موفقیت بارگذاری شد.',
    importError: 'خطا در خواندن فایل JSON ورکفلو.',
    templatesTitle: 'قالب نقش ایجنت‌ها',
    templatesHint: 'برای افزودن به بوم کلیک یا درگ کنید',
    maxRounds: 'حداکثر راند (max_rounds)',
    hitlLabel: 'تایید انسانی دستورات حساس',
    tabInspector: 'تنظیمات ایجنت',
    tabExecution: 'اجرای زنده GroupChat',
  },
};

export default function App() {
  const [topView, setTopView] = useState<TopView>('canvas');
  const [rightTab, setRightTab] = useState<InspectorTab>('inspector');
  const [lang, setLang] = useState<UiLang>('en');
  const [darkMode, setDarkMode] = useState(false);

  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>(DEFAULT_SEED_WORKFLOWS);
  const [workflow, setWorkflow] = useState<WorkflowConfig>(DEFAULT_SEED_WORKFLOWS[0]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('node-manager');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilitiesState>({
    geminiConfigured: false,
    openaiConfigured: false,
    anthropicConfigured: false,
    opencodeConfigured: false,
    secrets: {},
  });
  const [executionMode, setExecutionMode] = useState<'live' | 'dry_run'>('dry_run');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState<string>('all');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isConvertingPrompt, setIsConvertingPrompt] = useState(false);
  const [promptEnhancedNotice, setPromptEnhancedNotice] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [sandboxFiles, setSandboxFiles] = useState<SandboxFile[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [waitingNodeId, setWaitingNodeId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: string;
    agentName: string;
    command: string;
    reason: string;
  } | null>(null);

  const [runsHistory, setRunsHistory] = useState<ExecutionRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [bugReports, setBugReports] = useState<BugReportItem[]>([]);
  const [importedProjects, setImportedProjects] = useState<ImportedProjectAnalysis[]>([]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [builderModal, setBuilderModal] = useState<{
    open: boolean;
    mode: 'add_agents' | 'edit_template';
    template: AgentRoleTemplate | null;
  }>({ open: false, mode: 'add_agents', template: null });
  const [gitHubPushModal, setGitHubPushModal] = useState<{
    open: boolean;
    initialScope: ExportBundleScope;
  }>({ open: false, initialScope: 'project_bundle' });
  const [shareCopied, setShareCopied] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [continuousSession, setContinuousSession] = useState<ContinuousWorkSession | null>(null);
  const [continuousBusy, setContinuousBusy] = useState(false);
  const [prelaunchReport, setPrelaunchReport] = useState<PrelaunchTestReport | null>(null);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const hasSharedWorkflowRef = useRef(false);
  const workflowRef = useRef<WorkflowConfig>(workflow);
  const isDirtyRef = useRef(false);
  const workflowsHydratedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  workflowRef.current = workflow;

  // Keep workflows list synchronized with active workflow on every canvas/inspector edit
  useEffect(() => {
    setWorkflows((prevList) => syncWorkflowInList(prevList, workflow));
  }, [workflow]);

  const markWorkflowDirty = useCallback(() => {
    isDirtyRef.current = true;
    setDirtyVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows');
      if (!res.ok) return;
      const list = (await res.json()) as WorkflowConfig[];
      workflowsHydratedRef.current = true;
      if (list.length > 0) {
        if (isDirtyRef.current) {
          setWorkflows(syncWorkflowInList(list, workflowRef.current));
          return;
        }
        setWorkflows(list);
        if (!hasSharedWorkflowRef.current) {
          setWorkflow((prev) => list.find((w) => w.id === prev.id) ?? list[0]);
        }
      }
    } catch {
      // Keep initial seed state if offline
    }
  }, []);

  const loadRunsHistory = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch('/api/runs');
      if (!res.ok) return;
      const list = (await res.json()) as ExecutionRunSummary[];
      setRunsHistory(list);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadBugReports = useCallback(async () => {
    try {
      const res = await fetch('/api/bugs');
      if (!res.ok) return;
      const list = (await res.json()) as BugReportItem[];
      setBugReports(list);
    } catch {
      // ignore offline
    }
  }, []);

  const loadImportedProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const list = (await res.json()) as ImportedProjectAnalysis[];
      setImportedProjects(list);
    } catch {
      // ignore offline
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedToken = params.get('wf');
    if (sharedToken) {
      const decoded = decodeWorkflowFromShareParam(sharedToken);
      if (decoded) {
        hasSharedWorkflowRef.current = true;
        setWorkflow(decoded);
        setSelectedNodeId(decoded.nodes[0]?.id ?? null);
        setWorkflows((prev) =>
          prev.some((w) => w.id === decoded.id) ? prev : [decoded, ...prev],
        );
        setWorkflowNotice({ type: 'success', text: COPY.en.sharedLoadedNotice });
      } else {
        setWorkflowNotice({ type: 'error', text: COPY.en.importError });
      }
    }
    void loadWorkflows();
    void loadRunsHistory();
    void loadBugReports();
    void loadImportedProjects();
    Promise.all([
      fetch('/api/capabilities').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ])
      .then(([capData, settingsData]) => {
        const cap = capData as Partial<CapabilitiesState>;
        const anyConfigured = Boolean(
          cap.geminiConfigured || cap.openaiConfigured || cap.anthropicConfigured,
        );
        setCapabilities({
          geminiConfigured: Boolean(cap.geminiConfigured),
          openaiConfigured: Boolean(cap.openaiConfigured),
          anthropicConfigured: Boolean(cap.anthropicConfigured),
          opencodeConfigured: Boolean(cap.opencodeConfigured),
          ollamaBaseUrl: cap.ollamaBaseUrl,
          secrets: cap.secrets ?? {},
        });
        if (settingsData && settingsData.providers) {
          const loaded = settingsData as AppSettings;
          setAppSettings(loaded);
          setLang(loaded.language);
          setDarkMode(loaded.darkMode);
          setExecutionMode(
            loaded.defaultExecutionMode === 'dry_run' || !anyConfigured ? 'dry_run' : 'live',
          );
        } else {
          setExecutionMode(anyConfigured ? 'live' : 'dry_run');
        }
      })
      .catch(() => {});
  }, [loadBugReports, loadImportedProjects, loadRunsHistory, loadWorkflows]);

  const refreshSandboxFiles = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/files`);
      if (res.ok) {
        const files = (await res.json()) as SandboxFile[];
        setSandboxFiles(files);
      }
    } catch {
      // ignore
    }
  }, []);

  const connectRunStream = useCallback(
    (runId: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?runId=${encodeURIComponent(runId)}`);
      wsRef.current = ws;

      ws.onmessage = (messageEvent) => {
        try {
          const evt = JSON.parse(messageEvent.data as string) as ExecutionEvent;
          setEvents((prev) => (prev.some((e) => e.id === evt.id) ? prev : [...prev, evt]));

          if (evt.type === 'bug_reported' && evt.bugReport) {
            setBugReports((prev) =>
              prev.some((b) => b.id === evt.bugReport!.id) ? prev : [evt.bugReport!, ...prev],
            );
          } else if (evt.type === 'manager_delegation' && evt.delegation) {
            setActiveNodeId(evt.delegation.targetAgentId);
            setWaitingNodeId(null);
          } else if (evt.type === 'agent_message') {
            setActiveNodeId(evt.agentId ?? null);
            setWaitingNodeId(null);
            setIsSendingChat(false);
            void refreshSandboxFiles(runId);
          } else if (evt.type === 'approval_required' && evt.pendingCommand) {
            setWaitingNodeId(evt.agentId ?? null);
            setPendingApproval({
              approvalId: evt.pendingCommand.approvalId,
              agentName: evt.agentName ?? 'Executor Agent',
              command: evt.pendingCommand.command,
              reason: evt.pendingCommand.reason,
            });
          } else if (evt.type === 'approval_resolved') {
            setPendingApproval(null);
            setWaitingNodeId(null);
          } else if (evt.type === 'run_completed' || evt.type === 'run_error') {
            setIsRunning(false);
            setIsSendingChat(false);
            setActiveNodeId(null);
            setWaitingNodeId(null);
            setPendingApproval(null);
            void refreshSandboxFiles(runId);
            void loadRunsHistory();
            void loadBugReports();
          }
        } catch {
          // ignore malformed event
        }
      };
    },
    [loadBugReports, loadRunsHistory, refreshSandboxFiles],
  );

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const persistWorkflowToServer = useCallback(
    async (wfToSave: WorkflowConfig, showBadge = false): Promise<WorkflowConfig | null> => {
      try {
        const res = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wfToSave),
        });
        if (!res.ok) return null;
        const saved = (await res.json()) as WorkflowConfig;
        // Only update local workflow state if no newer edits happened during flight
        if (workflowRef.current.id === saved.id && !isDirtyRef.current) {
          setWorkflow(saved);
        }
        setWorkflows((prev) => syncWorkflowInList(prev, saved));
        if (showBadge) {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 1800);
        }
        return saved;
      } catch {
        return null;
      }
    },
    [],
  );

  // Debounced auto-save so agent inspector & canvas edits persist automatically before modal/reload
  useEffect(() => {
    if (dirtyVersion === 0) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      const snapshot = workflowRef.current;
      isDirtyRef.current = false;
      void persistWorkflowToServer(snapshot, false);
    }, 550);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [dirtyVersion, persistWorkflowToServer]);

  const flushWorkflowSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (isDirtyRef.current) {
      isDirtyRef.current = false;
      await persistWorkflowToServer(workflowRef.current, false);
    }
  }, [persistWorkflowToServer]);

  const handleSaveWorkflow = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    isDirtyRef.current = false;
    await persistWorkflowToServer(workflowRef.current, true);
  };

  // Continuous Autonomous Work Session Sync & Polling
  const loadContinuousSession = useCallback(
    async (workflowId: string) => {
      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/continuous`);
        if (!res.ok) return;
        const data = (await res.json()) as { session?: ContinuousWorkSession };
        if (data.session) {
          setContinuousSession(data.session);
          if (
            data.session.active &&
            data.session.lastRunId &&
            data.session.lastRunId !== activeRunId &&
            !isSendingChat
          ) {
            setActiveRunId(data.session.lastRunId);
            connectRunStream(data.session.lastRunId);
          }
        }
      } catch {
        // ignore offline errors
      }
    },
    [activeRunId, connectRunStream, isSendingChat],
  );

  useEffect(() => {
    void loadContinuousSession(workflow.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  useEffect(() => {
    const shouldPoll = Boolean(continuousSession?.active || workflow.continuousAgentWork);
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      void loadContinuousSession(workflow.id);
    }, 3500);
    return () => clearInterval(timer);
  }, [continuousSession?.active, workflow.continuousAgentWork, workflow.id, loadContinuousSession]);

  const handleToggleContinuousWork = async (
    targetEnable?: boolean,
    overrideIntervalSec?: number,
    workflowOverride?: WorkflowConfig,
  ) => {
    const baseWf = workflowOverride ?? workflowRef.current;
    const enable =
      typeof targetEnable === 'boolean'
        ? targetEnable
        : !(continuousSession?.active || baseWf.continuousAgentWork);

    setContinuousBusy(true);
    try {
      if (!workflowOverride) {
        await flushWorkflowSave();
      }
      const currentWf = workflowOverride ?? workflowRef.current;
      if (enable) {
        if (currentWf.nodes.length === 0) {
          setValidationError(
            lang === 'fa'
              ? 'پیش از فعال‌سازی کار مداوم، حداقل یک ایجنت به بوم اضافه کنید.'
              : 'Add at least one Agent node before enabling continuous work.',
          );
          return;
        }
        const resolvedInterval = clampContinuousIntervalSec(
          overrideIntervalSec ?? currentWf.continuousIntervalSec ?? 30,
        );
        const res = await fetch(
          `/api/workflows/${encodeURIComponent(currentWf.id)}/continuous/start`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflow: { ...currentWf, continuousAgentWork: true, continuousIntervalSec: resolvedInterval },
              taskPrompt: taskPrompt.trim() || currentWf.description,
              mode: executionMode,
              intervalSec: resolvedInterval,
              immediate: true,
            }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          session?: ContinuousWorkSession;
          workflow?: WorkflowConfig;
          error?: string;
        };
        if (!res.ok) {
          showNotice('error', data.error || 'Could not start continuous agent work.');
          return;
        }
        if (data.session) setContinuousSession(data.session);
        setWorkflow((prev) => ({
          ...prev,
          continuousAgentWork: true,
          continuousIntervalSec: resolvedInterval,
        }));
        showNotice(
          'success',
          lang === 'fa'
            ? `کار مداوم و پیوسته ایجنت‌ها روی پروژه «${currentWf.name}» فعال شد (هر ${resolvedInterval} ثانیه).`
            : `Continuous 24/7 autonomous work enabled for "${currentWf.name}" (${resolvedInterval}s cycle).`,
        );
      } else {
        const res = await fetch(
          `/api/workflows/${encodeURIComponent(currentWf.id)}/continuous/stop`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disableWorkflowFlag: true }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          session?: ContinuousWorkSession;
        };
        if (data.session) setContinuousSession(data.session);
        setWorkflow((prev) => ({ ...prev, continuousAgentWork: false }));
        showNotice(
          'success',
          lang === 'fa'
            ? `کار مداوم ایجنت‌ها روی «${currentWf.name}» متوقف شد.`
            : `Continuous work paused for "${currentWf.name}".`,
        );
      }
    } finally {
      setContinuousBusy(false);
    }
  };

  const handleSaveSettings = async (next: AppSettings) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const saved = (await res.json()) as AppSettings;
      setAppSettings(saved);
      setLang(saved.language);
      setDarkMode(saved.darkMode);
      setExecutionMode(
        saved.defaultExecutionMode === 'dry_run' || !capabilities.geminiConfigured
          ? 'dry_run'
          : 'live',
      );
    }
  };

  const handleCreateWorkflow = () => {
    hasSharedWorkflowRef.current = false;
    const fresh: WorkflowConfig = {
      id: `wf-${Date.now()}`,
      name: `Custom Pipeline ${workflows.length + 1}`,
      description: 'Custom multi-agent workflow',
      maxRounds: appSettings.defaultMaxRounds,
      humanInTheLoop: appSettings.globalHumanInTheLoop,
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    };
    setWorkflow(fresh);
    setSelectedNodeId(null);
  };

  const showNotice = useCallback((type: 'success' | 'error', text: string) => {
    setWorkflowNotice({ type, text });
    setTimeout(() => {
      setWorkflowNotice((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  }, []);

  const handleExportJson = () => {
    const json = serializeWorkflowForExport(workflow);
    const slug =
      workflow.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || workflow.id;
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}.workflow.json`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
    showNotice('success', COPY[lang].exportedNotice);
  };

  const handleCopyShareLink = async () => {
    const shareUrl = buildWorkflowShareUrl(window.location.href, workflow);
    window.history.replaceState(null, '', shareUrl);
    try {
      await navigator.clipboard?.writeText(shareUrl);
    } catch {
      // Clipboard may be restricted in headless contexts; URL bar is updated
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2200);
    showNotice(
      'success',
      lang === 'fa'
        ? 'لینک اشتراک‌گذاری در نوار آدرس و کلیپ‌بورد کپی شد.'
        : 'Shareable workflow link updated in URL & copied to clipboard.',
    );
  };

  const handleDownloadZip = useCallback(
    async (
      scope: ExportBundleScope = 'project_bundle',
    ): Promise<{ ok: boolean; error?: string; filename?: string; fileCount?: number }> => {
      setIsDownloadingZip(true);
      try {
        const res = await fetch('/api/export/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            workflow,
            runId: activeRunId ?? undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          filename?: string;
          downloadUrl?: string;
          zipBase64?: string;
          fileCount?: number;
          error?: string;
        };
        if (!res.ok || (!data.downloadUrl && !data.zipBase64)) {
          const errMsg =
            data.error ||
            (lang === 'fa' ? 'خطا در ساخت فایل فشرده ZIP.' : 'Failed to build ZIP archive.');
          showNotice('error', errMsg);
          return { ok: false, error: errMsg };
        }

        const filename = data.filename || 'aetherflow-bundle.zip';

        if (data.downloadUrl) {
          const link = document.createElement('a');
          link.href = data.downloadUrl;
          link.download = filename;
          link.rel = 'noopener';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => link.remove(), 5000);
        } else if (data.zipBase64) {
          const binaryStr = window.atob(data.zipBase64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i += 1) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(url);
          }, 60_000);
        }

        showNotice(
          'success',
          lang === 'fa'
            ? `فایل فشرده «${filename}» (${data.fileCount ?? 0} فایل) آماده و دانلود شد.`
            : `Downloaded "${filename}" (${data.fileCount ?? 0} files).`,
        );
        return { ok: true, filename, fileCount: data.fileCount };
      } catch {
        const errMsg =
          lang === 'fa'
            ? 'خطای شبکه هنگام ساخت و دانلود فایل ZIP.'
            : 'Network error while generating ZIP archive.';
        showNotice('error', errMsg);
        return { ok: false, error: errMsg };
      } finally {
        setIsDownloadingZip(false);
      }
    },
    [activeRunId, lang, showNotice, workflow],
  );

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseImportedWorkflowJson(text);
      if (!result.workflow) {
        showNotice('error', result.error || COPY[lang].importError);
        return;
      }
      hasSharedWorkflowRef.current = false;
      const imported: WorkflowConfig = {
        ...result.workflow,
        id: result.workflow.id || `wf-${Date.now()}`,
      };
      setWorkflow(imported);
      setSelectedNodeId(imported.nodes[0]?.id ?? null);
      setWorkflows((prev) => {
        const exists = prev.some((w) => w.id === imported.id);
        return exists ? prev.map((w) => (w.id === imported.id ? imported : w)) : [imported, ...prev];
      });
      // Persist imported workflow to SQLite
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imported),
      }).catch(() => {});
      showNotice('success', COPY[lang].importedNotice);
    } catch {
      showNotice('error', COPY[lang].importError);
    }
  };

  const handleSaveSpecificWorkflow = async (wfToSave: WorkflowConfig) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (wfToSave.id === workflowRef.current.id) {
      isDirtyRef.current = false;
    }
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wfToSave),
    });
    if (res.ok) {
      const saved = (await res.json()) as WorkflowConfig;
      setWorkflow((prev) => (prev.id === saved.id ? saved : prev));
      setWorkflows((prev) => syncWorkflowInList(prev, saved));

      if (saved.id === workflowRef.current.id) {
        workflowRef.current = saved;
        const wantsContinuous = Boolean(saved.continuousAgentWork);
        const currentlyActive = Boolean(continuousSession?.active);
        if (wantsContinuous && !currentlyActive && saved.nodes.length > 0) {
          await handleToggleContinuousWork(true, saved.continuousIntervalSec, saved);
        } else if (!wantsContinuous && currentlyActive) {
          await handleToggleContinuousWork(false, undefined, saved);
        }
      }

      showNotice(
        'success',
        lang === 'fa'
          ? `تغییرات پروژه «${saved.name}» با موفقیت ذخیره شد.`
          : `Saved project "${saved.name}".`,
      );
    }
  };

  const handleDuplicateWorkflow = async (sourceWf: WorkflowConfig) => {
    const cloned: WorkflowConfig = {
      ...sourceWf,
      id: `wf-${Date.now().toString(36)}`,
      name: `${sourceWf.name} (Copy)`,
      updatedAt: new Date().toISOString(),
    };
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloned),
    }).catch(() => null);
    const saved = res?.ok ? ((await res.json()) as WorkflowConfig) : cloned;
    setWorkflows((prev) => [saved, ...prev]);
    setWorkflow(saved);
    setSelectedNodeId(saved.nodes[0]?.id ?? null);
    showNotice(
      'success',
      lang === 'fa'
        ? `کپی از پروژه «${sourceWf.name}» ساخته شد.`
        : `Duplicated project "${sourceWf.name}".`,
    );
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' }).catch(() => {});
    const remaining = workflows.filter((w) => w.id !== workflowId);
    if (remaining.length > 0) {
      setWorkflows(remaining);
      if (workflow.id === workflowId) {
        setWorkflow(remaining[0]);
        setSelectedNodeId(remaining[0].nodes[0]?.id ?? null);
      }
    } else {
      const fallback: WorkflowConfig = {
        id: `wf-${Date.now().toString(36)}`,
        name: 'Custom Pipeline 1',
        description: 'Custom multi-agent workflow',
        maxRounds: appSettings.defaultMaxRounds,
        humanInTheLoop: appSettings.globalHumanInTheLoop,
        nodes: [],
        edges: [],
        updatedAt: new Date().toISOString(),
      };
      setWorkflows([fallback]);
      setWorkflow(fallback);
      setSelectedNodeId(null);
    }
    showNotice(
      'success',
      lang === 'fa' ? 'پروژه با موفقیت حذف شد.' : 'Project deleted.',
    );
  };

  const handleUpdateImportedProject = async (
    projectId: string,
    patch: Partial<ImportedProjectAnalysis>,
  ) => {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = (await res.json()) as { project?: ImportedProjectAnalysis };
      if (data.project) {
        setImportedProjects((prev) =>
          prev.map((p) => (p.id === projectId ? data.project! : p)),
        );
        showNotice(
          'success',
          lang === 'fa'
            ? `مشخصات پروژه «${data.project.name}» ویرایش شد.`
            : `Updated project "${data.project.name}".`,
        );
      }
    }
  };

  const handleDeleteImportedProject = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (res.ok) {
      setImportedProjects((prev) => prev.filter((p) => p.id !== projectId));
      showNotice(
        'success',
        lang === 'fa' ? 'پروژه واردشده حذف شد.' : 'Imported project deleted.',
      );
    }
  };

  const handleApplyProjectRecommendations = async (
    project: ImportedProjectAnalysis,
    selectedSpecs: RecommendedAgentSpec[],
    mode: 'replace' | 'merge',
  ) => {
    hasSharedWorkflowRef.current = false;
    const nextWorkflow = buildWorkflowFromRecommendations({
      project,
      selectedSpecs,
      existingWorkflow: workflow,
      mode,
      appSettings,
    });
    setWorkflow(nextWorkflow);
    setSelectedNodeId(nextWorkflow.nodes[0]?.id ?? null);
    setWorkflows((prev) => {
      const exists = prev.some((w) => w.id === nextWorkflow.id);
      return exists
        ? prev.map((w) => (w.id === nextWorkflow.id ? nextWorkflow : w))
        : [nextWorkflow, ...prev];
    });
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextWorkflow),
    }).catch(() => null);
    if (res?.ok) {
      const saved = (await res.json()) as WorkflowConfig;
      setWorkflow(saved);
    }
    setTopView('canvas');
    showNotice(
      'success',
      lang === 'fa'
        ? `تیم پیشنهادی (${selectedSpecs.length} ایجنت تخصصی) برای پروژه «${project.name}» روی بوم ساخته شد.`
        : `Applied ${selectedSpecs.length} Manager-recommended specialist agent(s) for "${project.name}".`,
    );
  };

  const effectiveTemplates = getEffectiveAgentTemplates(appSettings);

  const handleAddTemplateNode = (
    roleOrTemplateId: AgentRole | string,
    customPosition?: { x: number; y: number },
  ) => {
    const tpl =
      effectiveTemplates.find((t) => t.id === roleOrTemplateId || t.role === roleOrTemplateId) ??
      effectiveTemplates[0];
    const role: AgentRole =
      roleOrTemplateId === 'custom' ? 'custom' : tpl?.role ?? 'custom';
    const index = workflow.nodes.length;
    const provider = tpl?.defaultProvider ?? 'gemini';
    const providerModels = getEffectiveProviderModels(provider, appSettings.providers[provider]);
    const resolvedModel =
      appSettings.providers[provider]?.defaultModel ||
      tpl?.defaultModel ||
      providerModels[0]?.id ||
      'gemini-4-hydrogen';

    const newNode: WorkflowNode = {
      id: `node-${role}-${Date.now().toString().slice(-5)}`,
      type: 'agentNode',
      position: customPosition ?? {
        x: 100 + (index % 3) * 290,
        y: 90 + Math.floor(index / 3) * 190,
      },
      data: {
        label:
          roleOrTemplateId === 'custom'
            ? `Custom Agent ${index + 1}`
            : `${tpl.title}${workflow.nodes.some((n) => n.data.role === role) ? ` ${index + 1}` : ''}`,
        role,
        section: tpl?.section ?? 'General',
        positionTitle: tpl?.positionTitle ?? (role === 'custom' ? 'Specialist' : tpl?.title),
        responsibility: tpl?.responsibility ?? tpl?.subtitle,
        powerLevel: tpl?.powerLevel ?? 'standard',
        provider,
        model: resolvedModel,
        envSecretRef:
          appSettings.providers[provider]?.envVarName ||
          (provider === 'gemini'
            ? 'GEMINI_API_KEY'
            : provider === 'opencode'
              ? 'OPENCODE_API_KEY'
              : provider === 'openai'
                ? 'OPENAI_API_KEY'
                : provider === 'anthropic'
                  ? 'ANTHROPIC_API_KEY'
                  : 'OLLAMA_BASE_URL'),
        temperature: tpl?.defaultTemperature ?? 0.25,
        systemPrompt: tpl?.systemPrompt ?? 'You are a helpful specialized software engineering agent.',
        tools: {
          readFile: (tpl?.defaultTools.readFile ?? true) && appSettings.allowReadFile,
          writeFile: (tpl?.defaultTools.writeFile ?? true) && appSettings.allowWriteFile,
          execBash: (tpl?.defaultTools.execBash ?? false) && appSettings.allowExecBash,
        },
        status: 'idle',
      },
    };
    setWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    markWorkflowDirty();
    setSelectedNodeId(newNode.id);
    setRightTab('inspector');
  };

  const handleUpdateNode = (nodeId: string, nextData: AgentNodeData) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, data: nextData } : n)),
    }));
    markWorkflowDirty();
  };

  const handleDuplicateNode = (nodeId: string) => {
    const source = workflow.nodes.find((n) => n.id === nodeId);
    if (!source) return;
    const cloned = duplicateWorkflowNode(source, workflow.nodes);
    setWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, cloned],
    }));
    markWorkflowDirty();
    setSelectedNodeId(cloned.id);
    setRightTab('inspector');
  };

  const handleDeleteNode = (nodeId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
    markWorkflowDirty();
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (targetAgentId === nodeId) {
      setTargetAgentId('all');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const nextSettings = deleteAgentTemplate(appSettings, templateId);
    setAppSettings(nextSettings);
    await handleSaveSettings(nextSettings);
  };

  const handleRestoreTemplates = async () => {
    const nextSettings = restoreDefaultAgentTemplates(appSettings);
    setAppSettings(nextSettings);
    await handleSaveSettings(nextSettings);
  };

  const handleBuilderSubmit = async (payload: AgentBuilderSubmitPayload) => {
    if (payload.mode === 'save_template') {
      const tpl = payloadToCustomTemplate(payload, payload.templateId);
      const nextSettings = upsertCustomAgentTemplate(appSettings, tpl);
      setAppSettings(nextSettings);
      await handleSaveSettings(nextSettings);
      showNotice(
        'success',
        lang === 'fa' ? `قالب «${tpl.title}» ذخیره شد.` : `Saved template "${tpl.title}".`,
      );
      return;
    }

    const { nodesToAdd, edgesToAdd } = createAgentNodesBatch({
      count: payload.count,
      baseLabel: payload.label,
      role: payload.role,
      section: payload.section,
      positionTitle: payload.positionTitle,
      responsibility: payload.responsibility,
      powerLevel: payload.powerLevel,
      provider: payload.provider,
      model: payload.model,
      temperature: payload.temperature,
      systemPrompt: payload.systemPrompt,
      tools: payload.tools,
      existingNodes: workflow.nodes,
      existingEdges: workflow.edges,
      appSettings,
      autoConnect: payload.autoConnect,
    });

    setWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...nodesToAdd],
      edges: [...prev.edges, ...edgesToAdd],
    }));
    markWorkflowDirty();

    if (nodesToAdd[0]) {
      setSelectedNodeId(nodesToAdd[0].id);
      setRightTab('inspector');
    }

    if (payload.saveAsTemplate) {
      const tpl = payloadToCustomTemplate(payload);
      const nextSettings = upsertCustomAgentTemplate(appSettings, tpl);
      setAppSettings(nextSettings);
      await handleSaveSettings(nextSettings);
    }

    showNotice(
      'success',
      lang === 'fa'
        ? `${nodesToAdd.length} ایجنت جدید در بخش «${payload.section}» به پروژه اضافه شد.`
        : `Added ${nodesToAdd.length} agent(s) to "${payload.section}".`,
    );
  };

  const handleClearFeed = () => {
    wsRef.current?.close();
    setActiveRunId(null);
    setEvents([]);
    setSandboxFiles([]);
    setPendingApproval(null);
    setActiveNodeId(null);
    setWaitingNodeId(null);
    setValidationError(null);
    setPromptEnhancedNotice(null);
  };

  const handleConvertToPrompt = async () => {
    const clean = taskPrompt.trim();
    if (!clean) return;
    setValidationError(null);
    setPromptEnhancedNotice(null);
    setIsConvertingPrompt(true);
    try {
      const targetNode =
        targetAgentId !== 'all'
          ? workflow.nodes.find((n) => n.id === targetAgentId) ?? null
          : null;
      const res = await fetch('/api/chat/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: clean,
          targetNode,
          language: lang,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setValidationError(err.error ?? 'Failed to convert text to prompt.');
        return;
      }
      const data = (await res.json()) as { enhancedPrompt?: string; source?: string };
      if (data.enhancedPrompt) {
        setTaskPrompt(data.enhancedPrompt);
        setPromptEnhancedNotice(
          lang === 'fa'
            ? 'دستور شما به پرامپت استاندارد و قابل فهم برای ایجنت تبدیل شد.'
            : `Prompt structured for ${targetNode ? targetNode.data.label : 'GroupChat Team'} (${data.source ?? 'ready'}).`,
        );
        setTimeout(() => setPromptEnhancedNotice(null), 4000);
      }
    } catch {
      setValidationError('Network error while converting to prompt.');
    } finally {
      setIsConvertingPrompt(false);
    }
  };

  const handleSendChat = async () => {
    setValidationError(null);
    setPromptEnhancedNotice(null);
    const clean = taskPrompt.trim();
    if (!clean) {
      setValidationError(
        lang === 'fa'
          ? 'لطفاً ابتدا پیام یا دستور خود را بنویسید.'
          : 'Please enter a message or instruction before sending.',
      );
      return;
    }
    if (workflow.nodes.length === 0) {
      setValidationError('Add at least one Agent node to the canvas before chatting.');
      return;
    }

    const isGroupBroadcast = targetAgentId === 'all';
    if (isGroupBroadcast) {
      setPendingApproval(null);
      setIsRunning(true);
    } else {
      setIsSendingChat(true);
    }

    setTaskPrompt('');

    try {
      await handleSaveWorkflow();
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: activeRunId ?? undefined,
          workflowId: workflow.id,
          workflow,
          targetAgentId,
          message: clean,
          mode: executionMode,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        setValidationError(errData.error ?? 'Failed to send message');
        setTaskPrompt(clean);
        setIsRunning(false);
        setIsSendingChat(false);
        return;
      }

      const data = (await res.json()) as {
        runId: string;
        userEvent?: ExecutionEvent;
      };

      if (data.userEvent) {
        setEvents((prev) =>
          prev.some((e) => e.id === data.userEvent!.id)
            ? prev
            : [...prev, data.userEvent!],
        );
      }

      if (data.runId && data.runId !== activeRunId) {
        setActiveRunId(data.runId);
        connectRunStream(data.runId);
      }
    } catch {
      setValidationError('Network error sending chat message.');
      setTaskPrompt(clean);
      setIsRunning(false);
      setIsSendingChat(false);
    }
  };

  const handleUpdateBugStatus = async (id: string, status: BugReportStatus) => {
    const res = await fetch(`/api/bugs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = (await res.json()) as BugReportItem;
      setBugReports((prev) => prev.map((b) => (b.id === id ? updated : b)));
    }
  };

  const handleDeleteBug = async (id: string) => {
    const res = await fetch(`/api/bugs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setBugReports((prev) => prev.filter((b) => b.id !== id));
    }
  };

  const handleAskAgentToFixBug = (bug: BugReportItem) => {
    const matchingNode =
      workflow.nodes.find((n) => n.id === bug.agentId) ??
      workflow.nodes.find((n) => n.data.role === bug.role);
    setTargetAgentId(matchingNode ? matchingNode.id : 'all');
    const fixText =
      lang === 'fa'
        ? `لطفاً مورد زیر را بررسی و برطرف کن:\nعنوان: ${bug.title}\nشرح: ${bug.description}${
            bug.suggestedFix ? `\nراهکار پیشنهادی: ${bug.suggestedFix}` : ''
          }`
        : `Please investigate and fix this ${bug.category}:\nTitle: ${bug.title}\nDetails: ${bug.description}${
            bug.suggestedFix ? `\nSuggested Fix: ${bug.suggestedFix}` : ''
          }`;
    setTaskPrompt(fixText);
    setRightTab('execution');
  };

  const handleStartRun = async () => {
    setValidationError(null);
    setPromptEnhancedNotice(null);
    const effectivePrompt = taskPrompt.trim();
    if (!effectivePrompt) {
      setRightTab('execution');
      setValidationError(
        lang === 'fa'
          ? 'لطفاً ابتدا دستور یا تسک مورد نظر را وارد کنید.'
          : 'Enter a task prompt before starting a workflow run.',
      );
      return;
    }
    if (workflow.nodes.length === 0) {
      setValidationError('Add at least one Agent node to the canvas before running.');
      return;
    }

    setEvents([]);
    setSandboxFiles([]);
    setPendingApproval(null);
    setIsRunning(true);
    setRightTab('execution');

    try {
      // Persist latest canvas configuration before launching run
      await handleSaveWorkflow();
    } catch {
      setValidationError('Failed to save workflow before starting run.');
      setIsRunning(false);
      return;
    }

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: workflow.id,
        workflow,
        taskPrompt: effectivePrompt,
        mode: executionMode,
      }),
    });

    if (!res.ok) {
      const errData = (await res.json()) as { error?: string };
      setValidationError(errData.error ?? 'Failed to start execution');
      setIsRunning(false);
      return;
    }

    const data = (await res.json()) as { runId: string };
    setActiveRunId(data.runId);
    connectRunStream(data.runId);
  };

  const handleRunTestAndDeploy = async () => {
    setValidationError(null);
    setPromptEnhancedNotice(null);
    if (workflow.nodes.length === 0) {
      setValidationError('Add at least one Agent node to the canvas before running Test & Deploy.');
      return;
    }

    setEvents([]);
    setSandboxFiles([]);
    setPendingApproval(null);
    setIsRunning(true);
    setTopView('canvas');
    setRightTab('execution');

    try {
      await handleSaveWorkflow();
    } catch {
      setValidationError('Failed to save workflow before Test & Deploy verification.');
      setIsRunning(false);
      return;
    }

    try {
      const res = await fetch('/api/deploy/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          workflow,
          mode: executionMode,
          language: lang,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        setValidationError(errData.error ?? 'Failed to start Test & Deploy audit');
        setIsRunning(false);
        return;
      }
      const data = (await res.json()) as { runId: string };
      setActiveRunId(data.runId);
      connectRunStream(data.runId);
    } catch {
      setValidationError('Network error starting Test & Deploy audit.');
      setIsRunning(false);
    }
  };

  const handleResolveApproval = async (approvalId: string, approved: boolean) => {
    if (!activeRunId) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'approval_decision',
          approvalId,
          approved,
        }),
      );
    } else {
      await fetch(`/api/runs/${activeRunId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved }),
      });
    }
    setPendingApproval(null);
    setWaitingNodeId(null);
  };

  const handleInspectRun = async (runId: string) => {
    setActiveRunId(runId);
    setTopView('canvas');
    setRightTab('execution');
    const res = await fetch(`/api/runs/${runId}`);
    if (res.ok) {
      const data = (await res.json()) as { events?: ExecutionEvent[] };
      setEvents(data.events ?? []);
    }
    await refreshSandboxFiles(runId);
  };

  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const t = COPY[lang];

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setTopView('canvas');
          }}
          className="whitespace-nowrap shrink-0 font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
        >
          AetherFlow Studio
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setTopView('canvas')}
            className={`whitespace-nowrap shrink-0 border-b-2 py-4 transition-colors ${
              topView === 'canvas'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.navCanvas}
          </button>
          <button
            type="button"
            onClick={() => {
              setTopView('history');
              void loadRunsHistory();
            }}
            className={`whitespace-nowrap shrink-0 border-b-2 py-4 transition-colors ${
              topView === 'history'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.navHistory}
          </button>
          <button
            type="button"
            onClick={() => setTopView('blueprint')}
            className={`whitespace-nowrap shrink-0 border-b-2 py-4 transition-colors ${
              topView === 'blueprint'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.navBlueprint}
          </button>
          <button
            type="button"
            onClick={() => setTopView('settings')}
            className={`whitespace-nowrap shrink-0 border-b-2 py-4 transition-colors ${
              topView === 'settings'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.navSettings}
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleSaveWorkflow}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            {saveSuccess ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saveSuccess ? t.savedBtn : t.saveBtn}
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {topView === 'canvas' && (
          <>
            {/* Workspace Toolbar */}
            <div
              dir={lang === 'fa' ? 'rtl' : 'ltr'}
              className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-2.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="workflow-selector" className="sr-only">
                  Active Workflow
                </label>
                <select
                  id="workflow-selector"
                  value={workflow.id}
                  onChange={(e) => {
                    const found = workflows.find((w) => w.id === e.target.value);
                    if (found) {
                      hasSharedWorkflowRef.current = false;
                      setWorkflow(found);
                      setSelectedNodeId(found.nodes[0]?.id ?? null);
                    }
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                  {!workflows.some((w) => w.id === workflow.id) && (
                    <option value={workflow.id}>{workflow.name}</option>
                  )}
                </select>

                <button
                  type="button"
                  data-testid="toolbar-create-workflow-btn"
                  onClick={handleCreateWorkflow}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.newBtn}
                </button>

                <button
                  type="button"
                  data-testid="toolbar-edit-workflow-btn"
                  onClick={() => {
                    void flushWorkflowSave();
                    setIsProjectManagerOpen(true);
                  }}
                  title={lang === 'fa' ? 'مدیریت، ویرایش و حذف پروژه‌ها' : 'Manage, Edit & Delete Projects'}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Pencil className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  {t.manageProjects}
                </button>

                <button
                  type="button"
                  data-testid="toolbar-delete-workflow-btn"
                  onClick={() => void handleDeleteWorkflow(workflow.id)}
                  title={lang === 'fa' ? 'حذف پروژه فعلی' : 'Delete Active Project'}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.deleteProject}
                </button>

                <button
                  type="button"
                  data-testid="export-json-btn"
                  onClick={handleExportJson}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t.exportJson}
                </button>

                <button
                  type="button"
                  data-testid="share-link-btn"
                  onClick={() => void handleCopyShareLink()}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {shareCopied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {shareCopied ? t.linkCopied : t.shareLink}
                </button>

                <button
                  type="button"
                  data-testid="import-json-btn"
                  onClick={() => importFileRef.current?.click()}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t.importJson}
                </button>
                <input
                  ref={importFileRef}
                  data-testid="import-json-input"
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => void handleImportJsonFile(e)}
                  className="sr-only"
                  aria-label="Import workflow JSON file"
                />

                <button
                  type="button"
                  data-testid="open-project-import-btn"
                  onClick={() => setIsProjectModalOpen(true)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100/80 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
                >
                  <FolderGit2 className="h-3.5 w-3.5" />
                  {t.importProject}
                </button>

                <button
                  type="button"
                  data-testid="toolbar-download-zip-btn"
                  disabled={isDownloadingZip}
                  onClick={() => void handleDownloadZip('project_bundle')}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Archive className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  {t.saveZip}
                </button>

                <button
                  type="button"
                  data-testid="toolbar-github-push-btn"
                  onClick={() =>
                    setGitHubPushModal({ open: true, initialScope: 'project_bundle' })
                  }
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  {t.pushGitHub}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <span>{t.maxRounds}</span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={workflow.maxRounds}
                    onChange={(e) => {
                      setWorkflow((prev) => ({
                        ...prev,
                        maxRounds: clampMaxRounds(Number(e.target.value)),
                      }));
                      markWorkflowDirty();
                    }}
                    className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-center font-mono tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={workflow.humanInTheLoop}
                    onChange={(e) => {
                      setWorkflow((prev) => ({
                        ...prev,
                        humanInTheLoop: e.target.checked,
                      }));
                      markWorkflowDirty();
                    }}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  <span>{t.hitlLabel}</span>
                </label>

                <button
                  type="button"
                  data-testid="toolbar-continuous-toggle-btn"
                  disabled={continuousBusy}
                  onClick={() => void handleToggleContinuousWork()}
                  title={
                    lang === 'fa'
                      ? 'فعال/غیرفعال کردن کار مداوم و پیوسته ایجنت‌ها روی پروژه'
                      : 'Toggle 24/7 Continuous Autonomous Agent Work'
                  }
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    continuousSession?.active || workflow.continuousAgentWork
                      ? 'border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      continuousSession?.active || workflow.continuousAgentWork
                        ? 'animate-spin text-blue-600 dark:text-blue-400'
                        : ''
                    }`}
                  />
                  <span>
                    {lang === 'fa'
                      ? continuousSession?.active || workflow.continuousAgentWork
                        ? `کار مداوم فعال (${continuousSession?.cyclesCompleted ?? 0})`
                        : 'کار مداوم پروژه'
                      : continuousSession?.active || workflow.continuousAgentWork
                        ? `24/7 Work Active (${continuousSession?.cyclesCompleted ?? 0})`
                        : '24/7 Agent Work'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setLang((prev) => (prev === 'en' ? 'fa' : 'en'))}
                  aria-label="Toggle Interface Language"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Languages className="h-3.5 w-3.5" />
                  {lang === 'en' ? 'FA' : 'EN'}
                </button>

                <button
                  type="button"
                  onClick={() => setDarkMode((prev) => !prev)}
                  aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {workflowNotice && (
              <div
                role="status"
                data-testid="workflow-notice"
                dir={lang === 'fa' ? 'rtl' : 'ltr'}
                className={`flex items-center justify-between border-b px-5 py-1.5 text-xs font-medium ${
                  workflowNotice.type === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                }`}
              >
                <span>{workflowNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setWorkflowNotice(null)}
                  className="ml-4 text-[11px] underline opacity-80 hover:opacity-100"
                >
                  {lang === 'fa' ? 'بستن' : 'Dismiss'}
                </button>
              </div>
            )}

            {/* 3-Column Studio Workspace */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left Sidebar: Agent Role Templates */}
              <aside
                dir={lang === 'fa' ? 'rtl' : 'ltr'}
                className="hidden w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex"
              >
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div>
                    <h2 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {t.templatesTitle}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {t.templatesHint}
                    </p>
                  </div>
                  {(appSettings.hiddenTemplateIds?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleRestoreTemplates()}
                      title={lang === 'fa' ? 'بازیابی قالب‌های پیش‌فرض' : 'Restore default templates'}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      {lang === 'fa' ? 'بازیابی' : 'Reset'}
                    </button>
                  )}
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  <button
                    type="button"
                    data-testid="open-agent-builder-btn"
                    onClick={() =>
                      setBuilderModal({ open: true, mode: 'add_agents', template: null })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {lang === 'fa'
                        ? 'افزودن / ساخت ایجنت دلخواه'
                        : 'Build / Add Custom Agents'}
                    </span>
                  </button>

                  {effectiveTemplates.map((tpl) => (
                    <div
                      key={tpl.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/aetherflow-role', tpl.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="group rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-blue-500 dark:hover:bg-slate-800/80"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAddTemplateNode(tpl.id)}
                          className="min-w-0 flex-1 text-start"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {tpl.title}
                            </span>
                            <span className="shrink-0 rounded bg-slate-200/80 px-1 py-0.2 text-[9px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {POWER_LEVEL_META[tpl.powerLevel].short}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            {tpl.section} · {tpl.positionTitle}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                            {tpl.subtitle}
                          </p>
                          <div className="mt-1.5 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            {tpl.defaultProvider} · {tpl.defaultModel}
                          </div>
                        </button>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => handleAddTemplateNode(tpl.id)}
                            aria-label={`Add ${tpl.title}`}
                            title="Add to canvas"
                            className="rounded p-1 text-slate-500 hover:bg-white hover:text-blue-600 dark:hover:bg-slate-900"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setBuilderModal({
                                open: true,
                                mode: 'edit_template',
                                template: tpl,
                              })
                            }
                            aria-label={`Edit template ${tpl.title}`}
                            title="Edit template"
                            className="rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600 dark:hover:bg-slate-900"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTemplate(tpl.id)}
                            aria-label={`Delete template ${tpl.title}`}
                            title="Delete template"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {workflow.projectContext && (
                    <button
                      type="button"
                      onClick={() => setIsProjectModalOpen(true)}
                      className="mb-2.5 flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-start text-[11px] font-medium text-slate-700 transition-colors hover:border-blue-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span className="truncate">{workflow.projectContext.name}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400">
                        {lang === 'fa' ? 'آنالیز' : 'Inspect'}
                      </span>
                    </button>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Nodes</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {workflow.nodes.length}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Connections</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {workflow.edges.length}
                    </span>
                  </div>
                </div>
              </aside>

              {/* Center: React Flow Graph Canvas */}
              <div className="min-w-0 flex-1">
                <ReactFlowProvider>
                  <WorkflowCanvas
                    nodes={workflow.nodes}
                    edges={workflow.edges}
                    activeNodeId={activeNodeId}
                    waitingNodeId={waitingNodeId}
                    selectedNodeId={selectedNodeId}
                    showMiniMap={appSettings.showMiniMap}
                    gridVariant={appSettings.canvasGridVariant}
                    onNodesChange={(changes: NodeChange<Node<AgentNodeData>>[]) => {
                      const removedIds = new Set(
                        changes.filter((c) => c.type === 'remove').map((c) => c.id),
                      );
                      setWorkflow((prev) => {
                        const updated = applyNodeChanges(
                          changes,
                          prev.nodes as unknown as Node<AgentNodeData>[],
                        );
                        const validIds = new Set(updated.map((n) => n.id));
                        return {
                          ...prev,
                          nodes: updated.map((node) => ({
                            id: node.id,
                            type: 'agentNode',
                            position: node.position,
                            measured: node.measured,
                            data: {
                              ...node.data,
                              status: 'idle',
                            },
                          })),
                          edges:
                            removedIds.size > 0
                              ? prev.edges.filter(
                                  (e) => validIds.has(e.source) && validIds.has(e.target),
                                )
                              : prev.edges,
                        };
                      });
                      if (
                        workflowsHydratedRef.current &&
                        changes.some(
                          (c) =>
                            c.type === 'add' ||
                            c.type === 'remove' ||
                            c.type === 'replace' ||
                            (c.type === 'position' && c.dragging === false),
                        )
                      ) {
                        markWorkflowDirty();
                      }
                      if (selectedNodeId && removedIds.has(selectedNodeId)) {
                        setSelectedNodeId(null);
                      }
                    }}
                    onEdgesChange={(changes: EdgeChange<Edge>[]) => {
                      setWorkflow((prev) => {
                        const updated = applyEdgeChanges(
                          changes,
                          prev.edges as unknown as Edge[],
                        );
                        return {
                          ...prev,
                          edges: updated.map((e) => ({
                            id: e.id,
                            source: e.source,
                            target: e.target,
                            label: typeof e.label === 'string' ? e.label : undefined,
                            animated: Boolean(e.animated),
                          })),
                        };
                      });
                      if (
                        workflowsHydratedRef.current &&
                        changes.some((c) => c.type !== 'select')
                      ) {
                        markWorkflowDirty();
                      }
                    }}
                    onConnect={(connection: Connection) => {
                      setWorkflow((prev) => {
                        const updated = addEdge(
                          {
                            ...connection,
                            id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
                            label: 'Handoff',
                          },
                          prev.edges as unknown as Edge[],
                        );
                        return {
                          ...prev,
                          edges: updated.map((e) => ({
                            id: e.id,
                            source: e.source,
                            target: e.target,
                            label: typeof e.label === 'string' ? e.label : undefined,
                            animated: Boolean(e.animated),
                          })),
                        };
                      });
                      markWorkflowDirty();
                    }}
                    onSelectNode={(id) => {
                      setSelectedNodeId(id);
                      if (id) setRightTab('inspector');
                    }}
                    onEditNode={(id) => {
                      setSelectedNodeId(id);
                      setRightTab('inspector');
                    }}
                    onDuplicateNode={handleDuplicateNode}
                    onDeleteNode={handleDeleteNode}
                    onDropTemplate={(roleOrTpl, position) =>
                      handleAddTemplateNode(roleOrTpl, position)
                    }
                  />
                </ReactFlowProvider>
              </div>

              {/* Right Panel: Inspector & Live GroupChat Execution */}
              <aside className="flex w-[390px] shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:w-[430px]">
                <div className="grid grid-cols-2 border-b border-slate-200 p-1.5 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setRightTab('inspector')}
                    className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                      rightTab === 'inspector'
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {t.tabInspector}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('execution')}
                    className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                      rightTab === 'execution'
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {t.tabExecution}
                  </button>
                </div>

                <div className="min-h-0 flex-1">
                  {rightTab === 'inspector' ? (
                    <AgentInspector
                      node={selectedNode}
                      lang={lang}
                      appSettings={appSettings}
                      capabilities={capabilities}
                      onCapabilitiesUpdated={setCapabilities}
                      onOpenSettings={() => setTopView('settings')}
                      onUpdateNode={handleUpdateNode}
                      onDuplicateNode={handleDuplicateNode}
                      onDeleteNode={handleDeleteNode}
                    />
                  ) : (
                    <ExecutionConsole
                      nodes={workflow.nodes}
                      lang={lang}
                      targetAgentId={targetAgentId}
                      onTargetAgentChange={setTargetAgentId}
                      chatInput={taskPrompt}
                      onChatInputChange={setTaskPrompt}
                      onSendChat={() => void handleSendChat()}
                      onConvertToPrompt={handleConvertToPrompt}
                      onStartRun={handleStartRun}
                      onRunTestAndDeploy={() => void handleRunTestAndDeploy()}
                      onClearFeed={handleClearFeed}
                      isRunning={isRunning}
                      isSendingChat={isSendingChat}
                      isConvertingPrompt={isConvertingPrompt}
                      promptEnhancedNotice={promptEnhancedNotice}
                      validationError={validationError}
                      events={events}
                      sandboxFiles={sandboxFiles}
                      bugReports={bugReports}
                      onUpdateBugStatus={handleUpdateBugStatus}
                      onDeleteBug={handleDeleteBug}
                      onAskAgentToFixBug={handleAskAgentToFixBug}
                      pendingApproval={pendingApproval}
                      onResolveApproval={handleResolveApproval}
                      executionMode={executionMode}
                      onExecutionModeChange={setExecutionMode}
                      geminiConfigured={Boolean(
                        capabilities.geminiConfigured ||
                          capabilities.openaiConfigured ||
                          capabilities.anthropicConfigured,
                      )}
                      onDownloadZip={() => void handleDownloadZip('project_bundle')}
                      onOpenGitHubPush={() =>
                        setGitHubPushModal({ open: true, initialScope: 'project_bundle' })
                      }
                      continuousActive={Boolean(continuousSession?.active || workflow.continuousAgentWork)}
                      continuousSession={continuousSession}
                      continuousBusy={continuousBusy}
                      onToggleContinuous={() => void handleToggleContinuousWork()}
                    />
                  )}
                </div>
              </aside>
            </div>
          </>
        )}

        {topView === 'history' && (
          <RunHistoryView
            runs={runsHistory}
            loading={runsLoading}
            onRefresh={() => void loadRunsHistory()}
            onInspectRun={(id) => void handleInspectRun(id)}
          />
        )}

        {topView === 'blueprint' && (
          <BlueprintView
            lang={lang}
            workflow={workflow}
            activeRunId={activeRunId}
            prelaunchReport={prelaunchReport}
            onPrelaunchReportChange={setPrelaunchReport}
            strictPrelaunchMode={workflow.strictPrelaunchGate ?? true}
            onStrictPrelaunchModeChange={(strict) => {
              setWorkflow((prev) => ({ ...prev, strictPrelaunchGate: strict }));
              markWorkflowDirty();
            }}
            onFixPrelaunchIssues={(prompt) => {
              setValidationError(null);
              setTargetAgentId('all');
              setTaskPrompt(prompt);
              setTopView('canvas');
              setRightTab('execution');
            }}
            defaultRepoUrl={
              workflow.projectContext?.sourceType === 'github'
                ? workflow.projectContext.sourceUrl
                : undefined
            }
            defaultBranch={
              workflow.projectContext?.sourceType === 'github'
                ? workflow.projectContext.branch
                : undefined
            }
            onRunDeployAudit={() => void handleRunTestAndDeploy()}
            onDownloadZip={() => void handleDownloadZip('full_studio')}
            downloadingZip={isDownloadingZip}
            onOpenGitHubPush={() =>
              setGitHubPushModal({ open: true, initialScope: 'full_studio' })
            }
          />
        )}

        {topView === 'settings' && (
          <SettingsView
            settings={appSettings}
            capabilities={capabilities}
            onCapabilitiesUpdated={setCapabilities}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>

      <ProjectImportModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        lang={lang}
        executionMode={executionMode}
        appSettings={appSettings}
        projects={importedProjects}
        activeProjectId={workflow.projectContext?.projectId}
        onProjectImported={(proj) => {
          setImportedProjects((prev) => [proj, ...prev.filter((p) => p.id !== proj.id)]);
        }}
        onDeleteProject={handleDeleteImportedProject}
        onApplyRecommendations={handleApplyProjectRecommendations}
      />

      <AgentBuilderModal
        isOpen={builderModal.open}
        mode={builderModal.mode}
        initialTemplate={builderModal.template}
        lang={lang}
        appSettings={appSettings}
        onClose={() => setBuilderModal({ open: false, mode: 'add_agents', template: null })}
        onSubmit={handleBuilderSubmit}
      />

      <GitHubPushModal
        isOpen={gitHubPushModal.open}
        initialScope={gitHubPushModal.initialScope}
        lang={lang}
        workflow={workflow}
        activeRunId={activeRunId}
        capabilities={capabilities}
        onCapabilitiesUpdated={setCapabilities}
        onClose={() => setGitHubPushModal((prev) => ({ ...prev, open: false }))}
        onDownloadZip={handleDownloadZip}
      />

      <ProjectManagerModal
        isOpen={isProjectManagerOpen}
        lang={lang}
        workflows={workflows}
        activeWorkflow={workflow}
        importedProjects={importedProjects}
        onClose={() => setIsProjectManagerOpen(false)}
        onSelectWorkflow={(wf) => {
          hasSharedWorkflowRef.current = false;
          setWorkflow(wf);
          setSelectedNodeId(wf.nodes[0]?.id ?? null);
        }}
        onSaveWorkflow={handleSaveSpecificWorkflow}
        onDuplicateWorkflow={handleDuplicateWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
        onCreateNewWorkflow={handleCreateWorkflow}
        onUpdateImportedProject={handleUpdateImportedProject}
        onDeleteImportedProject={handleDeleteImportedProject}
        onOpenImportModal={() => setIsProjectModalOpen(true)}
      />
    </div>
  );
}
