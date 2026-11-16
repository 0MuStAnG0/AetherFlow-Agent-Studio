import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SEED_WORKFLOWS } from '../src/data/agentTemplates.ts';
import type {
  AppSettings,
  BugReportItem,
  BugReportStatus,
  ContinuousWorkSession,
  ExecutionEvent,
  ExecutionRunSummary,
  ImportedProjectAnalysis,
  NginxDomainConfig,
  NginxDomainStatus,
  NginxSslMode,
  PrelaunchTestReport,
  ProviderSecretStatus,
  UserProfile,
  UserRole,
  WorkflowConfig,
} from '../src/types/workflow.ts';
import { maskApiKey, normalizeSecretName } from '../src/utils/secretUtils.ts';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../src/utils/workflowEngine.ts';
import { decryptSecret, encryptSecret, isEncryptedSecretValue } from './security.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'studio.db');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      max_rounds INTEGER NOT NULL DEFAULT 6,
      human_in_the_loop INTEGER NOT NULL DEFAULT 1,
      graph_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'live',
      status TEXT NOT NULL,
      rounds_executed INTEGER NOT NULL DEFAULT 0,
      max_rounds INTEGER NOT NULL DEFAULT 6,
      events_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      workflow_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_fix TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS imported_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      branch TEXT,
      analysis_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_secrets (
      secret_name TEXT PRIMARY KEY,
      secret_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuous_sessions (
      workflow_id TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      session_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prelaunch_reports (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      gate_status TEXT NOT NULL,
      overall_score INTEGER NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#2563eb',
      role TEXT NOT NULL DEFAULT 'operator',
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_policy (
      id TEXT PRIMARY KEY,
      require_auth INTEGER NOT NULL DEFAULT 1,
      allow_self_registration INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nginx_domains (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
      upstream_port INTEGER NOT NULL DEFAULT 3000,
      ssl_mode TEXT NOT NULL DEFAULT 'letsencrypt',
      ssl_email TEXT NOT NULL DEFAULT '',
      ssl_cert_path TEXT NOT NULL DEFAULT '',
      ssl_key_path TEXT NOT NULL DEFAULT '',
      redirect_www INTEGER NOT NULL DEFAULT 0,
      client_max_body_mb INTEGER NOT NULL DEFAULT 30,
      enable_websocket INTEGER NOT NULL DEFAULT 1,
      enable_hsts INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      dns_ips_json TEXT NOT NULL DEFAULT '[]',
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const countRow = dbInstance.prepare('SELECT COUNT(*) AS cnt FROM workflows').get() as { cnt: number };
  if (countRow.cnt === 0) {
    for (const wf of DEFAULT_SEED_WORKFLOWS) {
      upsertWorkflow(wf);
    }
  }
  return dbInstance;
}

export function listWorkflows(): WorkflowConfig[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
    .all() as Array<{
    id: string;
    name: string;
    description: string;
    max_rounds: number;
    human_in_the_loop: number;
    graph_json: string;
    updated_at: string;
  }>;

  return rows.map((row) => {
    const graph = JSON.parse(row.graph_json) as {
      nodes: WorkflowConfig['nodes'];
      edges: WorkflowConfig['edges'];
      projectContext?: WorkflowConfig['projectContext'];
      continuousAgentWork?: boolean;
      continuousIntervalSec?: number;
      strictPrelaunchGate?: boolean;
      memoryEnabled?: boolean;
      webhookEnabled?: boolean;
      webhookSecret?: string;
    };
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      maxRounds: row.max_rounds,
      humanInTheLoop: Boolean(row.human_in_the_loop),
      ...(graph.continuousAgentWork !== undefined
        ? { continuousAgentWork: Boolean(graph.continuousAgentWork) }
        : {}),
      ...(graph.continuousIntervalSec !== undefined
        ? { continuousIntervalSec: graph.continuousIntervalSec }
        : {}),
      ...(graph.strictPrelaunchGate !== undefined
        ? { strictPrelaunchGate: Boolean(graph.strictPrelaunchGate) }
        : {}),
      ...(graph.memoryEnabled !== undefined
        ? { memoryEnabled: Boolean(graph.memoryEnabled) }
        : {}),
      ...(graph.webhookEnabled !== undefined
        ? { webhookEnabled: Boolean(graph.webhookEnabled) }
        : {}),
      ...(typeof graph.webhookSecret === 'string' && graph.webhookSecret
        ? { webhookSecret: graph.webhookSecret }
        : {}),
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      ...(graph.projectContext ? { projectContext: graph.projectContext } : {}),
      updatedAt: row.updated_at,
    };
  });
}

export function getWorkflowById(id: string): WorkflowConfig | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(id) as
    | {
        id: string;
        name: string;
        description: string;
        max_rounds: number;
        human_in_the_loop: number;
        graph_json: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  const graph = JSON.parse(row.graph_json) as {
    nodes: WorkflowConfig['nodes'];
    edges: WorkflowConfig['edges'];
    projectContext?: WorkflowConfig['projectContext'];
    continuousAgentWork?: boolean;
    continuousIntervalSec?: number;
    strictPrelaunchGate?: boolean;
    memoryEnabled?: boolean;
    webhookEnabled?: boolean;
    webhookSecret?: string;
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    maxRounds: row.max_rounds,
    humanInTheLoop: Boolean(row.human_in_the_loop),
    ...(graph.continuousAgentWork !== undefined
      ? { continuousAgentWork: Boolean(graph.continuousAgentWork) }
      : {}),
    ...(graph.continuousIntervalSec !== undefined
      ? { continuousIntervalSec: graph.continuousIntervalSec }
      : {}),
    ...(graph.strictPrelaunchGate !== undefined
      ? { strictPrelaunchGate: Boolean(graph.strictPrelaunchGate) }
      : {}),
    ...(graph.memoryEnabled !== undefined
      ? { memoryEnabled: Boolean(graph.memoryEnabled) }
      : {}),
    ...(graph.webhookEnabled !== undefined
      ? { webhookEnabled: Boolean(graph.webhookEnabled) }
      : {}),
    ...(typeof graph.webhookSecret === 'string' && graph.webhookSecret
      ? { webhookSecret: graph.webhookSecret }
      : {}),
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
    ...(graph.projectContext ? { projectContext: graph.projectContext } : {}),
    updatedAt: row.updated_at,
  };
}

export function upsertWorkflow(workflow: WorkflowConfig): WorkflowConfig {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  const graphJson = JSON.stringify({
    nodes: workflow.nodes,
    edges: workflow.edges,
    ...(workflow.projectContext ? { projectContext: workflow.projectContext } : {}),
    ...(workflow.continuousAgentWork !== undefined
      ? { continuousAgentWork: Boolean(workflow.continuousAgentWork) }
      : {}),
    ...(workflow.continuousIntervalSec !== undefined
      ? { continuousIntervalSec: workflow.continuousIntervalSec }
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
    ...(typeof workflow.webhookSecret === 'string' && workflow.webhookSecret.trim()
      ? { webhookSecret: workflow.webhookSecret.trim() }
      : {}),
  });

  db.prepare(
    `
    INSERT INTO workflows (id, name, description, max_rounds, human_in_the_loop, graph_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      max_rounds = excluded.max_rounds,
      human_in_the_loop = excluded.human_in_the_loop,
      graph_json = excluded.graph_json,
      updated_at = excluded.updated_at
  `,
  ).run(
    workflow.id,
    workflow.name,
    workflow.description,
    workflow.maxRounds,
    workflow.humanInTheLoop ? 1 : 0,
    graphJson,
    updatedAt,
  );

  return {
    ...workflow,
    updatedAt,
  };
}

export function deleteWorkflow(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function createRunRecord(params: {
  id: string;
  workflowId: string;
  workflowName: string;
  taskPrompt: string;
  mode: 'live' | 'dry_run';
  maxRounds: number;
}): void {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO execution_runs (id, workflow_id, workflow_name, task_prompt, mode, status, rounds_executed, max_rounds, events_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'running', 0, ?, '[]', ?)
  `,
  ).run(
    params.id,
    params.workflowId,
    params.workflowName,
    params.taskPrompt,
    params.mode,
    params.maxRounds,
    createdAt,
  );
}

export function updateRunRecord(params: {
  id: string;
  status: ExecutionRunSummary['status'];
  roundsExecuted: number;
  events: ExecutionEvent[];
  completed?: boolean;
}): void {
  const db = getDb();
  const completedAt = params.completed ? new Date().toISOString() : null;
  db.prepare(
    `
    UPDATE execution_runs
    SET status = ?, rounds_executed = ?, events_json = ?, completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `,
  ).run(
    params.status,
    params.roundsExecuted,
    JSON.stringify(params.events),
    completedAt,
    params.id,
  );
}

export function listRunSummaries(limit = 20): ExecutionRunSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, workflow_id, workflow_name, task_prompt, mode, status, rounds_executed, max_rounds, created_at, completed_at
      FROM execution_runs
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    id: string;
    workflow_id: string;
    workflow_name: string;
    task_prompt: string;
    mode: 'live' | 'dry_run';
    status: ExecutionRunSummary['status'];
    rounds_executed: number;
    max_rounds: number;
    created_at: string;
    completed_at: string | null;
  }>;

  return rows.map((row) => {
    const durationMs =
      row.completed_at && row.created_at
        ? Math.max(0, new Date(row.completed_at).getTime() - new Date(row.created_at).getTime())
        : undefined;
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      taskPrompt: row.task_prompt,
      mode: row.mode,
      status: row.status,
      roundsExecuted: row.rounds_executed,
      maxRounds: row.max_rounds,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  });
}

export function getRunEvents(runId: string): ExecutionEvent[] {
  const db = getDb();
  const row = db
    .prepare('SELECT events_json FROM execution_runs WHERE id = ?')
    .get(runId) as { events_json: string } | undefined;
  if (!row) return [];
  return JSON.parse(row.events_json) as ExecutionEvent[];
}

export function getRunSummaryById(runId: string): ExecutionRunSummary | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT id, workflow_id, workflow_name, task_prompt, mode, status, rounds_executed, max_rounds, created_at, completed_at
      FROM execution_runs
      WHERE id = ?
    `,
    )
    .get(runId) as
    | {
        id: string;
        workflow_id: string;
        workflow_name: string;
        task_prompt: string;
        mode: 'live' | 'dry_run';
        status: ExecutionRunSummary['status'];
        rounds_executed: number;
        max_rounds: number;
        created_at: string;
        completed_at: string | null;
      }
    | undefined;
  if (!row) return null;
  const durationMs =
    row.completed_at && row.created_at
      ? Math.max(0, new Date(row.completed_at).getTime() - new Date(row.created_at).getTime())
      : undefined;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    taskPrompt: row.task_prompt,
    mode: row.mode,
    status: row.status,
    roundsExecuted: row.rounds_executed,
    maxRounds: row.max_rounds,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function deleteRunRecord(runId: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM execution_runs WHERE id = ?').run(runId);
  return Number(res.changes) > 0;
}

export function listRecentWorkflowRunsWithSummary(
  workflowId: string,
  limit = 5,
  excludeRunId?: string,
): Array<{
  id: string;
  taskPrompt: string;
  status: string;
  roundsExecuted: number;
  summary?: string;
  createdAt: string;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, task_prompt, status, rounds_executed, events_json, created_at
      FROM execution_runs
      WHERE workflow_id = ? AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(workflowId, limit + 1) as Array<{
    id: string;
    task_prompt: string;
    status: string;
    rounds_executed: number;
    events_json: string;
    created_at: string;
  }>;

  const out: Array<{
    id: string;
    taskPrompt: string;
    status: string;
    roundsExecuted: number;
    summary?: string;
    createdAt: string;
  }> = [];

  for (const row of rows) {
    if (excludeRunId && row.id === excludeRunId) continue;
    let summary: string | undefined;
    try {
      const evts = JSON.parse(row.events_json) as ExecutionEvent[];
      const lastAgentMsg = [...evts].reverse().find((e) => e.type === 'agent_message');
      summary = lastAgentMsg?.content?.slice(0, 160);
    } catch {
      // ignore malformed json
    }
    out.push({
      id: row.id,
      taskPrompt: row.task_prompt,
      status: row.status,
      roundsExecuted: row.rounds_executed,
      summary,
      createdAt: row.created_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function clearWorkflowRunsMemory(workflowId: string): number {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM execution_runs WHERE workflow_id = ? AND status IN ('completed', 'failed', 'cancelled')")
    .run(workflowId);
  return Number(res.changes);
}

export function getAppSettings(): AppSettings {
  const db = getDb();
  const row = db
    .prepare('SELECT settings_json FROM app_settings WHERE id = ?')
    .get('default') as { settings_json: string } | undefined;
  if (!row) {
    return saveAppSettings(DEFAULT_APP_SETTINGS);
  }
  return normalizeAppSettings(JSON.parse(row.settings_json) as Partial<AppSettings>);
}

export function saveAppSettings(input: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const normalized = normalizeAppSettings({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  db.prepare(
    `
    INSERT INTO app_settings (id, settings_json, updated_at)
    VALUES ('default', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `,
  ).run(JSON.stringify(normalized), normalized.updatedAt);
  return normalized;
}

export function listBugReports(filter?: {
  runId?: string;
  workflowId?: string;
  role?: string;
}): BugReportItem[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];

  if (filter?.runId) {
    clauses.push('run_id = ?');
    params.push(filter.runId);
  }
  if (filter?.workflowId) {
    clauses.push('workflow_id = ?');
    params.push(filter.workflowId);
  }
  if (filter?.role && filter.role !== 'all') {
    clauses.push('role = ?');
    params.push(filter.role);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM bug_reports ${where} ORDER BY created_at DESC LIMIT 100`,
    )
    .all(...params) as Array<{
    id: string;
    run_id: string | null;
    workflow_id: string | null;
    agent_id: string;
    agent_name: string;
    role: BugReportItem['role'];
    category: BugReportItem['category'];
    severity: BugReportItem['severity'];
    title: string;
    description: string;
    suggested_fix: string | null;
    status: BugReportStatus;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    agentId: row.agent_id,
    agentName: row.agent_name,
    role: row.role,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    suggestedFix: row.suggested_fix ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function createBugReport(
  input: Omit<BugReportItem, 'id' | 'createdAt' | 'status'> & {
    status?: BugReportStatus;
  },
): BugReportItem {
  const db = getDb();
  const item: BugReportItem = {
    id: crypto.randomUUID(),
    runId: input.runId,
    workflowId: input.workflowId,
    agentId: input.agentId,
    agentName: input.agentName,
    role: input.role,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    suggestedFix: input.suggestedFix,
    status: input.status ?? 'open',
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `
    INSERT INTO bug_reports (id, run_id, workflow_id, agent_id, agent_name, role, category, severity, title, description, suggested_fix, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    item.id,
    item.runId ?? null,
    item.workflowId ?? null,
    item.agentId,
    item.agentName,
    item.role,
    item.category,
    item.severity,
    item.title,
    item.description,
    item.suggestedFix ?? null,
    item.status,
    item.createdAt,
  );

  return item;
}

export function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): BugReportItem | null {
  const db = getDb();
  const res = db
    .prepare('UPDATE bug_reports SET status = ? WHERE id = ?')
    .run(status, id);
  if (Number(res.changes) === 0) return null;
  const row = db
    .prepare('SELECT * FROM bug_reports WHERE id = ?')
    .get(id) as
    | {
        id: string;
        run_id: string | null;
        workflow_id: string | null;
        agent_id: string;
        agent_name: string;
        role: BugReportItem['role'];
        category: BugReportItem['category'];
        severity: BugReportItem['severity'];
        title: string;
        description: string;
        suggested_fix: string | null;
        status: BugReportStatus;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    agentId: row.agent_id,
    agentName: row.agent_name,
    role: row.role,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    suggestedFix: row.suggested_fix ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function deleteBugReport(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM bug_reports WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function saveImportedProject(project: ImportedProjectAnalysis): ImportedProjectAnalysis {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO imported_projects (id, name, source_type, source_url, branch, analysis_json, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      source_type = excluded.source_type,
      source_url = excluded.source_url,
      branch = excluded.branch,
      analysis_json = excluded.analysis_json,
      imported_at = excluded.imported_at
  `,
  ).run(
    project.id,
    project.name,
    project.sourceType,
    project.sourceUrl ?? null,
    project.branch ?? null,
    JSON.stringify(project),
    project.importedAt,
  );
  return project;
}

export function listImportedProjects(limit = 20): ImportedProjectAnalysis[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT analysis_json FROM imported_projects ORDER BY imported_at DESC LIMIT ?')
    .all(limit) as Array<{ analysis_json: string }>;
  return rows.map((r) => JSON.parse(r.analysis_json) as ImportedProjectAnalysis);
}

export function getImportedProjectById(id: string): ImportedProjectAnalysis | null {
  const db = getDb();
  const row = db
    .prepare('SELECT analysis_json FROM imported_projects WHERE id = ?')
    .get(id) as { analysis_json: string } | undefined;
  return row ? (JSON.parse(row.analysis_json) as ImportedProjectAnalysis) : null;
}

export function updateImportedProject(
  id: string,
  patch: Partial<
    Pick<
      ImportedProjectAnalysis,
      'name' | 'sourceUrl' | 'branch' | 'managerSummary' | 'frameworks' | 'recommendations'
    >
  >,
): ImportedProjectAnalysis | null {
  const existing = getImportedProjectById(id);
  if (!existing) return null;
  const updated: ImportedProjectAnalysis = {
    ...existing,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : existing.name,
    sourceUrl:
      patch.sourceUrl !== undefined
        ? patch.sourceUrl.trim() || undefined
        : existing.sourceUrl,
    branch:
      patch.branch !== undefined
        ? patch.branch.trim() || undefined
        : existing.branch,
    managerSummary:
      typeof patch.managerSummary === 'string' && patch.managerSummary.trim()
        ? patch.managerSummary.trim()
        : existing.managerSummary,
    frameworks: Array.isArray(patch.frameworks) ? patch.frameworks : existing.frameworks,
    recommendations: Array.isArray(patch.recommendations)
      ? patch.recommendations
      : existing.recommendations,
  };
  return saveImportedProject(updated);
}

export function deleteImportedProject(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM imported_projects WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function setProviderSecret(secretName: string, secretValue: string): ProviderSecretStatus {
  const normalized = normalizeSecretName(secretName);
  if (!normalized) {
    throw new Error('Invalid secret identifier');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const trimmed = secretValue.trim();
  const encrypted = encryptSecret(trimmed);
  db.prepare(
    `
    INSERT INTO provider_secrets (secret_name, secret_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(secret_name) DO UPDATE SET
      secret_value = excluded.secret_value,
      updated_at = excluded.updated_at
  `,
  ).run(normalized, encrypted, now);

  return {
    secretName: normalized,
    configured: true,
    source: 'vault',
    maskedHint: maskApiKey(trimmed),
    updatedAt: now,
  };
}

export function deleteProviderSecret(secretName: string): boolean {
  const normalized = normalizeSecretName(secretName);
  if (!normalized) return false;
  const db = getDb();
  const res = db.prepare('DELETE FROM provider_secrets WHERE secret_name = ?').run(normalized);
  return Number(res.changes) > 0;
}

export function getProviderSecret(secretName: string): { value: string; updatedAt: string } | null {
  const normalized = normalizeSecretName(secretName);
  if (!normalized) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT secret_value, updated_at FROM provider_secrets WHERE secret_name = ?')
    .get(normalized) as { secret_value: string; updated_at: string } | undefined;
  if (!row || !row.secret_value.trim()) return null;
  try {
    const { value, wasPlaintext } = decryptSecret(row.secret_value);
    if (!value) return null;
    if (wasPlaintext && !isEncryptedSecretValue(row.secret_value)) {
      // Auto-migrate legacy plaintext vault row to AES-256-GCM encrypted format
      const encrypted = encryptSecret(value);
      db.prepare('UPDATE provider_secrets SET secret_value = ? WHERE secret_name = ?').run(
        encrypted,
        normalized,
      );
    }
    return { value, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function resolveServerSecret(secretName: string): {
  value: string | null;
  source: 'vault' | 'env' | 'none';
  updatedAt?: string;
} {
  const normalized = normalizeSecretName(secretName);
  if (!normalized) {
    return { value: null, source: 'none' };
  }
  const vault = getProviderSecret(normalized);
  if (vault) {
    return { value: vault.value, source: 'vault', updatedAt: vault.updatedAt };
  }
  const envVal = process.env[normalized]?.trim();
  if (envVal && envVal !== 'MY_GEMINI_API_KEY') {
    return { value: envVal, source: 'env' };
  }
  return { value: null, source: 'none' };
}

export function listProviderSecretStatuses(
  knownNames: string[] = [],
): Record<string, ProviderSecretStatus> {
  const db = getDb();
  const rows = db
    .prepare('SELECT secret_name, secret_value, updated_at FROM provider_secrets ORDER BY secret_name ASC')
    .all() as Array<{ secret_name: string; secret_value: string; updated_at: string }>;

  const allNames = new Set<string>([
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENCODE_API_KEY',
    'OLLAMA_API_KEY',
  ]);
  for (const name of knownNames) {
    const n = normalizeSecretName(name);
    if (n) allNames.add(n);
  }
  for (const r of rows) {
    allNames.add(r.secret_name);
  }

  const out: Record<string, ProviderSecretStatus> = {};
  for (const name of allNames) {
    const resolved = resolveServerSecret(name);
    out[name] = {
      secretName: name,
      configured: Boolean(resolved.value),
      source: resolved.source,
      maskedHint:
        resolved.source === 'vault' && resolved.value
          ? maskApiKey(resolved.value)
          : resolved.source === 'env'
            ? 'Server .env'
            : '',
      updatedAt: resolved.updatedAt,
    };
  }
  return out;
}

export function upsertContinuousSession(session: ContinuousWorkSession): ContinuousWorkSession {
  const db = getDb();
  const updated = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `
    INSERT INTO continuous_sessions (workflow_id, active, status, session_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workflow_id) DO UPDATE SET
      active = excluded.active,
      status = excluded.status,
      session_json = excluded.session_json,
      updated_at = excluded.updated_at
  `,
  ).run(
    updated.workflowId,
    updated.active ? 1 : 0,
    updated.status,
    JSON.stringify(updated),
    updated.updatedAt,
  );
  return updated;
}

export function getContinuousSession(workflowId: string): ContinuousWorkSession | null {
  const db = getDb();
  const row = db
    .prepare('SELECT session_json FROM continuous_sessions WHERE workflow_id = ?')
    .get(workflowId) as { session_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.session_json) as ContinuousWorkSession;
  } catch {
    return null;
  }
}

export function listActiveContinuousSessions(): ContinuousWorkSession[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT session_json FROM continuous_sessions WHERE active = 1 ORDER BY updated_at DESC')
    .all() as Array<{ session_json: string }>;
  const out: ContinuousWorkSession[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.session_json) as ContinuousWorkSession);
    } catch {
      // ignore corrupted entry
    }
  }
  return out;
}

export function savePrelaunchReport(report: PrelaunchTestReport): PrelaunchTestReport {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO prelaunch_reports (id, workflow_id, gate_status, overall_score, report_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gate_status = excluded.gate_status,
      overall_score = excluded.overall_score,
      report_json = excluded.report_json
  `,
  ).run(
    report.id,
    report.workflowId,
    report.gateStatus,
    report.overallScore,
    JSON.stringify(report),
    report.createdAt,
  );
  return report;
}

export function getLatestPrelaunchReport(workflowId?: string): PrelaunchTestReport | null {
  const db = getDb();
  const row = (
    workflowId
      ? db
          .prepare(
            'SELECT report_json FROM prelaunch_reports WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1',
          )
          .get(workflowId)
      : db
          .prepare('SELECT report_json FROM prelaunch_reports ORDER BY created_at DESC LIMIT 1')
          .get()
  ) as { report_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.report_json) as PrelaunchTestReport;
  } catch {
    return null;
  }
}

interface RawUserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  job_title: string;
  bio: string;
  avatar_color: string;
  role: string;
  password_hash: string;
  session_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function mapUserRow(row: RawUserRow): UserProfile {
  const validRole: UserRole =
    row.role === 'admin' || row.role === 'viewer' ? row.role : 'operator';
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    jobTitle: row.job_title || '',
    bio: row.bio || '',
    avatarColor: row.avatar_color || '#2563eb',
    role: validRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
  };
}

export function countUsers(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  return Number(row?.cnt ?? 0);
}

export function getAuthPolicy(): { requireAuth: boolean; allowSelfRegistration: boolean } {
  const db = getDb();
  const row = db
    .prepare('SELECT require_auth, allow_self_registration FROM auth_policy WHERE id = ?')
    .get('default') as { require_auth: number; allow_self_registration: number } | undefined;
  if (!row) {
    return { requireAuth: true, allowSelfRegistration: false };
  }
  return {
    requireAuth: Boolean(row.require_auth),
    allowSelfRegistration: Boolean(row.allow_self_registration),
  };
}

export function saveAuthPolicy(patch: {
  requireAuth?: boolean;
  allowSelfRegistration?: boolean;
}): { requireAuth: boolean; allowSelfRegistration: boolean } {
  const db = getDb();
  const prev = getAuthPolicy();
  const next = {
    requireAuth: patch.requireAuth ?? prev.requireAuth,
    allowSelfRegistration: patch.allowSelfRegistration ?? prev.allowSelfRegistration,
  };
  db.prepare(
    `
    INSERT INTO auth_policy (id, require_auth, allow_self_registration, updated_at)
    VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      require_auth = excluded.require_auth,
      allow_self_registration = excluded.allow_self_registration,
      updated_at = excluded.updated_at
  `,
  ).run(next.requireAuth ? 1 : 0, next.allowSelfRegistration ? 1 : 0, new Date().toISOString());
  return next;
}

export function createUserRecord(params: {
  email: string;
  username: string;
  displayName: string;
  jobTitle?: string;
  bio?: string;
  avatarColor?: string;
  role: UserRole;
  passwordHash: string;
}): { user: UserProfile; sessionVersion: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `usr-${crypto.randomUUID()}`;
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanUsername = params.username.trim().toLowerCase();

  db.prepare(
    `
    INSERT INTO users (
      id, email, username, display_name, job_title, bio, avatar_color,
      role, password_hash, session_version, created_at, updated_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `,
  ).run(
    id,
    cleanEmail,
    cleanUsername,
    params.displayName.trim(),
    (params.jobTitle || '').trim(),
    (params.bio || '').trim(),
    params.avatarColor || '#2563eb',
    params.role,
    params.passwordHash,
    now,
    now,
    now,
  );

  const created = getUserWithAuthById(id)!;
  return { user: created.user, sessionVersion: created.sessionVersion };
}

export function getUserWithAuthByIdentifier(identifier: string): {
  user: UserProfile;
  passwordHash: string;
  sessionVersion: number;
} | null {
  const db = getDb();
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;
  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1')
    .get(clean, clean) as RawUserRow | undefined;
  if (!row) return null;
  return {
    user: mapUserRow(row),
    passwordHash: row.password_hash,
    sessionVersion: Number(row.session_version || 1),
  };
}

export function getUserWithAuthById(id: string): {
  user: UserProfile;
  passwordHash: string;
  sessionVersion: number;
} | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUserRow | undefined;
  if (!row) return null;
  return {
    user: mapUserRow(row),
    passwordHash: row.password_hash,
    sessionVersion: Number(row.session_version || 1),
  };
}

export function listUserProfiles(): UserProfile[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM users ORDER BY created_at ASC')
    .all() as unknown as RawUserRow[];
  return rows.map(mapUserRow);
}

export function recordUserLogin(id: string): UserProfile | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  return getUserWithAuthById(id)?.user ?? null;
}

export function updateUserProfileRecord(
  id: string,
  patch: {
    displayName?: string;
    email?: string;
    username?: string;
    jobTitle?: string;
    bio?: string;
    avatarColor?: string;
    role?: UserRole;
  },
): UserProfile | null {
  const db = getDb();
  const existing = getUserWithAuthById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextDisplayName = (patch.displayName ?? existing.user.displayName).trim() || existing.user.displayName;
  const nextEmail = (patch.email ?? existing.user.email).trim().toLowerCase();
  const nextUsername = (patch.username ?? existing.user.username).trim().toLowerCase();
  const nextJobTitle = (patch.jobTitle ?? existing.user.jobTitle ?? '').trim();
  const nextBio = (patch.bio ?? existing.user.bio ?? '').trim();
  const nextAvatarColor = patch.avatarColor ?? existing.user.avatarColor ?? '#2563eb';
  const nextRole = patch.role ?? existing.user.role;

  db.prepare(
    `
    UPDATE users
    SET display_name = ?, email = ?, username = ?, job_title = ?, bio = ?,
        avatar_color = ?, role = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    nextDisplayName,
    nextEmail,
    nextUsername,
    nextJobTitle,
    nextBio,
    nextAvatarColor,
    nextRole,
    now,
    id,
  );
  return getUserWithAuthById(id)?.user ?? null;
}

export function updateUserPasswordRecord(
  id: string,
  passwordHash: string,
): { user: UserProfile; sessionVersion: number } | null {
  const db = getDb();
  const existing = getUserWithAuthById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextVersion = existing.sessionVersion + 1;
  db.prepare(
    'UPDATE users SET password_hash = ?, session_version = ?, updated_at = ? WHERE id = ?',
  ).run(passwordHash, nextVersion, now, id);
  const updated = getUserWithAuthById(id);
  if (!updated) return null;
  return { user: updated.user, sessionVersion: updated.sessionVersion };
}

export function bumpUserSessionVersion(id: string): number {
  const db = getDb();
  const existing = getUserWithAuthById(id);
  if (!existing) return 1;
  const nextVersion = existing.sessionVersion + 1;
  db.prepare('UPDATE users SET session_version = ?, updated_at = ? WHERE id = ?').run(
    nextVersion,
    new Date().toISOString(),
    id,
  );
  return nextVersion;
}

export function deleteUserRecord(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.changes > 0;
}

interface RawNginxDomainRow {
  id: string;
  domain: string;
  upstream_port: number;
  ssl_mode: string;
  ssl_email: string;
  ssl_cert_path: string;
  ssl_key_path: string;
  redirect_www: number;
  client_max_body_mb: number;
  enable_websocket: number;
  enable_hsts: number;
  status: string;
  dns_ips_json: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapNginxDomainRow(row: RawNginxDomainRow): NginxDomainConfig {
  let ips: string[] = [];
  try {
    const parsed = JSON.parse(row.dns_ips_json || '[]');
    if (Array.isArray(parsed)) ips = parsed.map((v) => String(v));
  } catch {
    ips = [];
  }
  const sslMode: NginxSslMode =
    row.ssl_mode === 'http_only' || row.ssl_mode === 'custom_cert'
      ? row.ssl_mode
      : 'letsencrypt';
  const status: NginxDomainStatus =
    row.status === 'dns_verified' || row.status === 'active' ? row.status : 'draft';
  return {
    id: row.id,
    domain: row.domain,
    upstreamPort: Number(row.upstream_port || 3000),
    sslMode,
    ...(row.ssl_email ? { sslEmail: row.ssl_email } : {}),
    ...(row.ssl_cert_path ? { sslCertPath: row.ssl_cert_path } : {}),
    ...(row.ssl_key_path ? { sslKeyPath: row.ssl_key_path } : {}),
    redirectWww: Boolean(row.redirect_www),
    clientMaxBodyMb: Number(row.client_max_body_mb || 30),
    enableWebsocket: Boolean(row.enable_websocket),
    enableHsts: Boolean(row.enable_hsts),
    status,
    dnsResolvedIps: ips,
    ...(row.last_checked_at ? { lastCheckedAt: row.last_checked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNginxDomains(): NginxDomainConfig[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM nginx_domains ORDER BY updated_at DESC')
    .all() as unknown as RawNginxDomainRow[];
  return rows.map(mapNginxDomainRow);
}

export function getNginxDomainById(id: string): NginxDomainConfig | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM nginx_domains WHERE id = ?')
    .get(id) as RawNginxDomainRow | undefined;
  return row ? mapNginxDomainRow(row) : null;
}

export function upsertNginxDomain(input: {
  id?: string;
  domain: string;
  upstreamPort: number;
  sslMode: NginxSslMode;
  sslEmail?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
  redirectWww: boolean;
  clientMaxBodyMb: number;
  enableWebsocket: boolean;
  enableHsts: boolean;
  status?: NginxDomainStatus;
}): NginxDomainConfig {
  const db = getDb();
  const now = new Date().toISOString();
  const cleanDomain = input.domain.trim().toLowerCase();
  const byDomain = db
    .prepare('SELECT * FROM nginx_domains WHERE LOWER(domain) = ? LIMIT 1')
    .get(cleanDomain) as RawNginxDomainRow | undefined;
  const existing = (input.id ? getNginxDomainById(input.id) : null) || (byDomain ? mapNginxDomainRow(byDomain) : null);
  const id = existing?.id || input.id || `dom-${crypto.randomUUID()}`;
  const createdAt = existing?.createdAt || now;

  db.prepare(
    `
    INSERT INTO nginx_domains (
      id, domain, upstream_port, ssl_mode, ssl_email, ssl_cert_path, ssl_key_path,
      redirect_www, client_max_body_mb, enable_websocket, enable_hsts, status,
      dns_ips_json, last_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      domain = excluded.domain,
      upstream_port = excluded.upstream_port,
      ssl_mode = excluded.ssl_mode,
      ssl_email = excluded.ssl_email,
      ssl_cert_path = excluded.ssl_cert_path,
      ssl_key_path = excluded.ssl_key_path,
      redirect_www = excluded.redirect_www,
      client_max_body_mb = excluded.client_max_body_mb,
      enable_websocket = excluded.enable_websocket,
      enable_hsts = excluded.enable_hsts,
      status = excluded.status,
      updated_at = excluded.updated_at
  `,
  ).run(
    id,
    cleanDomain,
    input.upstreamPort,
    input.sslMode,
    (input.sslEmail || '').trim(),
    (input.sslCertPath || '').trim(),
    (input.sslKeyPath || '').trim(),
    input.redirectWww ? 1 : 0,
    input.clientMaxBodyMb,
    input.enableWebsocket ? 1 : 0,
    input.enableHsts ? 1 : 0,
    input.status ?? existing?.status ?? 'draft',
    JSON.stringify(existing?.dnsResolvedIps ?? []),
    existing?.lastCheckedAt ?? null,
    createdAt,
    now,
  );
  return getNginxDomainById(id)!;
}

export function updateNginxDomainCheck(
  id: string,
  patch: {
    status: NginxDomainStatus;
    dnsResolvedIps?: string[];
    lastCheckedAt?: string;
  },
): NginxDomainConfig | null {
  const db = getDb();
  const existing = getNginxDomainById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE nginx_domains
    SET status = ?, dns_ips_json = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    patch.status,
    JSON.stringify(patch.dnsResolvedIps ?? existing.dnsResolvedIps ?? []),
    patch.lastCheckedAt ?? existing.lastCheckedAt ?? now,
    now,
    id,
  );
  return getNginxDomainById(id);
}

export function deleteNginxDomain(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM nginx_domains WHERE id = ?').run(id);
  return res.changes > 0;
}



