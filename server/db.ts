import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SEED_WORKFLOWS } from '../src/data/agentTemplates.ts';
import type {
  AppSettings,
  BugReportItem,
  BugReportStatus,
  ExecutionEvent,
  ExecutionRunSummary,
  ImportedProjectAnalysis,
  WorkflowConfig,
} from '../src/types/workflow.ts';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../src/utils/workflowEngine.ts';

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
    };
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      maxRounds: row.max_rounds,
      humanInTheLoop: Boolean(row.human_in_the_loop),
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
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    maxRounds: row.max_rounds,
    humanInTheLoop: Boolean(row.human_in_the_loop),
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

  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    taskPrompt: row.task_prompt,
    mode: row.mode,
    status: row.status,
    roundsExecuted: row.rounds_executed,
    maxRounds: row.max_rounds,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }));
}

export function getRunEvents(runId: string): ExecutionEvent[] {
  const db = getDb();
  const row = db
    .prepare('SELECT events_json FROM execution_runs WHERE id = ?')
    .get(runId) as { events_json: string } | undefined;
  if (!row) return [];
  return JSON.parse(row.events_json) as ExecutionEvent[];
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

export function deleteImportedProject(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM imported_projects WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}
