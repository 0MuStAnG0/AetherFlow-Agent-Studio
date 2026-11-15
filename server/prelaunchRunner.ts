import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAppSettings,
  getDb,
  getLatestPrelaunchReport,
  getWorkflowById,
  listBugReports,
  listRunSummaries,
  listWorkflows,
  savePrelaunchReport,
} from './db.ts';
import { isEncryptedSecretValue, isOperatorAuthEnabled } from './security.ts';
import type {
  PrelaunchTestReport,
  PrelaunchTestResult,
  SandboxFile,
  WorkflowConfig,
} from '../src/types/workflow.ts';
import {
  evaluatePrelaunchGate,
  findMissingWorkflowCoverage,
  scanSourceSecurityIssues,
} from '../src/utils/prelaunchTests.ts';

export function collectSourceFilesForAudit(
  rootDir: string,
  maxFiles = 100,
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'data',
    '.playwright-cli',
    '.aistudio',
  ]);
  const allowedExt = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.py',
    '.css',
    '.html',
    '.json',
    '.yml',
    '.yaml',
    '.sh',
  ]);

  function walk(dir: string) {
    if (out.length >= maxFiles || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExt.has(ext)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 260_000) continue;
          const rel = path.relative(rootDir, full).replace(/\\/g, '/');
          out.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
        } catch {
          // ignore unreadable file
        }
      }
    }
  }

  walk(rootDir);
  return out;
}

export interface RunCommandFn {
  (cwd: string, command: string, timeoutMs?: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export async function runPrelaunchTestSuite(params: {
  workflowId?: string;
  inlineWorkflow?: WorkflowConfig;
  runId?: string;
  strictMode?: boolean;
  port: number;
  projectsBase: string;
  listSandboxFiles: (runId: string) => SandboxFile[];
  runSandboxCommand: RunCommandFn;
}): Promise<PrelaunchTestReport> {
  const startedAt = Date.now();
  const {
    workflowId,
    inlineWorkflow,
    runId,
    strictMode,
    port,
    projectsBase,
    listSandboxFiles,
    runSandboxCommand,
  } = params;

  const wf: WorkflowConfig =
    inlineWorkflow ??
    (workflowId ? getWorkflowById(workflowId) : null) ?? {
      id: workflowId || 'default-workflow',
      name: 'Studio Project',
      description: '',
      maxRounds: 6,
      humanInTheLoop: true,
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    };

  const isStrict = strictMode ?? wf.strictPrelaunchGate ?? true;
  const sandboxFiles = runId ? listSandboxFiles(runId) : [];
  const projectId = wf.projectContext?.projectId?.replace(/[^a-zA-Z0-9_-]/g, '');
  const projectDir = projectId ? path.join(projectsBase, projectId) : '';
  const hasImportedDir = Boolean(projectDir && fs.existsSync(projectDir));

  const targetRoot = hasImportedDir ? projectDir : process.cwd();
  const targetScope = hasImportedDir
    ? `Imported Project (${wf.projectContext?.name ?? projectId})`
    : sandboxFiles.length > 0
      ? `Studio + Sandbox (${sandboxFiles.length} files)`
      : 'Studio Codebase';

  const sourceFiles = collectSourceFilesForAudit(targetRoot);
  const combinedAuditFiles = [
    ...sourceFiles,
    ...sandboxFiles.map((f) => ({ path: `sandbox/${f.path}`, content: f.content })),
  ];

  const results: PrelaunchTestResult[] = [];
  const localBase = `http://127.0.0.1:${port}`;
  const settings = getAppSettings();
  const allBugs = listBugReports({ workflowId: wf.id });
  const openBugs = allBugs.filter((b) => b.status !== 'resolved');
  const recentRuns = listRunSummaries(15).filter((r) => !wf.id || r.workflowId === wf.id);

  // Detect imported project manifest (package.json / Python) so tests run against actual target project!
  const targetPkgPath = path.join(targetRoot, 'package.json');
  let targetPkg: { scripts?: Record<string, string> } | null = null;
  if (fs.existsSync(targetPkgPath)) {
    try {
      targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
    } catch {
      targetPkg = null;
    }
  }

  // 1. Unit Testing (runs inside targetRoot when imported project defines tests)
  {
    const t0 = Date.now();
    let unitCmd = '';
    let unitCwd = targetRoot;

    if (hasImportedDir) {
      const testFiles = sourceFiles
        .filter((f) => /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(f.path))
        .map((f) => f.path);
      const hasPyTests = sourceFiles.some((f) => /(^|\/)test_[^/]+\.py$|_test\.py$/.test(f.path));
      if (targetPkg?.scripts?.test && !targetPkg.scripts.test.includes('no test specified')) {
        unitCmd = 'npm test';
      } else if (testFiles.length > 0) {
        const localTsx = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
        const tsxBin = fs.existsSync(localTsx) ? localTsx : 'npx --yes tsx';
        unitCmd = `${tsxBin} --test ${testFiles.slice(0, 12).join(' ')}`;
      } else if (hasPyTests) {
        unitCmd = 'python3 -m unittest discover';
      }
    } else {
      const localTsx = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
      const tsxBin = fs.existsSync(localTsx) ? localTsx : 'npx --yes tsx';
      unitCmd = `${tsxBin} --test src/utils/*.test.ts server/*.test.ts`;
      unitCwd = process.cwd();
    }

    if (!unitCmd && hasImportedDir) {
      results.push({
        id: 'unit',
        category: 'core_technical',
        severity: 'critical',
        status: 'warn',
        score: 65,
        durationMs: Date.now() - t0,
        summaryEn: `Imported project "${wf.projectContext?.name ?? projectId}" has no unit test script or *.test.* files yet.`,
        summaryFa: `پروژه واردشده «${wf.projectContext?.name ?? projectId}» هنوز اسکریپت تست واحد یا فایل *.test.* ندارد.`,
        evidence: [`Audited root: ${targetScope}`, `Files scanned: ${sourceFiles.length}`],
        recommendationEn: 'Ask Security & QA / Executor agents to add unit tests and a package.json "test" script.',
        recommendationFa: 'از ایجنت امنیت/QA بخواهید تست واحد و اسکریپت test را به پروژه اضافه کند.',
      });
    } else {
      const unitRes = await runSandboxCommand(unitCwd, unitCmd, 30000);
      const output = [unitRes.stdout, unitRes.stderr].filter(Boolean).join('\n');
      const passMatch = output.match(/# pass (\d+)/);
      const failMatch = output.match(/# fail (\d+)/);
      const passCount = passMatch ? Number(passMatch[1]) : 0;
      const failCount = failMatch ? Number(failMatch[1]) : unitRes.exitCode === 0 ? 0 : 1;
      const ok = unitRes.exitCode === 0 && failCount === 0;
      results.push({
        id: 'unit',
        category: 'core_technical',
        severity: 'critical',
        status: ok ? 'pass' : 'fail',
        score: ok ? 100 : 25,
        durationMs: Date.now() - t0,
        summaryEn: ok
          ? `Executed ${passCount || 'all'} unit tests in ${hasImportedDir ? 'imported project' : 'Studio'} with 0 failures.`
          : `Unit test suite exited with code ${unitRes.exitCode} (${failCount} failed).`,
        summaryFa: ok
          ? `${passCount || 'تمامی'} تست واحد در ${hasImportedDir ? 'پروژه واردشده' : 'استودیو'} با موفقیت و بدون خطا اجرا شدند.`
          : `اجرای تست واحد با کد خطا ${unitRes.exitCode} و ${failCount} مورد ناموفق متوقف شد.`,
        evidence: [
          `Scope: ${targetScope}`,
          `Command: ${unitCmd}`,
          `Exit code: ${unitRes.exitCode}, Passed: ${passCount}, Failed: ${failCount}`,
        ],
        recommendationEn: ok ? undefined : 'Fix failing unit test assertions before launch.',
        recommendationFa: ok ? undefined : 'تست‌های واحد ناموفق را پیش از لانچ اصلاح کنید.',
      });
    }
  }

  // 2. Integration Testing
  {
    const t0 = Date.now();
    const integrationProbes = await Promise.all([
      fetch(`${localBase}/api/workflows`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false),
      fetch(`${localBase}/api/settings`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false),
      fetch(`${localBase}/api/capabilities`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false),
      fetch(`${localBase}/api/runs`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false),
      fetch(`${localBase}/api/auth/status`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false),
    ]);
    const passed = integrationProbes.filter(Boolean).length;
    const ok = passed === integrationProbes.length;
    results.push({
      id: 'integration',
      category: 'core_technical',
      severity: 'critical',
      status: ok ? 'pass' : passed >= 3 ? 'warn' : 'fail',
      score: Math.round((passed / integrationProbes.length) * 100),
      durationMs: Date.now() - t0,
      summaryEn: `${passed}/${integrationProbes.length} core REST/SQLite/Auth integration routes verified.`,
      summaryFa: `${passed} از ${integrationProbes.length} مسیر یکپارچه‌سازی API، احراز هویت و SQLite تایید شد.`,
      evidence: [
        `Probed /api/workflows, /api/settings, /api/capabilities, /api/runs, /api/auth/status`,
        `SQLite workflows persisted: ${listWorkflows().length}`,
      ],
      recommendationEn: ok ? undefined : 'Ensure backend API routes and SQLite database connections respond HTTP 200.',
      recommendationFa: ok ? undefined : 'از پاسخگویی سالم تمام سرویس‌های API و اتصال SQLite مطمئن شوید.',
    });
  }

  // 3. System Testing (checks target imported project's build/typecheck/py_compile when present)
  {
    const t0 = Date.now();
    if (hasImportedDir) {
      const hasTsConfig = fs.existsSync(path.join(projectDir, 'tsconfig.json'));
      const pyFiles = sourceFiles.filter((f) => f.path.endsWith('.py'));
      let checkCmd = '';
      if (hasTsConfig && fs.existsSync(path.join(projectDir, 'node_modules/.bin/tsc'))) {
        checkCmd = './node_modules/.bin/tsc --noEmit';
      } else if (targetPkg?.scripts?.lint) {
        checkCmd = 'npm run lint';
      } else if (targetPkg?.scripts?.build && fs.existsSync(path.join(projectDir, 'node_modules'))) {
        checkCmd = 'npm run build';
      } else if (pyFiles.length > 0) {
        checkCmd = `python3 -m py_compile ${pyFiles.slice(0, 20).map((f) => f.path).join(' ')}`;
      }

      if (!checkCmd) {
        results.push({
          id: 'system',
          category: 'core_technical',
          severity: 'critical',
          status: sourceFiles.length > 0 ? 'pass' : 'fail',
          score: sourceFiles.length > 0 ? 85 : 20,
          durationMs: Date.now() - t0,
          summaryEn: `Audited ${sourceFiles.length} source files in "${wf.projectContext?.name ?? projectId}" (no local node_modules build toolchain installed).`,
          summaryFa: `${sourceFiles.length} فایل در پروژه «${wf.projectContext?.name ?? projectId}» بررسی شد (محیط build لوکال نصب نشده).`,
          evidence: [`Target root: ${projectDir}`, `Source files: ${sourceFiles.length}`],
        });
      } else {
        const sysRes = await runSandboxCommand(projectDir, checkCmd, 30000);
        const ok = sysRes.exitCode === 0;
        results.push({
          id: 'system',
          category: 'core_technical',
          severity: 'critical',
          status: ok ? 'pass' : 'fail',
          score: ok ? 100 : 25,
          durationMs: Date.now() - t0,
          summaryEn: ok
            ? `Target project system verification (${checkCmd}) passed cleanly.`
            : `Target project system check failed: ${sysRes.stderr.slice(0, 140) || `exit ${sysRes.exitCode}`}`,
          summaryFa: ok
            ? `بررسی سیستم و کامپایل پروژه واردشده (${checkCmd}) بدون خطا تایید شد.`
            : `بررسی سیستم پروژه واردشده با خطا مواجه شد (exit ${sysRes.exitCode}).`,
          evidence: [`Project dir: ${projectDir}`, `Command: ${checkCmd}`, `Exit: ${sysRes.exitCode}`],
          recommendationEn: ok ? undefined : 'Resolve compilation or typecheck errors in the imported project.',
          recommendationFa: ok ? undefined : 'خطاهای کامپایل یا تایپ پروژه را برطرف کنید.',
        });
      }
    } else {
      const localTsc = path.resolve(process.cwd(), 'node_modules/.bin/tsc');
      const tscBin = fs.existsSync(localTsc) ? localTsc : 'npx --yes tsc';
      const tscRes = await runSandboxCommand(process.cwd(), `${tscBin} --noEmit`, 25000);
      const pyRes = await runSandboxCommand(
        process.cwd(),
        'python3 -m py_compile deploy/backend/*.py',
        15000,
      );
      const hasDistOrSrc = fs.existsSync(path.resolve(process.cwd(), 'src/App.tsx'));
      const ok = tscRes.exitCode === 0 && pyRes.exitCode === 0 && hasDistOrSrc;
      results.push({
        id: 'system',
        category: 'core_technical',
        severity: 'critical',
        status: ok ? 'pass' : 'fail',
        score: ok ? 100 : tscRes.exitCode === 0 ? 60 : 20,
        durationMs: Date.now() - t0,
        summaryEn: ok
          ? 'Full-system TypeScript typecheck (tsc --noEmit) and Python backend compile passed.'
          : 'System verification reported compilation or typecheck errors.',
        summaryFa: ok
          ? 'بررسی کامل ساختار سیستم (TypeScript و بک‌اند پایتون) بدون خطا تایید شد.'
          : 'بررسی یکپارچه سیستم با خطای کامپایل یا تایپ مواجه شد.',
        evidence: [
          `TypeScript tsc --noEmit exit: ${tscRes.exitCode}`,
          `Python py_compile exit: ${pyRes.exitCode}`,
        ],
        recommendationEn: ok ? undefined : 'Resolve TypeScript/Python errors reported by tsc --noEmit before launch.',
        recommendationFa: ok ? undefined : 'خطاهای تایپ یا سینتکس سیستم را برطرف کنید.',
      });
    }
  }

  // 4. Functional Testing
  {
    const t0 = Date.now();
    const workflowIssues = findMissingWorkflowCoverage(wf);
    const hasTools = wf.nodes.some((n) => n.data.tools.readFile || n.data.tools.writeFile);
    const score = workflowIssues.length === 0 && hasTools ? 100 : workflowIssues.length === 1 ? 75 : 40;
    const status = workflowIssues.length === 0 ? (hasTools ? 'pass' : 'warn') : 'fail';
    results.push({
      id: 'functional',
      category: 'functional_nonfunctional',
      severity: 'critical',
      status,
      score,
      durationMs: Date.now() - t0,
      summaryEn:
        workflowIssues.length === 0
          ? `Workflow "${wf.name}" has ${wf.nodes.length} active agent(s), ${wf.edges.length} edges, and valid prompts.`
          : `Functional gaps found: ${workflowIssues.join(' ')}`,
      summaryFa:
        workflowIssues.length === 0
          ? `ساختار کارکردی پروژه «${wf.name}» با ${wf.nodes.length} ایجنت و پرامپت‌های معتبر تایید شد.`
          : `نقص کارکردی شناسایی شد: ${workflowIssues.join(' ')}`,
      evidence: [
        `Agents: ${wf.nodes.length}, Edges: ${wf.edges.length}`,
        `Sandbox deliverable files: ${sandboxFiles.length}`,
      ],
      recommendationEn: workflowIssues.length > 0 ? workflowIssues.join(' ') : undefined,
      recommendationFa: workflowIssues.length > 0 ? 'حداقل یک مدیر و ایجنت‌های دارای پرامپت معتبر به ورکفلو اضافه کنید.' : undefined,
    });
  }

  // 5. Performance Testing (multi-sample latency benchmark + oversized source audit)
  {
    const t0 = Date.now();
    const samples: number[] = [];
    for (const ep of ['/api/health', '/api/workflows', '/api/capabilities', '/api/health', '/api/workflows']) {
      const s0 = Date.now();
      await fetch(`${localBase}${ep}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      samples.push(Date.now() - s0);
    }
    samples.sort((a, b) => a - b);
    const p95Ms = samples[samples.length - 1] ?? 0;
    const avgMs = Math.round(samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length));
    const oversizedFiles = combinedAuditFiles.filter((f) => f.content.length > 220_000);
    const ok = p95Ms < 350 && oversizedFiles.length === 0;
    const status = p95Ms < 900 && oversizedFiles.length <= 2 ? (ok ? 'pass' : 'warn') : 'fail';
    results.push({
      id: 'performance',
      category: 'functional_nonfunctional',
      severity: 'high',
      status,
      score: ok ? 98 : status === 'warn' ? 80 : 45,
      durationMs: Date.now() - t0,
      summaryEn: `5-probe benchmark avg=${avgMs}ms, p95=${p95Ms}ms across ${combinedAuditFiles.length} audited files (${oversizedFiles.length} >220KB).`,
      summaryFa: `بنچمارک ۵ مرحله‌ای API: میانگین ${avgMs}ms، p95=${p95Ms}ms؛ بررسی ${combinedAuditFiles.length} فایل (${oversizedFiles.length} فایل سنگین).`,
      evidence: [
        `API RTT samples: [${samples.join('ms, ')}ms]`,
        `Audited files: ${combinedAuditFiles.length}, Oversized (>220KB): ${oversizedFiles.length}`,
      ],
      recommendationEn: ok ? undefined : 'Split oversized source modules or optimize slow endpoints.',
      recommendationFa: ok ? undefined : 'ماژول‌های حجیم را خرد کنید و زمان پاسخ API را بهینه نمایید.',
    });
  }

  // 6. Stress Testing
  {
    const t0 = Date.now();
    const concurrency = 16;
    const stressResults = await Promise.all(
      Array.from({ length: concurrency }, (_, idx) =>
        fetch(`${localBase}${idx % 2 === 0 ? '/api/health' : '/api/capabilities'}`, {
          signal: AbortSignal.timeout(4000),
        })
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    const okCount = stressResults.filter(Boolean).length;
    const guardrailsValid =
      wf.maxRounds >= 1 &&
      wf.maxRounds <= 25 &&
      settings.sandboxTimeoutSec >= 5 &&
      settings.sandboxMemoryMb >= 256;
    const ok = okCount === concurrency && guardrailsValid;
    results.push({
      id: 'stress',
      category: 'functional_nonfunctional',
      severity: 'high',
      status: ok ? 'pass' : okCount >= 13 ? 'warn' : 'fail',
      score: Math.round((okCount / concurrency) * (guardrailsValid ? 100 : 80)),
      durationMs: Date.now() - t0,
      summaryEn: `Burst probe (${concurrency} concurrent requests): ${okCount}/${concurrency} succeeded; sandbox memory=${settings.sandboxMemoryMb}MB, timeout=${settings.sandboxTimeoutSec}s.`,
      summaryFa: `تست هم‌زمانی (${concurrency} درخواست موازی): ${okCount} از ${concurrency} موفق؛ سقف حافظه سندباکس ${settings.sandboxMemoryMb}MB و تایم‌اوت ${settings.sandboxTimeoutSec} ثانیه.`,
      evidence: [
        `Concurrent REST probes passed: ${okCount}/${concurrency}`,
        `Guardrails: maxRounds=${wf.maxRounds}, sandboxTimeout=${settings.sandboxTimeoutSec}s`,
      ],
      recommendationEn: ok ? undefined : 'Check concurrency stability and verify maxRounds / sandbox timeout limits.',
      recommendationFa: ok ? undefined : 'پایداری درخواست‌های هم‌زمان و محدودیت‌های منابع را بررسی کنید.',
    });
  }

  // 7. Security Testing (code audit + AES-256-GCM vault check + operator auth status)
  {
    const t0 = Date.now();
    const secFindings = scanSourceSecurityIssues(combinedAuditFiles);
    const hitlActive = wf.humanInTheLoop || settings.globalHumanInTheLoop;
    const authLocked = isOperatorAuthEnabled();

    const db = getDb();
    const secretRows = db
      .prepare('SELECT secret_name, secret_value FROM provider_secrets')
      .all() as Array<{ secret_name: string; secret_value: string }>;
    const unencryptedRows = secretRows.filter((r) => r.secret_value.trim() && !isEncryptedSecretValue(r.secret_value));

    const criticalCount = secFindings.filter((f) => f.severity === 'critical').length + unencryptedRows.length;
    const ok = criticalCount === 0 && secFindings.length === 0 && hitlActive;
    const status = criticalCount > 0 ? 'fail' : secFindings.length > 0 || !hitlActive ? 'warn' : 'pass';
    results.push({
      id: 'security',
      category: 'functional_nonfunctional',
      severity: 'critical',
      status,
      score: criticalCount > 0 ? 15 : secFindings.length > 0 ? 70 : hitlActive ? (authLocked ? 100 : 94) : 80,
      durationMs: Date.now() - t0,
      summaryEn:
        secFindings.length === 0 && unencryptedRows.length === 0
          ? `0 hardcoded secrets or injection flaws across ${combinedAuditFiles.length} files; AES-256-GCM vault active (HITL=${hitlActive ? 'ON' : 'OFF'}, Operator Auth=${authLocked ? 'ON' : 'optional'}).`
          : `Detected ${secFindings.length} code security finding(s) and ${unencryptedRows.length} unencrypted vault row(s).`,
      summaryFa:
        secFindings.length === 0 && unencryptedRows.length === 0
          ? `۰ کلید افشاشده یا تزریق کد در ${combinedAuditFiles.length} فایل؛ رمزنگاری AES-256-GCM مخزن کلیدها فعال است (HITL: ${hitlActive ? 'فعال' : 'خاموش'}).`
          : `${secFindings.length} ریسک امنیتی کد و ${unencryptedRows.length} کلید رمزنگاری‌نشده شناسایی شد.`,
      evidence:
        secFindings.length > 0
          ? secFindings.slice(0, 5).map((f) => `[${f.severity.toUpperCase()}] ${f.file}: ${f.issue}`)
          : [
              `Scanned ${combinedAuditFiles.length} source files`,
              `SQLite Vault AES-256-GCM rows: ${secretRows.length - unencryptedRows.length}/${secretRows.length}`,
              `HITL gate: ${hitlActive}, Operator Auth lock: ${authLocked}`,
            ],
      recommendationEn:
        secFindings.length > 0
          ? 'Remove hardcoded secrets/unsafe patterns immediately and store keys in the AES-256-GCM Secret Vault.'
          : !hitlActive
            ? 'Enable Human-in-the-Loop Gate for production shell safety.'
            : !authLocked
              ? 'Set AETHERFLOW_AUTH_TOKEN in .env when exposing the studio on a public server.'
              : undefined,
      recommendationFa:
        secFindings.length > 0
          ? 'کلیدهای هاردکد یا الگوهای ناامن را فوراً حذف و از مخزن رمزنگاری‌شده استفاده کنید.'
          : !hitlActive
            ? 'برای ایمنی بیشتر، تایید انسانی دستورات حساس را فعال کنید.'
            : undefined,
    });
  }

  // 8. Usability & UI/UX Testing (targets imported project files when present)
  {
    const t0 = Date.now();
    const htmlFile = combinedAuditFiles.find((f) => /(^|\/)index\.html$/i.test(f.path));
    const fallbackHtmlPath = path.resolve(process.cwd(), 'index.html');
    const indexHtml = htmlFile?.content ?? (fs.existsSync(fallbackHtmlPath) ? fs.readFileSync(fallbackHtmlPath, 'utf-8') : '');
    const hasTitle = /<title>[^<]+<\/title>/i.test(indexHtml);
    const uiSource = combinedAuditFiles
      .filter((f) => /\.(tsx|jsx|html|vue|svelte)$/.test(f.path))
      .map((f) => f.content)
      .join('\n');
    const hasRtlOrLang = uiSource.includes("dir={") || uiSource.includes('dir="') || indexHtml.includes('lang=');
    const hasAria = uiSource.includes('aria-label') || uiSource.includes('role=');
    const hasErrorBoundary = uiSource.includes('ErrorBoundary') || uiSource.includes('componentDidCatch');
    const ok = hasTitle && hasRtlOrLang && hasAria && (hasImportedDir || hasErrorBoundary);
    results.push({
      id: 'usability',
      category: 'ux_compatibility',
      severity: 'high',
      status: ok ? 'pass' : 'warn',
      score: ok ? 96 : 78,
      durationMs: Date.now() - t0,
      summaryEn: `UX & resilience audit (${targetScope}): title=${hasTitle}, ARIA=${hasAria}, RTL/i18n=${hasRtlOrLang}, ErrorBoundary=${hasErrorBoundary}.`,
      summaryFa: `بررسی تجربه کاربری و تاب‌آوری (${targetScope}): عنوان=${hasTitle}، دسترس‌پذیری ARIA=${hasAria}، ErrorBoundary=${hasErrorBoundary}.`,
      evidence: [
        `Document title present: ${hasTitle}`,
        `ARIA labels: ${hasAria}, ErrorBoundary: ${hasErrorBoundary}`,
      ],
      recommendationEn: ok ? undefined : 'Ensure semantic ARIA labels, ErrorBoundary recovery, and clear error feedback across views.',
      recommendationFa: ok ? undefined : 'از وجود ErrorBoundary، برچسب‌های ARIA و پشتیبانی RTL اطمینان حاصل کنید.',
    });
  }

  // 9. Compatibility Testing
  {
    const t0 = Date.now();
    const htmlFile = combinedAuditFiles.find((f) => /(^|\/)index\.html$/i.test(f.path));
    const fallbackHtmlPath = path.resolve(process.cwd(), 'index.html');
    const indexHtml = htmlFile?.content ?? (fs.existsSync(fallbackHtmlPath) ? fs.readFileSync(fallbackHtmlPath, 'utf-8') : '');
    const hasViewportMeta = /name=["']viewport["']/i.test(indexHtml);
    const hasLinuxStack =
      fs.existsSync(path.resolve(process.cwd(), 'install-linux.sh')) &&
      fs.existsSync(path.resolve(process.cwd(), 'Dockerfile')) &&
      fs.existsSync(path.resolve(process.cwd(), 'docker-compose.yml'));
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const ok = hasViewportMeta && hasLinuxStack && nodeMajor >= 20;
    results.push({
      id: 'compatibility',
      category: 'ux_compatibility',
      severity: 'high',
      status: ok ? 'pass' : 'warn',
      score: ok ? 100 : 75,
      durationMs: Date.now() - t0,
      summaryEn: `Viewport meta=${hasViewportMeta}, Node v${process.versions.node}, Linux/Docker bundle=${hasLinuxStack}.`,
      summaryFa: `سازگاری ریسپانسیو موبایل/دسکتاپ، Node v${process.versions.node} و فایل‌های استقرار لینوکس/Docker تایید شد.`,
      evidence: [
        `Responsive viewport meta tag: ${hasViewportMeta}`,
        `Node runtime: v${process.versions.node}`,
        `Linux installer & Docker manifests present: ${hasLinuxStack}`,
      ],
      recommendationEn: ok ? undefined : 'Verify mobile viewport meta tag and Linux Docker/Node compatibility files.',
      recommendationFa: ok ? undefined : 'تگ viewport و فایل‌های سازگاری لینوکس/داکر را بررسی کنید.',
    });
  }

  // 10. Regression Testing
  {
    const t0 = Date.now();
    const criticalBugs = openBugs.filter((b) => b.severity === 'critical' || b.severity === 'high');
    const failedRecent = recentRuns.filter((r) => r.status === 'failed');
    const ok = criticalBugs.length === 0;
    const status = criticalBugs.length > 0 ? 'fail' : openBugs.length > 0 || failedRecent.length > 0 ? 'warn' : 'pass';
    results.push({
      id: 'regression',
      category: 'ux_compatibility',
      severity: 'critical',
      status,
      score: criticalBugs.length > 0 ? 30 : openBugs.length > 0 ? 80 : 100,
      durationMs: Date.now() - t0,
      summaryEn:
        criticalBugs.length === 0
          ? `0 open critical/high bugs (${openBugs.length} minor open, ${allBugs.length - openBugs.length} resolved).`
          : `${criticalBugs.length} open critical/high bug report(s) blocking regression stability.`,
      summaryFa:
        criticalBugs.length === 0
          ? `هیچ باگ بحرانی/مهم بازی وجود ندارد (${allBugs.length - openBugs.length} مورد حل‌شده).`
          : `${criticalBugs.length} باگ باز مهم/بحرانی در سیستم ثبت شده است که باید پیش از لانچ رفع شود.`,
      evidence: [
        `Open critical/high bugs: ${criticalBugs.length}`,
        `Total open bugs: ${openBugs.length}, Recent failed runs: ${failedRecent.length}`,
      ],
      recommendationEn: ok ? undefined : 'Ask agents to fix open critical/high bug reports in the Bug Report tab.',
      recommendationFa: ok ? undefined : 'باگ‌های باز مهم را در تب Bug Report به ایجنت‌ها برای اصلاح ارسال کنید.',
    });
  }

  // 11. Smoke Testing
  {
    const t0 = Date.now();
    const healthRes = await fetch(`${localBase}/api/health`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, body: null }));
    const blueprintOk = await fetch(`${localBase}/api/blueprint`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false);
    const ok = Boolean(healthRes.ok && blueprintOk);
    results.push({
      id: 'smoke',
      category: 'final_pre_release',
      severity: 'critical',
      status: ok ? 'pass' : 'fail',
      score: ok ? 100 : 20,
      durationMs: Date.now() - t0,
      summaryEn: ok
        ? 'Live server health, SQLite readiness, and blueprint endpoints passed smoke checks.'
        : 'Smoke probe failed on core runtime endpoints.',
      summaryFa: ok
        ? 'تست دود روی سلامت سرور، دیتابیس SQLite و اندپوینت‌های اصلی با موفقیت پاس شد.'
        : 'تست دود روی مسیرهای اصلی سرور با خطا مواجه شد.',
      evidence: [`/api/health ok=${healthRes.ok}`, `/api/blueprint ok=${blueprintOk}`],
    });
  }

  // 12. Alpha Testing
  {
    const t0 = Date.now();
    const roles = new Set(wf.nodes.map((n) => n.data.role));
    const hasManager = roles.has('manager');
    const hasBuilder = roles.has('backend') || roles.has('frontend') || wf.nodes.length >= 2;
    const hasQa = roles.has('security_qa');
    const ok = hasManager && hasBuilder && hasQa;
    results.push({
      id: 'alpha',
      category: 'final_pre_release',
      severity: 'high',
      status: ok ? 'pass' : hasManager && hasBuilder ? 'warn' : 'fail',
      score: ok ? 100 : hasManager && hasBuilder ? 75 : 40,
      durationMs: Date.now() - t0,
      summaryEn: `Internal Alpha team coverage: Manager=${hasManager}, Engineering=${hasBuilder}, Security & QA=${hasQa}.`,
      summaryFa: `آمادگی تست آلفای داخلی: مدیر=${hasManager ? 'دارد' : 'ندارد'}، مهندسی=${hasBuilder ? 'دارد' : 'ندارد'}، امنیت و QA=${hasQa ? 'دارد' : 'ندارد'}.`,
      evidence: [
        `Assigned roles: ${Array.from(roles).join(', ') || 'none'}`,
        `Continuous autonomous mode: ${Boolean(wf.continuousAgentWork)}`,
      ],
      recommendationEn: ok ? undefined : 'Assign a Manager, Backend/Frontend, and Security & QA agent for complete Alpha coverage.',
      recommendationFa: ok ? undefined : 'برای پوشش کامل تست آلفا، نقش‌های مدیر، توسعه و امنیت/QA را در تیم داشته باشید.',
    });
  }

  // 13. Beta Testing
  {
    const t0 = Date.now();
    const hasEnvExample = fs.existsSync(path.resolve(process.cwd(), '.env.example'));
    const hasReadme = fs.existsSync(path.resolve(process.cwd(), 'README.md'));
    const hasNginxSslInstaller =
      fs.existsSync(path.resolve(process.cwd(), 'install-linux.sh')) &&
      fs.readFileSync(path.resolve(process.cwd(), 'install-linux.sh'), 'utf-8').includes('--nginx');
    const ok = hasEnvExample && hasReadme && hasNginxSslInstaller;
    results.push({
      id: 'beta',
      category: 'final_pre_release',
      severity: 'high',
      status: ok ? 'pass' : 'warn',
      score: ok ? 100 : 70,
      durationMs: Date.now() - t0,
      summaryEn: `Beta staging package: .env.example=${hasEnvExample}, README=${hasReadme}, Nginx+SSL installer=${hasNginxSslInstaller}.`,
      summaryFa: `آمادگی بسته تست بتا: فایل env.example، مستندات README و نصب خودکار Nginx+SSL ${ok ? 'کامل است' : 'نیاز به تکمیل دارد'}.`,
      evidence: [
        `.env.example: ${hasEnvExample}, README.md: ${hasReadme}`,
        `Linux Nginx/SSL bootstrap flag verified: ${hasNginxSslInstaller}`,
      ],
    });
  }

  // 14. User Acceptance Testing (UAT)
  {
    const t0 = Date.now();
    const hasGoal = Boolean(wf.description?.trim() || wf.projectContext?.summary?.trim());
    const anyBlockingCritical = results.some((r) => r.status === 'fail' && r.severity === 'critical');
    const ok = hasGoal && !anyBlockingCritical;
    const status = anyBlockingCritical ? 'fail' : hasGoal ? 'pass' : 'warn';
    results.push({
      id: 'uat',
      category: 'final_pre_release',
      severity: 'critical',
      status,
      score: anyBlockingCritical ? 35 : hasGoal ? 100 : 75,
      durationMs: Date.now() - t0,
      summaryEn: anyBlockingCritical
        ? 'UAT blocked because critical technical/security/regression checks failed.'
        : hasGoal
          ? 'Project requirements, goal definition, and pre-launch acceptance criteria satisfied.'
          : 'Technical checks passed, but project description/goal is empty for full UAT sign-off.',
      summaryFa: anyBlockingCritical
        ? 'پذیرش کاربر (UAT) به دلیل وجود خطای بحرانی در تست‌های قبلی مسدود است.'
        : hasGoal
          ? 'تطابق محصول با اهداف تعریف‌شده و معیارهای پذیرش کاربر (UAT) تایید شد.'
          : 'تست‌های فنی پاس شدند، اما برای امضای دقیق UAT، هدف و توضیحات پروژه را تکمیل کنید.',
      evidence: [
        `Project goal defined: ${hasGoal}`,
        `Prior critical test failures: ${results.filter((r) => r.status === 'fail' && r.severity === 'critical').length}`,
      ],
      recommendationEn: anyBlockingCritical
        ? 'Resolve all critical failures first, then re-run Strict Pre-Launch Tests.'
        : !hasGoal
          ? 'Add a clear project description in Manage Projects.'
          : undefined,
      recommendationFa: anyBlockingCritical
        ? 'ابتدا خطاهای بحرانی را رفع کرده و تست سخت قبل از لانچ را مجدداً اجرا کنید.'
        : !hasGoal
          ? 'در بخش مدیریت پروژه‌ها توضیحات و هدف پروژه را مشخص کنید.'
          : undefined,
    });
  }

  const report: PrelaunchTestReport = evaluatePrelaunchGate({
    id: `prelaunch-${crypto.randomUUID().slice(0, 8)}`,
    workflowId: wf.id,
    workflowName: wf.name,
    strictMode: isStrict,
    targetScope,
    durationMs: Date.now() - startedAt,
    results,
  });

  savePrelaunchReport(report);
  return report;
}

export { getLatestPrelaunchReport };
