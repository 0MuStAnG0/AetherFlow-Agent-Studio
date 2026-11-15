export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'opencode';

export type AgentRole =
  | 'manager'
  | 'backend'
  | 'frontend'
  | 'security_qa'
  | 'executor'
  | 'custom';

export interface AgentToolsConfig {
  readFile: boolean;
  writeFile: boolean;
  execBash: boolean;
}

export type AgentPowerLevel = 'eco' | 'standard' | 'pro' | 'ultra';

export type TokenOptimizationMode = 'ultra_compact' | 'balanced' | 'off';

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  role: AgentRole;
  section?: string;
  positionTitle?: string;
  responsibility?: string;
  powerLevel?: AgentPowerLevel;
  provider: LLMProvider;
  model: string;
  envSecretRef: string;
  temperature: number;
  systemPrompt: string;
  tools: AgentToolsConfig;
  status?: 'idle' | 'speaking' | 'waiting_approval' | 'done' | 'error';
}

export interface WorkflowNode {
  id: string;
  type: 'agentNode';
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  data: AgentNodeData;
}

export type EdgeConditionType = 'always' | 'on_success' | 'on_failure' | 'when_contains';

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  conditionType?: EdgeConditionType;
  conditionValue?: string;
}

export interface WorkflowProjectContext {
  projectId: string;
  name: string;
  sourceType: 'github' | 'zip';
  sourceUrl?: string;
  branch?: string;
  frameworks: string[];
  summary: string;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  maxRounds: number;
  humanInTheLoop: boolean;
  continuousAgentWork?: boolean;
  continuousIntervalSec?: number;
  strictPrelaunchGate?: boolean;
  memoryEnabled?: boolean;
  webhookEnabled?: boolean;
  webhookSecret?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  projectContext?: WorkflowProjectContext;
  updatedAt: string;
}

export interface ContinuousWorkSession {
  workflowId: string;
  active: boolean;
  status: 'idle' | 'running' | 'cooldown' | 'paused' | 'error_backoff';
  cyclesCompleted: number;
  lastRunId?: string;
  lastRunStatus?: string;
  lastCycleAt?: string;
  nextCycleAt?: string;
  intervalSec: number;
  mode: 'live' | 'dry_run';
  taskPrompt: string;
  consecutiveErrors: number;
  lastError?: string;
  startedAt: string;
  updatedAt: string;
}

export type PrelaunchCategoryId =
  | 'core_technical'
  | 'functional_nonfunctional'
  | 'ux_compatibility'
  | 'final_pre_release';

export type PrelaunchTestId =
  | 'unit'
  | 'integration'
  | 'system'
  | 'functional'
  | 'performance'
  | 'stress'
  | 'security'
  | 'usability'
  | 'compatibility'
  | 'regression'
  | 'smoke'
  | 'alpha'
  | 'beta'
  | 'uat';

export type PrelaunchTestStatus = 'pass' | 'warn' | 'fail';

export interface PrelaunchTestResult {
  id: PrelaunchTestId;
  category: PrelaunchCategoryId;
  severity: 'critical' | 'high' | 'medium';
  status: PrelaunchTestStatus;
  score: number;
  durationMs: number;
  summaryEn: string;
  summaryFa: string;
  evidence: string[];
  recommendationEn?: string;
  recommendationFa?: string;
}

export interface PrelaunchTestReport {
  id: string;
  workflowId: string;
  workflowName: string;
  strictMode: boolean;
  gateStatus: 'approved' | 'blocked';
  overallScore: number;
  passedCount: number;
  warnCount: number;
  failedCount: number;
  totalTests: number;
  durationMs: number;
  targetScope: string;
  results: PrelaunchTestResult[];
  createdAt: string;
}

export interface ToolCallLog {
  id: string;
  tool: 'read_file' | 'write_file' | 'exec_bash';
  target: string;
  result: string;
  exitCode?: number;
  requiresApproval?: boolean;
  approved?: boolean;
}

export interface ManagerDelegation {
  id: string;
  managerId: string;
  managerName: string;
  targetAgentId: string;
  targetAgentName: string;
  targetRole: AgentRole;
  issue: string;
  reason: string;
  phase: 'test' | 'deploy' | 'review';
  timestamp: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  savedTokens?: number;
  estimated?: boolean;
}

export interface ExecutionEvent {
  id: string;
  runId: string;
  type:
    | 'run_started'
    | 'user_message'
    | 'agent_chunk'
    | 'agent_message'
    | 'tool_executed'
    | 'bug_reported'
    | 'manager_delegation'
    | 'approval_required'
    | 'approval_resolved'
    | 'run_completed'
    | 'run_cancelled'
    | 'run_error';
  round: number;
  agentId?: string;
  agentName?: string;
  role?: AgentRole;
  provider?: LLMProvider;
  model?: string;
  content: string;
  streamDone?: boolean;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  toolCalls?: ToolCallLog[];
  bugReport?: BugReportItem;
  delegation?: ManagerDelegation;
  pendingCommand?: {
    approvalId: string;
    command: string;
    reason: string;
  };
  timestamp: string;
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface FileDiffEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  lines: DiffLine[];
  truncated?: boolean;
}

export interface SandboxFile {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}

export interface ExecutionRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  taskPrompt: string;
  mode: 'live' | 'dry_run';
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  roundsExecuted: number;
  maxRounds: number;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
}

export interface BlueprintFile {
  path: string;
  phase: string;
  language: string;
  summary: string;
  content: string;
}

export interface ModelCatalogMeta {
  displayName?: string;
  power?: AgentPowerLevel;
}

export interface CustomAgentTemplate {
  id: string;
  role: AgentRole;
  title: string;
  subtitle: string;
  section?: string;
  positionTitle?: string;
  responsibility?: string;
  powerLevel?: AgentPowerLevel;
  defaultProvider: LLMProvider;
  defaultModel: string;
  defaultTemperature: number;
  defaultTools: AgentToolsConfig;
  systemPrompt: string;
}

export interface ProviderEndpointConfig {
  defaultModel: string;
  baseUrl: string;
  envVarName: string;
  customModels: string[];
  disabledModels?: string[];
  modelMeta?: Record<string, ModelCatalogMeta>;
}

export interface AppSettings {
  defaultMaxRounds: number;
  defaultExecutionMode: 'live' | 'dry_run';
  globalHumanInTheLoop: boolean;
  customSensitivePatterns: string[];
  allowReadFile: boolean;
  allowWriteFile: boolean;
  allowExecBash: boolean;
  sandboxTimeoutSec: number;
  sandboxMemoryMb: 256 | 512 | 1024;
  tokenOptimizationMode?: TokenOptimizationMode;
  language: 'en' | 'fa';
  darkMode: boolean;
  showMiniMap: boolean;
  canvasGridVariant: 'dots' | 'lines' | 'cross';
  providers: Record<LLMProvider, ProviderEndpointConfig>;
  customTemplates?: CustomAgentTemplate[];
  hiddenTemplateIds?: string[];
  updatedAt: string;
}

export type BugReportCategory = 'bug' | 'improvement';
export type BugReportSeverity = 'critical' | 'high' | 'medium' | 'low';
export type BugReportStatus = 'open' | 'acknowledged' | 'resolved';

export interface BugReportItem {
  id: string;
  runId?: string;
  workflowId?: string;
  agentId: string;
  agentName: string;
  role: AgentRole;
  category: BugReportCategory;
  severity: BugReportSeverity;
  title: string;
  description: string;
  suggestedFix?: string;
  status: BugReportStatus;
  createdAt: string;
}

export type ProjectSourceType = 'github' | 'zip';

export interface RecommendedAgentSpec {
  id: string;
  title: string;
  role: AgentRole;
  section?: string;
  positionTitle?: string;
  powerLevel?: AgentPowerLevel;
  specialty: string;
  reason: string;
  recommendedProvider: LLMProvider;
  recommendedModel: string;
  systemPrompt: string;
  tools: AgentToolsConfig;
  priority: 'essential' | 'recommended' | 'optional';
  matchedSignals: string[];
}

export interface ImportedProjectAnalysis {
  id: string;
  name: string;
  sourceType: ProjectSourceType;
  sourceUrl?: string;
  branch?: string;
  totalFiles: number;
  languages: Array<{ name: string; files: number }>;
  frameworks: string[];
  keyFiles: string[];
  directoryOverview: string[];
  managerSummary: string;
  recommendations: RecommendedAgentSpec[];
  usedLiveAi: boolean;
  importedAt: string;
}

export interface ProviderSecretStatus {
  secretName: string;
  configured: boolean;
  source: 'vault' | 'env' | 'none';
  maskedHint: string;
  updatedAt?: string;
}

export interface CapabilitiesState {
  geminiConfigured: boolean;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  opencodeConfigured: boolean;
  ollamaBaseUrl?: string;
  secrets?: Record<string, ProviderSecretStatus>;
  authEnabled?: boolean;
  vaultEncrypted?: boolean;
  dockerSandbox?: boolean;
}
