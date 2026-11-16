import 'dotenv/config';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { ThinkingLevel } from '@google/genai';
import AdmZip from 'adm-zip';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  bumpUserSessionVersion,
  clearWorkflowRunsMemory,
  countUsers,
  createBugReport,
  createRunRecord,
  createUserRecord,
  deleteBugReport,
  deleteImportedProject,
  deleteNginxDomain,
  deleteProviderSecret,
  deleteRunRecord,
  deleteUserRecord,
  deleteWorkflow,
  getAppSettings,
  getAuthPolicy,
  getContinuousSession,
  getDb,
  getImportedProjectById,
  getNginxDomainById,
  getRunEvents,
  getRunSummaryById,
  getUserWithAuthById,
  getUserWithAuthByIdentifier,
  getWorkflowById,
  listActiveContinuousSessions,
  listBugReports,
  listImportedProjects,
  listNginxDomains,
  listProviderSecretStatuses,
  listRecentWorkflowRunsWithSummary,
  listRunSummaries,
  listUserProfiles,
  listWorkflows,
  recordUserLogin,
  resolveServerSecret,
  saveAppSettings,
  saveAuthPolicy,
  saveImportedProject,
  setProviderSecret,
  updateBugReportStatus,
  updateImportedProject,
  updateNginxDomainCheck,
  updateRunRecord,
  updateUserPasswordRecord,
  updateUserProfileRecord,
  upsertContinuousSession,
  upsertNginxDomain,
  upsertWorkflow,
} from './server/db.ts';
import type {
  AgentRole,
  AppSettings,
  BlueprintFile,
  BugReportStatus,
  ContinuousWorkSession,
  ExecutionEvent,
  ImportedProjectAnalysis,
  NginxSslMode,
  RecommendedAgentSpec,
  SandboxFile,
  TokenUsage,
  ToolCallLog,
  UserRole,
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
  formatGeminiApiError,
  normalizeSecretName,
  parseGeminiBaseUrl,
  validateApiKeyValue,
  type GeminiApiVersion,
} from './src/utils/secretUtils.ts';
import {
  assembleExportBundleFiles,
  buildContentDispositionHeader,
  computeExportChangeSummary,
  isSafeExportFilePath,
  mergeSandboxSnapshots,
  slugifyBundleName,
  upsertReadmeChangelog,
  validateGitHubPushParams,
  type BundleFileEntry,
  type ExportBundleScope,
  type ExportChangeSummary,
} from './src/utils/exportBundle.ts';
import { createZipBufferFromBundle } from './server/zipBundle.ts';
import { buildProjectDiffEntries } from './src/utils/diffUtils.ts';
import { compactSandboxOutput, truncateMiddle } from './src/utils/promptOptimizer.ts';
import {
  buildManagerInspectionContext,
  buildStructuredAgentPrompt,
  buildWorkflowMemorySnapshot,
  clampContinuousIntervalSec,
  clampMaxRounds,
  computeExecutionOrder,
  computeParallelFanoutTargets,
  detectSensitiveCommand,
  estimateTokenUsage,
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
import {
  canNodeRunLive,
  canWorkflowRunLive,
  generateLiveAgentReply,
  getAiClient,
  sleepWithAbort,
  type StructuredToolInvocation,
} from './server/llmRuntime.ts';
import { getLatestPrelaunchReport, runPrelaunchTestSuite } from './server/prelaunchRunner.ts';
import { cleanupStaleSandboxDirs, pruneBufferedRunEvents } from './server/sandboxCleanup.ts';
import {
  clampMaxBodyMb,
  clampUpstreamPort,
  generateNginxApplyScript,
  generateNginxServerBlock,
  validateDomainHostname,
} from './src/utils/nginxConfig.ts';
import {
  createUserSessionCookieValue,
  hashUserPassword,
  normalizeUsernameInput,
  parseAndVerifyUserSessionCookie,
  validateEmailAddress,
  validatePasswordStrength,
  verifyUserPassword,
} from './server/authUtils.ts';
import {
  createIpRateLimiter,
  createSignedSessionToken,
  getAuthenticatedUserIdFromRequest,
  getConfiguredOperatorAuthToken,
  getMasterEncryptionKey,
  getSessionCookieName,
  getUserSessionCookieName,
  isOperatorAuthEnabled,
  isRequestAuthorized,
  registerUserSessionResolver,
  requireOperatorAuth,
  safeEqualSecret,
  safeResolveSandboxPath,
  sanitizeSandboxEnv,
  securityHeadersMiddleware,
} from './server/security.ts';

const execAsync = promisify(exec);
const PORT = Number(process.env.PORT || 3000);
const SANDBOX_BASE = path.resolve('/tmp/aetherflow_sandboxes');
const PROJECTS_BASE = path.resolve('/tmp/aetherflow_projects');
const PROJECTS_ORIGINALS_BASE = path.resolve('/tmp/aetherflow_projects_originals');

// Initialize SQLite database on boot and wire persistent user sessions
getDb();
{
  const envDomainRaw = (process.env.AETHERFLOW_DOMAIN || '').trim();
  if (envDomainRaw) {
    const check = validateDomainHostname(envDomainRaw);
    if (check.valid) {
      const existing = listNginxDomains().find((d) => d.domain === check.domain);
      if (!existing) {
        upsertNginxDomain({
          domain: check.domain,
          upstreamPort: clampUpstreamPort(PORT),
          sslMode: 'letsencrypt',
          sslEmail: (process.env.AETHERFLOW_EMAIL || '').trim() || undefined,
          redirectWww: false,
          clientMaxBodyMb: 50,
          enableWebsocket: true,
          enableHsts: true,
          status: process.env.AETHERFLOW_SSL_ACTIVE === 'true' ? 'active' : 'draft',
        });
      }
    }
  }
}
registerUserSessionResolver({
  isUserAuthRequired: () => countUsers() > 0 && getAuthPolicy().requireAuth,
  verifyUserCookie: (cookieVal: string) => {
    const parsed = parseAndVerifyUserSessionCookie({
      cookieValue: cookieVal,
      signingKey: getMasterEncryptionKey(),
    });
    if (!parsed.valid || !parsed.userId) return { valid: false };
    const found = getUserWithAuthById(parsed.userId);
    if (!found || found.sessionVersion !== parsed.sessionVersion) {
      return { valid: false };
    }
    return { valid: true, userId: found.user.id, role: found.user.role };
  },
});

const app = express();
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: '25mb' }));
app.use('/api', requireOperatorAuth);

const authLoginLimiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 15 });
const providerTestLimiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 25 });
const runStartLimiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 30 });
const chatLimiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 45 });
const webhookLimiter = createIpRateLimiter({ windowMs: 60_000, maxRequests: 60 });

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const runSubscribers = new Map<string, Set<WebSocket>>();
const runEventBuffers = new Map<string, ExecutionEvent[]>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const pendingApprovalsByRun = new Map<string, Set<string>>();
const runAbortControllers = new Map<string, AbortController>();

function buildCapabilitiesPayload() {
  const settings = getAppSettings();
  const known = [...Object.values(settings.providers).map((p) => p.envVarName), 'GITHUB_TOKEN'];
  const secrets = listProviderSecretStatuses(known);
  const geminiRef = normalizeSecretName(settings.providers.gemini?.envVarName || '') || 'GEMINI_API_KEY';
  const openaiRef = normalizeSecretName(settings.providers.openai?.envVarName || '') || 'OPENAI_API_KEY';
  const anthropicRef =
    normalizeSecretName(settings.providers.anthropic?.envVarName || '') || 'ANTHROPIC_API_KEY';
  const opencodeRef =
    normalizeSecretName(settings.providers.opencode?.envVarName || '') || 'OPENCODE_API_KEY';

  return {
    geminiConfigured: Boolean(secrets[geminiRef]?.configured || secrets.GEMINI_API_KEY?.configured),
    openaiConfigured: Boolean(secrets[openaiRef]?.configured || secrets.OPENAI_API_KEY?.configured),
    anthropicConfigured: Boolean(
      secrets[anthropicRef]?.configured || secrets.ANTHROPIC_API_KEY?.configured,
    ),
    opencodeConfigured: Boolean(
      secrets[opencodeRef]?.configured || secrets.OPENCODE_API_KEY?.configured,
    ),
    ollamaBaseUrl:
      settings.providers.ollama?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://host.docker.internal:11434',
    secrets,
    authEnabled: isOperatorAuthEnabled() || (countUsers() > 0 && getAuthPolicy().requireAuth),
    hasUsers: countUsers() > 0,
    vaultEncrypted: true,
    dockerSandbox: process.env.AETHERFLOW_DOCKER_SANDBOX === '1',
  };
}

function broadcastEvent(runId: string, event: ExecutionEvent): void {
  if (event.type !== 'agent_chunk') {
    const list = runEventBuffers.get(runId) ?? [];
    list.push(event);
    runEventBuffers.set(runId, list);
    if (runEventBuffers.size > 60) {
      pruneBufferedRunEvents(runEventBuffers, 60, new Set(runAbortControllers.keys()));
    }
  }

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
  if (!isRequestAuthorized(req)) {
    ws.close(4401, 'Unauthorized');
    return;
  }

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
  return safeResolveSandboxPath(runDir, relPath);
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

function getProjectOriginalsDir(projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(PROJECTS_ORIGINALS_BASE, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureProjectOriginalsSnapshot(projectId: string): void {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return;
  const projDir = path.join(PROJECTS_BASE, safeId);
  const origDir = path.join(PROJECTS_ORIGINALS_BASE, safeId);
  if (!fs.existsSync(projDir) || fs.existsSync(origDir)) return;
  fs.mkdirSync(origDir, { recursive: true });
  function copyOrig(curr: string) {
    for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
      const full = path.join(curr, entry.name);
      const rel = path.relative(projDir, full).replace(/\\/g, '/');
      if (!isSafeExportFilePath(rel)) continue;
      const dest = path.join(origDir, rel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        copyOrig(full);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(full, dest);
      }
    }
  }
  copyOrig(projDir);
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
  const originalsDir = getProjectOriginalsDir(projectId);
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

    const origTarget = safeSandboxPath(originalsDir, relPath);
    fs.mkdirSync(path.dirname(origTarget), { recursive: true });
    fs.writeFileSync(origTarget, text, 'utf-8');

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
  ensureProjectOriginalsSnapshot(safeId);

  const runDir = getSandboxDir(runId);
  if (fs.readdirSync(runDir).length > 0) return;

  let copied = 0;
  function walkCopy(curr: string) {
    if (copied >= 400) return;
    for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
      if (copied >= 400) return;
      const full = path.join(curr, entry.name);
      const rel = path.relative(srcDir, full).replace(/\\/g, '/');
      if (!isSafeExportFilePath(rel)) continue;
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

function syncWriteToImportedProject(
  workflow: WorkflowConfig,
  relPath: string,
  content: string,
): void {
  const projectId = workflow.projectContext?.projectId;
  if (!projectId || !isSafeExportFilePath(relPath)) return;
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return;
  ensureProjectOriginalsSnapshot(safeId);
  const projectDir = getProjectDir(safeId);
  const target = safeSandboxPath(projectDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

function syncProjectReadmeChangelog(workflow: WorkflowConfig): void {
  const projectId = workflow.projectContext?.projectId;
  if (!projectId) return;
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return;
  const origFiles = listImportedProjectFilesFromDisk(safeId, true);
  const currFiles = listImportedProjectFilesFromDisk(safeId, false);
  const origMap = new Map(origFiles.map((f) => [f.path, f.content]));
  const modifiedPaths: string[] = [];
  const addedPaths: string[] = [];
  for (const f of currFiles) {
    if (f.path === 'README.md') continue;
    if (!origMap.has(f.path)) {
      addedPaths.push(f.path);
    } else if (origMap.get(f.path) !== f.content) {
      modifiedPaths.push(f.path);
    }
  }
  const bugReports = listBugReports({ workflowId: workflow.id });
  if (modifiedPaths.length === 0 && addedPaths.length === 0 && bugReports.length === 0) return;
  const existingReadme =
    currFiles.find((f) => f.path === 'README.md')?.content ?? origMap.get('README.md');
  const nextReadme = upsertReadmeChangelog(existingReadme, {
    workflow,
    modifiedPaths,
    addedPaths,
    bugReports,
  });
  const readmeTarget = safeSandboxPath(getProjectDir(safeId), 'README.md');
  fs.mkdirSync(path.dirname(readmeTarget), { recursive: true });
  fs.writeFileSync(readmeTarget, nextReadme, 'utf-8');
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
    .slice(0, 35)
    .map((f) => `${f.path} (${f.size ?? f.content.length}B)`)
    .join('\n');

  const manifestSnippets = files
    .filter((f) =>
      /(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|docker-compose\.ya?ml|dockerfile|readme\.md)$/i.test(
        f.path,
      ),
    )
    .slice(0, 4)
    .map((f) => `### ${f.path}\n${truncateMiddle(f.content, 650)}`)
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
    `Lead Architect: analyze repo files & return ONLY compact JSON: ` +
    `{"managerSummary":"concise assessment","recommendations":[{"title":"","role":"manager|backend|frontend|security_qa|executor|custom","specialty":"","reason":"","priority":"essential|recommended|optional","matchedSignals":[""],"systemPrompt":"concise prompt","tools":{"readFile":true,"writeFile":boolean,"execBash":boolean}}]}. ` +
    (isFa
      ? `Write managerSummary, title, specialty, reason in concise Persian/Farsi.`
      : `Write managerSummary, title, specialty, reason in concise English.`);

  const userPrompt =
    `Project: ${baseAnalysis.name} (${baseAnalysis.sourceType})\n` +
    `Langs: ${baseAnalysis.languages.map((l) => `${l.name}:${l.files}`).join(', ')}\n` +
    `Stack: ${baseAnalysis.frameworks.join(', ')}\n\n` +
    `Files (${files.length}, top 35):\n${fileIndex}\n\n` +
    `Manifests:\n${manifestSnippets}`;

  for (const modelName of ['gemini-3.1-flash-lite', 'gemini-4-argon']) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          ...(/^gemini-4-/i.test(modelName)
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
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
  const useDocker =
    process.env.AETHERFLOW_DOCKER_SANDBOX === '1' &&
    path.resolve(runDir) !== path.resolve(process.cwd());
  const effectiveCmd = useDocker
    ? `docker run --rm --network none -m ${getAppSettings().sandboxMemoryMb}m --pids-limit 128 -v ${JSON.stringify(path.resolve(runDir))}:/workspace -w /workspace alpine:3.20 sh -lc ${JSON.stringify(command)}`
    : command;

  try {
    const { stdout, stderr } = await execAsync(effectiveCmd, {
      cwd: runDir,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: {
        ...sanitizeSandboxEnv(process.env),
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

function applyStructuredMetaTools(params: {
  structuredTools?: StructuredToolInvocation[];
  runId: string;
  workflowId?: string;
  node: WorkflowNode;
  nodes: WorkflowNode[];
  roundNum: number;
  phase: 'test' | 'deploy' | 'review';
}): Array<{ targetRole: string; targetAgentId: string; targetAgentName: string; issue: string }> {
  const { structuredTools, runId, workflowId, node, nodes, roundNum, phase } = params;
  if (!structuredTools || structuredTools.length === 0) return [];
  const delegations: Array<{
    targetRole: string;
    targetAgentId: string;
    targetAgentName: string;
    issue: string;
  }> = [];

  for (const call of structuredTools) {
    if (call.name === 'report_bug') {
      const title = String(call.args.title || '').trim();
      const description = String(call.args.description || '').trim();
      if (!title || !description) continue;
      const categoryRaw = String(call.args.category || '').toLowerCase();
      const severityRaw = String(call.args.severity || '').toLowerCase();
      const saved = createBugReport({
        runId,
        workflowId,
        agentId: node.id,
        agentName: node.data.label,
        role: node.data.role,
        category: categoryRaw === 'improvement' ? 'improvement' : 'bug',
        severity:
          severityRaw === 'critical' ||
          severityRaw === 'high' ||
          severityRaw === 'medium' ||
          severityRaw === 'low'
            ? severityRaw
            : 'medium',
        title,
        description,
        suggestedFix:
          typeof call.args.suggestedFix === 'string' && call.args.suggestedFix.trim()
            ? call.args.suggestedFix.trim()
            : undefined,
      });
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
    } else if (call.name === 'delegate_agent' && isManagerNode(node)) {
      const targetRoleRaw = String(call.args.targetRole || '').trim();
      const issue = String(call.args.issue || '').trim();
      if (!targetRoleRaw || !issue) continue;
      const reason = String(call.args.reason || issue).trim();
      const targetNode =
        nodes.find((n) => n.data.role === targetRoleRaw) ??
        nodes.find((n) => n.id !== node.id) ??
        node;
      const delegation = {
        id: crypto.randomUUID(),
        managerId: node.id,
        managerName: node.data.label,
        targetRole: targetNode.data.role,
        targetAgentId: targetNode.id,
        targetAgentName: targetNode.data.label,
        issue,
        reason,
        phase,
        timestamp: new Date().toISOString(),
      };
      broadcastEvent(runId, {
        id: crypto.randomUUID(),
        runId,
        type: 'manager_delegation',
        round: roundNum,
        agentId: node.id,
        agentName: node.data.label,
        role: node.data.role,
        content: `${node.data.label} delegated issue to ${delegation.targetAgentName} (${delegation.targetRole}): ${delegation.issue}`,
        delegation,
        timestamp: delegation.timestamp,
      });
      delegations.push({
        targetRole: delegation.targetRole,
        targetAgentId: delegation.targetAgentId,
        targetAgentName: delegation.targetAgentName,
        issue: delegation.issue,
      });
    }
  }

  return delegations;
}

async function processAgentTools(params: {
  runId: string;
  workflow: WorkflowConfig;
  node: WorkflowNode;
  reply: string;
  structuredTools?: StructuredToolInvocation[];
  roundNum: number;
  mode: 'live' | 'dry_run';
  settings: AppSettings;
}): Promise<ToolCallLog[]> {
  const { runId, workflow, node, reply, structuredTools = [], roundNum, mode, settings } = params;
  const runDir = getSandboxDir(runId);
  const logs: ToolCallLog[] = [];
  const timeoutMs = settings.sandboxTimeoutSec * 1000;

  if (node.data.tools.writeFile && settings.allowWriteFile) {
    const writes: Array<{ relPath: string; content: string }> = [];
    const seenWritePaths = new Set<string>();
    for (const call of structuredTools) {
      if (call.name === 'write_file') {
        const relPath = String(call.args.path || '').trim();
        const content = String(call.args.content ?? '');
        if (relPath && !seenWritePaths.has(relPath)) {
          seenWritePaths.add(relPath);
          writes.push({ relPath, content });
        }
      }
    }
    const writeRegex = /WRITE_FILE:([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = writeRegex.exec(reply)) !== null) {
      const relPath = match[1].trim();
      const content = match[2];
      if (relPath && !seenWritePaths.has(relPath)) {
        seenWritePaths.add(relPath);
        writes.push({ relPath, content });
      }
    }

    let wroteAnyProjectFile = false;
    for (const { relPath, content } of writes) {
      try {
        const target = safeSandboxPath(runDir, relPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        syncWriteToImportedProject(workflow, relPath, content);
        wroteAnyProjectFile = true;
        logs.push({
          id: crypto.randomUUID(),
          tool: 'write_file',
          target: relPath,
          result: `Wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${relPath}`,
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
    if (wroteAnyProjectFile) {
      try {
        syncProjectReadmeChangelog(workflow);
      } catch {
        // ignore README sync errors
      }
    }
  }

  if (node.data.tools.readFile && settings.allowReadFile) {
    const reads: string[] = [];
    const seenReadPaths = new Set<string>();
    for (const call of structuredTools) {
      if (call.name === 'read_file') {
        const relPath = String(call.args.path || '').trim();
        if (relPath && !seenReadPaths.has(relPath)) {
          seenReadPaths.add(relPath);
          reads.push(relPath);
        }
      }
    }
    const readRegex = /^READ_FILE:([^\n]+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = readRegex.exec(reply)) !== null) {
      const relPath = match[1].trim();
      if (relPath && !seenReadPaths.has(relPath)) {
        seenReadPaths.add(relPath);
        reads.push(relPath);
      }
    }
    for (const relPath of reads) {
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
    const commands: string[] = [];
    const seenCommands = new Set<string>();
    for (const call of structuredTools) {
      if (call.name === 'exec_bash') {
        const cmd = String(call.args.command || '').trim();
        if (cmd && !seenCommands.has(cmd)) {
          seenCommands.add(cmd);
          commands.push(cmd);
        }
      }
    }
    const bashRegex = /^EXEC_BASH:([^\n]+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = bashRegex.exec(reply)) !== null) {
      const cmd = match[1].trim();
      if (cmd && !seenCommands.has(cmd)) {
        seenCommands.add(cmd);
        commands.push(cmd);
      }
    }

    for (const command of commands) {
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
            pendingApprovalsByRun.get(runId)?.delete(approvalId);
            resolve(false);
          }, 5 * 60 * 1000);
          if (!pendingApprovalsByRun.has(runId)) {
            pendingApprovalsByRun.set(runId, new Set());
          }
          pendingApprovalsByRun.get(runId)!.add(approvalId);
          pendingApprovals.set(approvalId, (decision) => {
            clearTimeout(timer);
            pendingApprovalsByRun.get(runId)?.delete(approvalId);
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
  const bootSettings = getAppSettings();
  const abortController = new AbortController();
  runAbortControllers.set(runId, abortController);

  seedSandboxFromProject(runId, workflow.projectContext?.projectId);

  if (mode === 'live' && !canWorkflowRunLive(ordered, bootSettings)) {
    const errEvt: ExecutionEvent = {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: 0,
      content:
        'No live LLM API key is configured for the selected agents. Open Settings to add a Gemini, OpenAI, Anthropic, or OpenCode API key, or switch Execution Mode to Sandbox Dry-Run.',
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
    runAbortControllers.delete(runId);
    return;
  }

  // Build cross-run persistent workflow memory when enabled (AutoGen-style shared context)
  const memoryText =
    workflow.memoryEnabled !== false
      ? buildWorkflowMemorySnapshot({
          priorRuns: listRecentWorkflowRunsWithSummary(workflow.id, 4, runId),
          openBugs: listBugReports({ workflowId: workflow.id }),
          workspaceFiles: listSandboxFilesReadOnly(runId),
        })
      : '';

  broadcastEvent(runId, {
    id: crypto.randomUUID(),
    runId,
    type: 'run_started',
    round: 0,
    content:
      runStage === 'test_and_deploy'
        ? `Started Automated Test & Deploy Audit across ${ordered.length} agents${managerNode ? ` (Supervisor: ${managerNode.data.label})` : ''}.`
        : `Started GroupChat across ${ordered.length} agents (max_rounds=${maxRounds}, HITL=${workflow.humanInTheLoop ? 'enabled' : 'off'}, mode=${mode}${memoryText ? ', memory=on' : ''}).`,
    timestamp: new Date().toISOString(),
  });

  const history: Array<{ role: string; content: string }> = [
    ...(memoryText ? [{ role: 'memory', content: memoryText }] : []),
    { role: 'user', content: `Project Task:\n${taskPrompt}` },
  ];

  const allToolCalls: ToolCallLog[] = [];
  const delegatedKeys = new Set<string>();
  let pendingDelegatedRole: string | undefined;
  let forceManagerAudit = false;
  let managerReviewedPostTest = false;
  let lastTurnHadError = false;
  let lastReply = '';

  if (runStage === 'test_and_deploy') {
    const preflightLogs = await runDeployVerificationChecks();
    allToolCalls.push(...preflightLogs);
    const hasFailure = preflightLogs.some((l) => (l.exitCode ?? 0) !== 0);
    lastTurnHadError = hasFailure;
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
  const executedNodeIds = new Set<string>();

  async function runSingleSpeakerTurn(paramsTurn: {
    speaker: WorkflowNode;
    roundNum: number;
    historySnapshot: Array<{ role: string; content: string }>;
  }): Promise<{
    reply: string;
    toolCalls: ToolCallLog[];
    hadError: boolean;
    delegatedRole?: string;
    delegationCount: number;
  }> {
    const { speaker, roundNum, historySnapshot } = paramsTurn;
    const turnStartedAt = Date.now();
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

    const localHistory = [...historySnapshot];
    let finalReply = '';
    const turnToolCalls: ToolCallLog[] = [];
    let totalTurnUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimated: false,
    };
    let delegatedRole: string | undefined;
    let delegationCount = 0;

    const maxInnerSteps = mode === 'live' && canNodeRunLive(speaker, getAppSettings()) ? 2 : 0;
    for (let innerStep = 0; innerStep <= maxInnerSteps; innerStep++) {
      if (abortController.signal.aborted) break;

      let rawReply: string;
      let structuredTools: StructuredToolInvocation[] = [];
      let stepUsage: TokenUsage;

      if (mode === 'live' && canNodeRunLive(speaker, getAppSettings())) {
        const liveResult = await generateLiveAgentReply({
          ai,
          node: speaker,
          history: localHistory,
          inspectionSnapshot: inspection?.summaryText,
          delegationPhase: phase,
          signal: abortController.signal,
          onChunk: (accumulatedText) => {
            broadcastEvent(runId, {
              id: `chunk-${runId}-${speaker.id}-${roundNum}-${innerStep}`,
              runId,
              type: 'agent_chunk',
              round: roundNum,
              agentId: speaker.id,
              agentName: speaker.data.label,
              role: speaker.data.role,
              provider: speaker.data.provider,
              model: speaker.data.model,
              content: accumulatedText,
              timestamp: new Date().toISOString(),
            });
          },
        });
        rawReply = liveResult.text;
        structuredTools = liveResult.structuredTools;
        stepUsage = liveResult.tokenUsage;
      } else {
        rawReply =
          isMgr && (runStage === 'test_and_deploy' || allToolCalls.length > 0 || roundNum > 1)
            ? buildDryRunManagerAuditReply({
                managerNode: speaker,
                nodes: ordered,
                taskPrompt,
                sandboxFiles: currentSandboxFiles,
                toolCalls: allToolCalls,
                openBugs: currentOpenBugs,
                alreadyDelegatedKeys: delegatedKeys,
                phase,
                allowTerminate: roundNum >= 2,
              })
            : buildDryRunAgentReply(speaker, taskPrompt, roundNum, maxRounds);
        stepUsage = estimateTokenUsage(taskPrompt, rawReply);
      }

      if (abortController.signal.aborted) break;

      totalTurnUsage = {
        promptTokens: totalTurnUsage.promptTokens + stepUsage.promptTokens,
        completionTokens: totalTurnUsage.completionTokens + stepUsage.completionTokens,
        totalTokens: totalTurnUsage.totalTokens + stepUsage.totalTokens,
        estimated: Boolean(totalTurnUsage.estimated || stepUsage.estimated),
        ...((totalTurnUsage.savedTokens ?? 0) + (stepUsage.savedTokens ?? 0) > 0
          ? { savedTokens: (totalTurnUsage.savedTokens ?? 0) + (stepUsage.savedTokens ?? 0) }
          : {}),
      };

      const withoutBugs = processAndBroadcastBugReports({
        reply: rawReply,
        runId,
        workflowId: workflow.id,
        node: speaker,
        roundNum,
      });

      const delegationResult = processAndBroadcastManagerDelegations({
        reply: withoutBugs,
        runId,
        managerNode: speaker,
        nodes: ordered,
        roundNum,
        phase,
      });

      const structuredDelegations = applyStructuredMetaTools({
        structuredTools,
        runId,
        workflowId: workflow.id,
        node: speaker,
        nodes: ordered,
        roundNum,
        phase,
      });

      const mergedDelegations = [...delegationResult.delegations, ...structuredDelegations];
      if (mergedDelegations.length > 0) {
        delegatedRole = mergedDelegations[0].targetRole;
        delegationCount += mergedDelegations.length;
      }

      const stepReply = delegationResult.cleanedReply.trim()
        ? delegationResult.cleanedReply
        : structuredTools.length > 0
          ? `${speaker.data.label} executed ${structuredTools.map((s) => s.name).join(', ')}.`
          : '';
      finalReply = finalReply ? `${finalReply}\n\n${stepReply}` : stepReply;

      const settings = getAppSettings();
      const stepToolCalls = await processAgentTools({
        runId,
        workflow,
        node: speaker,
        reply: stepReply,
        structuredTools,
        roundNum,
        mode,
        settings,
      });
      turnToolCalls.push(...stepToolCalls);

      const shouldFollowUpReAct =
        mode === 'live' &&
        innerStep < maxInnerSteps &&
        stepToolCalls.some((tc) => tc.tool === 'read_file' || tc.tool === 'exec_bash');

      if (!shouldFollowUpReAct) break;

      localHistory.push({
        role: speaker.data.label,
        content: truncateMiddle(stepReply, 450),
      });
      localHistory.push({
        role: 'sandbox',
        content: stepToolCalls
          .map(
            (t) =>
              `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${compactSandboxOutput(t.result, 320)}`,
          )
          .join('\n'),
      });
    }

    const hadError = turnToolCalls.some((t) => (t.exitCode ?? 0) !== 0);

    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'agent_message',
      round: roundNum,
      agentId: speaker.id,
      agentName: speaker.data.label,
      role: speaker.data.role,
      provider: speaker.data.provider,
      model: speaker.data.model,
      content: finalReply,
      durationMs: Date.now() - turnStartedAt,
      tokenUsage: totalTurnUsage,
      toolCalls: turnToolCalls,
      timestamp: new Date().toISOString(),
    });

    return {
      reply: finalReply,
      toolCalls: turnToolCalls,
      hadError,
      delegatedRole,
      delegationCount,
    };
  }

  try {
    for (let i = 0; i < maxRounds; i++) {
      if (abortController.signal.aborted) break;

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
          lastTurnHadError,
          lastReply,
        });
        speaker = next.node;
        pendingDelegatedRole = undefined;
      }

      if (!speaker) break;

      currentNodeId = speaker.id;
      executedNodeIds.add(speaker.id);
      roundsExecuted = i + 1;

      const outcome = await runSingleSpeakerTurn({
        speaker,
        roundNum: roundsExecuted,
        historySnapshot: history,
      });
      if (abortController.signal.aborted) break;

      allToolCalls.push(...outcome.toolCalls);
      lastTurnHadError = outcome.hadError;
      lastReply = outcome.reply;

      if (outcome.delegatedRole) {
        pendingDelegatedRole = outcome.delegatedRole;
        managerReviewedPostTest = false;
      }

      const isMgr = isManagerNode(speaker);
      if (
        managerNode &&
        !isMgr &&
        (lastTurnHadError ||
          speaker.data.role === 'executor' ||
          speaker.data.role === 'security_qa')
      ) {
        forceManagerAudit = true;
        managerReviewedPostTest = false;
      }

      history.push({ role: speaker.data.label, content: outcome.reply });
      if (outcome.toolCalls.length > 0) {
        history.push({
          role: 'sandbox',
          content: outcome.toolCalls
            .map((t) => `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${t.result}`)
            .join('\n'),
        });
      }

      updateRunRecord({
        id: runId,
        status: 'running',
        roundsExecuted,
        events: runEventBuffers.get(runId) ?? [],
      });

      if (outcome.reply.includes('TERMINATE') && isMgr && outcome.delegationCount === 0) {
        break;
      }

      // Execute independent DAG sibling branches in parallel wave if eligible
      if (!forceManagerAudit && !pendingDelegatedRole && i + 1 < maxRounds) {
        const fanoutTargets = computeParallelFanoutTargets({
          orderedNodes: ordered,
          edges: workflow.edges,
          sourceNodeId: speaker.id,
          alreadyExecutedIds: executedNodeIds,
          lastTurnHadError,
          lastReply,
        }).slice(0, maxRounds - (i + 1));

        if (fanoutTargets.length >= 2) {
          const waveHistory = [...history];
          const waveResults = await Promise.all(
            fanoutTargets.map((branchNode, idx) => {
              executedNodeIds.add(branchNode.id);
              return runSingleSpeakerTurn({
                speaker: branchNode,
                roundNum: i + 2 + idx,
                historySnapshot: waveHistory,
              }).then((res) => ({ branchNode, res }));
            }),
          );

          if (abortController.signal.aborted) break;

          let waveHadError = false;
          for (const { branchNode, res } of waveResults) {
            allToolCalls.push(...res.toolCalls);
            if (res.hadError) waveHadError = true;
            lastReply = res.reply;
            currentNodeId = branchNode.id;
            history.push({ role: branchNode.data.label, content: res.reply });
            if (res.toolCalls.length > 0) {
              history.push({
                role: 'sandbox',
                content: res.toolCalls
                  .map((t) => `${t.tool}(${t.target}) [exit=${t.exitCode ?? 0}]: ${t.result}`)
                  .join('\n'),
              });
            }
            if (
              managerNode &&
              !isManagerNode(branchNode) &&
              (res.hadError ||
                branchNode.data.role === 'executor' ||
                branchNode.data.role === 'security_qa')
            ) {
              forceManagerAudit = true;
              managerReviewedPostTest = false;
            }
          }

          lastTurnHadError = waveHadError;
          i += waveResults.length;
          roundsExecuted = i + 1;
          updateRunRecord({
            id: runId,
            status: 'running',
            roundsExecuted,
            events: runEventBuffers.get(runId) ?? [],
          });
        }
      }

      if (mode === 'dry_run') {
        const stillRunning = await sleepWithAbort(200, abortController.signal);
        if (!stillRunning) break;
      }
    }

    if (abortController.signal.aborted) {
      const existingEvents = runEventBuffers.get(runId) ?? [];
      if (!existingEvents.some((e) => e.type === 'run_cancelled')) {
        broadcastEvent(runId, {
          id: crypto.randomUUID(),
          runId,
          type: 'run_cancelled',
          round: roundsExecuted,
          content: `Execution stopped by operator after ${roundsExecuted} round(s).`,
          timestamp: new Date().toISOString(),
        });
      }
      updateRunRecord({
        id: runId,
        status: 'cancelled',
        roundsExecuted,
        events: runEventBuffers.get(runId) ?? [],
        completed: true,
      });
      return;
    }

    // Automatic Post-Test / Pre-Deploy Manager Inspection if tests ran and Manager hasn't signed off yet
    if (managerNode && !managerReviewedPostTest && (allToolCalls.length > 0 || runStage === 'test_and_deploy')) {
      if (roundsExecuted < maxRounds) {
        roundsExecuted += 1;
      }
      const mgrStartedAt = Date.now();
      const finalFiles = listSandboxFiles(runId);
      const finalBugs = listBugReports({ workflowId: workflow.id });
      const finalCtx = buildManagerInspectionContext({
        sandboxFiles: finalFiles,
        toolCalls: allToolCalls,
        openBugs: finalBugs,
      });
      let rawFinalMgr: string;
      let finalMgrStructured: StructuredToolInvocation[] = [];
      let finalMgrUsage: TokenUsage;
      if (mode === 'live' && canNodeRunLive(managerNode, getAppSettings())) {
        const liveMgr = await generateLiveAgentReply({
          ai,
          node: managerNode,
          history,
          inspectionSnapshot: finalCtx.summaryText,
          delegationPhase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
          signal: abortController.signal,
          onChunk: (accumulatedText) => {
            broadcastEvent(runId, {
              id: `chunk-${runId}-${managerNode.id}-${roundsExecuted}`,
              runId,
              type: 'agent_chunk',
              round: roundsExecuted,
              agentId: managerNode.id,
              agentName: managerNode.data.label,
              role: managerNode.data.role,
              provider: managerNode.data.provider,
              model: managerNode.data.model,
              content: accumulatedText,
              timestamp: new Date().toISOString(),
            });
          },
        });
        rawFinalMgr = liveMgr.text;
        finalMgrStructured = liveMgr.structuredTools;
        finalMgrUsage = liveMgr.tokenUsage;
      } else {
        rawFinalMgr = buildDryRunManagerAuditReply({
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
        finalMgrUsage = estimateTokenUsage(finalCtx.summaryText, rawFinalMgr);
      }
      const finalMgrClean = processAndBroadcastManagerDelegations({
        reply: rawFinalMgr,
        runId,
        managerNode,
        nodes: ordered,
        roundNum: roundsExecuted,
        phase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
      }).cleanedReply;
      applyStructuredMetaTools({
        structuredTools: finalMgrStructured,
        runId,
        workflowId: workflow.id,
        node: managerNode,
        nodes: ordered,
        roundNum: roundsExecuted,
        phase: runStage === 'test_and_deploy' ? 'deploy' : 'test',
      });
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
        durationMs: Date.now() - mgrStartedAt,
        tokenUsage: finalMgrUsage,
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
    if (abortController.signal.aborted) {
      const existingEvents = runEventBuffers.get(runId) ?? [];
      if (!existingEvents.some((e) => e.type === 'run_cancelled')) {
        broadcastEvent(runId, {
          id: crypto.randomUUID(),
          runId,
          type: 'run_cancelled',
          round: roundsExecuted,
          content: `Execution stopped by operator after ${roundsExecuted} round(s).`,
          timestamp: new Date().toISOString(),
        });
      }
      updateRunRecord({
        id: runId,
        status: 'cancelled',
        roundsExecuted,
        events: runEventBuffers.get(runId) ?? [],
        completed: true,
      });
      return;
    }
    const settings = getAppSettings();
    const formatted = formatGeminiApiError(err, settings.language);
    const message = formatted.message || (err instanceof Error ? err.message : 'Unexpected execution failure');
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
  } finally {
    runAbortControllers.delete(runId);
  }
}

// REST API Routes
function getCurrentUserFromReq(req: express.Request) {
  const sessionInfo = getAuthenticatedUserIdFromRequest(req);
  if (!sessionInfo) return null;
  return getUserWithAuthById(sessionInfo.userId)?.user ?? null;
}

function isSecureRequest(req: express.Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function setUserSessionCookie(
  req: express.Request,
  res: express.Response,
  userId: string,
  sessionVersion: number,
): void {
  const cookieVal = createUserSessionCookieValue({
    userId,
    sessionVersion,
    signingKey: getMasterEncryptionKey(),
  });
  const secureFlag = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${getUserSessionCookieName()}=${encodeURIComponent(cookieVal)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secureFlag}`,
  );
}

function buildAuthStatusPayload(req: express.Request) {
  const totalUsers = countUsers();
  const policy = getAuthPolicy();
  const operatorTokenEnabled = isOperatorAuthEnabled();
  const authEnabled = operatorTokenEnabled || (totalUsers > 0 && policy.requireAuth);
  const currentUser = getCurrentUserFromReq(req);
  const authenticated = isRequestAuthorized(req);

  return {
    authEnabled,
    authenticated,
    hasUsers: totalUsers > 0,
    requireAuth: policy.requireAuth,
    allowSelfRegistration: policy.allowSelfRegistration,
    operatorTokenEnabled,
    user: currentUser,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sqlite: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json(buildAuthStatusPayload(req));
});

app.post('/api/auth/register', authLoginLimiter, (req, res) => {
  const { email, username, displayName, password, jobTitle, bio, avatarColor } = (req.body ?? {}) as {
    email?: string;
    username?: string;
    displayName?: string;
    password?: string;
    jobTitle?: string;
    bio?: string;
    avatarColor?: string;
  };

  const totalUsers = countUsers();
  const policy = getAuthPolicy();
  const currentUser = getCurrentUserFromReq(req);
  if (totalUsers > 0 && !policy.allowSelfRegistration && currentUser?.role !== 'admin') {
    res.status(403).json({
      error: 'New account registration is restricted by the studio administrator.',
    });
    return;
  }

  const emailCheck = validateEmailAddress(email || '');
  if (!emailCheck.valid) {
    res.status(400).json({ error: emailCheck.error });
    return;
  }

  const cleanName = (displayName || '').trim();
  if (cleanName.length < 2) {
    res.status(400).json({ error: 'Display name must be at least 2 characters.' });
    return;
  }

  const passCheck = validatePasswordStrength(password || '');
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }

  let cleanUsername = normalizeUsernameInput(username || '', emailCheck.email);
  if (cleanUsername.length < 3) cleanUsername = `user_${Date.now().toString(36)}`;

  if (getUserWithAuthByIdentifier(emailCheck.email)) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  if (getUserWithAuthByIdentifier(cleanUsername)) {
    cleanUsername = `${cleanUsername.slice(0, 22)}_${Math.floor(100 + Math.random() * 900)}`;
  }

  const role: UserRole = totalUsers === 0 ? 'admin' : 'operator';
  const passwordHash = hashUserPassword(password!);
  const created = createUserRecord({
    email: emailCheck.email,
    username: cleanUsername,
    displayName: cleanName,
    jobTitle,
    bio,
    avatarColor,
    role,
    passwordHash,
  });

  if (totalUsers === 0) {
    saveAuthPolicy({ requireAuth: true });
  }

  setUserSessionCookie(req, res, created.user.id, created.sessionVersion);
  res.status(201).json({
    authenticated: true,
    user: created.user,
    status: {
      ...buildAuthStatusPayload(req),
      authenticated: true,
      hasUsers: true,
      authEnabled: true,
      user: created.user,
    },
  });
});

app.post('/api/auth/login', authLoginLimiter, (req, res) => {
  const { token, identifier, password } = (req.body ?? {}) as {
    token?: string;
    identifier?: string;
    password?: string;
  };

  // Option A: Static Operator Access Token
  if (token !== undefined) {
    const expected = getConfiguredOperatorAuthToken();
    if (!expected) {
      res.status(400).json({
        authenticated: false,
        error: 'Operator token authentication is not configured on this server.',
      });
      return;
    }
    if (!token || !safeEqualSecret(token.trim(), expected)) {
      res.status(401).json({
        authenticated: false,
        error: 'Invalid operator access token.',
      });
      return;
    }
    const signed = createSignedSessionToken(expected);
    const secureFlag = isSecureRequest(req) ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${getSessionCookieName()}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secureFlag}`,
    );
    res.json({ authenticated: true, authEnabled: true, user: null });
    return;
  }

  // Option B: Email / Username + Password
  const cleanIdentifier = String(identifier || '').trim();
  const cleanPassword = String(password || '');
  if (!cleanIdentifier || !cleanPassword) {
    res.status(400).json({
      authenticated: false,
      error: 'Email/username and password are required.',
    });
    return;
  }

  const found = getUserWithAuthByIdentifier(cleanIdentifier);
  if (!found || !verifyUserPassword(cleanPassword, found.passwordHash)) {
    res.status(401).json({
      authenticated: false,
      error: 'Invalid email/username or password.',
    });
    return;
  }

  const updatedUser = recordUserLogin(found.user.id) ?? found.user;
  setUserSessionCookie(req, res, updatedUser.id, found.sessionVersion);
  res.json({
    authenticated: true,
    authEnabled: true,
    user: updatedUser,
  });
});

app.post('/api/auth/logout', (req, res) => {
  const secureFlag = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${getSessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    `${getUserSessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  ]);
  res.json({ authenticated: false });
});

// User Profile, Security & Team Accounts API
app.get('/api/profile', (req, res) => {
  const user = getCurrentUserFromReq(req);
  const policy = getAuthPolicy();
  const totalUsers = countUsers();
  res.json({
    user,
    hasUsers: totalUsers > 0,
    requireAuth: policy.requireAuth,
    allowSelfRegistration: policy.allowSelfRegistration,
    operatorTokenEnabled: isOperatorAuthEnabled(),
    users: user?.role === 'admin' || totalUsers === 0 ? listUserProfiles() : user ? [user] : [],
  });
});

app.put('/api/profile', (req, res) => {
  const user = getCurrentUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in with a user account first.' });
    return;
  }
  const { displayName, email, jobTitle, bio, avatarColor } = (req.body ?? {}) as {
    displayName?: string;
    email?: string;
    jobTitle?: string;
    bio?: string;
    avatarColor?: string;
  };

  if (email !== undefined) {
    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error });
      return;
    }
    const existingByEmail = getUserWithAuthByIdentifier(emailCheck.email);
    if (existingByEmail && existingByEmail.user.id !== user.id) {
      res.status(409).json({ error: 'Another account already uses that email.' });
      return;
    }
  }

  const safeColor =
    avatarColor && /^#[0-9a-f]{6}$/i.test(avatarColor.trim()) ? avatarColor.trim() : undefined;

  const updated = updateUserProfileRecord(user.id, {
    ...(displayName !== undefined && displayName.trim().length >= 2 ? { displayName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(jobTitle !== undefined ? { jobTitle } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(safeColor ? { avatarColor: safeColor } : {}),
  });

  res.json({ user: updated });
});

app.put('/api/profile/password', (req, res) => {
  const user = getCurrentUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in with a user account first.' });
    return;
  }
  const { currentPassword, newPassword } = (req.body ?? {}) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const authRecord = getUserWithAuthById(user.id);
  if (!authRecord || !verifyUserPassword(currentPassword || '', authRecord.passwordHash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }
  const passCheck = validatePasswordStrength(newPassword || '');
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }
  const updated = updateUserPasswordRecord(user.id, hashUserPassword(newPassword!));
  if (!updated) {
    res.status(500).json({ error: 'Failed to update password.' });
    return;
  }
  setUserSessionCookie(req, res, updated.user.id, updated.sessionVersion);
  res.json({ updated: true, user: updated.user });
});

app.put('/api/profile/security', (req, res) => {
  const user = getCurrentUserFromReq(req);
  const totalUsers = countUsers();
  if (totalUsers > 0 && user?.role !== 'admin') {
    res.status(403).json({ error: 'Only an administrator can modify studio security policy.' });
    return;
  }
  const { requireAuth, allowSelfRegistration } = (req.body ?? {}) as {
    requireAuth?: boolean;
    allowSelfRegistration?: boolean;
  };
  const next = saveAuthPolicy({
    ...(typeof requireAuth === 'boolean' ? { requireAuth } : {}),
    ...(typeof allowSelfRegistration === 'boolean' ? { allowSelfRegistration } : {}),
  });
  res.json(next);
});

app.post('/api/profile/revoke-sessions', (req, res) => {
  const user = getCurrentUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in with a user account first.' });
    return;
  }
  const nextVersion = bumpUserSessionVersion(user.id);
  setUserSessionCookie(req, res, user.id, nextVersion);
  res.json({ revoked: true, sessionVersion: nextVersion });
});

app.post('/api/profile/users', (req, res) => {
  const currentUser = getCurrentUserFromReq(req);
  if (currentUser?.role !== 'admin') {
    res.status(403).json({ error: 'Only administrators can add team accounts.' });
    return;
  }
  const { email, username, displayName, password, role, jobTitle } = (req.body ?? {}) as {
    email?: string;
    username?: string;
    displayName?: string;
    password?: string;
    role?: UserRole;
    jobTitle?: string;
  };
  const emailCheck = validateEmailAddress(email || '');
  if (!emailCheck.valid) {
    res.status(400).json({ error: emailCheck.error });
    return;
  }
  if (!displayName || displayName.trim().length < 2) {
    res.status(400).json({ error: 'Display name must be at least 2 characters.' });
    return;
  }
  const passCheck = validatePasswordStrength(password || '');
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }
  if (getUserWithAuthByIdentifier(emailCheck.email)) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  let cleanUsername = normalizeUsernameInput(username || '', emailCheck.email);
  if (getUserWithAuthByIdentifier(cleanUsername)) {
    cleanUsername = `${cleanUsername.slice(0, 22)}_${Math.floor(100 + Math.random() * 900)}`;
  }
  const safeRole: UserRole = role === 'admin' || role === 'viewer' ? role : 'operator';
  const created = createUserRecord({
    email: emailCheck.email,
    username: cleanUsername,
    displayName: displayName.trim(),
    jobTitle,
    role: safeRole,
    passwordHash: hashUserPassword(password!),
  });
  res.status(201).json({ user: created.user, users: listUserProfiles() });
});

app.delete('/api/profile/users/:id', (req, res) => {
  const currentUser = getCurrentUserFromReq(req);
  if (currentUser?.role !== 'admin') {
    res.status(403).json({ error: 'Only administrators can remove team accounts.' });
    return;
  }
  if (req.params.id === currentUser.id) {
    res.status(400).json({ error: 'You cannot delete your own active admin account.' });
    return;
  }
  const deleted = deleteUserRecord(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  res.json({ deleted: true, users: listUserProfiles() });
});

// Nginx Reverse Proxy & Custom Domain Binding API
async function checkCommandExists(bin: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${bin}`);
    return true;
  } catch {
    return false;
  }
}

app.get('/api/nginx/domains', async (_req, res) => {
  const [nginxInstalled, certbotInstalled] = await Promise.all([
    checkCommandExists('nginx'),
    checkCommandExists('certbot'),
  ]);
  const domains = listNginxDomains().map((d) => ({
    ...d,
    nginxConf: generateNginxServerBlock(d),
    setupScript: generateNginxApplyScript(d),
  }));
  res.json({
    domains,
    environment: {
      nginxInstalled,
      certbotInstalled,
      isRoot: typeof process.getuid === 'function' ? process.getuid() === 0 : false,
      appPort: PORT,
    },
  });
});

app.post('/api/nginx/domains', (req, res) => {
  const {
    id,
    domain,
    upstreamPort,
    sslMode,
    sslEmail,
    sslCertPath,
    sslKeyPath,
    redirectWww,
    clientMaxBodyMb,
    enableWebsocket,
    enableHsts,
  } = (req.body ?? {}) as {
    id?: string;
    domain?: string;
    upstreamPort?: number;
    sslMode?: NginxSslMode;
    sslEmail?: string;
    sslCertPath?: string;
    sslKeyPath?: string;
    redirectWww?: boolean;
    clientMaxBodyMb?: number;
    enableWebsocket?: boolean;
    enableHsts?: boolean;
  };

  const domainCheck = validateDomainHostname(domain || '');
  if (!domainCheck.valid) {
    res.status(400).json({ error: domainCheck.error });
    return;
  }

  const validSslMode: NginxSslMode =
    sslMode === 'http_only' || sslMode === 'custom_cert' ? sslMode : 'letsencrypt';

  const saved = upsertNginxDomain({
    id,
    domain: domainCheck.domain,
    upstreamPort: clampUpstreamPort(upstreamPort ?? PORT),
    sslMode: validSslMode,
    sslEmail: sslEmail?.trim(),
    sslCertPath: sslCertPath?.trim(),
    sslKeyPath: sslKeyPath?.trim(),
    redirectWww: Boolean(redirectWww),
    clientMaxBodyMb: clampMaxBodyMb(clientMaxBodyMb ?? 30),
    enableWebsocket: enableWebsocket !== false,
    enableHsts: enableHsts !== false,
  });

  res.status(201).json({
    domain: {
      ...saved,
      nginxConf: generateNginxServerBlock(saved),
      setupScript: generateNginxApplyScript(saved),
    },
  });
});

app.post('/api/nginx/domains/:id/verify-dns', async (req, res) => {
  const record = getNginxDomainById(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Domain configuration not found.' });
    return;
  }

  const resolvedIps: string[] = [];
  let dnsError: string | null = null;
  try {
    const v4 = await dns.resolve4(record.domain).catch(() => []);
    const v6 = await dns.resolve6(record.domain).catch(() => []);
    resolvedIps.push(...v4, ...v6);
    if (resolvedIps.length === 0) {
      dnsError = `No A or AAAA DNS records found yet for ${record.domain}.`;
    }
  } catch (err) {
    dnsError = err instanceof Error ? err.message : 'DNS resolution failed';
  }

  const nextStatus = resolvedIps.length > 0 ? 'dns_verified' : 'draft';
  const updated =
    updateNginxDomainCheck(record.id, {
      status: record.status === 'active' && resolvedIps.length > 0 ? 'active' : nextStatus,
      dnsResolvedIps: resolvedIps,
      lastCheckedAt: new Date().toISOString(),
    }) ?? record;

  res.json({
    verified: resolvedIps.length > 0,
    resolvedIps,
    error: dnsError,
    domain: {
      ...updated,
      nginxConf: generateNginxServerBlock(updated),
      setupScript: generateNginxApplyScript(updated),
    },
  });
});

app.post('/api/nginx/domains/:id/apply', async (req, res) => {
  const record = getNginxDomainById(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Domain configuration not found.' });
    return;
  }

  const nginxConf = generateNginxServerBlock(record);
  const setupScript = generateNginxApplyScript(record);
  const hasNginx = await checkCommandExists('nginx');
  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;

  if (!hasNginx || !isRoot) {
    res.json({
      applied: false,
      needsServerPrivilege: true,
      message: !hasNginx
        ? 'Nginx is not installed in this runtime container. Run the generated setup script on your Linux VPS as root/sudo.'
        : 'Server process does not have root privileges to write /etc/nginx. Run the generated setup script with sudo on your VPS.',
      nginxConf,
      setupScript,
    });
    return;
  }

  const slug = record.domain.replace(/[^a-z0-9.-]/g, '_');
  const siteName = `aetherflow-${slug}`;
  const confPath = fs.existsSync('/etc/nginx/sites-available')
    ? `/etc/nginx/sites-available/${siteName}`
    : `/etc/nginx/conf.d/${siteName}.conf`;

  try {
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(confPath, nginxConf, 'utf-8');
    if (fs.existsSync('/etc/nginx/sites-enabled')) {
      const enabledLink = `/etc/nginx/sites-enabled/${siteName}`;
      try {
        fs.unlinkSync(enabledLink);
      } catch {
        // ignore missing link
      }
      fs.symlinkSync(confPath, enabledLink);
    }

    await execAsync('nginx -t');
    await execAsync('systemctl reload nginx || nginx -s reload');

    let sslApplied = false;
    let sslNote = '';
    if (record.sslMode === 'letsencrypt' && (await checkCommandExists('certbot'))) {
      const emailFlag = record.sslEmail
        ? `--email ${record.sslEmail}`
        : '--register-unsafely-without-email';
      const domainFlags =
        record.redirectWww && !record.domain.startsWith('www.')
          ? `-d ${record.domain} -d www.${record.domain}`
          : `-d ${record.domain}`;
      try {
        await execAsync(
          `certbot --nginx ${domainFlags} --non-interactive --agree-tos --redirect ${emailFlag}`,
          { timeout: 60000 },
        );
        sslApplied = true;
      } catch (certErr) {
        sslNote = certErr instanceof Error ? certErr.message : 'Certbot issuance failed';
      }
    }

    const updated =
      updateNginxDomainCheck(record.id, {
        status: 'active',
        lastCheckedAt: new Date().toISOString(),
      }) ?? record;

    res.json({
      applied: true,
      sslApplied,
      message: sslApplied
        ? `Nginx reverse proxy + HTTPS SSL active for ${record.domain}.`
        : `Nginx virtual host applied for ${record.domain}${sslNote ? ` (SSL note: ${sslNote})` : ''}.`,
      nginxConf,
      setupScript,
      domain: {
        ...updated,
        nginxConf,
        setupScript,
      },
    });
  } catch (err) {
    res.status(500).json({
      applied: false,
      error: err instanceof Error ? err.message : 'Failed to apply Nginx configuration.',
      nginxConf,
      setupScript,
    });
  }
});

app.get('/api/nginx/domains/:id/download-conf', (req, res) => {
  const record = getNginxDomainById(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Domain configuration not found.' });
    return;
  }
  const conf = generateNginxServerBlock(record);
  const safeName = `${record.domain.replace(/[^a-z0-9.-]/g, '_')}.nginx.conf`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', buildContentDispositionHeader(safeName));
  res.send(conf);
});

app.delete('/api/nginx/domains/:id', (req, res) => {
  const ok = deleteNginxDomain(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Domain configuration not found.' });
    return;
  }
  res.json({ deleted: true });
});

app.get('/api/capabilities', (_req, res) => {
  res.json(buildCapabilitiesPayload());
});

app.put('/api/provider-keys', (req, res) => {
  const { secretName, apiKey } = req.body as {
    secretName?: string;
    apiKey?: string;
  };
  const normalized = normalizeSecretName(secretName || '');
  if (!normalized) {
    res.status(400).json({
      error: 'Secret name must be uppercase letters, numbers, and underscores (e.g. OPENAI_API_KEY).',
    });
    return;
  }
  const check = validateApiKeyValue(apiKey || '');
  if (!check.valid) {
    res.status(400).json({ error: check.error || 'Invalid API key.' });
    return;
  }
  const status = setProviderSecret(normalized, check.cleaned);
  res.json({
    saved: true,
    secret: status,
    capabilities: buildCapabilitiesPayload(),
  });
});

app.delete('/api/provider-keys/:secretName', (req, res) => {
  const normalized = normalizeSecretName(req.params.secretName || '');
  if (!normalized) {
    res.status(400).json({ error: 'Invalid secret name.' });
    return;
  }
  const deleted = deleteProviderSecret(normalized);
  res.json({
    deleted,
    capabilities: buildCapabilitiesPayload(),
  });
});

app.post('/api/provider-keys/test', providerTestLimiter, async (req, res) => {
  const { provider, secretName, baseUrl, apiKey, model, language } = req.body as {
    provider?: WorkflowNode['data']['provider'];
    secretName?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    language?: 'en' | 'fa';
  };
  const settings = getAppSettings();
  const lang: 'en' | 'fa' = language === 'fa' || language === 'en' ? language : settings.language;
  const isFa = lang === 'fa';
  const targetProvider = provider || 'gemini';
  const ref =
    normalizeSecretName(secretName || '') ||
    settings.providers[targetProvider]?.envVarName ||
    'GEMINI_API_KEY';

  let inlineKey: string | undefined;
  if (typeof apiKey === 'string' && apiKey.trim()) {
    const check = validateApiKeyValue(apiKey);
    if (!check.valid) {
      res.status(400).json({
        ok: false,
        status: 400,
        message: check.error || 'Invalid API key.',
      });
      return;
    }
    inlineKey = check.cleaned;
  }

  const resolved = resolveServerSecret(ref);
  const fallbackGemini =
    targetProvider === 'gemini' && ref !== 'GEMINI_API_KEY' && !resolved.value
      ? resolveServerSecret('GEMINI_API_KEY').value
      : null;
  const keyToTest = inlineKey ?? resolved.value ?? fallbackGemini;
  const effectiveBase = (baseUrl ?? settings.providers[targetProvider]?.baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');

  if (targetProvider !== 'ollama' && targetProvider !== 'opencode' && !keyToTest) {
    res.status(400).json({
      ok: false,
      status: 400,
      message: isFa
        ? `کلیدی برای ${ref} ذخیره یا وارد نشده است. ابتدا کلید API را وارد کنید.`
        : `No key found for ${ref}. Enter or save an API key first.`,
    });
    return;
  }

  try {
    if (targetProvider === 'gemini') {
      const parsedBase = parseGeminiBaseUrl(effectiveBase);
      if (parsedBase.error) {
        res.status(400).json({
          ok: false,
          status: 400,
          message: parsedBase.error,
        });
        return;
      }

      const candidateModels = Array.from(
        new Set(
          [
            model?.trim(),
            settings.providers.gemini?.defaultModel,
            'gemini-3.1-flash-lite',
            'gemini-4-hydrogen',
            'gemini-4-argon',
          ].filter((m): m is string => Boolean(m && m.startsWith('gemini-'))),
        ),
      );

      const attemptConfigs: Array<{ apiVersion?: GeminiApiVersion; vertexai?: boolean }> = [
        { apiVersion: parsedBase.apiVersion },
      ];
      if (!parsedBase.apiVersion) {
        attemptConfigs.push({ apiVersion: 'v1beta' });
      }
      if (keyToTest && keyToTest.startsWith('AQ.') && !parsedBase.baseUrl) {
        attemptConfigs.push({ vertexai: true });
      }

      let lastErr: unknown = null;
      let sawOnlyNotFound = true;

      for (const cfg of attemptConfigs) {
        const client = getAiClient(ref, {
          baseUrl: effectiveBase,
          apiKey: keyToTest || undefined,
          apiVersion: cfg.apiVersion,
          vertexai: cfg.vertexai,
        });
        if (!client) continue;

        for (const candidateModel of candidateModels) {
          try {
            const resp = await client.models.generateContent({
              model: candidateModel,
              contents: 'Reply with OK',
              config: { httpOptions: { timeout: 12000 } },
            });
            const replyPreview = (resp.text || 'OK').trim().slice(0, 32);
            const unsavedNote = inlineKey
              ? isFa
                ? ' (برای ذخیره دائمی دکمه Save Key را بزنید)'
                : ' (click Save Key to store it)'
              : '';
            res.json({
              ok: true,
              status: 200,
              model: candidateModel,
              message: isFa
                ? `اتصال Gemini با موفقیت برقرار شد (${candidateModel}: ${replyPreview})${unsavedNote}`
                : `Gemini connected (${candidateModel}: ${replyPreview})${unsavedNote}`,
            });
            return;
          } catch (err) {
            lastErr = err;
            const formatted = formatGeminiApiError(err, lang);
            if (formatted.status !== 404) {
              sawOnlyNotFound = false;
            }
            // Invalid key or geo/permission 403 won't be fixed by trying other models on same transport
            if (
              formatted.code === 'API_KEY_INVALID' ||
              formatted.code === 'GEO_OR_ENDPOINT_FORBIDDEN' ||
              formatted.code === 'LOCATION_NOT_SUPPORTED'
            ) {
              break;
            }
          }
        }
        if (!sawOnlyNotFound && !(keyToTest && keyToTest.startsWith('AQ.'))) {
          break;
        }
      }

      const formatted = formatGeminiApiError(lastErr, lang);
      res.json({
        ok: false,
        status: formatted.status,
        code: formatted.code,
        message: formatted.message,
      });
      return;
    }

    if (targetProvider === 'openai' || targetProvider === 'opencode') {
      const headers: Record<string, string> = {};
      if (keyToTest) headers.Authorization = `Bearer ${keyToTest}`;
      const r = await fetch(`${effectiveBase}/models`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        const cleanBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        res.json({
          ok: false,
          status: r.status,
          message: `HTTP ${r.status}: ${cleanBody.slice(0, 140) || 'Authentication failed'}`,
        });
        return;
      }
      res.json({
        ok: true,
        status: r.status,
        message: `${targetProvider} endpoint reachable (HTTP ${r.status})`,
      });
      return;
    }

    if (targetProvider === 'anthropic') {
      const r = await fetch(`${effectiveBase}/v1/models`, {
        headers: {
          'x-api-key': keyToTest || '',
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        const cleanBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        res.json({
          ok: false,
          status: r.status,
          message: `HTTP ${r.status}: ${cleanBody.slice(0, 140) || 'Authentication failed'}`,
        });
        return;
      }
      res.json({
        ok: true,
        status: r.status,
        message: `Anthropic endpoint reachable (HTTP ${r.status})`,
      });
      return;
    }

    // ollama
    const headers: Record<string, string> = {};
    if (keyToTest) headers.Authorization = `Bearer ${keyToTest}`;
    const r = await fetch(`${effectiveBase}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    res.json({
      ok: r.ok,
      status: r.status,
      message: r.ok ? `Ollama reachable at ${effectiveBase}` : `Ollama returned HTTP ${r.status}`,
    });
  } catch (err) {
    const formatted = formatGeminiApiError(err, lang);
    res.json({
      ok: false,
      status: formatted.status,
      message: formatted.message,
    });
  }
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

app.get('/api/projects/:id/diff', (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const proj = getImportedProjectById(req.params.id);
  const currDir = safeId ? path.join(PROJECTS_BASE, safeId) : '';
  if (!proj && (!currDir || !fs.existsSync(currDir))) {
    res.status(404).json({ error: 'Imported project not found' });
    return;
  }
  const originals = listImportedProjectFilesFromDisk(req.params.id, true);
  const current = listImportedProjectFilesFromDisk(req.params.id, false);
  const diffs = buildProjectDiffEntries({ originals, current });
  res.json({ projectId: req.params.id, diffs });
});

app.put('/api/projects/:id', (req, res) => {
  const patch = req.body as Partial<ImportedProjectAnalysis>;
  if (!patch || typeof patch !== 'object') {
    res.status(400).json({ error: 'Invalid project update payload' });
    return;
  }
  const updated = updateImportedProject(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: 'Imported project not found' });
    return;
  }
  res.json({ project: updated });
});

app.delete('/api/projects/:id', (req, res) => {
  const ok = deleteImportedProject(req.params.id);
  try {
    const safeId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safeId) {
      const projDir = path.join(PROJECTS_BASE, safeId);
      if (fs.existsSync(projDir)) {
        fs.rmSync(projDir, { recursive: true, force: true });
      }
      const origDir = path.join(PROJECTS_ORIGINALS_BASE, safeId);
      if (fs.existsSync(origDir)) {
        fs.rmSync(origDir, { recursive: true, force: true });
      }
    }
  } catch {
    // ignore cleanup error
  }
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

app.get('/api/runs/:id/diff', (req, res) => {
  const runId = req.params.id;
  const summary = getRunSummaryById(runId);
  const wf = summary ? getWorkflowById(summary.workflowId) : null;
  const originals = wf?.projectContext?.projectId
    ? listImportedProjectFilesFromDisk(wf.projectContext.projectId, true)
    : [];
  const current = listSandboxFilesReadOnly(runId);
  const diffs = buildProjectDiffEntries({ originals, current });
  res.json({ runId, diffs });
});

app.post('/api/runs', runStartLimiter, (req, res) => {
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
      : canWorkflowRunLive(workflow.nodes, getAppSettings())
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
      : canWorkflowRunLive(workflow.nodes, getAppSettings())
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

app.post('/api/runs/:id/stop', (req, res) => {
  const runId = req.params.id;
  const controller = runAbortControllers.get(runId);
  const summary = getRunSummaryById(runId);

  if (!controller && !summary) {
    res.status(404).json({ error: 'Execution run not found.' });
    return;
  }

  // Abort active loop/LLM calls and reject any pending HITL approval gates
  controller?.abort();
  const pendingIds = pendingApprovalsByRun.get(runId);
  if (pendingIds) {
    for (const approvalId of Array.from(pendingIds)) {
      const resolver = pendingApprovals.get(approvalId);
      if (resolver) {
        resolver(false);
        pendingApprovals.delete(approvalId);
      }
    }
    pendingApprovalsByRun.delete(runId);
  }

  const buffered = runEventBuffers.get(runId) ?? getRunEvents(runId);
  const roundsExecuted = buffered.reduce((max, e) => (e.round > max ? e.round : max), summary?.roundsExecuted ?? 0);

  if (!buffered.some((e) => e.type === 'run_cancelled')) {
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_cancelled',
      round: roundsExecuted,
      content: `Execution stopped by operator after ${roundsExecuted} round(s).`,
      timestamp: new Date().toISOString(),
    });
  }

  updateRunRecord({
    id: runId,
    status: 'cancelled',
    roundsExecuted,
    events: runEventBuffers.get(runId) ?? buffered,
    completed: true,
  });

  res.json({ ok: true, runId, status: 'cancelled' });
});

app.delete('/api/runs/:id', (req, res) => {
  const runId = req.params.id;
  runAbortControllers.get(runId)?.abort();
  runAbortControllers.delete(runId);
  runEventBuffers.delete(runId);
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeId) {
    const runDir = path.join(SANDBOX_BASE, safeId);
    if (fs.existsSync(runDir)) {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  }
  const deleted = deleteRunRecord(runId);
  res.json({ deleted });
});

app.get('/api/workflows/:id/memory', (req, res) => {
  const wf = getWorkflowById(req.params.id);
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  const priorRuns = listRecentWorkflowRunsWithSummary(wf.id, 5);
  const openBugs = listBugReports({ workflowId: wf.id }).filter((b) => b.status !== 'resolved');
  const workspaceFiles = wf.projectContext?.projectId
    ? listImportedProjectFilesFromDisk(wf.projectContext.projectId).map((f) => ({
        path: f.path,
        size: f.content.length,
      }))
    : [];
  const summary = buildWorkflowMemorySnapshot({ priorRuns, openBugs, workspaceFiles });
  res.json({
    workflowId: wf.id,
    memoryEnabled: wf.memoryEnabled !== false,
    priorRunCount: priorRuns.length,
    openBugCount: openBugs.length,
    fileCount: workspaceFiles.length,
    summary,
  });
});

app.delete('/api/workflows/:id/memory', (req, res) => {
  const deletedRuns = clearWorkflowRunsMemory(req.params.id);
  res.json({ cleared: true, deletedRuns });
});

app.post('/api/webhooks/:workflowId', webhookLimiter, (req, res) => {
  const wf = getWorkflowById(req.params.workflowId);
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }
  if (wf.webhookEnabled === false) {
    res.status(403).json({ error: 'Webhook trigger is disabled for this workflow.' });
    return;
  }

  if (wf.webhookSecret && wf.webhookSecret.trim()) {
    const expected = wf.webhookSecret.trim();
    const headerSecret =
      (typeof req.headers['x-webhook-secret'] === 'string' ? req.headers['x-webhook-secret'] : '') ||
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '') ||
      (typeof req.query.secret === 'string' ? req.query.secret : '');
    if (!safeEqualSecret(headerSecret.trim(), expected)) {
      res.status(401).json({ error: 'Invalid or missing webhook secret.' });
      return;
    }
  }

  const body = (req.body ?? {}) as {
    taskPrompt?: string;
    prompt?: string;
    message?: string;
    mode?: 'live' | 'dry_run';
    payload?: unknown;
  };
  const rawPrompt =
    (typeof body.taskPrompt === 'string' && body.taskPrompt.trim()) ||
    (typeof body.prompt === 'string' && body.prompt.trim()) ||
    (typeof body.message === 'string' && body.message.trim()) ||
    (body.payload !== undefined
      ? `Webhook event payload:\n${JSON.stringify(body.payload, null, 2).slice(0, 1200)}`
      : Object.keys(body).length > 0
        ? `Webhook event payload:\n${JSON.stringify(body, null, 2).slice(0, 1200)}`
        : wf.description || `Triggered via external webhook for ${wf.name}`);

  const validation = validateWorkflowForRun(wf, rawPrompt);
  if (!validation.valid) {
    res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    return;
  }

  const resolvedMode: 'live' | 'dry_run' =
    body.mode === 'live' || body.mode === 'dry_run'
      ? body.mode
      : canWorkflowRunLive(wf.nodes, getAppSettings())
        ? 'live'
        : 'dry_run';

  const runId = crypto.randomUUID();
  runEventBuffers.set(runId, []);
  createRunRecord({
    id: runId,
    workflowId: wf.id,
    workflowName: `${wf.name} · Webhook`,
    taskPrompt: rawPrompt,
    mode: resolvedMode,
    maxRounds: clampMaxRounds(wf.maxRounds),
  });

  void executeWorkflowRun({
    runId,
    workflow: wf,
    taskPrompt: rawPrompt,
    mode: resolvedMode,
  });

  res.status(202).json({
    accepted: true,
    runId,
    workflowId: wf.id,
    mode: resolvedMode,
    status: 'running',
  });
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
    `Rewrite into a crisp engineering prompt (<=90 words) for ${targetDesc} with Objective, Requirements, Acceptance Criteria. ` +
    (isPersian
      ? `Write in concise Persian/Farsi (keep tool tags like WRITE_FILE:<path> or EXEC_BASH:<cmd> in English). `
      : `Write in concise English. `) +
    `Output ONLY the prompt.`;

  for (const modelName of ['gemini-3.1-flash-lite', 'gemini-4-argon']) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: clean,
        config: {
          systemInstruction: sysPrompt,
          ...(/^gemini-4-/i.test(modelName)
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
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

  const settingsForDirect = getAppSettings();
  if (mode === 'live' && !canNodeRunLive(targetNode, settingsForDirect)) {
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: roundNum,
      content:
        `No API key configured for ${targetNode.data.label} (${targetNode.data.provider}). Add the API key in Settings or switch to Sandbox Dry-Run.`,
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

    const turnStartedAt = Date.now();
    let rawReply: string;
    let structuredTools: StructuredToolInvocation[] = [];
    let turnTokenUsage: TokenUsage;
    if (mode === 'live' && canNodeRunLive(targetNode, settingsForDirect)) {
      const liveRes = await generateLiveAgentReply({
        ai,
        node: targetNode,
        history,
        onChunk: (accumulatedText) => {
          broadcastEvent(runId, {
            id: `chunk-${runId}-${targetNode.id}-${roundNum}`,
            runId,
            type: 'agent_chunk',
            round: roundNum,
            agentId: targetNode.id,
            agentName: targetNode.data.label,
            role: targetNode.data.role,
            provider: targetNode.data.provider,
            model: targetNode.data.model,
            content: accumulatedText,
            timestamp: new Date().toISOString(),
          });
        },
      });
      rawReply = liveRes.text;
      structuredTools = liveRes.structuredTools;
      turnTokenUsage = liveRes.tokenUsage;
    } else {
      rawReply = buildDryRunDirectReply(targetNode, userMessage);
      turnTokenUsage = estimateTokenUsage(userMessage, rawReply);
    }

    const reply = processAndBroadcastBugReports({
      reply: rawReply,
      runId,
      workflowId: workflow.id,
      node: targetNode,
      roundNum,
    });
    applyStructuredMetaTools({
      structuredTools,
      runId,
      workflowId: workflow.id,
      node: targetNode,
      nodes: workflow.nodes,
      roundNum,
      phase: 'review',
    });

    const settings = getAppSettings();
    const toolCalls = await processAgentTools({
      runId,
      workflow,
      node: targetNode,
      reply,
      structuredTools,
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
      durationMs: Date.now() - turnStartedAt,
      tokenUsage: turnTokenUsage,
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
    const formatted = formatGeminiApiError(err, getAppSettings().language);
    const message = formatted.message || (err instanceof Error ? err.message : 'Direct agent chat failed');
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
  const groupSettings = getAppSettings();
  if (mode === 'live' && !canWorkflowRunLive(activeSpeakers, groupSettings)) {
    broadcastEvent(runId, {
      id: crypto.randomUUID(),
      runId,
      type: 'run_error',
      round: baseRound,
      content:
        'No live LLM API key is configured. Add an API key in Settings or switch to Sandbox Dry-Run.',
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
      const turnStartedAt = Date.now();

      let rawReply: string;
      let structuredTools: StructuredToolInvocation[] = [];
      let turnTokenUsage: TokenUsage;
      if (mode === 'live' && canNodeRunLive(speaker, groupSettings)) {
        const liveRes = await generateLiveAgentReply({
          ai,
          node: speaker,
          history,
          isGroupDiscussion: true,
          teammates: activeSpeakers
            .filter((n) => n.id !== speaker.id)
            .map((n) => `${n.data.label} (${n.data.role})`),
          onChunk: (accumulatedText) => {
            broadcastEvent(runId, {
              id: `chunk-${runId}-${speaker.id}-${currentRound}`,
              runId,
              type: 'agent_chunk',
              round: currentRound,
              agentId: speaker.id,
              agentName: speaker.data.label,
              role: speaker.data.role,
              provider: speaker.data.provider,
              model: speaker.data.model,
              content: accumulatedText,
              timestamp: new Date().toISOString(),
            });
          },
        });
        rawReply = liveRes.text;
        structuredTools = liveRes.structuredTools;
        turnTokenUsage = liveRes.tokenUsage;
      } else {
        rawReply = buildDryRunGroupDiscussionReply({
          node: speaker,
          userMessage,
          priorSpeakers,
        });
        turnTokenUsage = estimateTokenUsage(userMessage, rawReply);
      }

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

      applyStructuredMetaTools({
        structuredTools,
        runId,
        workflowId: workflow.id,
        node: speaker,
        nodes: workflow.nodes,
        roundNum: currentRound,
        phase: 'review',
      });

      const settings = getAppSettings();
      const toolCalls = await processAgentTools({
        runId,
        workflow,
        node: speaker,
        reply,
        structuredTools,
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
        durationMs: Date.now() - turnStartedAt,
        tokenUsage: turnTokenUsage,
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
        const mgrStartedAt = Date.now();
        let rawAudit: string;
        let auditStructured: StructuredToolInvocation[] = [];
        let auditTokenUsage: TokenUsage;
        if (mode === 'live' && canNodeRunLive(managerNode, getAppSettings())) {
          const liveAudit = await generateLiveAgentReply({
            ai,
            node: managerNode,
            history,
            isGroupDiscussion: true,
            inspectionSnapshot: ctx.summaryText,
            delegationPhase: 'review',
            teammates: activeSpeakers
              .filter((n) => n.id !== managerNode.id)
              .map((n) => `${n.data.label} (${n.data.role})`),
            onChunk: (accumulatedText) => {
              broadcastEvent(runId, {
                id: `chunk-${runId}-${managerNode.id}-${currentRound}`,
                runId,
                type: 'agent_chunk',
                round: currentRound,
                agentId: managerNode.id,
                agentName: managerNode.data.label,
                role: managerNode.data.role,
                provider: managerNode.data.provider,
                model: managerNode.data.model,
                content: accumulatedText,
                timestamp: new Date().toISOString(),
              });
            },
          });
          rawAudit = liveAudit.text;
          auditStructured = liveAudit.structuredTools;
          auditTokenUsage = liveAudit.tokenUsage;
        } else {
          rawAudit = buildDryRunManagerAuditReply({
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
          auditTokenUsage = estimateTokenUsage(ctx.summaryText, rawAudit);
        }

        const auditCleaned = processAndBroadcastManagerDelegations({
          reply: rawAudit,
          runId,
          managerNode,
          nodes: workflow.nodes,
          roundNum: currentRound,
          phase: 'review',
        }).cleanedReply;
        applyStructuredMetaTools({
          structuredTools: auditStructured,
          runId,
          workflowId: workflow.id,
          node: managerNode,
          nodes: workflow.nodes,
          roundNum: currentRound,
          phase: 'review',
        });

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
          durationMs: Date.now() - mgrStartedAt,
          tokenUsage: auditTokenUsage,
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
    const formatted = formatGeminiApiError(err, getAppSettings().language);
    const message = formatted.message || (err instanceof Error ? err.message : 'Group discussion failed');
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

app.post('/api/chat/message', chatLimiter, (req, res) => {
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
      : canWorkflowRunLive(workflow.nodes, getAppSettings())
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

function listImportedProjectFilesFromDisk(
  projectId?: string,
  preferOriginals = false,
): Array<{ path: string; content: string }> {
  if (!projectId) return [];
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return [];
  const origDir = path.join(PROJECTS_ORIGINALS_BASE, safeId);
  const currDir = path.join(PROJECTS_BASE, safeId);
  const dir = preferOriginals && fs.existsSync(origDir) ? origDir : currDir;
  if (!fs.existsSync(dir)) return [];

  const result: Array<{ path: string; content: string }> = [];
  function walk(curr: string) {
    if (result.length >= 400) return;
    for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
      if (result.length >= 400) return;
      const full = path.join(curr, entry.name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (isSafeExportFilePath(rel)) {
          walk(full);
        }
      } else if (entry.isFile() && isSafeExportFilePath(rel)) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= 512 * 1024) {
            result.push({
              path: rel,
              content: fs.readFileSync(full, 'utf-8'),
            });
          }
        } catch {
          // ignore unreadable file
        }
      }
    }
  }
  walk(dir);
  return result;
}

function listStudioSourceFilesFromDisk(): Array<{ path: string; content: string }> {
  const rootDir = process.cwd();
  const topLevelFiles = [
    'package.json',
    '.npmrc',
    '.gitignore',
    '.dockerignore',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'metadata.json',
    '.env.example',
    'Dockerfile',
    'docker-compose.yml',
    'install-linux.sh',
    'README.md',
    'server.ts',
  ];
  const foldersToWalk = ['src', 'server', 'deploy'];
  const collected: Array<{ path: string; content: string }> = [];

  for (const rel of topLevelFiles) {
    const full = path.join(rootDir, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile() && isSafeExportFilePath(rel)) {
      try {
        collected.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
      } catch {
        // ignore
      }
    }
  }

  function walkFolder(relDir: string) {
    const absDir = path.join(rootDir, relDir);
    if (!fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, entry.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      if (!isSafeExportFilePath(rel)) continue;
      if (entry.isDirectory()) {
        walkFolder(rel);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= 512 * 1024) {
            collected.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  for (const folder of foldersToWalk) {
    walkFolder(folder);
  }
  return collected;
}

function listSandboxFilesReadOnly(runId: string): SandboxFile[] {
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return [];
  const runDir = path.join(SANDBOX_BASE, safeId);
  if (!fs.existsSync(runDir)) return [];
  return listSandboxFiles(safeId);
}

function resolveSandboxFilesForExport(workflow: WorkflowConfig, runId?: string): SandboxFile[] {
  if (runId && runId !== '__merged_completed__') {
    const direct = listSandboxFilesReadOnly(runId);
    if (direct.length > 0) return direct;
  }

  const allRuns = listRunSummaries(60).filter((r) => r.workflowId === workflow.id);
  const completedRuns = allRuns.filter((r) => r.status === 'completed');
  const candidateRuns = completedRuns.length > 0 ? completedRuns : allRuns;
  if (candidateRuns.length === 0) return [];

  // Sort oldest-to-newest so newer agent edits override older runs cleanly
  const chronological = [...candidateRuns].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const snapshots = chronological
    .map((r) => listSandboxFilesReadOnly(r.id))
    .filter((files) => files.length > 0);
  return mergeSandboxSnapshots(snapshots);
}

function collectExportBundleForServer(params: {
  scope?: ExportBundleScope;
  workflow?: WorkflowConfig;
  workflowId?: string;
  runId?: string;
}): {
  scope: ExportBundleScope;
  workflow: WorkflowConfig;
  filename: string;
  files: BundleFileEntry[];
  totalBytes: number;
  changeSummary: ExportChangeSummary;
} {
  const scope: ExportBundleScope =
    params.scope === 'sandbox_only' || params.scope === 'full_studio'
      ? params.scope
      : 'project_bundle';
  const workflow =
    params.workflow ??
    (params.workflowId ? getWorkflowById(params.workflowId) : null) ??
    listWorkflows()[0];

  if (!workflow) {
    throw new Error('Workflow configuration not found.');
  }

  const sandboxFiles = resolveSandboxFilesForExport(workflow, params.runId);
  const importedProjectFiles =
    scope === 'project_bundle' || scope === 'sandbox_only'
      ? listImportedProjectFilesFromDisk(workflow.projectContext?.projectId, true)
      : [];
  const studioSourceFiles = scope === 'full_studio' ? listStudioSourceFilesFromDisk() : [];
  const bugReports = listBugReports({ workflowId: workflow.id });

  const files = assembleExportBundleFiles({
    scope,
    workflow,
    sandboxFiles,
    importedProjectFiles,
    studioSourceFiles,
    bugReports,
  });

  const slug = slugifyBundleName(
    scope === 'full_studio'
      ? `aetherflow-studio-${workflow.name}`
      : workflow.projectContext?.name || workflow.name,
  );
  const changeSummary = computeExportChangeSummary(files);

  return {
    scope,
    workflow,
    filename: `${slug}.zip`,
    files,
    totalBytes: changeSummary.totalBytes,
    changeSummary,
  };
}

app.get('/api/export/projects', (_req, res) => {
  try {
    const workflowsList = listWorkflows();
    const runs = listRunSummaries(100);
    const projects = workflowsList.map((wf) => {
      const wfRuns = runs
        .filter((r) => r.workflowId === wf.id)
        .map((r) => ({
          ...r,
          sandboxFileCount: listSandboxFilesReadOnly(r.id).length,
        }));
      const completedRuns = wfRuns.filter((r) => r.status === 'completed');
      const mergedSandboxFiles = resolveSandboxFilesForExport(wf, '__merged_completed__');
      const importedCount = wf.projectContext?.projectId
        ? listImportedProjectFilesFromDisk(wf.projectContext.projectId).length
        : 0;
      return {
        workflowId: wf.id,
        workflowName: wf.name,
        hasImportedProject: importedCount > 0,
        importedFileCount: importedCount,
        completedRunCount: completedRuns.length,
        totalRunCount: wfRuns.length,
        mergedAgentFileCount: mergedSandboxFiles.length,
        runs: wfRuns,
      };
    });
    res.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list exportable projects.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/export/preview', (req, res) => {
  try {
    const body = req.body as {
      scope?: ExportBundleScope;
      workflow?: WorkflowConfig;
      workflowId?: string;
      runId?: string;
    };
    const bundle = collectExportBundleForServer(body);
    res.json({
      filename: bundle.filename,
      scope: bundle.scope,
      fileCount: bundle.files.length,
      totalBytes: bundle.totalBytes,
      changeSummary: bundle.changeSummary,
      files: bundle.files.map((f) => ({
        path: f.path,
        size: f.size,
        changeType: f.changeType ?? 'project',
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to preview export bundle.';
    res.status(400).json({ error: message });
  }
});

const pendingZipDownloads = new Map<
  string,
  { filename: string; buffer: Buffer; expiresAt: number }
>();

function pruneExpiredZipDownloads() {
  const now = Date.now();
  for (const [token, entry] of pendingZipDownloads.entries()) {
    if (entry.expiresAt <= now) {
      pendingZipDownloads.delete(token);
    }
  }
  while (pendingZipDownloads.size > 40) {
    const oldest = pendingZipDownloads.keys().next().value;
    if (!oldest) break;
    pendingZipDownloads.delete(oldest);
  }
}

function registerZipDownloadToken(filename: string, buffer: Buffer): string {
  pruneExpiredZipDownloads();
  const token = crypto.randomBytes(16).toString('hex');
  pendingZipDownloads.set(token, {
    filename,
    buffer,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return token;
}

app.post('/api/export/zip', (req, res) => {
  try {
    const body = req.body as {
      scope?: ExportBundleScope;
      workflow?: WorkflowConfig;
      workflowId?: string;
      runId?: string;
    };
    const bundle = collectExportBundleForServer(body);
    const zipBuffer = createZipBufferFromBundle(bundle.files);
    const token = registerZipDownloadToken(bundle.filename, zipBuffer);
    res.json({
      filename: bundle.filename,
      scope: bundle.scope,
      fileCount: bundle.files.length,
      totalBytes: zipBuffer.length,
      downloadUrl: `/api/export/zip/download/${token}`,
      zipBase64: zipBuffer.toString('base64'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build ZIP archive.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/export/zip/binary', (req, res) => {
  try {
    const body = req.body as {
      scope?: ExportBundleScope;
      workflow?: WorkflowConfig;
      workflowId?: string;
      runId?: string;
    };
    const bundle = collectExportBundleForServer(body);
    const zipBuffer = createZipBufferFromBundle(bundle.files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', buildContentDispositionHeader(bundle.filename));
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(zipBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build ZIP archive.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/export/zip/download/:token', (req, res) => {
  pruneExpiredZipDownloads();
  const entry = pendingZipDownloads.get(req.params.token);
  if (!entry) {
    res.status(404).json({ error: 'ZIP download link expired or not found.' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', buildContentDispositionHeader(entry.filename));
  res.setHeader('Content-Length', String(entry.buffer.length));
  res.setHeader('Cache-Control', 'no-store');
  res.send(entry.buffer);
});

app.post('/api/github/push', async (req, res) => {
  try {
    const body = req.body as {
      repoUrl?: string;
      branch?: string;
      commitMessage?: string;
      scope?: ExportBundleScope;
      workflow?: WorkflowConfig;
      workflowId?: string;
      runId?: string;
      token?: string;
      saveTokenToVault?: boolean;
      createIfMissing?: boolean;
      isPrivate?: boolean;
    };

    const validation = validateGitHubPushParams({
      repoInput: body.repoUrl,
      branch: body.branch,
      commitMessage: body.commitMessage,
    });

    if (!validation.valid) {
      res.status(400).json({ error: validation.error || 'Invalid GitHub repository target.' });
      return;
    }

    const inlineToken = body.token?.trim() || '';
    if (inlineToken && body.saveTokenToVault) {
      const check = validateApiKeyValue(inlineToken);
      if (check.valid) {
        setProviderSecret('GITHUB_TOKEN', inlineToken);
      }
    }

    const resolvedToken = inlineToken || resolveServerSecret('GITHUB_TOKEN').value;
    if (!resolvedToken) {
      res.status(400).json({
        error:
          'GitHub Personal Access Token (GITHUB_TOKEN) is required to push commits. Enter your token in the Push modal or save GITHUB_TOKEN in Settings.',
      });
      return;
    }

    const bundle = collectExportBundleForServer({
      scope: body.scope,
      workflow: body.workflow,
      workflowId: body.workflowId,
      runId: body.runId,
    });

    const { owner, repo, branch, commitMessage } = validation;
    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${resolvedToken}`,
      'User-Agent': 'AetherFlow-Agent-Studio',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };

    const ghFetch = async (url: string, init?: RequestInit) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        return await fetch(url, {
          ...init,
          headers: { ...ghHeaders, ...(init?.headers as Record<string, string> | undefined) },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    // 1. Check repository existence (and optionally create it if 404)
    let repoRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (repoRes.status === 404 && body.createIfMissing) {
      const createRes = await ghFetch('https://api.github.com/user/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: repo,
          private: Boolean(body.isPrivate),
          auto_init: true,
          description: bundle.workflow.description || 'Exported from AetherFlow Agent Studio',
        }),
      });
      if (!createRes.ok) {
        const errBody = (await createRes.json().catch(() => ({}))) as { message?: string };
        res.status(createRes.status).json({
          error: `Could not create repository ${owner}/${repo}: ${errBody.message || createRes.statusText}`,
        });
        return;
      }
      repoRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
    }

    if (!repoRes.ok) {
      const errBody = (await repoRes.json().catch(() => ({}))) as { message?: string };
      res.status(repoRes.status).json({
        error: `GitHub API error for ${owner}/${repo} (${repoRes.status}): ${errBody.message || repoRes.statusText}`,
      });
      return;
    }

    const repoMeta = (await repoRes.json()) as { default_branch?: string };
    const defaultBranch = repoMeta.default_branch || 'main';

    // 2. Resolve base commit SHA for target branch (or default branch if creating a new branch)
    let parentCommitSha: string | null = null;
    let targetBranchExists = false;

    const refRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    if (refRes.ok) {
      const refData = (await refRes.json()) as { object?: { sha?: string } };
      parentCommitSha = refData.object?.sha ?? null;
      targetBranchExists = true;
    } else if (branch !== defaultBranch) {
      const defaultRefRes = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
      );
      if (defaultRefRes.ok) {
        const defaultRefData = (await defaultRefRes.json()) as { object?: { sha?: string } };
        parentCommitSha = defaultRefData.object?.sha ?? null;
      }
    }

    // If repository is completely empty (0 commits), bootstrap initial file via Contents API
    if (!parentCommitSha) {
      const readmeFile =
        bundle.files.find((f) => f.path === 'README.md') ?? bundle.files[0];
      const initRes = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(readmeFile.path)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: 'chore: initialize repository from AetherFlow Agent Studio',
            content: Buffer.from(readmeFile.content, 'utf-8').toString('base64'),
            branch,
          }),
        },
      );
      if (!initRes.ok) {
        const errBody = (await initRes.json().catch(() => ({}))) as { message?: string };
        res.status(initRes.status).json({
          error: `Failed to initialize empty repository ${owner}/${repo}: ${errBody.message || initRes.statusText}`,
        });
        return;
      }
      const initData = (await initRes.json()) as { commit?: { sha?: string } };
      parentCommitSha = initData.commit?.sha ?? null;
      targetBranchExists = true;
    }

    // 3. Create Git Tree with all bundle files
    const treeEntries = bundle.files.map((file) => ({
      path: file.path,
      mode: file.path.endsWith('.sh') ? '100755' : '100644',
      type: 'blob',
      content: file.content,
    }));

    const treeRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        ...(parentCommitSha ? { base_tree: parentCommitSha } : {}),
        tree: treeEntries,
      }),
    });

    if (!treeRes.ok) {
      const errBody = (await treeRes.json().catch(() => ({}))) as { message?: string };
      res.status(treeRes.status).json({
        error: `Failed to create Git tree on ${owner}/${repo}: ${errBody.message || treeRes.statusText}`,
      });
      return;
    }

    const treeData = (await treeRes.json()) as { sha: string };

    // 4. Create Git Commit
    const commitRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: parentCommitSha ? [parentCommitSha] : [],
      }),
    });

    if (!commitRes.ok) {
      const errBody = (await commitRes.json().catch(() => ({}))) as { message?: string };
      res.status(commitRes.status).json({
        error: `Failed to create commit on ${owner}/${repo}: ${errBody.message || commitRes.statusText}`,
      });
      return;
    }

    const commitData = (await commitRes.json()) as { sha: string; html_url?: string };

    // 5. Update or create branch reference
    const updateRefUrl = targetBranchExists
      ? `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${owner}/${repo}/git/refs`;
    const updateRefBody = targetBranchExists
      ? { sha: commitData.sha, force: false }
      : { ref: `refs/heads/${branch}`, sha: commitData.sha };

    const updateRefRes = await ghFetch(updateRefUrl, {
      method: targetBranchExists ? 'PATCH' : 'POST',
      body: JSON.stringify(updateRefBody),
    });

    if (!updateRefRes.ok) {
      const errBody = (await updateRefRes.json().catch(() => ({}))) as { message?: string };
      res.status(updateRefRes.status).json({
        error: `Failed to update branch ${branch} on ${owner}/${repo}: ${errBody.message || updateRefRes.statusText}`,
      });
      return;
    }

    const capabilities = buildCapabilitiesPayload();
    res.json({
      ok: true,
      owner,
      repo,
      branch,
      commitSha: commitData.sha,
      commitUrl:
        commitData.html_url || `https://github.com/${owner}/${repo}/commit/${commitData.sha}`,
      repoUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}`,
      filesPushed: bundle.files.length,
      totalBytes: bundle.totalBytes,
      capabilities,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GitHub push failed.';
    res.status(500).json({ error: message });
  }
});

// =============================================================================
// Continuous Autonomous Project Work Engine (Prevents Idle/Hour-Long Stops)
// =============================================================================
const continuousTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearContinuousTimer(workflowId: string): void {
  const existing = continuousTimers.get(workflowId);
  if (existing) {
    clearTimeout(existing);
    continuousTimers.delete(workflowId);
  }
}

async function runSingleContinuousCycle(workflowId: string): Promise<void> {
  const current = getContinuousSession(workflowId);
  if (!current || !current.active) {
    clearContinuousTimer(workflowId);
    return;
  }

  const wf = getWorkflowById(workflowId);
  if (!wf || wf.nodes.length === 0) {
    upsertContinuousSession({
      ...current,
      active: false,
      status: 'paused',
      lastError: 'Workflow missing or has no agent nodes.',
      nextCycleAt: undefined,
    });
    return;
  }

  const resolvedMode: 'live' | 'dry_run' =
    current.mode === 'live' && canWorkflowRunLive(wf.nodes, getAppSettings())
      ? 'live'
      : 'dry_run';

  const openBugs = listBugReports({ workflowId }).filter((b) => b.status !== 'resolved');
  const prevFiles = current.lastRunId ? listSandboxFiles(current.lastRunId) : [];
  const nextCycleNumber = current.cyclesCompleted + 1;

  const cyclePrompt = [
    current.taskPrompt || wf.description || `Continue autonomous work on ${wf.name}.`,
    `[Autonomous Continuous Cycle #${nextCycleNumber}]`,
    prevFiles.length > 0
      ? `Previous workspace artifacts (${prevFiles.length}): ${prevFiles.map((f) => f.path).slice(0, 10).join(', ')}`
      : `No workspace artifacts written yet; initialize or inspect deliverables.`,
    openBugs.length > 0
      ? `Open bug reports (${openBugs.length}): ${openBugs.map((b) => `[${b.severity}] ${b.title}`).slice(0, 5).join('; ')}`
      : `No open bug reports recorded; focus on feature progress, tests, and hardening.`,
  ].join('\n');

  const runId = crypto.randomUUID();
  runEventBuffers.set(runId, []);
  createRunRecord({
    id: runId,
    workflowId: wf.id,
    workflowName: `${wf.name} · Cycle #${nextCycleNumber}`,
    taskPrompt: cyclePrompt,
    mode: resolvedMode,
    maxRounds: clampMaxRounds(wf.maxRounds),
  });

  upsertContinuousSession({
    ...current,
    status: 'running',
    lastRunId: runId,
    nextCycleAt: undefined,
  });

  try {
    await executeWorkflowRun({
      runId,
      workflow: wf,
      taskPrompt: cyclePrompt,
      mode: resolvedMode,
    });

    const latest = getContinuousSession(workflowId);
    if (!latest || !latest.active) return;

    const events = runEventBuffers.get(runId) ?? getRunEvents(runId);
    const hadError = events.some((e) => e.type === 'run_error');
    const intervalSec = clampContinuousIntervalSec(wf.continuousIntervalSec ?? latest.intervalSec);
    const backoffErrors = hadError ? latest.consecutiveErrors + 1 : 0;
    const waitSec = hadError
      ? Math.min(300, Math.max(intervalSec, 15 * Math.pow(2, Math.min(backoffErrors - 1, 4))))
      : intervalSec;
    const nextCycleAt = new Date(Date.now() + waitSec * 1000).toISOString();

    upsertContinuousSession({
      ...latest,
      status: hadError ? 'error_backoff' : 'cooldown',
      cyclesCompleted: nextCycleNumber,
      lastRunId: runId,
      lastRunStatus: hadError ? 'failed' : 'completed',
      lastCycleAt: new Date().toISOString(),
      nextCycleAt,
      intervalSec,
      consecutiveErrors: backoffErrors,
      lastError: hadError
        ? events.find((e) => e.type === 'run_error')?.content ?? 'Execution cycle reported an error'
        : undefined,
    });

    scheduleContinuousCycle(workflowId, waitSec * 1000);
  } catch (err) {
    const latest = getContinuousSession(workflowId);
    if (!latest || !latest.active) return;
    const backoffErrors = latest.consecutiveErrors + 1;
    const waitSec = Math.min(300, 15 * Math.pow(2, Math.min(backoffErrors - 1, 4)));
    const nextCycleAt = new Date(Date.now() + waitSec * 1000).toISOString();

    upsertContinuousSession({
      ...latest,
      status: 'error_backoff',
      lastRunId: runId,
      lastRunStatus: 'failed',
      lastCycleAt: new Date().toISOString(),
      nextCycleAt,
      consecutiveErrors: backoffErrors,
      lastError: err instanceof Error ? err.message : 'Unexpected continuous cycle error',
    });

    scheduleContinuousCycle(workflowId, waitSec * 1000);
  }
}

function scheduleContinuousCycle(workflowId: string, delayMs: number): void {
  clearContinuousTimer(workflowId);
  const timer = setTimeout(() => {
    continuousTimers.delete(workflowId);
    void runSingleContinuousCycle(workflowId);
  }, Math.max(1000, delayMs));
  continuousTimers.set(workflowId, timer);
}

function hydrateContinuousSessions(): void {
  try {
    const activeSessions = listActiveContinuousSessions();
    for (const session of activeSessions) {
      const intervalSec = clampContinuousIntervalSec(session.intervalSec);
      const nextCycleAt = new Date(Date.now() + Math.min(intervalSec, 10) * 1000).toISOString();
      upsertContinuousSession({
        ...session,
        status: 'cooldown',
        nextCycleAt,
      });
      scheduleContinuousCycle(session.workflowId, Math.min(intervalSec, 10) * 1000);
    }
  } catch {
    // ignore hydration errors on boot
  }
}

app.get('/api/workflows/:id/continuous', (req, res) => {
  const wf = getWorkflowById(req.params.id);
  const existing = getContinuousSession(req.params.id);
  if (existing) {
    res.json({ session: existing });
    return;
  }
  const now = new Date().toISOString();
  res.json({
    session: {
      workflowId: req.params.id,
      active: Boolean(wf?.continuousAgentWork),
      status: 'idle',
      cyclesCompleted: 0,
      intervalSec: clampContinuousIntervalSec(wf?.continuousIntervalSec ?? 30),
      mode: 'dry_run',
      taskPrompt: wf?.description ?? '',
      consecutiveErrors: 0,
      startedAt: now,
      updatedAt: now,
    } satisfies ContinuousWorkSession,
  });
});

app.post('/api/workflows/:id/continuous/start', (req, res) => {
  const workflowId = req.params.id;
  const { workflow: inlineWorkflow, taskPrompt, mode, intervalSec, immediate } = req.body as {
    workflow?: WorkflowConfig;
    taskPrompt?: string;
    mode?: 'live' | 'dry_run';
    intervalSec?: number;
    immediate?: boolean;
  };

  let wf = inlineWorkflow ?? getWorkflowById(workflowId);
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found.' });
    return;
  }

  const resolvedInterval = clampContinuousIntervalSec(
    intervalSec ?? wf.continuousIntervalSec ?? 30,
  );
  wf = upsertWorkflow({
    ...wf,
    id: workflowId,
    continuousAgentWork: true,
    continuousIntervalSec: resolvedInterval,
  });

  if (wf.nodes.length === 0) {
    res.status(400).json({ error: 'Add at least one Agent node before enabling continuous work.' });
    return;
  }

  const existing = getContinuousSession(workflowId);
  const resolvedMode: 'live' | 'dry_run' =
    mode === 'live' || mode === 'dry_run'
      ? mode
      : canWorkflowRunLive(wf.nodes, getAppSettings())
        ? 'live'
        : 'dry_run';

  const now = new Date().toISOString();
  const promptText =
    (typeof taskPrompt === 'string' && taskPrompt.trim()) ||
    existing?.taskPrompt ||
    wf.description ||
    `Continue building, testing, and improving ${wf.name}.`;

  const delayMs = immediate === false ? resolvedInterval * 1000 : 1200;
  const session = upsertContinuousSession({
    workflowId,
    active: true,
    status: 'cooldown',
    cyclesCompleted: existing?.cyclesCompleted ?? 0,
    lastRunId: existing?.lastRunId,
    lastRunStatus: existing?.lastRunStatus,
    lastCycleAt: existing?.lastCycleAt,
    nextCycleAt: new Date(Date.now() + delayMs).toISOString(),
    intervalSec: resolvedInterval,
    mode: resolvedMode,
    taskPrompt: promptText,
    consecutiveErrors: 0,
    startedAt: existing?.active ? existing.startedAt : now,
    updatedAt: now,
  });

  scheduleContinuousCycle(workflowId, delayMs);
  res.json({ session, workflow: wf });
});

app.post('/api/workflows/:id/continuous/stop', (req, res) => {
  const workflowId = req.params.id;
  const { disableWorkflowFlag } = (req.body ?? {}) as { disableWorkflowFlag?: boolean };
  clearContinuousTimer(workflowId);

  const existing = getContinuousSession(workflowId);
  const wf = getWorkflowById(workflowId);
  let updatedWorkflow = wf;
  if (wf && disableWorkflowFlag !== false) {
    updatedWorkflow = upsertWorkflow({
      ...wf,
      continuousAgentWork: false,
    });
  }

  const now = new Date().toISOString();
  const session = upsertContinuousSession({
    workflowId,
    active: false,
    status: 'paused',
    cyclesCompleted: existing?.cyclesCompleted ?? 0,
    lastRunId: existing?.lastRunId,
    lastRunStatus: existing?.lastRunStatus,
    lastCycleAt: existing?.lastCycleAt,
    nextCycleAt: undefined,
    intervalSec: existing?.intervalSec ?? clampContinuousIntervalSec(wf?.continuousIntervalSec ?? 30),
    mode: existing?.mode ?? 'dry_run',
    taskPrompt: existing?.taskPrompt ?? wf?.description ?? '',
    consecutiveErrors: 0,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
  });

  res.json({ session, workflow: updatedWorkflow });
});

// =============================================================================
// Strict Pre-Launch Final Test Gate (4 Categories, 14+ Test Types)
// =============================================================================
app.get('/api/prelaunch-tests/latest', (req, res) => {
  const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;
  const report = getLatestPrelaunchReport(workflowId);
  res.json({ report });
});

app.post('/api/prelaunch-tests/run', async (req, res) => {
  try {
    const { workflowId, workflow: inlineWorkflow, runId, strictMode } = req.body as {
      workflowId?: string;
      workflow?: WorkflowConfig;
      runId?: string;
      strictMode?: boolean;
    };
    const report = await runPrelaunchTestSuite({
      workflowId,
      inlineWorkflow,
      runId,
      strictMode,
      port: PORT,
      projectsBase: PROJECTS_BASE,
      listSandboxFiles,
      runSandboxCommand,
    });
    res.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pre-launch test execution failed.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  cleanupStaleSandboxDirs({ sandboxBaseDir: SANDBOX_BASE });
  const cleanupTimer = setInterval(
    () => cleanupStaleSandboxDirs({ sandboxBaseDir: SANDBOX_BASE }),
    6 * 60 * 60 * 1000,
  );
  cleanupTimer.unref();

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
    hydrateContinuousSessions();
  });
}

if (process.env.AETHERFLOW_NO_LISTEN !== '1') {
  void startServer();
}

export { app, server, startServer };
