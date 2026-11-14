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

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  role: AgentRole;
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

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
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
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  projectContext?: WorkflowProjectContext;
  updatedAt: string;
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

export interface ExecutionEvent {
  id: string;
  runId: string;
  type:
    | 'run_started'
    | 'user_message'
    | 'agent_message'
    | 'tool_executed'
    | 'bug_reported'
    | 'manager_delegation'
    | 'approval_required'
    | 'approval_resolved'
    | 'run_completed'
    | 'run_error';
  round: number;
  agentId?: string;
  agentName?: string;
  role?: AgentRole;
  provider?: LLMProvider;
  model?: string;
  content: string;
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
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed';
  roundsExecuted: number;
  maxRounds: number;
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

export interface ProviderEndpointConfig {
  defaultModel: string;
  baseUrl: string;
  envVarName: string;
  customModels: string[];
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
  language: 'en' | 'fa';
  darkMode: boolean;
  showMiniMap: boolean;
  canvasGridVariant: 'dots' | 'lines' | 'cross';
  providers: Record<LLMProvider, ProviderEndpointConfig>;
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

