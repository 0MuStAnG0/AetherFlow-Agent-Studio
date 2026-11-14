import type { AgentNodeData, AgentRole, LLMProvider, WorkflowConfig } from '../types/workflow';

export interface AgentRoleTemplate {
  role: AgentRole;
  title: string;
  subtitle: string;
  defaultProvider: LLMProvider;
  defaultModel: string;
  defaultTemperature: number;
  defaultTools: AgentNodeData['tools'];
  systemPrompt: string;
}

export const PROVIDER_MODELS: Record<
  LLMProvider,
  { label: string; envRef: string; models: string[] }
> = {
  gemini: {
    label: 'Google Gemini (AI Studio)',
    envRef: 'GEMINI_API_KEY',
    models: ['gemini-4-hydrogen', 'gemini-4-argon', 'gemini-4-carbon', 'gemini-3.1-flash-lite'],
  },
  openai: {
    label: 'OpenAI ChatGPT',
    envRef: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4.1', 'o3-mini'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    envRef: 'ANTHROPIC_API_KEY',
    models: ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  },
  ollama: {
    label: 'Local Ollama',
    envRef: 'OLLAMA_BASE_URL',
    models: ['ollama/qwen2.5-coder:32b', 'ollama/llama3.3:70b', 'ollama/deepseek-r1:14b'],
  },
  opencode: {
    label: 'OpenCode Zen (Free Models)',
    envRef: 'OPENCODE_API_KEY',
    models: [
      'big-pickle',
      'deepseek-v4.1-flash-free',
      'glm-5.3-flash-free',
      'mimo-v2.6-flash-free',
      'minimax-m3.1-flash-free',
      'longcat-2.5-free',
      'nemotron-3.5-super-vl-free',
      'nemotron-3.5-lightning-free',
      'iceman-free',
      'inkling-2-small-free',
      'beam-free',
      'flint-40b-free',
    ],
  },
};

export const AGENT_ROLE_TEMPLATES: AgentRoleTemplate[] = [
  {
    role: 'manager',
    title: 'Manager Agent',
    subtitle: 'Breaks down tasks, coordinates handoffs, and approves completion.',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.2,
    defaultTools: { readFile: true, writeFile: false, execBash: false },
    systemPrompt:
      'You are the Lead Software Architect & GroupChat Manager. Break the user task into concrete backend, frontend, security, and verification milestones. Assign the next agent clearly and declare TERMINATE only after Executor confirms passing checks.',
  },
  {
    role: 'backend',
    title: 'Backend Agent',
    subtitle: 'Designs FastAPI/Express endpoints, SQLite/Postgres schemas, and core services.',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.2,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Backend Engineer. Write clean, production-ready Python (FastAPI) or TypeScript APIs with input validation, structured error handling, and database persistence. Emit concrete file payloads when creating code.',
  },
  {
    role: 'frontend',
    title: 'Frontend Agent',
    subtitle: 'Builds React + Tailwind interfaces, state management, and accessible controls.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o',
    defaultTemperature: 0.3,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Frontend Engineer. Produce modular React + TypeScript + Tailwind CSS components with accessible form controls, loading/empty/error states, and WebSocket integration.',
  },
  {
    role: 'security_qa',
    title: 'Security & QA Agent',
    subtitle: 'Audits OWASP risks, validates sanitization, and writes automated tests.',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    defaultTemperature: 0.1,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are an Application Security & QA Engineer. Audit generated code for injection, auth bypass, path traversal, and unsafe shell execution. Write deterministic pytest or node:test assertions covering happy paths and edge cases.',
  },
  {
    role: 'executor',
    title: 'Executor Agent',
    subtitle: 'Runs code inside the isolated Linux Docker sandbox and reports logs.',
    defaultProvider: 'ollama',
    defaultModel: 'ollama/qwen2.5-coder:32b',
    defaultTemperature: 0.0,
    defaultTools: { readFile: true, writeFile: true, execBash: true },
    systemPrompt:
      'You are the Sandbox Execution & DevOps Agent. Execute tests, linters, and build checks inside the isolated Linux Docker container. Report exact stdout/stderr exit codes so Backend/Frontend agents can self-heal on failure.',
  },
];

export const DEFAULT_SEED_WORKFLOWS: WorkflowConfig[] = [
  {
    id: 'wf-fullstack-pipeline',
    name: 'Full-Stack Engineering & Security Pipeline',
    description:
      'Five-agent software delivery graph: Manager orchestrates Backend and Frontend, Security & QA audits and writes tests, and Executor verifies inside Linux Docker sandbox.',
    maxRounds: 6,
    humanInTheLoop: true,
    updatedAt: '2026-11-14T08:00:00.000Z',
    nodes: [
      {
        id: 'node-manager',
        type: 'agentNode',
        position: { x: 40, y: 180 },
        data: {
          label: 'Manager Agent',
          role: 'manager',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.2,
          systemPrompt: AGENT_ROLE_TEMPLATES[0].systemPrompt,
          tools: { readFile: true, writeFile: false, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-backend',
        type: 'agentNode',
        position: { x: 340, y: 70 },
        data: {
          label: 'Backend Agent',
          role: 'backend',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.2,
          systemPrompt: AGENT_ROLE_TEMPLATES[1].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-frontend',
        type: 'agentNode',
        position: { x: 340, y: 310 },
        data: {
          label: 'Frontend Agent',
          role: 'frontend',
          provider: 'openai',
          model: 'gpt-4o',
          envSecretRef: 'OPENAI_API_KEY',
          temperature: 0.3,
          systemPrompt: AGENT_ROLE_TEMPLATES[2].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-security',
        type: 'agentNode',
        position: { x: 660, y: 180 },
        data: {
          label: 'Security & QA Agent',
          role: 'security_qa',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          envSecretRef: 'ANTHROPIC_API_KEY',
          temperature: 0.1,
          systemPrompt: AGENT_ROLE_TEMPLATES[3].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-executor',
        type: 'agentNode',
        position: { x: 960, y: 180 },
        data: {
          label: 'Executor Agent',
          role: 'executor',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:32b',
          envSecretRef: 'OLLAMA_BASE_URL',
          temperature: 0.0,
          systemPrompt: AGENT_ROLE_TEMPLATES[4].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: true },
          status: 'idle',
        },
      },
    ],
    edges: [
      { id: 'e-mgr-be', source: 'node-manager', target: 'node-backend', label: 'API Spec' },
      { id: 'e-mgr-fe', source: 'node-manager', target: 'node-frontend', label: 'UI Spec' },
      { id: 'e-be-sec', source: 'node-backend', target: 'node-security', label: 'Audit' },
      { id: 'e-fe-sec', source: 'node-frontend', target: 'node-security', label: 'Audit' },
      { id: 'e-sec-exec', source: 'node-security', target: 'node-executor', label: 'Run Tests' },
      { id: 'e-exec-be', source: 'node-executor', target: 'node-backend', label: 'Self-Heal Logs', animated: true },
    ],
  },
  {
    id: 'wf-security-audit',
    name: 'Security Audit & Self-Healing Sandbox',
    description:
      'Focused 3-agent loop using distinct Gemini system prompts for static analysis, patch generation, and isolated container verification.',
    maxRounds: 4,
    humanInTheLoop: true,
    updatedAt: '2026-11-14T08:00:00.000Z',
    nodes: [
      {
        id: 'node-mgr-2',
        type: 'agentNode',
        position: { x: 80, y: 180 },
        data: {
          label: 'Triage Manager',
          role: 'manager',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.15,
          systemPrompt: AGENT_ROLE_TEMPLATES[0].systemPrompt,
          tools: { readFile: true, writeFile: false, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-sec-2',
        type: 'agentNode',
        position: { x: 400, y: 180 },
        data: {
          label: 'Vulnerability Auditor',
          role: 'security_qa',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.1,
          systemPrompt: AGENT_ROLE_TEMPLATES[3].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-exec-2',
        type: 'agentNode',
        position: { x: 720, y: 180 },
        data: {
          label: 'Docker Sandbox Runner',
          role: 'executor',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.0,
          systemPrompt: AGENT_ROLE_TEMPLATES[4].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: true },
          status: 'idle',
        },
      },
    ],
    edges: [
      { id: 'e2-1', source: 'node-mgr-2', target: 'node-sec-2', label: 'Scope' },
      { id: 'e2-2', source: 'node-sec-2', target: 'node-exec-2', label: 'Verify Patch' },
    ],
  },
];
