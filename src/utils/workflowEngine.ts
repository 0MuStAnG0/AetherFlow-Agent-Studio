import type {
  AgentNodeData,
  AgentRole,
  AppSettings,
  BugReportCategory,
  BugReportItem,
  BugReportSeverity,
  EdgeConditionType,
  ManagerDelegation,
  SandboxFile,
  TokenUsage,
  ToolCallLog,
  WorkflowConfig,
  WorkflowEdge,
  WorkflowNode,
} from '../types/workflow';

const SENSITIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*|--recursive|--force)/i, reason: 'Recursive or forced file deletion' },
  { pattern: /\bsudo\b/i, reason: 'Elevated root privilege escalation' },
  { pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)/i, reason: 'Remote script piped directly to shell' },
  { pattern: /\b(chmod|chown)\b/i, reason: 'Filesystem permission or ownership modification' },
  { pattern: /\b(docker|systemctl|service|kill|pkill|reboot|shutdown)\b/i, reason: 'System daemon or container control operation' },
  { pattern: /\b(pip|pip3|npm|apt|apt-get|apk)\s+install\b/i, reason: 'External package installation inside environment' },
  { pattern: /\b(psql|mysql|sqlite3|drop\s+table|delete\s+from|truncate)\b/i, reason: 'Direct database mutation or schema command' },
  { pattern: />|>>/, reason: 'Shell output redirection writing directly to filesystem' },
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultMaxRounds: 6,
  defaultExecutionMode: 'live',
  globalHumanInTheLoop: true,
  customSensitivePatterns: ['terraform destroy', 'kubectl delete'],
  allowReadFile: true,
  allowWriteFile: true,
  allowExecBash: true,
  sandboxTimeoutSec: 20,
  sandboxMemoryMb: 512,
  tokenOptimizationMode: 'ultra_compact',
  language: 'en',
  darkMode: false,
  showMiniMap: true,
  canvasGridVariant: 'dots',
  providers: {
    gemini: {
      defaultModel: 'gemini-4-hydrogen',
      baseUrl: 'https://generativelanguage.googleapis.com',
      envVarName: 'GEMINI_API_KEY',
      customModels: [],
    },
    openai: {
      defaultModel: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      envVarName: 'OPENAI_API_KEY',
      customModels: [],
    },
    anthropic: {
      defaultModel: 'claude-3-7-sonnet-latest',
      baseUrl: 'https://api.anthropic.com',
      envVarName: 'ANTHROPIC_API_KEY',
      customModels: [],
    },
    ollama: {
      defaultModel: 'ollama/qwen2.5-coder:32b',
      baseUrl: 'http://host.docker.internal:11434',
      envVarName: 'OLLAMA_BASE_URL',
      customModels: [],
    },
    opencode: {
      defaultModel: 'big-pickle',
      baseUrl: 'https://opencode.ai/zen/v1',
      envVarName: 'OPENCODE_API_KEY',
      customModels: [],
    },
  },
  updatedAt: '2026-11-14T08:00:00.000Z',
};

function normalizeProviderConfig(
  baseCfg: AppSettings['providers']['gemini'],
  rawCfg?: Partial<AppSettings['providers']['gemini']>,
  forceEnvVar?: string,
) {
  const disabledModels = Array.isArray(rawCfg?.disabledModels)
    ? Array.from(new Set(rawCfg.disabledModels.map((m) => String(m).trim()).filter(Boolean)))
    : [];
  const rawMeta = rawCfg?.modelMeta && typeof rawCfg.modelMeta === 'object' ? rawCfg.modelMeta : {};
  const modelMeta: NonNullable<AppSettings['providers']['gemini']['modelMeta']> = {};
  for (const [k, v] of Object.entries(rawMeta)) {
    if (v && typeof v === 'object') {
      const power =
        v.power === 'eco' || v.power === 'standard' || v.power === 'pro' || v.power === 'ultra'
          ? v.power
          : undefined;
      const displayName =
        typeof v.displayName === 'string' && v.displayName.trim() ? v.displayName.trim() : undefined;
      if (power || displayName) {
        modelMeta[k] = { ...(displayName ? { displayName } : {}), ...(power ? { power } : {}) };
      }
    }
  }
  return {
    ...baseCfg,
    ...(rawCfg ?? {}),
    ...(forceEnvVar ? { envVarName: forceEnvVar } : {}),
    customModels: Array.isArray(rawCfg?.customModels)
      ? Array.from(new Set(rawCfg.customModels.map((m) => String(m).trim()).filter(Boolean)))
      : [],
    disabledModels,
    modelMeta,
  };
}

export function normalizeAppSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const base = DEFAULT_APP_SETTINGS;
  const raw = input ?? {};
  const timeout = Number(raw.sandboxTimeoutSec);
  const clampedTimeout = Number.isFinite(timeout) ? Math.max(5, Math.min(60, Math.round(timeout))) : base.sandboxTimeoutSec;
  const memory = raw.sandboxMemoryMb === 256 || raw.sandboxMemoryMb === 512 || raw.sandboxMemoryMb === 1024
    ? raw.sandboxMemoryMb
    : base.sandboxMemoryMb;

  return {
    defaultMaxRounds: clampMaxRounds(raw.defaultMaxRounds ?? base.defaultMaxRounds),
    defaultExecutionMode: raw.defaultExecutionMode === 'dry_run' ? 'dry_run' : 'live',
    globalHumanInTheLoop: raw.globalHumanInTheLoop ?? base.globalHumanInTheLoop,
    customSensitivePatterns: Array.isArray(raw.customSensitivePatterns)
      ? raw.customSensitivePatterns.map((p) => String(p).trim()).filter(Boolean)
      : [...base.customSensitivePatterns],
    allowReadFile: raw.allowReadFile ?? base.allowReadFile,
    allowWriteFile: raw.allowWriteFile ?? base.allowWriteFile,
    allowExecBash: raw.allowExecBash ?? base.allowExecBash,
    sandboxTimeoutSec: clampedTimeout,
    sandboxMemoryMb: memory,
    tokenOptimizationMode:
      raw.tokenOptimizationMode === 'off' || raw.tokenOptimizationMode === 'balanced'
        ? raw.tokenOptimizationMode
        : 'ultra_compact',
    language: raw.language === 'fa' ? 'fa' : 'en',
    darkMode: Boolean(raw.darkMode),
    showMiniMap: raw.showMiniMap ?? base.showMiniMap,
    canvasGridVariant:
      raw.canvasGridVariant === 'lines' || raw.canvasGridVariant === 'cross'
        ? raw.canvasGridVariant
        : 'dots',
    providers: {
      gemini: normalizeProviderConfig(base.providers.gemini, raw.providers?.gemini, 'GEMINI_API_KEY'),
      openai: normalizeProviderConfig(base.providers.openai, raw.providers?.openai),
      anthropic: normalizeProviderConfig(base.providers.anthropic, raw.providers?.anthropic),
      ollama: normalizeProviderConfig(base.providers.ollama, raw.providers?.ollama),
      opencode: normalizeProviderConfig(base.providers.opencode, raw.providers?.opencode),
    },
    customTemplates: Array.isArray(raw.customTemplates) ? raw.customTemplates : [],
    hiddenTemplateIds: Array.isArray(raw.hiddenTemplateIds)
      ? Array.from(new Set(raw.hiddenTemplateIds.map((id) => String(id).trim()).filter(Boolean)))
      : [],
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export interface OpenCodeModelEntry {
  id: string;
  name?: string;
  cost?: {
    text?: {
      input?: { price?: number };
      output?: { price?: number };
    };
  };
}

export function extractFreeOpenCodeModels(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const freeIds: string[] = [];

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as OpenCodeModelEntry;
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue;
    const id = entry.id.trim();
    const inPrice = entry.cost?.text?.input?.price;
    const outPrice = entry.cost?.text?.output?.price;
    const isZeroCost = inPrice === 0 && outPrice === 0;
    const isFreeNamed = id.endsWith('-free') || id === 'big-pickle';

    if ((isZeroCost || (inPrice === undefined && isFreeNamed)) && !seen.has(id)) {
      seen.add(id);
      freeIds.push(id);
    }
  }

  return freeIds;
}

export function detectSensitiveCommand(
  command: string,
  customPatterns: string[] = [],
): { sensitive: boolean; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { sensitive: false, reason: '' };
  }
  for (const rule of SENSITIVE_COMMAND_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      return { sensitive: true, reason: rule.reason };
    }
  }
  const lower = trimmed.toLowerCase();
  for (const rawPattern of customPatterns) {
    const clean = rawPattern.trim().toLowerCase();
    if (clean && lower.includes(clean)) {
      return {
        sensitive: true,
        reason: `Matched custom policy pattern: "${rawPattern.trim()}"`,
      };
    }
  }
  return { sensitive: false, reason: '' };
}

export function clampMaxRounds(rounds: number): number {
  if (!Number.isFinite(rounds)) return 6;
  return Math.max(1, Math.min(25, Math.round(rounds)));
}

export function clampContinuousIntervalSec(seconds: number): number {
  if (!Number.isFinite(seconds)) return 30;
  return Math.max(5, Math.min(3600, Math.round(seconds)));
}

export function syncWorkflowInList(
  workflows: WorkflowConfig[],
  updated: WorkflowConfig,
): WorkflowConfig[] {
  const exists = workflows.some((w) => w.id === updated.id);
  if (!exists) return [updated, ...workflows];
  return workflows.map((w) => (w.id === updated.id ? updated : w));
}

export function clampTemperature(temp: number): number {
  if (!Number.isFinite(temp)) return 0.3;
  return Math.round(Math.max(0, Math.min(1, temp)) * 100) / 100;
}

export function computeExecutionOrder(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target) && edge.source !== edge.target) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue: WorkflowNode[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => {
      if (isManagerNode(a) && !isManagerNode(b)) return -1;
      if (isManagerNode(b) && !isManagerNode(a)) return 1;
      return a.position.x - b.position.x;
    });

  const visited = new Set<string>();
  const ordered: WorkflowNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    ordered.push(current);

    for (const neighborId of adjacency.get(current.id) ?? []) {
      const nextDegree = (inDegree.get(neighborId) ?? 1) - 1;
      inDegree.set(neighborId, nextDegree);
      if (nextDegree <= 0 && !visited.has(neighborId)) {
        const neighbor = nodeMap.get(neighborId);
        if (neighbor) queue.push(neighbor);
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      ordered.push(node);
    }
  }

  return ordered;
}

export function evaluateEdgeCondition(
  edge: WorkflowEdge,
  context: {
    lastTurnHadError?: boolean;
    lastReply?: string;
  } = {},
): boolean {
  const cond = edge.conditionType ?? 'always';
  if (cond === 'always') return true;
  if (cond === 'on_success') return !context.lastTurnHadError;
  if (cond === 'on_failure') return Boolean(context.lastTurnHadError);
  if (cond === 'when_contains') {
    const keyword = (edge.conditionValue ?? '').trim().toLowerCase();
    if (!keyword) return true;
    return (context.lastReply ?? '').toLowerCase().includes(keyword);
  }
  return true;
}

export function getDefaultEdgeLabelForCondition(
  conditionType: EdgeConditionType,
  conditionValue?: string,
): string {
  switch (conditionType) {
    case 'on_success':
      return 'On Success';
    case 'on_failure':
      return 'On Failure';
    case 'when_contains': {
      const kw = (conditionValue ?? '').trim();
      return kw ? `If "${kw.slice(0, 18)}"` : 'When Contains';
    }
    default:
      return 'Handoff';
  }
}

export function estimateTokenUsage(promptText: string, completionText: string): TokenUsage {
  const promptTokens = Math.max(1, Math.ceil((promptText || '').length / 4));
  const completionTokens = Math.max(1, Math.ceil((completionText || '').length / 4));
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

export function buildWorkflowMemorySnapshot(params: {
  priorRuns: Array<{
    taskPrompt: string;
    status: string;
    roundsExecuted?: number;
    summary?: string;
    createdAt: string;
  }>;
  openBugs: BugReportItem[];
  workspaceFiles: Array<{ path: string; size?: number }>;
}): string {
  const { priorRuns, openBugs, workspaceFiles } = params;
  const recentRuns = priorRuns.slice(0, 2);
  const unresolvedBugs = openBugs.filter((b) => b.status !== 'resolved').slice(0, 4);
  const files = workspaceFiles.slice(0, 10);

  if (recentRuns.length === 0 && unresolvedBugs.length === 0 && files.length === 0) {
    return '';
  }

  const sections: string[] = ['[WORKFLOW MEMORY FROM PRIOR RUNS]'];

  if (recentRuns.length > 0) {
    sections.push(
      'Runs:\n' +
        recentRuns
          .map((r, idx) => {
            const promptSnippet = r.taskPrompt.replace(/\s+/g, ' ').trim().slice(0, 80);
            const summarySnippet = r.summary
              ? ` -> ${r.summary.replace(/\s+/g, ' ').trim().slice(0, 95)}`
              : '';
            return `${idx + 1}.[${r.status.toUpperCase()}] ${promptSnippet}${summarySnippet}`;
          })
          .join('\n'),
    );
  }

  if (unresolvedBugs.length > 0) {
    sections.push(
      'Open Bugs:\n' +
        unresolvedBugs
          .map((b) => `- [${b.severity.toUpperCase()}·${b.role}] ${b.title}: ${b.description.slice(0, 65)}`)
          .join('\n'),
    );
  }

  if (files.length > 0) {
    sections.push(
      `Files(${workspaceFiles.length}): ` +
        files.map((f) => f.path).join(', '),
    );
  }

  return sections.join('\n').slice(0, 850);
}

export function selectNextSpeaker(params: {
  orderedNodes: WorkflowNode[];
  edges: WorkflowEdge[];
  currentNodeId: string | null;
  roundIndex: number;
  maxRounds: number;
  requestedNextAgentId?: string;
  requestedNextRole?: string;
  lastTurnHadError?: boolean;
  lastReply?: string;
}): { node: WorkflowNode | null; reason: string } {
  const {
    orderedNodes,
    edges,
    currentNodeId,
    roundIndex,
    maxRounds,
    requestedNextAgentId,
    requestedNextRole,
    lastTurnHadError,
    lastReply,
  } = params;

  if (orderedNodes.length === 0) {
    return { node: null, reason: 'Workflow contains no agent nodes' };
  }

  if (roundIndex >= clampMaxRounds(maxRounds)) {
    return { node: null, reason: `Reached max_rounds limit (${maxRounds})` };
  }

  if (!currentNodeId) {
    return { node: orderedNodes[0], reason: 'Entry node selected by topological priority' };
  }

  const outgoingEdges = edges.filter((e) => e.source === currentNodeId);
  const matchingEdges = outgoingEdges.filter((e) =>
    evaluateEdgeCondition(e, { lastTurnHadError, lastReply }),
  );
  const outgoingIds = outgoingEdges.map((e) => e.target);

  if (requestedNextAgentId) {
    const exactIdTarget = orderedNodes.find(
      (n) => n.id === requestedNextAgentId && n.id !== currentNodeId,
    );
    if (exactIdTarget) {
      return {
        node: exactIdTarget,
        reason: `Delegated by Manager to ${exactIdTarget.data.label}`,
      };
    }
  }

  if (requestedNextRole) {
    const cleanReq = requestedNextRole.trim().toLowerCase();
    const matchesHint = (n: WorkflowNode) =>
      n.data.role === requestedNextRole ||
      n.data.label.toLowerCase().includes(cleanReq) ||
      (n.data.section?.toLowerCase().includes(cleanReq) ?? false) ||
      (n.data.positionTitle?.toLowerCase().includes(cleanReq) ?? false);
    const matchingTarget =
      orderedNodes.find((n) => outgoingIds.includes(n.id) && matchesHint(n)) ??
      orderedNodes.find((n) => n.id !== currentNodeId && matchesHint(n));
    if (matchingTarget) {
      return {
        node: matchingTarget,
        reason: `Delegated by Manager to ${matchingTarget.data.label}`,
      };
    }
  }

  if (matchingEdges.length > 0) {
    // Prefer specific conditional edges over generic 'always' when a condition specifically matched
    const specificMatches = matchingEdges.filter((e) => e.conditionType && e.conditionType !== 'always');
    const pool = specificMatches.length > 0 ? specificMatches : matchingEdges;
    const chosenEdge = pool[roundIndex % pool.length];
    const targetNode = orderedNodes.find((n) => n.id === chosenEdge.target);
    if (targetNode) {
      const condSuffix =
        chosenEdge.conditionType && chosenEdge.conditionType !== 'always'
          ? ` (${chosenEdge.conditionType})`
          : '';
      return {
        node: targetNode,
        reason: `Routed along graph edge${condSuffix} to ${targetNode.data.label}`,
      };
    }
  }

  const currentIdx = orderedNodes.findIndex((n) => n.id === currentNodeId);
  const nextNode = orderedNodes[(currentIdx + 1) % orderedNodes.length];
  return {
    node: nextNode,
    reason: `Advanced round-robin to ${nextNode.data.label}`,
  };
}

/**
 * Identifies independent parallel branch targets fanned out from a source node
 * (e.g. Manager -> [Backend Agent, Frontend Agent]) that do not directly depend
 * on each other, enabling concurrent Promise.all execution within a wave.
 */
export function computeParallelFanoutTargets(params: {
  orderedNodes: WorkflowNode[];
  edges: WorkflowEdge[];
  sourceNodeId: string;
  alreadyExecutedIds?: Set<string>;
  lastTurnHadError?: boolean;
  lastReply?: string;
}): WorkflowNode[] {
  const {
    orderedNodes,
    edges,
    sourceNodeId,
    alreadyExecutedIds,
    lastTurnHadError,
    lastReply,
  } = params;

  const outgoingEdges = edges.filter((e) => e.source === sourceNodeId);
  const matchingEdges = outgoingEdges.filter((e) =>
    evaluateEdgeCondition(e, { lastTurnHadError, lastReply }),
  );
  if (matchingEdges.length <= 1) return [];

  const nodeMap = new Map(orderedNodes.map((n) => [n.id, n]));
  const candidates: WorkflowNode[] = [];
  const seen = new Set<string>();

  for (const edge of matchingEdges) {
    if (edge.target === sourceNodeId) continue;
    if (alreadyExecutedIds?.has(edge.target)) continue;
    const target = nodeMap.get(edge.target);
    if (target && !seen.has(target.id)) {
      seen.add(target.id);
      candidates.push(target);
    }
  }

  if (candidates.length <= 1) return [];

  // Keep only candidates that have no direct edge between each other (independent branches)
  const candidateIds = new Set(candidates.map((c) => c.id));
  const independent = candidates.filter((c) => {
    const hasIncomingFromSibling = edges.some(
      (e) => e.target === c.id && e.source !== sourceNodeId && candidateIds.has(e.source),
    );
    return !hasIncomingFromSibling;
  });

  return independent.length > 1 ? independent : [];
}

export function validateWorkflowForRun(
  workflow: WorkflowConfig,
  taskPrompt: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!taskPrompt.trim()) {
    errors.push('Task prompt is required before launching the multi-agent workflow.');
  }

  if (workflow.nodes.length === 0) {
    errors.push('Add at least one Agent node to the canvas before running.');
  }

  for (const node of workflow.nodes) {
    if (!node.data.label.trim()) {
      errors.push(`Agent node (${node.id}) is missing a display name.`);
    }
    if (!node.data.systemPrompt.trim()) {
      errors.push(`Agent "${node.data.label || node.id}" requires a System Prompt.`);
    }
  }

  if (workflow.maxRounds < 1 || workflow.maxRounds > 25) {
    errors.push('max_rounds must be between 1 and 25.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getDefaultEnvRef(provider: AgentNodeData['provider']): string {
  switch (provider) {
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'ollama':
      return 'OLLAMA_BASE_URL';
    case 'opencode':
      return 'OPENCODE_API_KEY';
  }
}

export function buildStructuredAgentPrompt(params: {
  rawInstruction: string;
  targetNode?: WorkflowNode | null;
  language?: 'en' | 'fa';
}): string {
  const clean = params.rawInstruction.trim();
  if (!clean) return '';

  const target = params.targetNode;
  const isPersian =
    params.language === 'fa' || /[\u0600-\u06FF]/.test(clean);

  const tools: string[] = [];
  if (target) {
    if (target.data.tools.readFile) tools.push('READ_FILE:<path>');
    if (target.data.tools.writeFile) tools.push('WRITE_FILE:<path>');
    if (target.data.tools.execBash) tools.push('EXEC_BASH:<command>');
  } else {
    tools.push('READ_FILE:<path>', 'WRITE_FILE:<path>', 'EXEC_BASH:<command>');
  }

  if (isPersian) {
    const targetLabel = target ? `${target.data.label} (${target.data.role})` : 'تیم چندعاملی';
    return [
      `مخاطب: ${targetLabel} | هدف: ${clean}`,
      `۱. پیاده‌سازی دقیق با اعتبارسنجی ورودی و مدیریت خطا، بدون توضیح اضافه.`,
      `۲. ${tools.includes('WRITE_FILE:<path>') ? 'تغییرات فایل را با WRITE_FILE:<path> و بلوک کد اعمال کن.' : 'کد/مشخصات آماده و مستقیم ارائه بده.'}`,
      tools.includes('EXEC_BASH:<command>')
        ? `۳. تست/بررسی را با EXEC_BASH:<command> اجرا و نتیجه را خلاصه گزارش کن.`
        : `۳. معیارهای پذیرش را در ۲ خط خلاصه کن.`,
    ].join('\n');
  }

  const targetLabel = target ? `${target.data.label} (${target.data.role})` : 'Multi-Agent Team';
  return [
    `Target: ${targetLabel} | Goal: ${clean}`,
    `1. Implement concisely with strict input validation and error handling; skip boilerplate prose.`,
    tools.includes('WRITE_FILE:<path>')
      ? `2. Persist code directly via WRITE_FILE:<path> + fenced block (or write_file tool).`
      : `2. Provide concise, actionable technical specs.`,
    tools.includes('EXEC_BASH:<command>')
      ? `3. Verify via EXEC_BASH:<command> (or exec_bash) and report brief results.`
      : `3. Summarize acceptance checks briefly.`,
  ].join('\n');
}

export function orderGroupChatParticipants(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const ordered = computeExecutionOrder(nodes, edges);
  const seenRoles = new Set<string>();
  const primary: WorkflowNode[] = [];
  const secondary: WorkflowNode[] = [];

  for (const node of ordered) {
    if (node.data.role !== 'custom' && !seenRoles.has(node.data.role)) {
      seenRoles.add(node.data.role);
      primary.push(node);
    } else {
      secondary.push(node);
    }
  }

  return [...primary, ...secondary];
}

export function extractBugReportsFromReply(
  reply: string,
  meta: {
    runId?: string;
    workflowId?: string;
    agentId: string;
    agentName: string;
    role: AgentNodeData['role'];
  },
): {
  cleanedReply: string;
  reports: Array<Omit<BugReportItem, 'id' | 'createdAt' | 'status'>>;
} {
  const reports: Array<Omit<BugReportItem, 'id' | 'createdAt' | 'status'>> = [];
  const bugBlockRegex = /BUG_REPORT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\})(?:\s*```)?/g;

  const cleanedReply = reply
    .replace(bugBlockRegex, (_full, jsonPart: string) => {
      try {
        const parsed = JSON.parse(jsonPart.trim()) as {
          category?: string;
          severity?: string;
          title?: string;
          description?: string;
          suggestedFix?: string;
        };
        const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
        const description =
          typeof parsed.description === 'string' ? parsed.description.trim() : '';
        if (!title || !description) return '';

        const category: BugReportCategory =
          parsed.category === 'improvement' ? 'improvement' : 'bug';
        const validSeverities = ['critical', 'high', 'medium', 'low'];
        const severity: BugReportSeverity = validSeverities.includes(
          String(parsed.severity),
        )
          ? (parsed.severity as BugReportSeverity)
          : 'medium';

        reports.push({
          runId: meta.runId,
          workflowId: meta.workflowId,
          agentId: meta.agentId,
          agentName: meta.agentName,
          role: meta.role,
          category,
          severity,
          title: title.slice(0, 140),
          description: description.slice(0, 600),
          suggestedFix:
            typeof parsed.suggestedFix === 'string' && parsed.suggestedFix.trim()
              ? parsed.suggestedFix.trim().slice(0, 400)
              : undefined,
        });
      } catch {
        // Ignore malformed JSON blocks safely
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedReply, reports };
}

export function isManagerNode(node: WorkflowNode | null | undefined): boolean {
  if (!node) return false;
  if (node.data.role === 'manager') return true;
  return /مدیر|manager/i.test(node.data.label);
}

export function findManagerNode(nodes: WorkflowNode[]): WorkflowNode | null {
  return (
    nodes.find((n) => n.data.role === 'manager') ??
    nodes.find((n) => isManagerNode(n)) ??
    null
  );
}

export function findDomainSpecialistNode(
  nodes: WorkflowNode[],
  targetRole: string,
  excludeId?: string,
): WorkflowNode | null {
  const cleanRole = targetRole.trim().toLowerCase();
  const candidates = nodes.filter((n) => n.id !== excludeId);
  if (candidates.length === 0 || !cleanRole) return null;

  // 1. Exact ID or exact label match first (handles custom agents reliably)
  const exactIdOrLabel = candidates.find(
    (n) =>
      n.id.toLowerCase() === cleanRole ||
      n.data.label.trim().toLowerCase() === cleanRole,
  );
  if (exactIdOrLabel) return exactIdOrLabel;

  // 2. Partial label / positionTitle / section match for custom & named specialists
  const exactLabelPartial = candidates.find(
    (n) =>
      n.data.label.toLowerCase().includes(cleanRole) ||
      (n.data.positionTitle?.toLowerCase().includes(cleanRole) ?? false),
  );
  if (exactLabelPartial && cleanRole !== 'custom') return exactLabelPartial;

  // 3. Canonical role keyword match
  const normalizedRole: AgentRole | null =
    cleanRole === 'backend' || cleanRole.includes('back') || cleanRole.includes('بک') || cleanRole.includes('سرور')
      ? 'backend'
      : cleanRole === 'frontend' || cleanRole.includes('front') || cleanRole.includes('فرانت') || cleanRole.includes('رابط')
        ? 'frontend'
        : cleanRole === 'security_qa' ||
            cleanRole.includes('security') ||
            cleanRole.includes('qa') ||
            cleanRole.includes('امنیت') ||
            cleanRole.includes('تست')
          ? 'security_qa'
          : cleanRole === 'executor' ||
              cleanRole.includes('exec') ||
              cleanRole.includes('devops') ||
              cleanRole.includes('deploy') ||
              cleanRole.includes('اجرا') ||
              cleanRole.includes('دپلوی')
            ? 'executor'
            : cleanRole === 'manager' || cleanRole.includes('مدیر')
              ? 'manager'
              : null;

  if (normalizedRole) {
    const exactRoleMatch = candidates.find((n) => n.data.role === normalizedRole);
    if (exactRoleMatch) return exactRoleMatch;
  }

  // 4. Section or responsibility fallback for specialized custom agents
  return (
    candidates.find(
      (n) =>
        (n.data.section?.toLowerCase().includes(cleanRole) ?? false) ||
        (n.data.responsibility?.toLowerCase().includes(cleanRole) ?? false),
    ) ?? null
  );
}

export function extractManagerDelegations(
  reply: string,
  managerNode: WorkflowNode,
  nodes: WorkflowNode[],
  phase: ManagerDelegation['phase'] = 'review',
): {
  cleanedReply: string;
  delegations: Array<Omit<ManagerDelegation, 'id' | 'timestamp'>>;
} {
  const delegations: Array<Omit<ManagerDelegation, 'id' | 'timestamp'>> = [];
  const delegateRegex = /DELEGATE:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\})(?:\s*```)?/g;

  const cleanedReply = reply
    .replace(delegateRegex, (_full, jsonPart: string) => {
      try {
        const parsed = JSON.parse(jsonPart.trim()) as {
          targetRole?: string;
          targetAgent?: string;
          issue?: string;
          reason?: string;
        };
        const targetAgentHint = (parsed.targetAgent || '').trim();
        const targetRoleHint = (parsed.targetRole || '').trim();
        const targetHint = targetAgentHint || targetRoleHint;
        const issue = (parsed.issue || '').trim();
        const reason = (parsed.reason || '').trim();
        if (!targetHint || (!issue && !reason)) return '';

        const targetNode =
          (targetAgentHint
            ? findDomainSpecialistNode(nodes, targetAgentHint, managerNode.id)
            : null) ??
          (targetRoleHint
            ? findDomainSpecialistNode(nodes, targetRoleHint, managerNode.id)
            : null);
        if (!targetNode) return '';

        delegations.push({
          managerId: managerNode.id,
          managerName: managerNode.data.label,
          targetAgentId: targetNode.id,
          targetAgentName: targetNode.data.label,
          targetRole: targetNode.data.role,
          issue: (issue || reason).slice(0, 220),
          reason: (reason || issue).slice(0, 400),
          phase,
        });
      } catch {
        // Ignore malformed DELEGATE block
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedReply, delegations };
}

export function buildManagerInspectionContext(params: {
  sandboxFiles: SandboxFile[];
  toolCalls: ToolCallLog[];
  openBugs: BugReportItem[];
}): {
  hasIssues: boolean;
  failingTools: ToolCallLog[];
  openBugsByRole: Array<{ role: AgentRole; bug: BugReportItem }>;
  summaryText: string;
} {
  const { sandboxFiles, toolCalls, openBugs } = params;
  const failingTools = toolCalls.filter((t) => (t.exitCode ?? 0) !== 0);
  const openOnly = openBugs.filter((b) => b.status !== 'resolved');
  const openBugsByRole = openOnly.map((bug) => ({ role: bug.role, bug }));

  const visibleFiles = sandboxFiles.slice(0, 8);
  const fileList =
    visibleFiles.length > 0
      ? visibleFiles
          .map((f) => {
            const firstLines = f.content.replace(/\s+/g, ' ').trim().slice(0, 110);
            return `- ${f.path} (${f.size}B): ${firstLines}`;
          })
          .join('\n') +
        (sandboxFiles.length > 8 ? `\n- ... +${sandboxFiles.length - 8} more files` : '')
      : '- No sandbox files yet.';

  const visibleTools = toolCalls.slice(-8);
  const toolSummary =
    visibleTools.length > 0
      ? visibleTools
          .map(
            (t) =>
              `- [${(t.exitCode ?? 0) === 0 ? 'PASS' : `FAIL exit=${t.exitCode}`}] ${t.tool}(${t.target}): ${t.result.slice(0, 140)}`,
          )
          .join('\n')
      : '- No tool logs.';

  const bugSummary =
    openOnly.length > 0
      ? openOnly
          .slice(0, 6)
          .map(
            (b) =>
              `- [${b.severity.toUpperCase()}·${b.category}] ${b.role}: ${b.title} — ${b.description.slice(0, 90)}`,
          )
          .join('\n')
      : '- None.';

  const summaryText =
    `AUDIT SNAPSHOT:\n` +
    `Files(${sandboxFiles.length}):\n${fileList}\n` +
    `Tools(${toolCalls.length}):\n${toolSummary}\n` +
    `Bugs(${openOnly.length}):\n${bugSummary}`;

  return {
    hasIssues: failingTools.length > 0 || openOnly.some((b) => b.category === 'bug'),
    failingTools,
    openBugsByRole,
    summaryText: summaryText.slice(0, 1400),
  };
}

export interface ExportedWorkflowEnvelope {
  schemaVersion: '1.0';
  exportedAt: string;
  workflow: WorkflowConfig;
}

export function serializeWorkflowForExport(workflow: WorkflowConfig): string {
  const cleanWorkflow: WorkflowConfig = {
    id: workflow.id,
    name: workflow.name.trim() || 'Untitled Workflow',
    description: workflow.description || '',
    maxRounds: clampMaxRounds(workflow.maxRounds),
    humanInTheLoop: Boolean(workflow.humanInTheLoop),
    ...(workflow.continuousAgentWork !== undefined
      ? { continuousAgentWork: Boolean(workflow.continuousAgentWork) }
      : {}),
    ...(workflow.continuousIntervalSec !== undefined
      ? { continuousIntervalSec: clampContinuousIntervalSec(workflow.continuousIntervalSec) }
      : {}),
    ...(workflow.strictPrelaunchGate !== undefined
      ? { strictPrelaunchGate: Boolean(workflow.strictPrelaunchGate) }
      : {}),
    ...(workflow.memoryEnabled !== undefined
      ? { memoryEnabled: Boolean(workflow.memoryEnabled) }
      : {}),
    ...(workflow.webhookEnabled !== undefined
      ? { webhookEnabled: Boolean(workflow.webhookEnabled) }
      : {}),
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: 'agentNode',
      position: {
        x: Math.round(Number(node.position?.x) || 0),
        y: Math.round(Number(node.position?.y) || 0),
      },
      data: {
        label: node.data.label,
        role: node.data.role,
        ...(node.data.section ? { section: node.data.section } : {}),
        ...(node.data.positionTitle ? { positionTitle: node.data.positionTitle } : {}),
        ...(node.data.responsibility ? { responsibility: node.data.responsibility } : {}),
        ...(node.data.powerLevel ? { powerLevel: node.data.powerLevel } : {}),
        provider: node.data.provider,
        model: node.data.model,
        envSecretRef: node.data.envSecretRef || getDefaultEnvRef(node.data.provider),
        temperature: clampTemperature(node.data.temperature),
        systemPrompt: node.data.systemPrompt,
        tools: {
          readFile: Boolean(node.data.tools?.readFile),
          writeFile: Boolean(node.data.tools?.writeFile),
          execBash: Boolean(node.data.tools?.execBash),
        },
        status: 'idle',
      },
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.animated ? { animated: edge.animated } : {}),
      ...(edge.conditionType && edge.conditionType !== 'always'
        ? { conditionType: edge.conditionType }
        : {}),
      ...(edge.conditionType === 'when_contains' && edge.conditionValue
        ? { conditionValue: edge.conditionValue }
        : {}),
    })),
    ...(workflow.projectContext ? { projectContext: workflow.projectContext } : {}),
    updatedAt: workflow.updatedAt || new Date().toISOString(),
  };

  const envelope: ExportedWorkflowEnvelope = {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    workflow: cleanWorkflow,
  };

  return JSON.stringify(envelope, null, 2);
}

export function parseImportedWorkflowJson(rawJson: string): {
  workflow: WorkflowConfig | null;
  error?: string;
} {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { workflow: null, error: 'Invalid workflow JSON object.' };
    }

    const candidate =
      'workflow' in parsed && parsed.workflow && typeof parsed.workflow === 'object'
        ? (parsed.workflow as Partial<WorkflowConfig>)
        : (parsed as Partial<WorkflowConfig>);

    if (!Array.isArray(candidate.nodes)) {
      return { workflow: null, error: 'Workflow JSON is missing a valid nodes array.' };
    }

    const validProviders = new Set(['gemini', 'openai', 'anthropic', 'ollama', 'opencode']);
    const validRoles = new Set(['manager', 'backend', 'frontend', 'security_qa', 'executor', 'custom']);

    const nodes: WorkflowNode[] = [];
    for (const rawNode of candidate.nodes) {
      if (!rawNode || typeof rawNode !== 'object' || !rawNode.id || !rawNode.data) {
        return { workflow: null, error: 'Each workflow node must include id and data.' };
      }
      const provider = validProviders.has(String(rawNode.data.provider))
        ? rawNode.data.provider
        : 'gemini';
      const role = validRoles.has(String(rawNode.data.role))
        ? rawNode.data.role
        : 'custom';
      nodes.push({
        id: String(rawNode.id),
        type: 'agentNode',
        position: {
          x: Number(rawNode.position?.x) || 0,
          y: Number(rawNode.position?.y) || 0,
        },
        data: {
          label: String(rawNode.data.label || rawNode.id),
          role,
          ...(typeof rawNode.data.section === 'string' && rawNode.data.section.trim()
            ? { section: rawNode.data.section.trim() }
            : {}),
          ...(typeof rawNode.data.positionTitle === 'string' && rawNode.data.positionTitle.trim()
            ? { positionTitle: rawNode.data.positionTitle.trim() }
            : {}),
          ...(typeof rawNode.data.responsibility === 'string' && rawNode.data.responsibility.trim()
            ? { responsibility: rawNode.data.responsibility.trim() }
            : {}),
          ...(rawNode.data.powerLevel === 'eco' ||
          rawNode.data.powerLevel === 'standard' ||
          rawNode.data.powerLevel === 'pro' ||
          rawNode.data.powerLevel === 'ultra'
            ? { powerLevel: rawNode.data.powerLevel }
            : {}),
          provider,
          model: String(rawNode.data.model || 'gemini-4-hydrogen'),
          envSecretRef: String(rawNode.data.envSecretRef || getDefaultEnvRef(provider)),
          temperature: clampTemperature(Number(rawNode.data.temperature ?? 0.3)),
          systemPrompt: String(rawNode.data.systemPrompt || 'You are a helpful specialist agent.'),
          tools: {
            readFile: Boolean(rawNode.data.tools?.readFile),
            writeFile: Boolean(rawNode.data.tools?.writeFile),
            execBash: Boolean(rawNode.data.tools?.execBash),
          },
          status: 'idle',
        },
      });
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const validConditions = new Set(['always', 'on_success', 'on_failure', 'when_contains']);
    const edges: WorkflowEdge[] = Array.isArray(candidate.edges)
      ? candidate.edges
          .filter(
            (e): e is WorkflowEdge =>
              Boolean(
                e &&
                  typeof e === 'object' &&
                  typeof e.source === 'string' &&
                  typeof e.target === 'string' &&
                  nodeIds.has(e.source) &&
                  nodeIds.has(e.target),
              ),
          )
          .map((e, idx) => {
            const cond =
              typeof e.conditionType === 'string' && validConditions.has(e.conditionType)
                ? (e.conditionType as EdgeConditionType)
                : undefined;
            const condVal =
              cond === 'when_contains' && typeof e.conditionValue === 'string' && e.conditionValue.trim()
                ? e.conditionValue.trim()
                : undefined;
            return {
              id: e.id || `edge-${idx + 1}`,
              source: e.source,
              target: e.target,
              ...(e.label ? { label: String(e.label) } : {}),
              ...(e.animated ? { animated: Boolean(e.animated) } : {}),
              ...(cond && cond !== 'always' ? { conditionType: cond } : {}),
              ...(condVal ? { conditionValue: condVal } : {}),
            };
          })
      : [];

    const workflow: WorkflowConfig = {
      id:
        typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id.trim()
          : `wf-${Date.now()}`,
      name:
        typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim()
          : 'Imported Workflow',
      description:
        typeof candidate.description === 'string'
          ? candidate.description
          : 'Imported agent workflow configuration',
      maxRounds: clampMaxRounds(Number(candidate.maxRounds ?? 6)),
      humanInTheLoop: candidate.humanInTheLoop ?? true,
      ...(candidate.continuousAgentWork !== undefined
        ? { continuousAgentWork: Boolean(candidate.continuousAgentWork) }
        : {}),
      ...(candidate.continuousIntervalSec !== undefined
        ? { continuousIntervalSec: clampContinuousIntervalSec(Number(candidate.continuousIntervalSec)) }
        : {}),
      ...(candidate.strictPrelaunchGate !== undefined
        ? { strictPrelaunchGate: Boolean(candidate.strictPrelaunchGate) }
        : {}),
      ...(candidate.memoryEnabled !== undefined
        ? { memoryEnabled: Boolean(candidate.memoryEnabled) }
        : {}),
      ...(candidate.webhookEnabled !== undefined
        ? { webhookEnabled: Boolean(candidate.webhookEnabled) }
        : {}),
      nodes,
      edges,
      ...(candidate.projectContext && typeof candidate.projectContext === 'object'
        ? { projectContext: candidate.projectContext }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    return { workflow };
  } catch {
    return { workflow: null, error: 'Malformed JSON file.' };
  }
}

export function encodeWorkflowToShareParam(workflow: WorkflowConfig): string {
  const json = serializeWorkflowForExport(workflow);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeWorkflowFromShareParam(encoded: string): WorkflowConfig | null {
  try {
    const clean = encoded.trim();
    if (!clean) return null;
    const base64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = parseImportedWorkflowJson(json);
    return parsed.workflow;
  } catch {
    return null;
  }
}

export function buildWorkflowShareUrl(currentUrl: string, workflow: WorkflowConfig): string {
  const url = new URL(currentUrl);
  url.searchParams.set('wf', encodeWorkflowToShareParam(workflow));
  return url.toString();
}


