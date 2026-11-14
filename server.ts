import 'dotenv/config';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  createBugReport,
  createRunRecord,
  deleteBugReport,
  deleteImportedProject,
  deleteWorkflow,
  getAppSettings,
  getDb,
  getImportedProjectById,
  getRunEvents,
  getWorkflowById,
  listBugReports,
  listImportedProjects,
  listRunSummaries,
  listWorkflows,
  saveAppSettings,
  saveImportedProject,
  updateBugReportStatus,
  updateRunRecord,
  upsertWorkflow,
} from './server/db.ts';
import type {
  AgentRole,
  AppSettings,
  BlueprintFile,
  BugReportStatus,
  ExecutionEvent,
  ImportedProjectAnalysis,
  RecommendedAgentSpec,
  SandboxFile,
  ToolCallLog,
  WorkflowConfig,
  WorkflowNode,
} from './src/types/workflow.ts';
import { PROVIDER_MODELS } from './src/data/agentTemplates.ts';
import {
  analyzeProjectFiles,
  parseGitHubRepoInput,
  sanitizeArchiveEntryPath,
  type ScannedProjectFile,
} from './src/utils/projectAnalyzer.ts';
import {
  buildManagerInspectionContext,
  buildStructuredAgentPrompt,
  clampMaxRounds,
  computeExecutionOrder,
  detectSensitiveCommand,
  extractBugReportsFromReply,
  extractFreeOpenCodeModels,
  extractManagerDelegations,
  findManagerNode,
  isManagerNode,
  orderGroupChatParticipants,
  selectNextSpeaker,
  serializeWorkflowForExport,
  validateWorkflowForRun,
} from './src/utils/workflowEngine.ts';

const execAsync = promisify(exec);
const PORT = Number(process.env.PORT || 3000);
const SANDBOX_BASE = path.resolve('/tmp/aetherflow_sandboxes');
const PROJECTS_BASE = path.resolve('/tmp/aetherflow_projects');

// Initialize SQLite database on boot
getDb();

const app = express();
app.use(express.json({ limit: '25mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const runSubscribers = new Map<string, Set<WebSocket>>();
const runEventBuffers = new Map<string, ExecutionEvent[]>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function broadcastEvent(runId: string, event: ExecutionEvent): void {
  const list = runEventBuffers.get(runId) ?? [];
  list.push(event);
  runEventBuffers.set(runId, list);

  const clients = runSubscribers.get(runId);
  if (!clients) return;
  const serialized = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(serialized);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const runId = url.searchParams.get('runId');

  if (runId) {
    if (!runSubscribers.has(runId)) {
      runSubscribers.set(runId, new Set());
    }
    runSubscribers.get(runId)!.add(ws);

    const buffered = runEventBuffers.get(runId) ?? getRunEvents(runId);
    for (const evt of buffered) {
      ws.send(JSON.stringify(evt));
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        runId?: string;
        approvalId?: string;
        approved?: boolean;
      };
      if (msg.type === 'subscribe' && msg.runId) {
        if (!runSubscribers.has(msg.runId)) {
          runSubscribers.set(msg.runId, new Set());
        }
        runSubscribers.get(msg.runId)!.add(ws);
        const buffered = runEventBuffers.get(msg.runId) ?? getRunEvents(msg.runId);
        for (const evt of buffered) {
          ws.send(JSON.stringify(evt));
        }
      } else if (msg.type === 'approval_decision' && msg.approvalId) {
        const resolver = pendingApprovals.get(msg.approvalId);
        if (resolver) {
          resolver(Boolean(msg.approved));
          pendingApprovals.delete(msg.approvalId);
        }
      }
    } catch {
      // Ignore malformed client messages
    }
  });

  ws.on('close', () => {
    for (const set of runSubscribers.values()) {
      set.delete(ws);
    }
  });
});

function getSandboxDir(runId: string): string {
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(SANDBOX_BASE, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeSandboxPath(runDir: string, relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, '').replace(/\.\./g, '');
  const target = path.resolve(runDir, cleaned);
  if (!target.startsWith(runDir)) {
    throw new Error(`Blocked path traversal attempt: ${relPath}`);
  }
  return target;
}

function listSandboxFiles(runId: string): SandboxFile[] {
  const runDir = getSandboxDir(runId);
  const files: SandboxFile[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files.push({
          path: path.relative(runDir, fullPath).replace(/\\/g, '/'),
          content: fs.readFileSync(fullPath, 'utf-8'),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  walk(runDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function getProjectDir(projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(PROJECTS_BASE, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractProjectFilesFromZip(
  zipBuffer: Buffer,
  projectId: string,
  forceStripCommonRoot?: boolean,
): ScannedProjectFile[] {
  const zip = new AdmZip(zipBuffer);
  const rawEntries = zip.getEntries().filter((e) => !e.isDirectory);
  if (rawEntries.length === 0) {
    throw new Error('The ZIP archive contains no readable files.');
  }

  // Detect whether all entries live inside a single top-level folder (like GitHub zipballs)
  const firstSegments = new Set(
    rawEntries
      .map((e) => e.entryName.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0])
      .filter(Boolean),
  );
  const allNestedInFolder = rawEntries.every((e) =>
    e.entryName.replace(/\\/g, '/').replace(/^\/+/, '').includes('/'),
  );
  const stripRoot =
    forceStripCommonRoot !== undefined
      ? forceStripCommonRoot
      : firstSegments.size === 1 && allNestedInFolder;

  const projectDir = getProjectDir(projectId);
  const scanned: ScannedProjectFile[] = [];

  for (const entry of rawEntries) {
    if (scanned.length >= 400) break;
    const relPath = sanitizeArchiveEntryPath(entry.entryName, stripRoot);
    if (!relPath) continue;

    const rawBuf = entry.getData();
    // Skip very large files or binary NUL buffers
    if (rawBuf.length > 512 * 1024) continue;
    if (rawBuf.subarray(0, 512).includes(0)) continue;

    const text = rawBuf.toString('utf-8');
    const target = safeSandboxPath(projectDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf-8');

    scanned.push({
      path: relPath,
      content: text.slice(0, 12000),
      size: rawBuf.length,
    });
  }

  if (scanned.length === 0) {
    throw new Error('No readable source or configuration files were found in the archive.');
  }

  return scanned.sort((a, b) => a.path.localeCompare(b.path));
}

function seedSandboxFromProject(runId: string, projectId?: string): void {
  if (!projectId) return;
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  const srcDir = path.join(PROJECTS_BASE, safeId);
  if (!fs.existsSync(srcDir)) return;

  const runDir = getSandboxDir(runId);
  if (fs.readdirSync(runDir).length > 0) return;

  let copied = 0;
  function walkCopy(curr: string) {
    if (copied >= 45) return;
    for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
      if (copied >= 45) return;
      const full = path.join(curr, entry.name);
      const rel = path.relative(srcDir, full);
      const dest = path.join(runDir, rel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        walkCopy(full);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(full, dest);
        copied += 1;
      }
    }
  }
  walkCopy(srcDir);
}

async function refineProjectAnalysisWithManagerAI(params: {
  baseAnalysis: ImportedProjectAnalysis;
  files: ScannedProjectFile[];
  language: 'en' | 'fa';
  mode?: 'live' | 'dry_run';
}): Promise<ImportedProjectAnalysis> {
  const { baseAnalysis, files, language, mode } = params;
  if (mode === 'dry_run') return baseAnalysis;
  const ai = getAiClient();
  if (!ai) return baseAnalysis;

  const fileIndex = files
    .slice(0, 70)
    .map((f) => `- ${f.path} (${f.size ?? f.content.length}B)`)
    .join('\n');

  const manifestSnippets = files
    .filter((f) =>
      /(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|docker-compose\.ya?ml|dockerfile|readme\.md)$/i.test(
        f.path,
      ),
    )
    .slice(0, 6)
    .map((f) => `### ${f.path}\n${f.content.slice(0, 1500)}`)
    .join('\n\n');

  const isFa = language === 'fa';
  const validRoles = new Set<AgentRole>([
    'manager',
    'backend',
    'frontend',
    'security_qa',
    'executor',
    'custom',
  ]);

  const systemInstruction =
    `You are the Lead Software Architect & Manager Agent in AetherFlow Studio.\n` +
    `Analyze the imported software project and recommend the optimal team of AI agents and exact specialties needed to develop, debug, secure, test, and deploy it.\n` +
    `Respond ONLY with valid JSON matching this schema:\n` +
    `{\n` +
    `  "managerSummary": "string (concise architectural assessment & team rationale)",\n` +
    `  "recommendations": [\n` +
    `    {\n` +
    `      "title": "string",\n` +
    `      "role": "manager" | "backend" | "frontend" | "security_qa" | "executor" | "custom",\n` +
    `      "specialty": "string (specific tech specialty matching project stack)",\n` +
    `      "reason": "string (why needed based on actual files)",\n` +
    `      "priority": "essential" | "recommended" | "optional",\n` +
    `      "matchedSignals": ["file or package name"],\n` +
    `      "systemPrompt": "string (tailored specialist prompt)",\n` +
    `      "tools": { "readFile": true, "writeFile": boolean, "execBash": boolean }\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    (isFa
      ? `Write managerSummary, title, specialty, and reason in fluent Persian/Farsi (keeping technical framework names accurate).`
      : `Write managerSummary, title, specialty, and reason in clear English.`);

  const userPrompt =
    `Project: ${baseAnalysis.name} (${baseAnalysis.sourceType})\n` +
    `Detected Languages: ${baseAnalysis.languages.map((l) => `${l.name} (${l.files})`).join(', ')}\n` +
    `Detected Frameworks: ${baseAnalysis.frameworks.join(', ')}\n\n` +
    `Files (${files.length} total, top 70 shown):\n${fileIndex}\n\n` +
    `Key Manifests & README:\n${manifestSnippets}`;

  for (const modelName of ['gemini-3.1-flash-lite', 'gemini-4-argon']) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          httpOptions: { timeout: 14000 },
        },
      });
      const rawText = (response.text || '').trim();
      if (!rawText) continue;
      const jsonStr = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(jsonStr) as {
        managerSummary?: string;
        recommendations?: Array<{
          title?: string;
          role?: string;
          specialty?: string;
          reason?: string;
          priority?: string;
          matchedSignals?: string[];
          systemPrompt?: string;
          tools?: { readFile?: boolean; writeFile?: boolean; execBash?: boolean };
        }>;
      };

      if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length === 0) {
        continue;
      }

      const appSettings = getAppSettings();
      const refinedRecs: RecommendedAgentSpec[] = parsed.recommendations
        .filter((r) => r && r.title && r.specialty && r.reason)
        .slice(0, 8)
        .map((r, idx) => {
          const role: AgentRole = validRoles.has(r.role as AgentRole)
            ? (r.role as AgentRole)
            : 'custom';
          const fallbackMatch =
            baseAnalysis.recommendations.find((b) => b.role === role) ??
            baseAnalysis.recommendations[0];
          const provider = fallbackMatch?.recommendedProvider ?? 'gemini';
          const model =
            appSettings.providers[provider]?.defaultModel ||
            fallbackMatch?.recommendedModel ||
            'gemini-4-hydrogen';
          const priority =
            r.priority === 'essential' || r.priority === 'recommended' || r.priority === 'optional'
              ? r.priority
              : 'recommended';
          return {
            id: `rec-ai-${idx + 1}`,
            title: String(r.title).trim(),
            role,
            specialty: String(r.specialty).trim(),
            reason: String(r.reason).trim(),
            recommendedProvider: provider,
            recommendedModel: model,
            systemPrompt:
              typeof r.systemPrompt === 'string' && r.systemPrompt.trim()
                ? r.systemPrompt.trim()
                : fallbackMatch?.systemPrompt || `You are ${r.title} working on ${baseAnalysis.name}.`,
            tools: {
              readFile: r.tools?.readFile ?? true,
              writeFile: r.tools?.writeFile ?? (role !== 'manager'),
              execBash: r.tools?.execBash ?? (role === 'executor'),
            },
            priority,
            matchedSignals: Array.isArray(r.matchedSignals)
              ? r.matchedSignals.map((s) => String(s)).slice(0, 5)
              : fallbackMatch?.matchedSignals ?? [],
          };
        });

      if (refinedRecs.length > 0) {
        return {
          ...baseAnalysis,
          managerSummary:
            typeof parsed.managerSummary === 'string' && parsed.managerSummary.trim()
              ? parsed.managerSummary.trim()
              : baseAnalysis.managerSummary,
          recommendations: refinedRecs,
          usedLiveAi: true,
        };
      }
    } catch {
      // Fallback to deterministic Manager analysis cleanly
    }
  }

  return baseAnalysis;
}

async function runSandboxCommand(
  runDir: string,
  command: string,
  timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: runDir,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: runDir,
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: (execErr.stdout || '').trim(),
      stderr: (execErr.stderr || execErr.message || 'Command failed').trim(),
      exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
    };
  }
}

function buildDryRunAgentReply(
  node: WorkflowNode,
  taskPrompt: string,
  roundNum: number,
  maxRounds: number,
): string {
  const role = node.data.role;
  if (role === 'manager') {
    if (roundNum >= maxRounds || roundNum > 3) {
      return (
        `All implementation, security checks, and sandbox verifications passed for "${taskPrompt.slice(0, 72)}".\n` +
        `Execution checklist complete. TERMINATE`
      );
    }
    return (
      `Architecture Plan for "${taskPrompt}":\n` +
      `1. Backend Agent: implement validated service module under app/service.py\n` +
      `2. Frontend Agent: expose clean status & form UI under app/DashboardWidget.tsx\n` +
      `3. Security & QA Agent: audit input sanitization and write tests/test_service.mjs\n` +
      `4. Executor Agent: verify inside isolated Linux container sandbox.\n` +
      `Handoff -> Backend Agent.`
    );
  }

  if (role === 'backend') {
    return (
      `Implemented core backend module with strict input validation and structured JSON responses.\n\n` +
      `WRITE_FILE:app/service.mjs\n` +
      '```javascript\n' +
      `export function evaluateTaskHealth(payload) {\n` +
      `  if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) {\n` +
      `    throw new Error('Invalid task payload: name is required');\n` +
      `  }\n` +
      `  return { ok: true, service: payload.name.trim(), checkedAt: new Date().toISOString() };\n` +
      `}\n` +
      '```\n\n' +
      `Handoff -> Security & QA Agent for audit.`
    );
  }

  if (role === 'frontend') {
    return (
      `Created modular React status view aligned with backend contract.\n\n` +
      `WRITE_FILE:app/Widget.tsx\n` +
      '```tsx\n' +
      `export function StatusPanel({ service }: { service: string }) {\n` +
      `  return (\n` +
      `    <section className="rounded-lg border border-slate-200 p-4">\n` +
      `      <h3 className="text-sm font-semibold text-slate-900">{service}</h3>\n` +
      `      <p className="text-xs text-slate-600">Validated and monitored</p>\n` +
      `    </section>\n` +
      `  );\n` +
      `}\n` +
      '```\n\n' +
      `Handoff -> Security & QA Agent.`
    );
  }

  if (role === 'security_qa') {
    return (
      `Completed OWASP validation check: no unsafe eval, shell interpolation, or path traversal detected.\n\n` +
      `READ_FILE:app/service.mjs\n\n` +
      `WRITE_FILE:tests/service.test.mjs\n` +
      '```javascript\n' +
      `import test from 'node:test';\n` +
      `import assert from 'node:assert/strict';\n` +
      `import { evaluateTaskHealth } from '../app/service.mjs';\n\n` +
      `test('evaluateTaskHealth validates input and returns ok status', () => {\n` +
      `  const res = evaluateTaskHealth({ name: 'api-gateway' });\n` +
      `  assert.equal(res.ok, true);\n` +
      `  assert.equal(res.service, 'api-gateway');\n` +
      `  assert.throws(() => evaluateTaskHealth({ name: '' }));\n` +
      `});\n` +
      '```\n\n' +
      `Handoff -> Executor Agent to run automated checks in sandbox.`
    );
  }

  // Executor or custom
  return (
    `Running sandbox verification suite and checking dependency integrity inside Linux container:\n\n` +
    `EXEC_BASH:node --test tests/service.test.mjs && chmod 644 app/service.mjs\n\n` +
    `Report -> Ready for final Manager sign-off.`
  );
}

function buildDryRunDirectReply(node: WorkflowNode, userMessage: string): string {
  const snippet = userMessage.trim().slice(0, 96);
  const isFa = /[\u0600-\u06FF]/.test(userMessage);
  const role = node.data.role;

  if (role === 'backend') {
    return isFa
      ? `درخواست شما توسط ${node.data.label} دریافت شد («${snippet}»).\nیک ماژول بک‌اند معتبر همراه با بررسی ورودی در مسیر app/chat_handler.mjs ایجاد شد.\n\nWRITE_FILE:app/chat_handler.mjs\n\`\`\`javascript\nexport function handleAction(input) {\n  if (!input || !String(input).trim()) {\n    throw new Error('Input is required');\n  }\n  return { ok: true, received: String(input).trim() };\n}\n\`\`\``
      : `Received your direct instruction as ${node.data.label}: "${snippet}".\nImplemented a validated backend handler:\n\nWRITE_FILE:app/chat_handler.mjs\n\`\`\`javascript\nexport function handleAction(input) {\n  if (!input || !String(input).trim()) {\n    throw new Error('Input is required');\n  }\n  return { ok: true, received: String(input).trim() };\n}\n\`\`\``;
  }

  if (role === 'frontend') {
    return isFa
      ? `${node.data.label} آماده است. بر اساس دستور «${snippet}»، کامپوننت رابط کاربری استاندارد طراحی شد:\n\nWRITE_FILE:app/ChatWidget.tsx\n\`\`\`tsx\nexport function ChatWidget({ title }: { title: string }) {\n  return <div className="rounded-lg border p-3 text-sm">{title}</div>;\n}\n\`\`\``
      : `${node.data.label} responding to "${snippet}": drafted clean UI component.\n\nWRITE_FILE:app/ChatWidget.tsx\n\`\`\`tsx\nexport function ChatWidget({ title }: { title: string }) {\n  return <div className="rounded-lg border p-3 text-sm">{title}</div>;\n}\n\`\`\``;
  }

  if (role === 'security_qa') {
    return isFa
      ? `بررسی امنیتی ${node.data.label} روی درخواست «${snippet}» انجام شد:\n- اعتبارسنجی ورودی‌ها و جلوگیری از Command Injection\n- عدم افشای کلیدهای محرمانه در خروجی\nهمه موارد در وضعیت ایمن تایید شدند.`
      : `${node.data.label} security & QA review for "${snippet}":\n- Verified strict input validation and path sanitization.\n- No hardcoded secrets or unsafe shell interpolation found.`;
  }

  if (role === 'executor') {
    return isFa
      ? `اجرای بررسی در کانتینر سندباکس لینوکس برای «${snippet}»:\n\nEXEC_BASH:ls -la\n\nفایل‌های محیط کاری آماده بررسی هستند.`
      : `Executing workspace check inside Linux sandbox for "${snippet}":\n\nEXEC_BASH:ls -la\n\nSandbox workspace inspected cleanly.`;
  }

  return isFa
    ? `${node.data.label} پیام شما («${snippet}») را دریافت کرد.\nگام‌های پیشنهادی:\n1. مشخص کردن خروجی دقیق مورد انتظار\n2. پیاده‌سازی یا بررسی فایل در سندباکس\n3. تایید نهایی و تست خروجی.\nدر صورت نیاز دستور بعدی را بفرستید.`
    : `${node.data.label} acknowledged: "${snippet}".\nRecommended next steps:\n1. Confirm exact files or endpoints to update\n2. Run implementation or security audit\n3. Verify in sandbox.`;
}

function buildDryRunGroupDiscussionReply(params: {
  node: WorkflowNode;
  userMessage: string;
  priorSpeakers: string[];
}): string {
  const { node, userMessage, priorSpeakers } = params;
  const isFa = /[\u0600-\u06FF]/.test(userMessage);
  const prev = priorSpeakers.length > 0 ? priorSpeakers[priorSpeakers.length - 1] : null;
  const role = node.data.role;
  const snippet = userMessage.trim().slice(0, 80);

  if (role === 'manager') {
    return isFa
      ? `درود به همگی! برای درخواست «${snippet}»، من هماهنگی تیم را بر عهده می‌گیرم:\n- @Backend Agent لطفاً مدل داده و API را طراحی کن.\n- @Frontend Agent رابط کاربری متناسب را آماده کن.\n- @Security & QA Agent موارد امنیتی را چک کن.\n- @Executor Agent در پایان خروجی را در سندباکس تست کن.\n\nBUG_REPORT: {"category":"improvement","severity":"low","title":"تعریف قرارداد API مشترک قبل از پیاده‌سازی","description":"برای جلوگیری از ناهماهنگی بین فرانت‌اند و بک‌اند، بهتر است یک OpenAPI Schema پایه ثبت شود.","suggestedFix":"افزودن فایل docs/api-contract.json توسط Backend Agent"}`
      : `Team, let's align on "${snippet}":\n- @Backend Agent please propose the core service & API contract.\n- @Frontend Agent align UI state with that schema.\n- @Security & QA Agent review edge cases and validation.\n- @Executor Agent verify checks in the sandbox.\n\nBUG_REPORT: {"category":"improvement","severity":"low","title":"Shared OpenAPI contract before parallel coding","description":"Defining a shared request/response schema prevents frontend-backend integration drift.","suggestedFix":"Generate docs/openapi.json alongside core service"}`;
  }

  if (role === 'backend') {
    const refText = prev ? (isFa ? `همسو با نکات ${prev}، ` : `Building on ${prev}'s points, `) : '';
    return isFa
      ? `${refText}من لایه بک‌اند را با اعتبارسنجی دقیق ورودی پیاده‌سازی کردم و فایل service.mjs را در سندباکس نوشتم. @Frontend Agent می‌توانی با همین ساختار JSON متصل شوی و @Security & QA Agent لطفاً Rate Limit را بررسی کن.\n\nWRITE_FILE:app/service.mjs\n\`\`\`javascript\nexport function processRequest(payload) {\n  if (!payload || typeof payload.input !== 'string' || !payload.input.trim()) {\n    throw new Error('Invalid input');\n  }\n  return { ok: true, data: payload.input.trim() };\n}\n\`\`\`\n\nBUG_REPORT: {"category":"bug","severity":"medium","title":"نبود محدودیت نرخ درخواست (Rate Limit) در لایه بک‌اند","description":"درخواست‌های پیاپی بدون Rate Limiter می‌توانند باعث مصرف بیش از حد منابع شوند.","suggestedFix":"افزودن Middleware محدودکننده نرخ درخواست در روتر اصلی"}`
      : `${refText}I implemented the backend handler in app/service.mjs with strict payload validation. @Frontend Agent you can bind directly to this JSON contract, and @Security & QA Agent please audit throttling.\n\nWRITE_FILE:app/service.mjs\n\`\`\`javascript\nexport function processRequest(payload) {\n  if (!payload || typeof payload.input !== 'string' || !payload.input.trim()) {\n    throw new Error('Invalid input');\n  }\n  return { ok: true, data: payload.input.trim() };\n}\n\`\`\`\n\nBUG_REPORT: {"category":"bug","severity":"medium","title":"Missing rate-limiting middleware on backend handler","description":"Unthrottled calls to the handler could exhaust worker capacity under burst traffic.","suggestedFix":"Add token-bucket rate limiting per IP or user session"}`;
  }

  if (role === 'frontend') {
    const refText = prev ? (isFa ? `ممنون ${prev}؛ ` : `Thanks ${prev}; `) : '';
    return isFa
      ? `${refText}کامپوننت رابط کاربری را طوری طراحی کردم که خطاهای اعتبارسنجی بک‌اند را به‌صورت شفاف نمایش دهد. پیشنهاد می‌کنم یک حالت Loading و Timeout هم در درخواست‌ها بگذاریم.\n\nWRITE_FILE:app/Panel.tsx\n\`\`\`tsx\nexport function Panel({ status }: { status: string }) {\n  return <div className="rounded-lg border p-3 text-sm">{status}</div>;\n}\n\`\`\`\n\nBUG_REPORT: {"category":"improvement","severity":"low","title":"افزودن وضعیت Loading و Retry در رابط کاربری","description":"در صورت تاخیر پاسخ سرور، کاربر باید وضعیت در حال پردازش و دکمه تلاش مجدد ببیند.","suggestedFix":"استفاده از AbortController و نمایش پیام خطای قابل بازیابی"}`
      : `${refText}I built the UI component to surface backend validation errors cleanly and handle empty states.\n\nWRITE_FILE:app/Panel.tsx\n\`\`\`tsx\nexport function Panel({ status }: { status: string }) {\n  return <div className="rounded-lg border p-3 text-sm">{status}</div>;\n}\n\`\`\`\n\nBUG_REPORT: {"category":"improvement","severity":"low","title":"Add optimistic loading and retry boundary in UI","description":"Slow network responses need an explicit loading state and retry trigger.","suggestedFix":"Wrap fetch with AbortController timeout and retry action"}`;
  }

  if (role === 'security_qa') {
    const refText = prev ? (isFa ? `پس از بررسی کد ${prev} و تیم: ` : `Reviewing the code from ${prev} and Backend Agent: `) : '';
    return isFa
      ? `${refText}بررسی امنیتی و تست واحد انجام شد. کد فعلی از Path Traversal در امان است، اما یک باگ امنیتی در بخش هدرهای پاسخ و اعتبارسنجی طول ورودی پیدا کردم که در تب باگ رپورت ثبت شد. @Executor Agent لطفاً تست‌ها را اجرا کن.\n\nBUG_REPORT: {"category":"bug","severity":"high","title":"عدم محدودیت طول حداکثری ورودی (Payload DoS Risk)","description":"ورودی‌های متنی بسیار طولانی می‌توانند باعث مصرف حافظه غیرعادی در پردازش رشته‌ها شوند.","suggestedFix":"اعمال محدودیت maxLength=2000 و بررسی نوع داده در لایه ورودی"}`
      : `${refText}I audited the generated modules. No unsafe shell interpolation was found, though I logged a high-priority input-length guardrail issue in Bug Report. @Executor Agent please run the sandbox suite.\n\nBUG_REPORT: {"category":"bug","severity":"high","title":"Unbounded input string length in request handler","description":"Very large payloads are accepted without an upper length bound, risking memory spikes.","suggestedFix":"Enforce maxLength <= 2000 characters and schema validation"}`;
  }

  return isFa
    ? `تست و بررسی در محیط ایزوله سندباکس انجام شد. @Security & QA Agent باگ ثبت‌شده در محدودیت طول ورودی را تایید می‌کنم و پیشنهاد می‌کنم تست خودکار روی خطاهای ورودی هم اضافه شود.\n\nEXEC_BASH:ls -la\n\nBUG_REPORT: {"category":"improvement","severity":"medium","title":"افزودن تست خودکار برای ورودی‌های مرزی در سندباکس","description":"تست فعلی مسیر موفق را بررسی می‌کند؛ افزودن تست خطای ورودی پایداری را افزایش می‌دهد.","suggestedFix":"افزودن تست assert.throws در فایل tests/service.test.mjs"}`
    : `Sandbox inspection complete. @Security & QA Agent I confirm the payload bound finding and recommend adding automated negative test assertions.\n\nEXEC_BASH:ls -la\n\nBUG_REPORT: {"category":"improvement","severity":"medium","title":"Add negative edge-case tests in sandbox suite","description":"Current sandbox checks cover happy paths but lack malformed-payload assertions.","suggestedFix":"Add assert.throws test cases in tests/service.test.mjs"}`;
}

function processAndBroadcastBugReports(params: {
  reply: string;
  runId: string;
  workflowId?: string;
  node: WorkflowNode;
  roundNum: number;
}): string {
  const { reply, runId, workflowId, node, roundNum } = params;
  const parsed = extractBugReportsFromReply(reply, {
    runId,
    workflowId,
    agentId: node.id,
    agentName: node.data.label,
    role: node.data.role,
  });

  for (const rep of parsed.reports) {
    const saved = createBugReport(rep);
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'bug_reported',
      round: roundNum,
      agentId: node.id,
      agentName: node.data.label,
      role: node.data.role,
      content: `[${saved.category === 'bug' ? 'BUG' : 'IDEA'} · ${saved.severity.toUpperCase()}] ${saved.title}`,
      bugReport: saved,
      timestamp: saved.createdAt,
    });
  }

  return parsed.cleanedReply || reply;
}

function processAndBroadcastManagerDelegations(params: {
  reply: string;
  runId: string;
  managerNode: WorkflowNode;
  nodes: WorkflowNode[];
  roundNum: number;
  phase: 'test' | 'deploy' | 'review';
}): {
  cleanedReply: string;
  delegations: Array<{ targetRole: string; targetAgentId: string; targetAgentName: string; issue: string }>;
} {
  const { reply, runId, managerNode, nodes, roundNum, phase } = params;
  if (!isManagerNode(managerNode)) {
    return { cleanedReply: reply, delegations: [] };
  }

  const parsed = extractManagerDelegations(reply, managerNode, nodes, phase);
  const recorded: Array<{
    targetRole: string;
    targetAgentId: string;
    targetAgentName: string;
    issue: string;
  }> = [];

  for (const item of parsed.delegations) {
    const delegation = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'manager_delegation',
      round: roundNum,
      agentId: managerNode.id,
      agentName: managerNode.data.label,
      role: managerNode.data.role,
      content: `${managerNode.data.label} delegated issue to ${delegation.targetAgentName} (${delegation.targetRole}): ${delegation.issue}`,
      delegation,
      timestamp: delegation.timestamp,
    });
    recorded.push({
      targetRole: delegation.targetRole,
      targetAgentId: delegation.targetAgentId,
      targetAgentName: delegation.targetAgentName,
      issue: delegation.issue,
    });
  }

  return { cleanedReply: parsed.cleanedReply || reply, delegations: recorded };
}

function buildDryRunManagerAuditReply(params: {
  managerNode: WorkflowNode;
  nodes: WorkflowNode[];
  taskPrompt: string;
  sandboxFiles: SandboxFile[];
  toolCalls: ToolCallLog[];
  openBugs: ReturnType<typeof listBugReports>;
  alreadyDelegatedKeys: Set<string>;
  phase: 'test' | 'deploy' | 'review';
  allowTerminate: boolean;
}): string {
  const {
    managerNode,
    nodes,
    taskPrompt,
    sandboxFiles,
    toolCalls,
    openBugs,
    alreadyDelegatedKeys,
    phase,
    allowTerminate,
  } = params;
  const isFa = /[\u0600-\u06FF]/.test(taskPrompt) || /[\u0600-\u06FF]/.test(managerNode.data.label);
  const ctx = buildManagerInspectionContext({ sandboxFiles, toolCalls, openBugs });

  const failingTool = ctx.failingTools.find((t) => !alreadyDelegatedKeys.has(`tool:${t.target}`));
  if (failingTool) {
    const targetHint =
      failingTool.target.includes('frontend') || failingTool.target.endsWith('.tsx')
        ? 'frontend'
        : failingTool.target.includes('security') || failingTool.target.includes('test')
          ? 'security_qa'
          : 'backend';
    const targetNode =
      nodes.find((n) => n.data.role === targetHint) ??
      nodes.find((n) => n.id !== managerNode.id) ??
      managerNode;
    alreadyDelegatedKeys.add(`tool:${failingTool.target}`);

    return isFa
      ? `بررسی و آنالیز خودکار ${managerNode.data.label} در مرحله ${phase === 'deploy' ? 'دپلوی' : 'تست'}:\n` +
          `خطا در اجرای «${failingTool.target}» (exit=${failingTool.exitCode}) شناسایی شد و به ${targetNode.data.label} ارجاع داده شد.\n\n` +
          `DELEGATE: {"targetRole":"${targetNode.data.role}","issue":"خطا در ${failingTool.target} (exit ${failingTool.exitCode})","reason":"اصلاح فایل و رفع خطای تست پیش از دپلوی نهایی"}`
      : `${managerNode.data.label} automatic ${phase} inspection:\n` +
          `Detected non-zero exit (${failingTool.exitCode}) in "${failingTool.target}". Delegating fix to ${targetNode.data.label}.\n\n` +
          `DELEGATE: {"targetRole":"${targetNode.data.role}","issue":"Failed check on ${failingTool.target}","reason":"Fix failure before deploy sign-off"}`;
  }

  const actionableBug = ctx.openBugsByRole.find(
    ({ bug }) => bug.category === 'bug' && !alreadyDelegatedKeys.has(`bug:${bug.id}`),
  );
  if (actionableBug) {
    const { bug } = actionableBug;
    alreadyDelegatedKeys.add(`bug:${bug.id}`);
    const inferredRole =
      /rate|api|endpoint|sql|backend|بک|نرخ/i.test(bug.title + bug.description)
        ? 'backend'
        : /ui|react|loading|front|فرانت|رابط/i.test(bug.title + bug.description)
          ? 'frontend'
          : /security|owasp|length|dos|امنیت|طول/i.test(bug.title + bug.description)
            ? 'security_qa'
            : bug.role;
    const targetNode =
      nodes.find((n) => n.data.role === inferredRole) ??
      nodes.find((n) => n.id !== managerNode.id) ??
      managerNode;

    return isFa
      ? `گزارش آنالیز ${managerNode.data.label} (${phase === 'deploy' ? 'بازرسی پیش از دپلوی' : 'بازرسی تست'}):\n` +
          `باگ باز «${bug.title}» (${bug.severity}) بررسی شد و جهت رفع قطعی به ${targetNode.data.label} ارجاع می‌گردد.\n\n` +
          `DELEGATE: {"targetRole":"${targetNode.data.role}","issue":"${bug.title.replace(/"/g, "'")}","reason":"${(bug.suggestedFix || bug.description).slice(0, 140).replace(/"/g, "'")}"}`
      : `${managerNode.data.label} ${phase} inspection found open bug "${bug.title}" (${bug.severity}). Delegating directly to ${targetNode.data.label}.\n\n` +
          `DELEGATE: {"targetRole":"${targetNode.data.role}","issue":"${bug.title.replace(/"/g, "'")}","reason":"${(bug.suggestedFix || bug.description).slice(0, 140).replace(/"/g, "'")}"}`;
  }

  const fileCount = sandboxFiles.length;
  if (isFa) {
    return (
      `بازرسی کامل ${managerNode.data.label} انجام شد (${fileCount} فایل سندباکس، ${toolCalls.length} اجرای ابزار/تست بررسی شد).\n` +
      `هیچ خطای مسدودکننده یا باگ باز حل‌نشده‌ای باقی نمانده است و خروجی تیم برای استقرار تایید می‌شود.` +
      (allowTerminate ? `\nTERMINATE` : '')
    );
  }

  return (
    `${managerNode.data.label} full inspection complete (${fileCount} sandbox file(s), ${toolCalls.length} test/tool check(s) verified).\n` +
    `All checks passed with no remaining blocking defects. Approved for deployment.` +
    (allowTerminate ? `\nTERMINATE` : '')
  );
}

async function generateLiveGeminiReply(params: {
  ai: GoogleGenAI | null;
  node: WorkflowNode;
  history: Array<{ role: string; content: string }>;
  isGroupDiscussion?: boolean;
  teammates?: string[];
  inspectionSnapshot?: string;
  delegationPhase?: 'test' | 'deploy' | 'review';
}): Promise<string> {
  const {
    ai,
    node,
    history,
    isGroupDiscussion,
    teammates,
    inspectionSnapshot,
    delegationPhase,
  } = params;

  const toolHints: string[] = [];
  if (node.data.tools.readFile) toolHints.push('READ_FILE:<relative_path>');
  if (node.data.tools.writeFile) {
    toolHints.push('WRITE_FILE:<relative_path>\n```js\n<content>\n```');
  }
  if (node.data.tools.execBash) toolHints.push('EXEC_BASH:<command>');

  const managerNodeFlag = isManagerNode(node);
  const managerDirective = managerNodeFlag
    ? `\nManager Inspection & Domain Delegation Protocol (${delegationPhase ?? 'review'}):\n` +
      `- As the Manager (${node.data.label}), carefully analyze all sandbox files, test/deploy logs, and open bug reports from the team.\n` +
      `- If ANY bug, failing check, or domain defect exists, DO NOT emit TERMINATE. Instead, assign the fix directly to the responsible domain agent (backend, frontend, security_qa, executor) by emitting ONE line:\n` +
      `DELEGATE: {"targetRole":"backend"|"frontend"|"security_qa"|"executor","issue":"concise issue title","reason":"specific fix required"}\n` +
      `- Only emit TERMINATE once all checks pass and no unresolved blocking issues remain.\n`
    : '';

  const groupGuidance = isGroupDiscussion
    ? `\nLive GroupChat Collaboration Mode:\n` +
      `- You are chatting live in a real team room with the User and fellow specialists: ${(teammates || []).join(', ')}.\n` +
      `- Directly respond to the User's latest message AND interact naturally with teammates who spoke before you (reference them by name, e.g. @Backend Agent, agree, refine, or raise concerns).\n` +
      `- Reply in the SAME language the User used (if the User wrote in Persian/Farsi, write your conversational reply in fluent Persian/Farsi).\n` +
      `- Do NOT emit TERMINATE unless the user explicitly asked to end the session.\n`
    : `\n- Reply in the same language the user used where appropriate.\n` +
      `- If you are the Manager in an automated pipeline and verification is complete, include TERMINATE.\n`;

  const systemInstruction =
    `${node.data.systemPrompt}\n\n` +
    `Agent Name: ${node.data.label}\n` +
    `Role: ${node.data.role}\n` +
    `Configured Provider Profile: ${node.data.provider} (${node.data.model})\n` +
    `Authorized Tools: ${toolHints.length > 0 ? toolHints.join(', ') : 'None'}\n` +
    `Keep responses focused, technical, and concise (under 200 words). ` +
    `If you create a file, output WRITE_FILE:<path> followed immediately by a fenced code block. ` +
    `If you run a bash command, output a single line starting with EXEC_BASH:<command>.` +
    managerDirective +
    groupGuidance +
    `\nBug Report / Improvement Idea Tracking:\n` +
    `- If you spot a bug, security risk, or concrete improvement idea in your domain, append ONE single-line JSON block at the end:\n` +
    `BUG_REPORT: {"category":"bug"|"improvement","severity":"critical"|"high"|"medium"|"low","title":"short title","description":"what is wrong or can improve","suggestedFix":"actionable fix"}`;

  const snapshotBlock = inspectionSnapshot ? `\n\n[TEAM AUDIT SNAPSHOT]\n${inspectionSnapshot}` : '';
  const transcript =
    history
      .map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`)
      .join('\n\n---\n\n') + snapshotBlock;

  if (node.data.provider === 'opencode') {
    const settings = getAppSettings();
    const baseUrl = (settings.providers.opencode?.baseUrl || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.OPENCODE_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENCODE_API_KEY}`;
    }
    const openCodeRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: node.data.model.replace(/^opencode\//, ''),
        temperature: node.data.temperature,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: `${transcript}\n\nNow respond as ${node.data.label}:` },
        ],
      }),
    }).catch(() => null);
    if (openCodeRes?.ok) {
      const data = (await openCodeRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (text) return text;
    }
    if (!ai) {
      const statusText = openCodeRes ? `HTTP ${openCodeRes.status}` : 'network timeout';
      const errBody = openCodeRes ? await openCodeRes.text().catch(() => '') : '';
      throw new Error(
        `OpenCode Zen returned ${statusText}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`,
      );
    }
  }

  if (!ai) {
    throw new Error('GEMINI_API_KEY is required to run non-OpenCode agents in live mode.');
  }

  const preferredModel =
    node.data.provider === 'gemini' && node.data.model.startsWith('gemini-')
      ? node.data.model
      : 'gemini-3.1-flash-lite';

  const candidateModels = Array.from(
    new Set([preferredModel, 'gemini-3.1-flash-lite', 'gemini-4-argon', 'gemini-4-hydrogen']),
  );

  let lastErr: unknown = null;
  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `${transcript}\n\nNow respond as ${node.data.label}:`,
        config: {
          systemInstruction,
          httpOptions: { timeout: 20000 },
        },
      });
      return response.text ?? '';
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('DEADLINE_EXCEEDED') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('abort');
      if (!retryable) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('All Gemini fallback models failed');
}

async function processAgentTools(params: {
  runId: string;
  workflow: WorkflowConfig;
  node: WorkflowNode;
  reply: string;
  roundNum: number;
  mode: 'live' | 'dry_run';
  settings: AppSettings;
}): Promise<ToolCallLog[]> {
  const { runId, workflow, node, reply, roundNum, mode, settings } = params;
  const runDir = getSandboxDir(runId);
  const logs: ToolCallLog[] = [];
  const timeoutMs = settings.sandboxTimeoutSec * 1000;

  if (node.data.tools.writeFile && settings.allowWriteFile) {
    const writeRegex = /WRITE_FILE:([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = writeRegex.exec(reply)) !== null) {
      const relPath = match[1].trim();
      const content = match[2];
      try {
        const target = safeSandboxPath(runDir, relPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        logs.push({
          id: crypto.randomUUID(),
          tool: 'write_file',
          target: relPath,
          result: `Wrote ${Buffer.byteLength(content, 'utf-8')} bytes to /workspace/${relPath}`,
          exitCode: 0,
        });
      } catch (err) {
        logs.push({
          id: crypto.randomUUID(),
          tool: 'write_file',
          target: relPath,
          result: err instanceof Error ? err.message : 'Write failed',
          exitCode: 1,
        });
      }
    }
  }

  if (node.data.tools.readFile && settings.allowReadFile) {
    const readRegex = /^READ_FILE:([^\n]+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = readRegex.exec(reply)) !== null) {
      const relPath = match[1].trim();
      try {
        const target = safeSandboxPath(runDir, relPath);
        const content = fs.readFileSync(target, 'utf-8');
        logs.push({
          id: crypto.randomUUID(),
          tool: 'read_file',
          target: relPath,
          result: content.slice(0, 1200),
          exitCode: 0,
        });
      } catch (err) {
        logs.push({
          id: crypto.randomUUID(),
          tool: 'read_file',
          target: relPath,
          result: err instanceof Error ? err.message : 'File not found',
          exitCode: 1,
        });
      }
    }
  }

  if (node.data.tools.execBash && settings.allowExecBash) {
    const bashRegex = /^EXEC_BASH:([^\n]+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = bashRegex.exec(reply)) !== null) {
      const command = match[1].trim();
      const sensitivity = detectSensitiveCommand(command, settings.customSensitivePatterns);
      let approved = true;

      if ((workflow.humanInTheLoop || settings.globalHumanInTheLoop) && sensitivity.sensitive) {
        const approvalId = crypto.randomUUID();
        const reqEvent: ExecutionEvent = {
          id: crypto.randomUUID(),
          runId,
          type: 'approval_required',
          round: roundNum,
          agentId: node.id,
          agentName: node.data.label,
          role: node.data.role,
          content: `Human approval requested before executing sensitive command: ${command}`,
          pendingCommand: {
            approvalId,
            command,
            reason: sensitivity.reason,
          },
          timestamp: new Date().toISOString(),
        };
        broadcastEvent(runId, reqEvent);
        updateRunRecord({
          id: runId,
          status: 'awaiting_approval',
          roundsExecuted: roundNum,
          events: runEventBuffers.get(runId) ?? [],
        });

        approved = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            pendingApprovals.delete(approvalId);
            resolve(false);
          }, 5 * 60 * 1000);
          pendingApprovals.set(approvalId, (decision) => {
            clearTimeout(timer);
            resolve(decision);
          });
        });

        broadcastEvent(runId, {
          id: crypto.randomUUID(),
          runId,
          type: 'approval_resolved',
          round: roundNum,
          agentId: node.id,
          agentName: node.data.label,
          content: approved
            ? `Operator approved command: ${command}`
            : `Operator rejected command: ${command}`,
          timestamp: new Date().toISOString(),
        });
      }

      if (!approved) {
        logs.push({
          id: crypto.randomUUID(),
          tool: 'exec_bash',
          target: command,
          result: 'Command execution aborted by Human-in-the-Loop operator.',
          exitCode: 130,
          requiresApproval: sensitivity.sensitive,
          approved: false,
        });
      } else {
        // Execute safe command inside isolated temp workspace directory
        const isSafeNodeTest =
          command.startsWith('node --test') ||
          command.startsWith('ls') ||
          command.startsWith('cat ') ||
          command.startsWith('python3 -m py_compile');

        if (isSafeNodeTest || mode === 'dry_run') {
          const safeCmd = command.includes('&& chmod')
            ? command.split('&&')[0].trim()
            : command;
          const cmdRes = isSafeNodeTest || safeCmd.startsWith('node ')
            ? await runSandboxCommand(runDir, safeCmd, timeoutMs)
            : {
                stdout: `[sandbox:${runId.slice(0, 8)}] Simulated container exit 0 for: ${command}`,
                stderr: '',
                exitCode: 0,
              };
          logs.push({
            id: crypto.randomUUID(),
            tool: 'exec_bash',
            target: command,
            result: [cmdRes.stdout, cmdRes.stderr].filter(Boolean).join('\n') || 'Command exited 0',
            exitCode: cmdRes.exitCode,
            requiresApproval: sensitivity.sensitive,
            approved: true,
          });
        } else {
          const cmdRes = await runSandboxCommand(runDir, command, timeoutMs);
          logs.push({
            id: crypto.randomUUID(),
            tool: 'exec_bash',
            target: command,
            result: [cmdRes.stdout, cmdRes.stderr].filter(Boolean).join('\n') || 'Command exited 0',
            exitCode: cmdRes.exitCode,
            requiresApproval: sensitivity.sensitive,
            approved: true,
          });
        }
      }
    }
  }

  return logs;
}

async function runDeployVerificationChecks(): Promise<ToolCallLog[]> {
  const checks = [
    { label: 'Unit & Logic Suite (workflowEngine.test.ts)', cmd: 'npx --yes tsx --test src/utils/workflowEngine.test.ts' },
    { label: 'Python Multi-Agent Engine Syntax (deploy/backend/*.py)', cmd: 'python3 -m py_compile deploy/backend/*.py' },
  ];
  const results: ToolCallLog[] = [];
  for (const chk of checks) {
    const res = await runSandboxCommand(process.cwd(), chk.cmd, 20000);
    results.push({
      id: crypto.randomUUID(),
      tool: 'exec_bash',
      target: chk.cmd,
      result: [res.stdout, res.stderr].filter(Boolean).join('\n').slice(0, 900) || 'Passed (exit 0)',
      exitCode: res.exitCode,
    });
  }
  const composeExists = fs.existsSync(path.resolve(process.cwd(), 'deploy/docker-compose.yml'));
  results.push({
    id: crypto.randomUUID(),
    tool: 'read_file',
    target: 'deploy/docker-compose.yml',
    result: composeExists
      ? 'Verified deploy/docker-compose.yml and container definitions exist.'
      : 'Missing deploy/docker-compose.yml bundle.',
    exitCode: composeExists ? 0 : 1,
  });
  return results;
}

async function executeWorkflowRun(params: {
  runId: string;
  workflow: WorkflowConfig;
  taskPrompt: string;
  mode: 'live' | 'dry_run';
  runStage?: 'standard' | 'test_and_deploy';
}): Promise<void> {
  const { runId, workflow, taskPrompt, mode, runStage = 'standard' } = params;
  const maxRounds = clampMaxRounds(workflow.maxRounds);
  const ordered = computeExecutionOrder(workflow.nodes, workflow.edges);
  const managerNode = findManagerNode(ordered);
  const ai = mode === 'live' ? getAiClient() : null;

  seedSandboxFromProject(runId, workflow.projectContext?.projectId);

  const hasOpenCodeOnly = ordered.length > 0 && ordered.every((n) => n.data.provider === 'opencode');
  if (mode === 'live' && !ai && !hasOpenCodeOnly) {
    const errEvt: ExecutionEvent = {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: 0,
      content:
        'GEMINI_API_KEY is not configured in environment secrets. Configure it in Settings > Secrets, or switch Execution Mode to Sandbox Dry-Run.',
      timestamp: new Date().toISOString(),
    };
    broadcastEvent(runId, errEvt);
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted: 0,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
    return;
  }

  broadcastEvent(runId, {
    id: crypto.randomUUID(),
    runId,
    type: 'run_started',
    round: 0,
    content:
      runStage === 'test_and_deploy'
        ? `Started Automated Test & Deploy Audit across ${ordered.length} agents${managerNode ? ` (Supervisor: ${managerNode.data.label})` : ''}.`
        : `Started GroupChat across ${ordered.length} agents (max_rounds=${maxRounds}, HITL=${workflow.humanInTheLoop ? 'enabled' : 'off'}, mode=${mode}).`,
    timestamp: new Date().toISOString(),
  });

  const history: Array<{ role: string; content: string }> = [
    { role: 'user', content: `Project Task:\n${taskPrompt}` },
  ];

  const allToolCalls: ToolCallLog[] = [];
  const delegatedKeys = new Set<string>();
  let pendingDelegatedRole: string | undefined;
  let forceManagerAudit = false;
  let managerReviewedPostTest = false;

  if (runStage === 'test_and_deploy') {
    const preflightLogs = await runDeployVerificationChecks();
    allToolCalls.push(...preflightLogs);
    const hasFailure = preflightLogs.some((l) => (l.exitCode ?? 0) !== 0);
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'tool_executed',
      round: 0,
      agentName: 'Test & Deploy Gate',
      content: hasFailure
        ? 'Automated Test & Deploy preflight detected check failures — routing to Manager for inspection and delegation.'
        : 'Automated Test & Deploy verification suite executed — routing results to Manager for team inspection & sign-off.',
      toolCalls: preflightLogs,
      timestamp: new Date().toISOString(),
    });
    history.push({
      role: 'sandbox',
      content: preflightLogs
        .map((t) => `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${t.result}`)
        .join('\n'),
    });
    if (managerNode) {
      forceManagerAudit = true;
    }
  }

  let currentNodeId: string | null = null;
  let roundsExecuted = 0;

  try {
    for (let i = 0; i < maxRounds; i++) {
      let speaker: WorkflowNode | null = null;
      if (forceManagerAudit && managerNode && managerNode.id !== currentNodeId) {
        speaker = managerNode;
        forceManagerAudit = false;
      } else {
        const next = selectNextSpeaker({
          orderedNodes: ordered,
          edges: workflow.edges,
          currentNodeId,
          roundIndex: i,
          maxRounds,
          requestedNextRole: pendingDelegatedRole,
        });
        speaker = next.node;
        pendingDelegatedRole = undefined;
      }

      if (!speaker) break;

      currentNodeId = speaker.id;
      roundsExecuted = i + 1;
      const isMgr = isManagerNode(speaker);
      const currentSandboxFiles = listSandboxFiles(runId);
      const currentOpenBugs = listBugReports({ workflowId: workflow.id });
      const inspection = isMgr
        ? buildManagerInspectionContext({
            sandboxFiles: currentSandboxFiles,
            toolCalls: allToolCalls,
            openBugs: currentOpenBugs,
          })
        : null;

      if (isMgr && (runStage === 'test_and_deploy' || allToolCalls.length > 0)) {
        managerReviewedPostTest = true;
      }

      const phase: 'test' | 'deploy' | 'review' =
        runStage === 'test_and_deploy' ? 'deploy' : allToolCalls.length > 0 ? 'test' : 'review';

      let rawReply: string;
      if (mode === 'live' && (ai || speaker.data.provider === 'opencode')) {
        rawReply = await generateLiveGeminiReply({
          ai,
          node: speaker,
          history,
          inspectionSnapshot: inspection?.summaryText,
          delegationPhase: phase,
        });
      } else if (isMgr && (runStage === 'test_and_deploy' || allToolCalls.length > 0 || roundsExecuted > 1)) {
        rawReply = buildDryRunManagerAuditReply({
          managerNode: speaker,
          nodes: ordered,
          taskPrompt,
          sandboxFiles: currentSandboxFiles,
          toolCalls: allToolCalls,
          openBugs: currentOpenBugs,
          alreadyDelegatedKeys: delegatedKeys,
          phase,
          allowTerminate: roundsExecuted >= 2,
        });
      } else {
        rawReply = buildDryRunAgentReply(speaker, taskPrompt, roundsExecuted, maxRounds);
      }

      const withoutBugs = processAndBroadcastBugReports({
        reply: rawReply,
        runId,
        workflowId: workflow.id,
        node: speaker,
        roundNum: roundsExecuted,
      });

      const delegationResult = processAndBroadcastManagerDelegations({
        reply: withoutBugs,
        runId,
        managerNode: speaker,
        nodes: ordered,
        roundNum: roundsExecuted,
        phase,
      });
      const reply = delegationResult.cleanedReply;

      if (delegationResult.delegations.length > 0) {
        pendingDelegatedRole = delegationResult.delegations[0].targetRole;
        managerReviewedPostTest = false;
      }

      const settings = getAppSettings();
      const toolCalls = await processAgentTools({
        runId,
        workflow,
        node: speaker,
        reply,
        roundNum: roundsExecuted,
        mode,
        settings,
      });
      allToolCalls.push(...toolCalls);

      if (
        managerNode &&
        !isMgr &&
        (toolCalls.some((t) => (t.exitCode ?? 0) !== 0) ||
          speaker.data.role === 'executor' ||
          speaker.data.role === 'security_qa')
      ) {
        forceManagerAudit = true;
        managerReviewedPostTest = false;
      }

      history.push({ role: speaker.data.label, content: reply });
      if (toolCalls.length > 0) {
        history.push({
          role: 'sandbox',
          content: toolCalls
            .map((t) => `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${t.result}`)
            .join('\n'),
        });
      }

      broadcastEvent(runId, {
        id: crypto.randomUUID(),
        runId,
        type: 'agent_message',
        round: roundsExecuted,
        agentId: speaker.id,
        agentName: speaker.data.label,
        role: speaker.data.role,
        provider: speaker.data.provider,
        model: speaker.data.model,
        content: reply,
        toolCalls,
        timestamp: new Date().toISOString(),
      });

      updateRunRecord({
        id: runId,
        status: 'running',
        roundsExecuted,
        events: runEventBuffers.get(runId) ?? [],
      });

      if (reply.includes('TERMINATE') && isMgr && delegationResult.delegations.length === 0) {
        break;
      }

      if (mode === 'dry_run') {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Automatic Post-Test / Pre-Deploy Manager Inspection if tests ran and Manager hasn't signed off yet
    if (managerNode && !managerReviewedPostTest && (allToolCalls.length > 0 || runStage === 'test_and_deploy')) {
      roundsExecuted += 1;
      const finalFiles = listSandboxFiles(runId);
      const finalBugs = listBugReports({ workflowId: workflow.id });
      const finalCtx = buildManagerInspectionContext({
        sandboxFiles: finalFiles,
        toolCalls: allToolCalls,
        openBugs: finalBugs,
      });
      const rawFinalMgr =
        mode === 'live' && (ai || managerNode.data.provider === 'opencode')
          ? await generateLiveGeminiReply({
              ai,
              node: managerNode,
              history,
              inspectionSnapshot: finalCtx.summaryText,
              delegationPhase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
            })
          : buildDryRunManagerAuditReply({
              managerNode,
              nodes: ordered,
              taskPrompt,
              sandboxFiles: finalFiles,
              toolCalls: allToolCalls,
              openBugs: finalBugs,
              alreadyDelegatedKeys: delegatedKeys,
              phase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
              allowTerminate: true,
            });
      const finalMgrClean = processAndBroadcastManagerDelegations({
        reply: rawFinalMgr,
        runId,
        managerNode,
        nodes: ordered,
        roundNum: roundsExecuted,
        phase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
      }).cleanedReply;
      broadcastEvent(runId, {
        id: crypto.randomUUID(),
        runId,
        type: 'agent_message',
        round: roundsExecuted,
        agentId: managerNode.id,
        agentName: managerNode.data.label,
        role: managerNode.data.role,
        provider: managerNode.data.provider,
        model: managerNode.data.model,
        content: finalMgrClean,
        timestamp: new Date().toISOString(),
      });
    }

    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_completed',
      round: roundsExecuted,
      content:
        runStage === 'test_and_deploy'
          ? `Automated Test & Deploy verification finished after ${roundsExecuted} round(s).`
          : `Workflow finished after ${roundsExecuted} round(s).`,
      timestamp: new Date().toISOString(),
    });

    updateRunRecord({
      id: runId,
      status: 'completed',
      roundsExecuted,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected execution failure';
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: roundsExecuted,
      content: `Agent execution error: ${message}`,
      timestamp: new Date().toISOString(),
    });
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  }
}

// REST API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sqlite: true });
});

app.get('/api/capabilities', (_req, res) => {
  const key = process.env.GEMINI_API_KEY;
  res.json({
    geminiConfigured: Boolean(key && key !== 'MY_GEMINI_API_KEY'),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    opencodeConfigured: Boolean(process.env.OPENCODE_API_KEY),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434',
  });
});

app.get('/api/opencode/free-models', async (req, res) => {
  const settings = getAppSettings();
  const queryBase =
    typeof req.query.baseUrl === 'string' && /^https?:\/\//i.test(req.query.baseUrl.trim())
      ? req.query.baseUrl.trim()
      : null;
  const baseUrl = (
    queryBase ||
    settings.providers.opencode?.baseUrl ||
    'https://opencode.ai/zen/v1'
  ).replace(/\/+$/, '');
  try {
    const upstream = await fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(6000),
    });
    if (upstream.ok) {
      const payload = (await upstream.json()) as unknown;
      const models = extractFreeOpenCodeModels(payload);
      if (models.length > 0) {
        res.json({ models, source: 'live', count: models.length });
        return;
      }
    }
  } catch {
    // Fall back to curated catalog if upstream is unreachable
  }
  const fallback = PROVIDER_MODELS.opencode.models;
  res.json({ models: fallback, source: 'fallback', count: fallback.length });
});

app.get('/api/settings', (_req, res) => {
  res.json(getAppSettings());
});

app.put('/api/settings', (req, res) => {
  const saved = saveAppSettings(req.body as Partial<AppSettings>);
  res.json(saved);
});

app.get('/api/workflows', (_req, res) => {
  res.json(listWorkflows());
});

app.get('/api/workflows/:id/export', (req, res) => {
  const wf = getWorkflowById(req.params.id);
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  const slug =
    wf.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || wf.id;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.workflow.json"`);
  res.send(serializeWorkflowForExport(wf));
});

app.post('/api/workflows', (req, res) => {
  const wf = req.body as WorkflowConfig;
  if (!wf || !wf.id || !wf.name) {
    res.status(400).json({ error: 'Workflow id and name are required' });
    return;
  }
  const saved = upsertWorkflow({
    ...wf,
    maxRounds: clampMaxRounds(wf.maxRounds),
  });
  res.json(saved);
});

app.delete('/api/workflows/:id', (req, res) => {
  const ok = deleteWorkflow(req.params.id);
  res.json({ deleted: ok });
});

app.get('/api/projects', (_req, res) => {
  res.json(listImportedProjects(20));
});

app.get('/api/projects/:id', (req, res) => {
  const proj = getImportedProjectById(req.params.id);
  if (!proj) {
    res.status(404).json({ error: 'Imported project not found' });
    return;
  }
  res.json(proj);
});

app.delete('/api/projects/:id', (req, res) => {
  const ok = deleteImportedProject(req.params.id);
  res.json({ deleted: ok });
});

app.post('/api/projects/import/github', async (req, res) => {
  const { repoUrl, branch, token, language, mode } = req.body as {
    repoUrl?: string;
    branch?: string;
    token?: string;
    language?: 'en' | 'fa';
    mode?: 'live' | 'dry_run';
  };

  const parsed = parseGitHubRepoInput(repoUrl || '', branch);
  if (!parsed) {
    res.status(400).json({
      error:
        language === 'fa'
          ? 'آدرس مخزن گیت‌هاب معتبر نیست (مثال: https://github.com/owner/repo یا owner/repo).'
          : 'Invalid GitHub repository URL or owner/repo shorthand.',
    });
    return;
  }

  const headers: Record<string, string> = {
    'User-Agent': 'AetherFlow-Studio',
    Accept: 'application/vnd.github+json',
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    let resolvedBranch = parsed.branch;
    const metaRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      { headers, signal: AbortSignal.timeout(10000) },
    ).catch(() => null);

    if (metaRes?.ok) {
      const meta = (await metaRes.json()) as { default_branch?: string };
      if (!resolvedBranch && meta.default_branch) {
        resolvedBranch = meta.default_branch;
      }
    } else if (metaRes && (metaRes.status === 404 || metaRes.status === 401 || metaRes.status === 403)) {
      const detail = await metaRes.text().catch(() => '');
      res.status(metaRes.status).json({
        error:
          metaRes.status === 404
            ? `GitHub repository "${parsed.owner}/${parsed.repo}" not found (if private, provide a Personal Access Token).`
            : `GitHub API returned ${metaRes.status}: ${detail.slice(0, 160)}`,
      });
      return;
    }

    const refSegment = resolvedBranch ? `/${encodeURIComponent(resolvedBranch)}` : '';
    const zipUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zipball${refSegment}`;
    const zipRes = await fetch(zipUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });

    if (!zipRes.ok) {
      res.status(zipRes.status).json({
        error: `Failed to download GitHub archive (HTTP ${zipRes.status}). Check repository visibility, branch, or token.`,
      });
      return;
    }

    const arrayBuf = await zipRes.arrayBuffer();
    const projectId = `proj-${parsed.owner}-${parsed.repo}-${Date.now().toString(36)}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    const files = extractProjectFilesFromZip(Buffer.from(arrayBuf), projectId, true);

    const baseAnalysis = analyzeProjectFiles({
      id: projectId,
      name: `${parsed.owner}/${parsed.repo}`,
      sourceType: 'github',
      sourceUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      branch: resolvedBranch || 'main',
      files,
      appSettings: getAppSettings(),
      language: language === 'fa' ? 'fa' : 'en',
    });

    const analyzed = await refineProjectAnalysisWithManagerAI({
      baseAnalysis,
      files,
      language: language === 'fa' ? 'fa' : 'en',
      mode,
    });

    saveImportedProject(analyzed);
    res.json({ project: analyzed });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect and analyze GitHub repository.',
    });
  }
});

app.post('/api/projects/import/zip', async (req, res) => {
  const { filename, contentBase64, projectName, language, mode } = req.body as {
    filename?: string;
    contentBase64?: string;
    projectName?: string;
    language?: 'en' | 'fa';
    mode?: 'live' | 'dry_run';
  };

  if (!contentBase64 || typeof contentBase64 !== 'string') {
    res.status(400).json({ error: 'ZIP file payload (contentBase64) is required.' });
    return;
  }

  try {
    const cleanedB64 = contentBase64.replace(/^data:[^;]+;base64,/, '').trim();
    const zipBuffer = Buffer.from(cleanedB64, 'base64');
    if (zipBuffer.length === 0) {
      res.status(400).json({ error: 'Uploaded ZIP archive is empty.' });
      return;
    }

    const derivedName =
      projectName?.trim() ||
      (filename || 'uploaded-project')
        .replace(/\.zip$/i, '')
        .replace(/[^a-zA-Z0-9._\u0600-\u06FF -]/g, '') ||
      'Uploaded Project';

    const projectId = `proj-zip-${Date.now().toString(36)}`;
    const files = extractProjectFilesFromZip(zipBuffer, projectId);

    const baseAnalysis = analyzeProjectFiles({
      id: projectId,
      name: derivedName,
      sourceType: 'zip',
      files,
      appSettings: getAppSettings(),
      language: language === 'fa' ? 'fa' : 'en',
    });

    const analyzed = await refineProjectAnalysisWithManagerAI({
      baseAnalysis,
      files,
      language: language === 'fa' ? 'fa' : 'en',
      mode,
    });

    saveImportedProject(analyzed);
    res.json({ project: analyzed });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not parse uploaded ZIP archive.',
    });
  }
});

app.get('/api/runs', (_req, res) => {
  res.json(listRunSummaries(25));
});

app.get('/api/runs/:id', (req, res) => {
  const events = runEventBuffers.get(req.params.id) ?? getRunEvents(req.params.id);
  res.json({ runId: req.params.id, events });
});

app.get('/api/runs/:id/files', (req, res) => {
  res.json(listSandboxFiles(req.params.id));
});

app.post('/api/runs', (req, res) => {
  const { workflowId, taskPrompt, workflow: inlineWorkflow, mode } = req.body as {
    workflowId?: string;
    taskPrompt?: string;
    workflow?: WorkflowConfig;
    mode?: 'live' | 'dry_run';
  };

  const workflow = inlineWorkflow ?? (workflowId ? getWorkflowById(workflowId) : null);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }

  const validation = validateWorkflowForRun(workflow, taskPrompt || '');
  if (!validation.valid) {
    res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    return;
  }

  const resolvedMode: 'live' | 'dry_run' =
    mode === 'live' || mode === 'dry_run'
      ? mode
      : getAiClient()
        ? 'live'
        : 'dry_run';

  const runId = crypto.randomUUID();
  runEventBuffers.set(runId, []);
  createRunRecord({
    id: runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    taskPrompt: taskPrompt!.trim(),
    mode: resolvedMode,
    maxRounds: clampMaxRounds(workflow.maxRounds),
  });

  void executeWorkflowRun({
    runId,
    workflow,
    taskPrompt: taskPrompt!.trim(),
    mode: resolvedMode,
  });

  res.json({ runId, mode: resolvedMode });
});

app.post('/api/deploy/verify', (req, res) => {
  const { workflowId, workflow: inlineWorkflow, mode, language } = req.body as {
    workflowId?: string;
    workflow?: WorkflowConfig;
    mode?: 'live' | 'dry_run';
    language?: 'en' | 'fa';
  };

  const workflow = inlineWorkflow ?? (workflowId ? getWorkflowById(workflowId) : null);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }

  const taskPrompt =
    language === 'fa'
      ? 'تست جامع، بررسی کیفیت و امنیت کدهای مجموعه، و تایید نهایی برای استقرار (Deploy).'
      : 'Run full test suite, inspect team deliverables & bug reports, delegate any domain defects, and verify deployment readiness.';

  const validation = validateWorkflowForRun(workflow, taskPrompt);
  if (!validation.valid) {
    res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    return;
  }

  const resolvedMode: 'live' | 'dry_run' =
    mode === 'live' || mode === 'dry_run'
      ? mode
      : getAiClient()
        ? 'live'
        : 'dry_run';

  const runId = crypto.randomUUID();
  runEventBuffers.set(runId, []);
  createRunRecord({
    id: runId,
    workflowId: workflow.id,
    workflowName: `${workflow.name} · Test & Deploy Audit`,
    taskPrompt,
    mode: resolvedMode,
    maxRounds: clampMaxRounds(Math.max(workflow.maxRounds, 6)),
  });

  void executeWorkflowRun({
    runId,
    workflow: {
      ...workflow,
      maxRounds: clampMaxRounds(Math.max(workflow.maxRounds, 6)),
    },
    taskPrompt,
    mode: resolvedMode,
    runStage: 'test_and_deploy',
  });

  res.json({ runId, mode: resolvedMode, stage: 'test_and_deploy' });
});

app.post('/api/runs/:id/approve', (req, res) => {
  const { approvalId, approved } = req.body as { approvalId?: string; approved?: boolean };
  if (!approvalId) {
    res.status(400).json({ error: 'approvalId is required' });
    return;
  }
  const resolver = pendingApprovals.get(approvalId);
  if (!resolver) {
    res.status(404).json({ error: 'Approval request not found or already resolved' });
    return;
  }
  resolver(Boolean(approved));
  pendingApprovals.delete(approvalId);
  res.json({ runId: req.params.id, approvalId, approved: Boolean(approved) });
});

app.post('/api/chat/enhance-prompt', async (req, res) => {
  const { instruction, targetNode, language } = req.body as {
    instruction?: string;
    targetNode?: WorkflowNode | null;
    language?: 'en' | 'fa';
  };

  const clean = (instruction || '').trim();
  if (!clean) {
    res.status(400).json({ error: 'Please enter a plain-language instruction first.' });
    return;
  }

  const fallback = buildStructuredAgentPrompt({
    rawInstruction: clean,
    targetNode,
    language,
  });

  const ai = getAiClient();
  if (!ai) {
    res.json({ enhancedPrompt: fallback, source: 'template' });
    return;
  }

  const targetDesc = targetNode
    ? `${targetNode.data.label} (role: ${targetNode.data.role}, tools: read=${targetNode.data.tools.readFile}, write=${targetNode.data.tools.writeFile}, bash=${targetNode.data.tools.execBash})`
    : 'Multi-Agent GroupChat Team (Manager, Backend, Frontend, Security & QA, Executor)';

  const isPersian = language === 'fa' || /[\u0600-\u06FF]/.test(clean);
  const sysPrompt =
    `You are a Senior Prompt Architect for a multi-agent software engineering platform.\n` +
    `Rewrite the user's plain-language request into a crisp, concrete, actionable engineering prompt tailored for: ${targetDesc}.\n` +
    `Rules:\n` +
    (isPersian
      ? `- CRITICAL: The user wrote in Persian/Farsi. You MUST write the entire rewritten prompt in fluent Persian/Farsi (keeping only technical keywords like WRITE_FILE:<path> or EXEC_BASH:<command> in English).\n`
      : `- Write the rewritten prompt in clear English.\n`) +
    `- Keep it structured and concise (under 140 words) with clear Objective, Technical Requirements, and Acceptance Criteria.\n` +
    `- Where appropriate for enabled tools, mention WRITE_FILE:<path> or EXEC_BASH:<command> conventions.\n` +
    `- Output ONLY the rewritten prompt text with no preamble or markdown chatter.`;

  for (const modelName of ['gemini-3.1-flash-lite', 'gemini-4-argon']) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `User plain instruction:\n${clean}`,
        config: {
          systemInstruction: sysPrompt,
          httpOptions: { timeout: 10000 },
        },
      });
      const text = (response.text || '').trim();
      if (text) {
        res.json({ enhancedPrompt: text, source: 'ai' });
        return;
      }
    } catch {
      // Try next fallback model
    }
  }

  res.json({ enhancedPrompt: fallback, source: 'template' });
});

async function executeDirectAgentTurn(params: {
  runId: string;
  workflow: WorkflowConfig;
  targetNode: WorkflowNode;
  userMessage: string;
  mode: 'live' | 'dry_run';
  roundNum: number;
}): Promise<void> {
  const { runId, workflow, targetNode, userMessage, mode, roundNum } = params;
  const ai = mode === 'live' ? getAiClient() : null;

  if (mode === 'live' && !ai && targetNode.data.provider !== 'opencode') {
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: roundNum,
      content:
        'GEMINI_API_KEY is not configured in environment secrets. Switch to Sandbox Dry-Run or use an OpenCode agent.',
      timestamp: new Date().toISOString(),
    });
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted: roundNum,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
    return;
  }

  try {
    const existingEvents = runEventBuffers.get(runId) ?? getRunEvents(runId);
    const history: Array<{ role: string; content: string }> = existingEvents
      .filter((e) => e.type === 'user_message' || e.type === 'agent_message')
      .slice(-12)
      .map((e) => ({
        role: e.type === 'user_message' ? 'user' : e.agentName || 'agent',
        content: e.content,
      }));

    if (!history.some((h) => h.role === 'user' && h.content === userMessage)) {
      history.push({ role: 'user', content: userMessage });
    }

    const rawReply =
      mode === 'live' && (ai || targetNode.data.provider === 'opencode')
        ? await generateLiveGeminiReply({ ai, node: targetNode, history })
        : buildDryRunDirectReply(targetNode, userMessage);

    const reply = processAndBroadcastBugReports({
      reply: rawReply,
      runId,
      workflowId: workflow.id,
      node: targetNode,
      roundNum,
    });

    const settings = getAppSettings();
    const toolCalls = await processAgentTools({
      runId,
      workflow,
      node: targetNode,
      reply,
      roundNum,
      mode,
      settings,
    });

    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'agent_message',
      round: roundNum,
      agentId: targetNode.id,
      agentName: targetNode.data.label,
      role: targetNode.data.role,
      provider: targetNode.data.provider,
      model: targetNode.data.model,
      content: reply,
      toolCalls,
      timestamp: new Date().toISOString(),
    });

    updateRunRecord({
      id: runId,
      status: 'completed',
      roundsExecuted: roundNum,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Direct agent chat failed';
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: roundNum,
      content: `Agent execution error: ${message}`,
      timestamp: new Date().toISOString(),
    });
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted: roundNum,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  }
}

async function executeGroupDiscussionRound(params: {
  runId: string;
  workflow: WorkflowConfig;
  userMessage: string;
  mode: 'live' | 'dry_run';
  baseRound: number;
}): Promise<void> {
  const { runId, workflow, userMessage, mode, baseRound } = params;
  const participantsAll = orderGroupChatParticipants(workflow.nodes, workflow.edges);
  // Deduplicate role specialists when workflow has extra duplicate nodes unless only 1 role exists
  const seenRoles = new Set<string>();
  const specialists: WorkflowNode[] = [];
  for (const n of participantsAll) {
    if (n.data.role === 'custom' || !seenRoles.has(n.data.role)) {
      seenRoles.add(n.data.role);
      specialists.push(n);
    }
  }
  const activeSpeakers = (specialists.length > 0 ? specialists : participantsAll).slice(
    0,
    clampMaxRounds(workflow.maxRounds),
  );

  const ai = mode === 'live' ? getAiClient() : null;
  const hasOpenCodeOnly =
    activeSpeakers.length > 0 && activeSpeakers.every((n) => n.data.provider === 'opencode');
  if (mode === 'live' && !ai && !hasOpenCodeOnly) {
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: baseRound,
      content:
        'GEMINI_API_KEY is not configured in environment secrets. Switch to Sandbox Dry-Run or use OpenCode agents.',
      timestamp: new Date().toISOString(),
    });
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted: baseRound,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
    return;
  }

  let currentRound = baseRound;
  const priorSpeakers: string[] = [];

  try {
    const existingEvents = runEventBuffers.get(runId) ?? getRunEvents(runId);
    const history: Array<{ role: string; content: string }> = existingEvents
      .filter((e) => e.type === 'user_message' || e.type === 'agent_message')
      .slice(-14)
      .map((e) => ({
        role: e.type === 'user_message' ? 'user' : e.agentName || 'agent',
        content: e.content,
      }));

    if (!history.some((h) => h.role === 'user' && h.content === userMessage)) {
      history.push({ role: 'user', content: userMessage });
    }

    const turnToolCalls: ToolCallLog[] = [];
    const managerNode = findManagerNode(activeSpeakers) ?? findManagerNode(workflow.nodes);
    const delegatedKeys = new Set<string>();

    for (let idx = 0; idx < activeSpeakers.length; idx++) {
      const speaker = activeSpeakers[idx];
      currentRound = baseRound + idx;

      const rawReply =
        mode === 'live' && (ai || speaker.data.provider === 'opencode')
          ? await generateLiveGeminiReply({
              ai,
              node: speaker,
              history,
              isGroupDiscussion: true,
              teammates: activeSpeakers
                .filter((n) => n.id !== speaker.id)
                .map((n) => `${n.data.label} (${n.data.role})`),
            })
          : buildDryRunGroupDiscussionReply({
              node: speaker,
              userMessage,
              priorSpeakers,
            });

      const withoutBugs = processAndBroadcastBugReports({
        reply: rawReply,
        runId,
        workflowId: workflow.id,
        node: speaker,
        roundNum: currentRound,
      });

      const reply = isManagerNode(speaker)
        ? processAndBroadcastManagerDelegations({
            reply: withoutBugs,
            runId,
            managerNode: speaker,
            nodes: workflow.nodes,
            roundNum: currentRound,
            phase: 'review',
          }).cleanedReply
        : withoutBugs;

      const settings = getAppSettings();
      const toolCalls = await processAgentTools({
        runId,
        workflow,
        node: speaker,
        reply,
        roundNum: currentRound,
        mode,
        settings,
      });
      turnToolCalls.push(...toolCalls);

      priorSpeakers.push(speaker.data.label);
      history.push({ role: speaker.data.label, content: reply });
      if (toolCalls.length > 0) {
        history.push({
          role: 'sandbox',
          content: toolCalls
            .map((t) => `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${t.result}`)
            .join('\n'),
        });
      }

      broadcastEvent(runId, {
        id: crypto.randomUUID(),
        runId,
        type: 'agent_message',
        round: currentRound,
        agentId: speaker.id,
        agentName: speaker.data.label,
        role: speaker.data.role,
        provider: speaker.data.provider,
        model: speaker.data.model,
        content: reply,
        toolCalls,
        timestamp: new Date().toISOString(),
      });

      updateRunRecord({
        id: runId,
        status: 'running',
        roundsExecuted: currentRound,
        events: runEventBuffers.get(runId) ?? [],
      });

      if (mode === 'dry_run') {
        await new Promise((r) => setTimeout(r, 180));
      }
    }

    // Automatic Manager Team Audit & Domain Delegation after specialists respond
    if (managerNode) {
      const runBugs = listBugReports({ runId });
      const ctx = buildManagerInspectionContext({
        sandboxFiles: listSandboxFiles(runId),
        toolCalls: turnToolCalls,
        openBugs: runBugs,
      });
      if (ctx.hasIssues || turnToolCalls.length > 0 || runBugs.length > 0) {
        currentRound += 1;
        const rawAudit =
          mode === 'live' && (ai || managerNode.data.provider === 'opencode')
            ? await generateLiveGeminiReply({
                ai,
                node: managerNode,
                history,
                isGroupDiscussion: true,
                inspectionSnapshot: ctx.summaryText,
                delegationPhase: 'review',
                teammates: activeSpeakers
                  .filter((n) => n.id !== managerNode.id)
                  .map((n) => `${n.data.label} (${n.data.role})`),
              })
            : buildDryRunManagerAuditReply({
                managerNode,
                nodes: workflow.nodes,
                taskPrompt: userMessage,
                sandboxFiles: listSandboxFiles(runId),
                toolCalls: turnToolCalls,
                openBugs: runBugs,
                alreadyDelegatedKeys: delegatedKeys,
                phase: 'review',
                allowTerminate: false,
              });

        const auditCleaned = processAndBroadcastManagerDelegations({
          reply: rawAudit,
          runId,
          managerNode,
          nodes: workflow.nodes,
          roundNum: currentRound,
          phase: 'review',
        }).cleanedReply;

        broadcastEvent(runId, {
          id: crypto.randomUUID(),
          runId,
          type: 'agent_message',
          round: currentRound,
          agentId: managerNode.id,
          agentName: managerNode.data.label,
          role: managerNode.data.role,
          provider: managerNode.data.provider,
          model: managerNode.data.model,
          content: auditCleaned,
          timestamp: new Date().toISOString(),
        });
      }
    }

    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_completed',
      round: currentRound,
      content: `Team discussion turn completed (${activeSpeakers.length} specialists replied). You can continue replying below.`,
      timestamp: new Date().toISOString(),
    });

    updateRunRecord({
      id: runId,
      status: 'completed',
      roundsExecuted: currentRound,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Group discussion failed';
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: currentRound,
      content: `Agent execution error: ${message}`,
      timestamp: new Date().toISOString(),
    });
    updateRunRecord({
      id: runId,
      status: 'failed',
      roundsExecuted: currentRound,
      events: runEventBuffers.get(runId) ?? [],
      completed: true,
    });
  }
}

app.post('/api/chat/message', (req, res) => {
  const {
    runId: existingRunId,
    workflowId,
    workflow: inlineWorkflow,
    targetAgentId,
    message,
    mode,
  } = req.body as {
    runId?: string;
    workflowId?: string;
    workflow?: WorkflowConfig;
    targetAgentId?: string;
    message?: string;
    mode?: 'live' | 'dry_run';
  };

  const cleanMessage = (message || '').trim();
  if (!cleanMessage) {
    res.status(400).json({ error: 'Message text is required.' });
    return;
  }

  const workflow = inlineWorkflow ?? (workflowId ? getWorkflowById(workflowId) : null);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  if (workflow.nodes.length === 0) {
    res.status(400).json({ error: 'Add at least one Agent node to the canvas before chatting.' });
    return;
  }

  const resolvedMode: 'live' | 'dry_run' =
    mode === 'live' || mode === 'dry_run'
      ? mode
      : getAiClient()
        ? 'live'
        : 'dry_run';

  const target = targetAgentId && targetAgentId !== 'all'
    ? workflow.nodes.find((n) => n.id === targetAgentId) ?? null
    : null;

  if (targetAgentId && targetAgentId !== 'all' && !target) {
    res.status(404).json({ error: 'Selected target agent node was not found on canvas.' });
    return;
  }

  // Reuse existing runId when continuing a group or direct conversation
  let runId = existingRunId;
  let existingEvents: ExecutionEvent[] = [];
  if (runId) {
    existingEvents = runEventBuffers.get(runId) ?? getRunEvents(runId);
    if (!runEventBuffers.has(runId)) {
      runEventBuffers.set(runId, existingEvents);
    }
  }

  if (!runId) {
    runId = crypto.randomUUID();
    runEventBuffers.set(runId, []);
    seedSandboxFromProject(runId, workflow.projectContext?.projectId);
    createRunRecord({
      id: runId,
      workflowId: workflow.id,
      workflowName: target ? `${workflow.name} · Direct Chat` : `${workflow.name} · Group Chat`,
      taskPrompt: cleanMessage,
      mode: resolvedMode,
      maxRounds: clampMaxRounds(workflow.maxRounds),
    });
  }

  const nextRound =
    existingEvents.reduce((max, e) => (e.round > max ? e.round : max), 0) + 1;

  if (!target) {
    const userEvent: ExecutionEvent = {
      id: crypto.randomUUID(),
      runId,
      type: 'user_message',
      round: nextRound,
      agentName: 'You → All Agents (GroupChat)',
      content: cleanMessage,
      timestamp: new Date().toISOString(),
    };
    broadcastEvent(runId, userEvent);
    updateRunRecord({
      id: runId,
      status: 'running',
      roundsExecuted: nextRound,
      events: runEventBuffers.get(runId) ?? [],
    });

    void executeGroupDiscussionRound({
      runId,
      workflow,
      userMessage: cleanMessage,
      mode: resolvedMode,
      baseRound: nextRound,
    });

    res.json({ runId, mode: resolvedMode, userEvent });
    return;
  }

  const userEvent: ExecutionEvent = {
    id: crypto.randomUUID(),
    runId,
    type: 'user_message',
    round: nextRound,
    agentId: target.id,
    agentName: `You → ${target.data.label}`,
    role: target.data.role,
    content: cleanMessage,
    timestamp: new Date().toISOString(),
  };

  broadcastEvent(runId, userEvent);
  updateRunRecord({
    id: runId,
    status: 'running',
    roundsExecuted: nextRound,
    events: runEventBuffers.get(runId) ?? [],
  });

  void executeDirectAgentTurn({
    runId,
    workflow,
    targetNode: target,
    userMessage: cleanMessage,
    mode: resolvedMode,
    roundNum: nextRound,
  });

  res.json({ runId, mode: resolvedMode, userEvent });
});

app.get('/api/bugs', (req, res) => {
  const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  res.json(listBugReports({ runId, role }));
});

app.post('/api/bugs', (req, res) => {
  const body = req.body as {
    runId?: string;
    workflowId?: string;
    agentId?: string;
    agentName?: string;
    role?: WorkflowNode['data']['role'];
    category?: 'bug' | 'improvement';
    severity?: 'critical' | 'high' | 'medium' | 'low';
    title?: string;
    description?: string;
    suggestedFix?: string;
  };
  if (!body.title?.trim() || !body.description?.trim()) {
    res.status(400).json({ error: 'Bug report title and description are required.' });
    return;
  }
  const created = createBugReport({
    runId: body.runId,
    workflowId: body.workflowId,
    agentId: body.agentId || 'manual',
    agentName: body.agentName || 'Operator / Team',
    role: body.role || 'custom',
    category: body.category === 'improvement' ? 'improvement' : 'bug',
    severity: body.severity || 'medium',
    title: body.title.trim(),
    description: body.description.trim(),
    suggestedFix: body.suggestedFix?.trim() || undefined,
  });
  res.json(created);
});

app.patch('/api/bugs/:id', (req, res) => {
  const { status } = req.body as { status?: BugReportStatus };
  if (status !== 'open' && status !== 'acknowledged' && status !== 'resolved') {
    res.status(400).json({ error: 'Invalid bug status' });
    return;
  }
  const updated = updateBugReportStatus(req.params.id, status);
  if (!updated) {
    res.status(404).json({ error: 'Bug report not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/bugs/:id', (req, res) => {
  const ok = deleteBugReport(req.params.id);
  res.json({ deleted: ok });
});

app.get('/api/blueprint', (_req, res) => {
  const specs: Array<{
    diskPath: string;
    displayPath: string;
    phase: string;
    language: string;
    summary: string;
  }> = [
    {
      diskPath: 'install-linux.sh',
      displayPath: 'install-linux.sh',
      phase: 'Linux Installer · One-Command Setup',
      language: 'bash',
      summary:
        'Automated Linux installer supporting Docker Compose (--docker), Native Node 22+ (--native), systemd service (--systemd), and prerequisite checks (--check).',
    },
    {
      diskPath: 'Dockerfile',
      displayPath: 'Dockerfile',
      phase: 'Linux Container · Production Full-Stack',
      language: 'dockerfile',
      summary:
        'Node 22 + Python 3 production image building the React/Vite bundle and serving Express + WebSocket + SQLite on port 3000 with /api/health check.',
    },
    {
      diskPath: 'docker-compose.yml',
      displayPath: 'docker-compose.yml',
      phase: 'Linux Compose · Root Stack',
      language: 'yaml',
      summary:
        'One-command root Compose configuration with persistent SQLite volume, sandbox storage, and host.docker.internal support for local Linux Ollama.',
    },
    {
      diskPath: 'deploy/systemd/aetherflow-studio.service',
      displayPath: 'deploy/systemd/aetherflow-studio.service',
      phase: 'Linux Service · systemd Unit',
      language: 'ini',
      summary:
        'Hardened systemd unit template for running AetherFlow Studio cleanly as a background Linux daemon.',
    },
    {
      diskPath: 'deploy/frontend/nginx.conf',
      displayPath: 'deploy/frontend/nginx.conf',
      phase: 'Linux Proxy · Nginx + WebSocket',
      language: 'nginx',
      summary:
        'Nginx configuration serving the SPA bundle and reverse-proxying /api/* and /ws upgrades with 25MB ZIP upload limit.',
    },
    {
      diskPath: 'README.md',
      displayPath: 'README.md',
      phase: 'Linux Docs · Installation Guide',
      language: 'markdown',
      summary:
        'Bilingual Linux installation and operations guide covering Docker Compose, Native Node 22+, systemd, and environment variables.',
    },
    {
      diskPath: 'deploy/backend/agent_engine.py',
      displayPath: 'backend/agent_engine.py',
      phase: 'Phase 2 · Multi-Agent Core',
      language: 'python',
      summary:
        'LiteLLM multi-provider router (Gemini, OpenAI, Anthropic, Ollama), GroupChat speaker orchestration, max_rounds guard, HITL gate, and Docker sandbox tool runner.',
    },
    {
      diskPath: 'deploy/backend/sandbox.py',
      displayPath: 'backend/sandbox.py',
      phase: 'Phase 2 · Docker Sandbox',
      language: 'python',
      summary:
        'Isolated Linux container execution via Docker SDK for Python with non-root user, memory/PID/CPU limits, network isolation, and sensitive command detector.',
    },
    {
      diskPath: 'deploy/backend/main.py',
      displayPath: 'backend/main.py',
      phase: 'Phase 3 · FastAPI & WebSocket',
      language: 'python',
      summary:
        'FastAPI REST endpoints, WebSocket /ws/run/{run_id} live event stream with replay buffer, and async Human-in-the-Loop approval futures.',
    },
    {
      diskPath: 'deploy/backend/database.py',
      displayPath: 'backend/database.py',
      phase: 'Phase 3 · SQLite Persistence',
      language: 'python',
      summary:
        'SQLite storage for visual workflow graphs, agent system prompts, and GroupChat execution logs.',
    },
    {
      diskPath: 'deploy/backend/models.py',
      displayPath: 'backend/models.py',
      phase: 'Phase 3 · Pydantic Schemas',
      language: 'python',
      summary:
        'Strict Pydantic v2 schemas for nodes, edges, LLM providers, tools, and WebSocket execution payloads.',
    },
    {
      diskPath: 'src/components/WorkflowCanvas.tsx',
      displayPath: 'frontend/src/components/WorkflowCanvas.tsx',
      phase: 'Phase 4 · React Flow Canvas',
      language: 'tsx',
      summary:
        'n8n-style interactive React Flow graph canvas with custom Agent nodes, edge handoffs, and live speaker highlighting.',
    },
    {
      diskPath: 'deploy/docker-compose.yml',
      displayPath: 'deploy/docker-compose.yml',
      phase: 'Phase 5 · Python Stack Compose',
      language: 'yaml',
      summary:
        'Alternative FastAPI + Docker Sandbox + Nginx Compose stack under deploy/.',
    },
    {
      diskPath: 'deploy/backend/Dockerfile',
      displayPath: 'backend/Dockerfile',
      phase: 'Phase 5 · Backend Image',
      language: 'dockerfile',
      summary: 'Python 3.11-slim FastAPI runtime container.',
    },
    {
      diskPath: 'deploy/sandbox/Dockerfile.sandbox',
      displayPath: 'sandbox/Dockerfile.sandbox',
      phase: 'Phase 5 · Sandbox Image',
      language: 'dockerfile',
      summary: 'Non-root isolated Linux execution container with pytest, ruff, and git.',
    },
    {
      diskPath: 'deploy/backend/requirements.txt',
      displayPath: 'backend/requirements.txt',
      phase: 'Phase 1 · Dependencies',
      language: 'text',
      summary: 'Pinned FastAPI, LiteLLM, PyAutoGen, Docker SDK, and WebSocket packages.',
    },
  ];

  const files: BlueprintFile[] = specs
    .map((item) => {
      const full = path.resolve(process.cwd(), item.diskPath);
      if (!fs.existsSync(full)) return null;
      return {
        path: item.displayPath,
        phase: item.phase,
        language: item.language,
        summary: item.summary,
        content: fs.readFileSync(full, 'utf-8'),
      };
    })
    .filter((f): f is BlueprintFile => f !== null);

  res.json({ files });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AetherFlow Agent Studio server listening on http://localhost:${PORT}`);
  });
}

void startServer();
