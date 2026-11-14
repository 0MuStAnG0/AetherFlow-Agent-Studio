import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Check,
  Download,
  FolderGit2,
  Languages,
  Link2,
  Moon,
  Plus,
  Save,
  Sun,
  Upload,
} from 'lucide-react';
import { AGENT_ROLE_TEMPLATES, DEFAULT_SEED_WORKFLOWS } from './data/agentTemplates';
import type {
  AgentNodeData,
  AgentRole,
  AppSettings,
  BugReportItem,
  BugReportStatus,
  ExecutionEvent,
  ExecutionRunSummary,
  ImportedProjectAnalysis,
  RecommendedAgentSpec,
  SandboxFile,
  WorkflowConfig,
  WorkflowEdge,
  WorkflowNode,
} from './types/workflow';
import { buildWorkflowFromRecommendations } from './utils/projectAnalyzer';
import {
  DEFAULT_APP_SETTINGS,
  buildWorkflowShareUrl,
  clampMaxRounds,
  decodeWorkflowFromShareParam,
  parseImportedWorkflowJson,
  serializeWorkflowForExport,
} from './utils/workflowEngine';
import { AgentInspector } from './components/AgentInspector';
import { BlueprintView } from './components/BlueprintView';
import { ExecutionConsole } from './components/ExecutionConsole';
import { ProjectImportModal } from './components/ProjectImportModal';
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
    exportJson: 'Export JSON',
    importJson: 'Import JSON',
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
    exportJson: 'خروجی JSON',
    importJson: 'ورود JSON',
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

  const [capabilities, setCapabilities] = useState({
    geminiConfigured: false,
    openaiConfigured: false,
    anthropicConfigured: false,
    opencodeConfigured: false,
  });
  const [executionMode, setExecutionMode] = useState<'live' | 'dry_run'>('dry_run');
  const [taskPrompt, setTaskPrompt] = useState(
    'Design a rate-limited FastAPI health endpoint with input validation, unit tests, and Docker verification.',
  );
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
  const [shareCopied, setShareCopied] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const hasSharedWorkflowRef = useRef(false);

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
      if (list.length > 0) {
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
        const cap = capData as {
          geminiConfigured?: boolean;
          openaiConfigured?: boolean;
          anthropicConfigured?: boolean;
          opencodeConfigured?: boolean;
        };
        const configured = Boolean(cap.geminiConfigured);
        setCapabilities({
          geminiConfigured: configured,
          openaiConfigured: Boolean(cap.openaiConfigured),
          anthropicConfigured: Boolean(cap.anthropicConfigured),
          opencodeConfigured: Boolean(cap.opencodeConfigured),
        });
        if (settingsData && settingsData.providers) {
          const loaded = settingsData as AppSettings;
          setAppSettings(loaded);
          setLang(loaded.language);
          setDarkMode(loaded.darkMode);
          setExecutionMode(
            loaded.defaultExecutionMode === 'dry_run' || !configured ? 'dry_run' : 'live',
          );
        } else {
          setExecutionMode(configured ? 'live' : 'dry_run');
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

  const handleSaveWorkflow = async () => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    });
    if (res.ok) {
      const saved = (await res.json()) as WorkflowConfig;
      setWorkflow(saved);
      setWorkflows((prev) => {
        const exists = prev.some((w) => w.id === saved.id);
        return exists ? prev.map((w) => (w.id === saved.id ? saved : w)) : [saved, ...prev];
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 1800);
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
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

  const handleDeleteImportedProject = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (res.ok) {
      setImportedProjects((prev) => prev.filter((p) => p.id !== projectId));
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

  const handleAddTemplateNode = (role: AgentRole, customPosition?: { x: number; y: number }) => {
    const tpl =
      AGENT_ROLE_TEMPLATES.find((t) => t.role === role) ?? AGENT_ROLE_TEMPLATES[1];
    const index = workflow.nodes.length;
    const newNode: WorkflowNode = {
      id: `node-${role}-${Date.now().toString().slice(-5)}`,
      type: 'agentNode',
      position: customPosition ?? {
        x: 100 + (index % 3) * 290,
        y: 90 + Math.floor(index / 3) * 190,
      },
      data: {
        label:
          role === 'custom'
            ? `Custom Agent ${index + 1}`
            : `${tpl.title}${workflow.nodes.some((n) => n.data.role === role) ? ` ${index + 1}` : ''}`,
        role,
        provider: tpl.defaultProvider,
        model: appSettings.providers[tpl.defaultProvider]?.defaultModel || tpl.defaultModel,
        envSecretRef:
          appSettings.providers[tpl.defaultProvider]?.envVarName ||
          (tpl.defaultProvider === 'gemini'
            ? 'GEMINI_API_KEY'
            : tpl.defaultProvider === 'opencode'
              ? 'OPENCODE_API_KEY'
              : tpl.defaultProvider === 'openai'
                ? 'OPENAI_API_KEY'
                : tpl.defaultProvider === 'anthropic'
                  ? 'ANTHROPIC_API_KEY'
                  : 'OLLAMA_BASE_URL'),
        temperature: tpl.defaultTemperature,
        systemPrompt: tpl.systemPrompt,
        tools: {
          readFile: tpl.defaultTools.readFile && appSettings.allowReadFile,
          writeFile: tpl.defaultTools.writeFile && appSettings.allowWriteFile,
          execBash: tpl.defaultTools.execBash && appSettings.allowExecBash,
        },
        status: 'idle',
      },
    };
    setWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    setSelectedNodeId(newNode.id);
    setRightTab('inspector');
  };

  const handleUpdateNode = (nodeId: string, nextData: AgentNodeData) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, data: nextData } : n)),
    }));
  };

  const handleDeleteNode = (nodeId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (targetAgentId === nodeId) {
      setTargetAgentId('all');
    }
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
    const effectivePrompt =
      taskPrompt.trim() ||
      'Design a rate-limited FastAPI health endpoint with input validation, unit tests, and Docker verification.';
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
                  onClick={handleCreateWorkflow}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.newBtn}
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
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <span>{t.maxRounds}</span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={workflow.maxRounds}
                    onChange={(e) =>
                      setWorkflow((prev) => ({
                        ...prev,
                        maxRounds: clampMaxRounds(Number(e.target.value)),
                      }))
                    }
                    className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-center font-mono tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={workflow.humanInTheLoop}
                    onChange={(e) =>
                      setWorkflow((prev) => ({
                        ...prev,
                        humanInTheLoop: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  <span>{t.hitlLabel}</span>
                </label>

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
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <h2 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t.templatesTitle}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {t.templatesHint}
                  </p>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {AGENT_ROLE_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.role}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/aetherflow-role', tpl.role);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => handleAddTemplateNode(tpl.role)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-blue-500 dark:hover:bg-slate-800/80"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {tpl.title}
                        </span>
                        <Plus className="h-3.5 w-3.5 text-slate-400" />
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                        {tpl.subtitle}
                      </p>
                      <div className="mt-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {tpl.defaultProvider} · {tpl.defaultModel}
                      </div>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleAddTemplateNode('custom')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-500 hover:text-blue-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-blue-400"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Custom Agent Node
                  </button>
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
                    onNodesChange={(nodes: WorkflowNode[]) =>
                      setWorkflow((prev) => ({ ...prev, nodes }))
                    }
                    onEdgesChange={(edges: WorkflowEdge[]) =>
                      setWorkflow((prev) => ({ ...prev, edges }))
                    }
                    onSelectNode={(id) => {
                      setSelectedNodeId(id);
                      if (id) setRightTab('inspector');
                    }}
                    onDropTemplate={(role, position) => handleAddTemplateNode(role, position)}
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
                      appSettings={appSettings}
                      onUpdateNode={handleUpdateNode}
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
                      geminiConfigured={capabilities.geminiConfigured}
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
          <BlueprintView lang={lang} onRunDeployAudit={() => void handleRunTestAndDeploy()} />
        )}

        {topView === 'settings' && (
          <SettingsView
            settings={appSettings}
            capabilities={capabilities}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>

      <ProjectImportModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        lang={lang}
        executionMode={executionMode}
        projects={importedProjects}
        activeProjectId={workflow.projectContext?.projectId}
        onProjectImported={(proj) => {
          setImportedProjects((prev) => [proj, ...prev.filter((p) => p.id !== proj.id)]);
        }}
        onDeleteProject={handleDeleteImportedProject}
        onApplyRecommendations={handleApplyProjectRecommendations}
      />
    </div>
  );
}
