import type {
  AgentRole,
  AppSettings,
  ImportedProjectAnalysis,
  LLMProvider,
  ProjectSourceType,
  RecommendedAgentSpec,
  WorkflowConfig,
  WorkflowEdge,
  WorkflowNode,
} from '../types/workflow';
import { clampMaxRounds, getDefaultEnvRef } from './workflowEngine';

export interface ScannedProjectFile {
  path: string;
  content: string;
  size?: number;
}

const IGNORED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  'coverage',
  '.turbo',
  '.cache',
  'target',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.db',
  '.sqlite',
  '.lockb',
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript / React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript / React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.sql': 'SQL',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.yml': 'YAML / CI',
  '.yaml': 'YAML / CI',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.sh': 'Shell',
};

const KEY_FILE_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'pipfile',
  'go.mod',
  'cargo.toml',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'readme.md',
  '.env.example',
  'firestore.rules',
  'schema.prisma',
  'drizzle.config.ts',
  'makefile',
]);

export function parseGitHubRepoInput(
  input: string,
  branchOverride?: string,
): { owner: string; repo: string; branch?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const cleanBranch = branchOverride?.trim() || undefined;

  // Accept shorthand owner/repo
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(trimmed)) {
    const [owner, rawRepo] = trimmed.split('/');
    const repo = rawRepo.replace(/\.git$/i, '');
    if (!owner || !repo) return null;
    return { owner, repo, branch: cleanBranch };
  }

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
      return null;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!owner || !repo || owner.includes('..') || repo.includes('..')) return null;

    let branchFromUrl: string | undefined;
    if (parts[2] === 'tree' && parts[3]) {
      branchFromUrl = parts.slice(3).join('/');
    }
    return {
      owner,
      repo,
      branch: cleanBranch ?? branchFromUrl,
    };
  } catch {
    return null;
  }
}

export function sanitizeArchiveEntryPath(rawPath: string, stripCommonRoot = true): string | null {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return null;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '..' || s === '.')) return null;

  const trimmedSegments =
    stripCommonRoot && segments.length > 1 ? segments.slice(1) : segments;
  if (trimmedSegments.length === 0) return null;

  for (const seg of trimmedSegments) {
    if (IGNORED_PATH_SEGMENTS.has(seg.toLowerCase())) {
      return null;
    }
  }

  const finalPath = trimmedSegments.join('/');
  const dotIdx = finalPath.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = finalPath.slice(dotIdx).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return null;
    }
  }

  return finalPath;
}

function getFileExt(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  const idx = base.lastIndexOf('.');
  return idx === -1 ? '' : base.slice(idx).toLowerCase();
}

function resolveProviderAndModel(
  preferredProvider: LLMProvider,
  fallbackModel: string,
  appSettings?: AppSettings,
): { provider: LLMProvider; model: string } {
  const cfg = appSettings?.providers[preferredProvider];
  if (cfg?.defaultModel) {
    return { provider: preferredProvider, model: cfg.defaultModel };
  }
  return { provider: preferredProvider, model: fallbackModel };
}

export function analyzeProjectFiles(params: {
  id?: string;
  name: string;
  sourceType: ProjectSourceType;
  sourceUrl?: string;
  branch?: string;
  files: ScannedProjectFile[];
  appSettings?: AppSettings;
  language?: 'en' | 'fa';
}): ImportedProjectAnalysis {
  const {
    id = `proj-${Date.now()}`,
    name,
    sourceType,
    sourceUrl,
    branch,
    files,
    appSettings,
    language = 'en',
  } = params;

  const isFa = language === 'fa';
  const langCounts = new Map<string, number>();
  const keyFiles: string[] = [];
  const topDirs = new Set<string>();

  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length > 1) {
      topDirs.add(`${parts[0]}/`);
    } else {
      topDirs.add(parts[0]);
    }

    const baseLower = (parts.pop() || f.path).toLowerCase();
    if (KEY_FILE_NAMES.has(baseLower) || f.path.toLowerCase().includes('.github/workflows/')) {
      keyFiles.push(f.path);
    }

    const ext = getFileExt(f.path);
    const langName = EXTENSION_LANGUAGE_MAP[ext];
    if (langName) {
      langCounts.set(langName, (langCounts.get(langName) ?? 0) + 1);
    }
  }

  const languages = Array.from(langCounts.entries())
    .map(([langName, count]) => ({ name: langName, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 8);

  const pathListLower = files.map((f) => f.path.toLowerCase());
  const combinedManifestText = files
    .filter((f) => {
      const lower = f.path.toLowerCase();
      return (
        lower.endsWith('package.json') ||
        lower.endsWith('requirements.txt') ||
        lower.endsWith('pyproject.toml') ||
        lower.endsWith('go.mod') ||
        lower.endsWith('cargo.toml') ||
        lower.endsWith('docker-compose.yml') ||
        lower.endsWith('docker-compose.yaml') ||
        lower.endsWith('dockerfile') ||
        lower.endsWith('.env.example') ||
        lower.endsWith('readme.md')
      );
    })
    .map((f) => `${f.path}\n${f.content.slice(0, 4000)}`)
    .join('\n\n')
    .toLowerCase();

  const hasText = (pattern: RegExp) =>
    pattern.test(combinedManifestText) || pathListLower.some((p) => pattern.test(p));

  const frameworks: string[] = [];
  const addFramework = (label: string) => {
    if (!frameworks.includes(label)) frameworks.push(label);
  };

  const hasReact = hasText(/\breact\b|"react"|react-dom|\.tsx$|\.jsx$/);
  const hasNext = hasText(/\bnext\b|next\.config/);
  const hasVue = hasText(/\bvue\b|\.vue$/);
  const hasTailwind = hasText(/tailwind/);
  const hasVite = hasText(/\bvite\b/);
  const hasFastAPI = hasText(/fastapi/);
  const hasDjango = hasText(/django/);
  const hasFlask = hasText(/flask/);
  const hasExpress = hasText(/\bexpress\b/);
  const hasNest = hasText(/@nestjs/);
  const hasGo = pathListLower.some((p) => p.endsWith('.go') || p.endsWith('go.mod'));
  const hasRust = pathListLower.some((p) => p.endsWith('.rs') || p.endsWith('cargo.toml'));
  const hasDatabase = hasText(
    /sqlite|postgres|postgresql|pg\b|prisma|drizzle|sqlalchemy|mongoose|supabase|firestore|\.sql$/,
  );
  const hasDocker = hasText(/dockerfile|docker-compose/);
  const hasCI = pathListLower.some((p) => p.includes('.github/workflows/'));
  const hasTests = hasText(/pytest|vitest|jest|playwright|\.test\.|\.spec\.|tests\//);
  const hasAuthOrSecurity = hasText(
    /oauth|jwt|jsonwebtoken|passport|bcrypt|helmet|auth|security|firestore\.rules/,
  );
  const hasAI = hasText(
    /@google\/genai|openai|anthropic|langchain|langgraph|autogen|litellm|ollama|pytorch|transformers/,
  );

  if (hasNext) addFramework('Next.js');
  if (hasReact) addFramework('React');
  if (hasVue) addFramework('Vue');
  if (hasTailwind) addFramework('Tailwind CSS');
  if (hasVite) addFramework('Vite');
  if (hasFastAPI) addFramework('FastAPI');
  if (hasDjango) addFramework('Django');
  if (hasFlask) addFramework('Flask');
  if (hasExpress) addFramework('Express.js');
  if (hasNest) addFramework('NestJS');
  if (hasGo) addFramework('Go');
  if (hasRust) addFramework('Rust');
  if (hasDatabase) addFramework('Database / ORM');
  if (hasAI) addFramework('AI / LLM SDK');
  if (hasDocker) addFramework('Docker');
  if (hasCI) addFramework('GitHub Actions');
  if (hasTests) addFramework('Automated Tests');

  const recommendations: RecommendedAgentSpec[] = [];

  // 1. Always recommend Manager Agent as technical coordinator
  const mgrChoice = resolveProviderAndModel('gemini', 'gemini-4-hydrogen', appSettings);
  recommendations.push({
    id: 'rec-manager',
    title: isFa ? 'ایجنت مدیر فنی و معمار (Manager)' : 'Lead Manager & Architect Agent',
    role: 'manager',
    specialty: isFa
      ? `مدیریت معماری و هماهنگی پروژه ${frameworks.slice(0, 3).join(' + ') || name}`
      : `Architecture Orchestration & Review (${frameworks.slice(0, 3).join(' / ') || 'Multi-Module'})`,
    reason: isFa
      ? `بررسی کل ساختار ${files.length} فایل پروژه، تقسیم تسک‌ها بین متخصصان، و ارجاع خودکار باگ‌ها یا خطاهای تست به بخش مربوطه.`
      : `Coordinates across ${files.length} project file(s), assigns domain milestones, and routes test/security defects to the right specialist.`,
    recommendedProvider: mgrChoice.provider,
    recommendedModel: mgrChoice.model,
    systemPrompt: `You are the Lead Software Architect & Manager supervising the imported project "${name}" (${frameworks.join(', ') || 'Software Project'}). Analyze changes against key files (${keyFiles.slice(0, 6).join(', ')}), delegate issues using DELEGATE blocks when domain defects appear, and approve release only when all tests pass.`,
    tools: { readFile: true, writeFile: false, execBash: false },
    priority: 'essential',
    matchedSignals: keyFiles.slice(0, 4),
  });

  // 2. Backend Agent if server/API/Python/Go/Rust/DB detected
  const hasBackend =
    hasFastAPI ||
    hasDjango ||
    hasFlask ||
    hasExpress ||
    hasNest ||
    hasGo ||
    hasRust ||
    pathListLower.some((p) => p.includes('server') || p.includes('api/') || p.endsWith('.py'));

  if (hasBackend || hasDatabase) {
    const backendStack =
      [
        hasFastAPI ? 'FastAPI' : null,
        hasDjango ? 'Django' : null,
        hasFlask ? 'Flask' : null,
        hasExpress ? 'Express/Node' : null,
        hasNest ? 'NestJS' : null,
        hasGo ? 'Go' : null,
        hasRust ? 'Rust' : null,
      ]
        .filter(Boolean)
        .join(' / ') || 'API & Backend Services';
    const beChoice = resolveProviderAndModel('gemini', 'gemini-4-hydrogen', appSettings);
    const signals = [
      ...keyFiles.filter((f) =>
        /(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|server\.ts|main\.py)/i.test(
          f,
        ),
      ),
      ...pathListLower.filter((p) => p.includes('api/') || p.includes('server')).slice(0, 2),
    ];

    recommendations.push({
      id: 'rec-backend',
      title: isFa ? 'ایجنت مهندس بک‌اند (Backend)' : 'Backend API & Services Agent',
      role: 'backend',
      specialty: isFa
        ? `توسعه سرویس‌ها و API مبتنی بر ${backendStack}`
        : `${backendStack} API & Service Engineering`,
      reason: isFa
        ? `ساختار بک‌اند (${backendStack}) در پروژه شناسایی شد؛ این ایجنت مسئول طراحی Endpointها، منطق سرور و رفع خطاهای لایه سرویس است.`
        : `Detected backend runtime/frameworks (${backendStack}); handles API endpoints, business logic, and server error handling.`,
      recommendedProvider: beChoice.provider,
      recommendedModel: beChoice.model,
      systemPrompt: `You are a Senior Backend Engineer specializing in ${backendStack} for "${name}". Inspect existing API handlers, enforce strict input validation and structured error responses, and write clean modules via WRITE_FILE:<path>.`,
      tools: { readFile: true, writeFile: true, execBash: false },
      priority: 'essential',
      matchedSignals: Array.from(new Set(signals)).slice(0, 5),
    });
  }

  // 3. Frontend UI/UX Specialist if React/Next/Vue/Tailwind/CSS detected
  const hasFrontend =
    hasReact ||
    hasNext ||
    hasVue ||
    hasTailwind ||
    pathListLower.some((p) => p.endsWith('.tsx') || p.endsWith('.jsx') || p.endsWith('.html'));

  if (hasFrontend) {
    const feStack =
      [
        hasNext ? 'Next.js' : null,
        hasReact ? 'React' : null,
        hasVue ? 'Vue' : null,
        hasTailwind ? 'Tailwind CSS' : null,
        hasVite ? 'Vite' : null,
      ]
        .filter(Boolean)
        .join(' + ') || 'Web Frontend';
    const feChoice = resolveProviderAndModel('openai', 'gpt-4o', appSettings);
    const signals = [
      ...keyFiles.filter((f) => /(package\.json|vite\.config|next\.config|tsconfig)/i.test(f)),
      ...pathListLower.filter((p) => p.endsWith('.tsx') || p.endsWith('.vue')).slice(0, 2),
    ];

    recommendations.push({
      id: 'rec-frontend',
      title: isFa ? 'ایجنت رابط کاربری و فرانت‌اند (Frontend)' : 'Frontend & UI Specialist Agent',
      role: 'frontend',
      specialty: isFa
        ? `طراحی کامپوننت و مدیریت وضعیت با ${feStack}`
        : `${feStack} Component & State Engineering`,
      reason: isFa
        ? `فایل‌ها و وابستگی‌های ${feStack} در پروژه وجود دارد؛ این ایجنت کامپوننت‌ها، فرم‌ها و اتصال به API را توسعه و بهینه‌سازی می‌کند.`
        : `Detected ${feStack} UI modules; crafts accessible components, state synchronization, and responsive error/loading states.`,
      recommendedProvider: feChoice.provider,
      recommendedModel: feChoice.model,
      systemPrompt: `You are a Principal Frontend Engineer working on "${name}" (${feStack}). Build modular, accessible, responsive components aligned with the backend API contract.`,
      tools: { readFile: true, writeFile: true, execBash: false },
      priority: 'essential',
      matchedSignals: Array.from(new Set(signals)).slice(0, 5),
    });
  }

  // 4. Database / Schema Specialist when ORM or SQL schemas detected
  if (hasDatabase) {
    const dbChoice = resolveProviderAndModel('gemini', 'gemini-4-hydrogen', appSettings);
    const dbSignals = pathListLower
      .filter((p) => /(prisma|drizzle|sql|db|schema|models|firestore\.rules)/i.test(p))
      .slice(0, 4);
    recommendations.push({
      id: 'rec-database',
      title: isFa ? 'ایجنت متخصص دیتابیس و مدل داده' : 'Database & Schema Architect Agent',
      role: 'custom',
      specialty: isFa
        ? 'طراحی Schema، کوئری‌های بهینه و امنیت داده‌ها (SQL / ORM)'
        : 'Database Schema, Migrations & Query Optimization',
      reason: isFa
        ? `لایه‌های دیتابیس/ORM یا فایل‌های Schema در پروژه شناسایی شدند؛ وجود یک متخصص اختصاصی از باگ‌های Migration و کوئری‌های کند جلوگیری می‌کند.`
        : `Detected database persistence/schema artifacts (${dbSignals.join(', ') || 'ORM/SQL'}); guards migrations, indexing, and data integrity.`,
      recommendedProvider: dbChoice.provider,
      recommendedModel: dbChoice.model,
      systemPrompt: `You are a Database & Data Modeling Architect for "${name}". Audit schemas, migrations, parameterized queries, and persistence consistency without breaking existing data.`,
      tools: { readFile: true, writeFile: true, execBash: false },
      priority: 'recommended',
      matchedSignals: dbSignals,
    });
  }

  // 5. AI / LLM Specialist when AI SDKs are detected
  if (hasAI) {
    const aiChoice = resolveProviderAndModel('gemini', 'gemini-4-hydrogen', appSettings);
    recommendations.push({
      id: 'rec-ai-specialist',
      title: isFa ? 'ایجنت مهندس هوش مصنوعی و پرامپت' : 'AI & Prompt Systems Specialist',
      role: 'custom',
      specialty: isFa
        ? 'بهینه‌سازی فراخوانی مدل‌های LLM، پرامپت‌نویسی و مدیریت توکن'
        : 'LLM Integration, Prompt Engineering & Guardrails',
      reason: isFa
        ? `کتابخانه‌های هوش مصنوعی/LLM در پروژه استفاده شده است؛ این ایجنت پرامپت‌ها، Fallback مدل‌ها و کنترل خروجی ساختاریافته را تنظیم می‌کند.`
        : `Detected AI/LLM SDK dependencies; optimizes structured outputs, model fallbacks, timeout guards, and prompt safety.`,
      recommendedProvider: aiChoice.provider,
      recommendedModel: aiChoice.model,
      systemPrompt: `You are an AI Systems Engineer for "${name}". Design reliable LLM integrations, structured JSON output schemas, retry/fallback routing, and prompt guardrails.`,
      tools: { readFile: true, writeFile: true, execBash: false },
      priority: 'recommended',
      matchedSignals: ['AI / LLM SDK'],
    });
  }

  // 6. Security & QA Agent (always recommended, specialized based on auth/test signals)
  const secChoice = resolveProviderAndModel('anthropic', 'claude-3-7-sonnet-latest', appSettings);
  const secSignals = [
    ...pathListLower.filter((p) => /(test|spec|auth|security|rules|\.env)/i.test(p)).slice(0, 4),
  ];
  recommendations.push({
    id: 'rec-security-qa',
    title: isFa ? 'ایجنت امنیت و تست خودکار (Security & QA)' : 'Security & QA Auditor Agent',
    role: 'security_qa',
    specialty: isFa
      ? `ممیزی امنیت OWASP، بررسی احراز هویت و نوشتن تست خودکار`
      : hasAuthOrSecurity
        ? 'Auth / OWASP Security Audit & Automated Test Suite'
        : 'Code Security Audit & Automated Regression Testing',
    reason: isFa
      ? `برای شناسایی آسیب‌پذیری‌ها (تزریق کد، مدیریت Secretها، اعتبارسنجی ورودی) و پوشش تست واحد/تست انتها به انتها ضروری است.`
      : `Essential for auditing input sanitization, secret handling, auth boundaries, and writing automated test coverage.`,
    recommendedProvider: secChoice.provider,
    recommendedModel: secChoice.model,
    systemPrompt: `You are the Application Security & QA Engineer for "${name}". Audit every change for OWASP Top 10 risks, secret leaks, and missing validation, and write deterministic automated tests.`,
    tools: { readFile: true, writeFile: true, execBash: false },
    priority: 'essential',
    matchedSignals: secSignals.length > 0 ? secSignals : ['OWASP & QA'],
  });

  // 7. Executor / DevOps Agent (essential when Docker/CI/build scripts exist, recommended otherwise)
  const execChoice = resolveProviderAndModel('ollama', 'ollama/qwen2.5-coder:32b', appSettings);
  const execSignals = keyFiles.filter((f) =>
    /(dockerfile|docker-compose|makefile|\.github\/workflows|package\.json|pyproject\.toml)/i.test(
      f,
    ),
  );
  recommendations.push({
    id: 'rec-executor',
    title: isFa ? 'ایجنت اجراگر، تست و DevOps (Executor)' : 'DevOps & Sandbox Executor Agent',
    role: 'executor',
    specialty: isFa
      ? hasDocker || hasCI
        ? 'اجرای Docker، بررسی CI/CD و تست واقعی در سندباکس لینوکس'
        : 'اجرای تست‌ها، بیلد و بررسی سلامت کد در سندباکس لینوکس'
      : hasDocker || hasCI
        ? 'Docker Containerization, CI/CD & Sandbox Verification'
        : 'Build, Linter & Sandbox Test Execution',
    reason: isFa
      ? hasDocker || hasCI
        ? `فایل‌های Docker یا CI/CD در پروژه وجود دارد؛ این ایجنت تست‌ها و بیلد پروژه را در کانتینر ایزوله اجرا و گزارش می‌کند.`
        : `برای اجرای واقعی دستورات تست، تایپ‌چک و بیلد در محیط سندباکس لینوکس جهت تایید نهایی پروژه لازم است.`
      : hasDocker || hasCI
        ? `Detected container/CI definitions (${execSignals.slice(0, 3).join(', ')}); executes builds, linters, and test suites inside the Linux sandbox.`
        : `Runs automated builds, type checks, and test suites inside the Linux sandbox before final Manager sign-off.`,
    recommendedProvider: execChoice.provider,
    recommendedModel: execChoice.model,
    systemPrompt: `You are the DevOps & Sandbox Executor Agent for "${name}". Run build scripts, type checks, and test suites inside the Linux sandbox via EXEC_BASH:<command> and report exact exit codes.`,
    tools: { readFile: true, writeFile: true, execBash: true },
    priority: hasDocker || hasCI || hasTests ? 'essential' : 'recommended',
    matchedSignals: execSignals.slice(0, 4),
  });

  const topLangs = languages.slice(0, 3).map((l) => l.name).join('، ');
  const topFrameworks = frameworks.slice(0, 4).join(' / ');
  const managerSummary = isFa
    ? `تحلیل ایجنت مدیر روی پروژه «${name}» (${files.length} فایل قابل بررسی): ساختار اصلی بر پایه ${topLangs || 'کد منبع چندمنظوره'}${
        topFrameworks ? ` با فریم‌ورک‌های ${topFrameworks}` : ''
      } تشخیص داده شد. برای توسعه، عیب‌یابی، تست امنیت و استقرار خودکار این پروژه، تیم پیشنهادی شامل ${
        recommendations.length
      } ایجنت تخصصی زیر است که می‌توانید مستقیماً روی بوم بسازید:`
    : `Manager Agent analyzed "${name}" across ${files.length} source file(s): primary stack uses ${
        languages.slice(0, 3).map((l) => l.name).join(', ') || 'multi-purpose source files'
      }${topFrameworks ? ` with ${topFrameworks}` : ''}. To cover architecture, domain coding, security, and verification cleanly, Manager recommends ${
        recommendations.length
      } specialized agents below:`;

  return {
    id,
    name,
    sourceType,
    sourceUrl,
    branch,
    totalFiles: files.length,
    languages,
    frameworks,
    keyFiles: keyFiles.slice(0, 12),
    directoryOverview: Array.from(topDirs).sort().slice(0, 12),
    managerSummary,
    recommendations,
    usedLiveAi: false,
    importedAt: new Date().toISOString(),
  };
}

export function buildWorkflowFromRecommendations(params: {
  project: ImportedProjectAnalysis;
  selectedSpecs: RecommendedAgentSpec[];
  existingWorkflow?: WorkflowConfig;
  mode: 'replace' | 'merge';
  appSettings?: AppSettings;
}): WorkflowConfig {
  const { project, selectedSpecs, existingWorkflow, mode, appSettings } = params;

  const baseNodes: WorkflowNode[] =
    mode === 'merge' && existingWorkflow ? [...existingWorkflow.nodes] : [];
  const baseEdges: WorkflowEdge[] =
    mode === 'merge' && existingWorkflow ? [...existingWorkflow.edges] : [];

  const existingLabels = new Set(baseNodes.map((n) => n.data.label.toLowerCase()));
  const specsToAdd =
    mode === 'merge'
      ? selectedSpecs.filter((s) => !existingLabels.has(s.title.toLowerCase()))
      : selectedSpecs;

  const createdNodes: WorkflowNode[] = [];
  const startOffsetX = mode === 'merge' && baseNodes.length > 0 ? 120 : 40;
  const startOffsetY =
    mode === 'merge' && baseNodes.length > 0
      ? Math.max(...baseNodes.map((n) => n.position.y), 120) + 210
      : 80;

  // Group into clear pipeline columns: Manager -> Specialists (Backend/Frontend/Custom) -> Security -> Executor
  const managers = specsToAdd.filter((s) => s.role === 'manager');
  const builders = specsToAdd.filter(
    (s) => s.role === 'backend' || s.role === 'frontend' || s.role === 'custom',
  );
  const auditors = specsToAdd.filter((s) => s.role === 'security_qa');
  const executors = specsToAdd.filter((s) => s.role === 'executor');

  const placeColumn = (specs: RecommendedAgentSpec[], colX: number, baseY: number) => {
    specs.forEach((spec, idx) => {
      const nodeId = `node-${spec.role}-${Date.now().toString(36).slice(-4)}-${createdNodes.length + 1}`;
      createdNodes.push({
        id: nodeId,
        type: 'agentNode',
        position: { x: colX, y: baseY + idx * 195 },
        data: {
          label: spec.title,
          role: spec.role,
          provider: spec.recommendedProvider,
          model: spec.recommendedModel,
          envSecretRef:
            appSettings?.providers[spec.recommendedProvider]?.envVarName ||
            getDefaultEnvRef(spec.recommendedProvider),
          temperature: spec.role === 'executor' ? 0.0 : spec.role === 'security_qa' ? 0.1 : 0.25,
          systemPrompt: spec.systemPrompt,
          tools: {
            readFile: spec.tools.readFile && (appSettings?.allowReadFile ?? true),
            writeFile: spec.tools.writeFile && (appSettings?.allowWriteFile ?? true),
            execBash: spec.tools.execBash && (appSettings?.allowExecBash ?? true),
          },
          status: 'idle',
        },
      });
    });
  };

  placeColumn(managers, startOffsetX, startOffsetY + 90);
  placeColumn(builders, startOffsetX + 310, startOffsetY);
  placeColumn(auditors, startOffsetX + 630, startOffsetY + 90);
  placeColumn(executors, startOffsetX + 940, startOffsetY + 90);

  const allNodes = [...baseNodes, ...createdNodes];
  const newEdges: WorkflowEdge[] = [];
  const edgeKeys = new Set(baseEdges.map((e) => `${e.source}->${e.target}`));

  const addEdge = (source: WorkflowNode | undefined, target: WorkflowNode | undefined, label: string, animated = false) => {
    if (!source || !target || source.id === target.id) return;
    const key = `${source.id}->${target.id}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    newEdges.push({
      id: `e-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      label,
      ...(animated ? { animated: true } : {}),
    });
  };

  const mgrNode =
    createdNodes.find((n) => n.data.role === 'manager') ??
    allNodes.find((n) => n.data.role === 'manager');
  const builderNodes = createdNodes.filter(
    (n) => n.data.role === 'backend' || n.data.role === 'frontend' || n.data.role === 'custom',
  );
  const secNode =
    createdNodes.find((n) => n.data.role === 'security_qa') ??
    allNodes.find((n) => n.data.role === 'security_qa');
  const execNode =
    createdNodes.find((n) => n.data.role === 'executor') ??
    allNodes.find((n) => n.data.role === 'executor');

  for (const b of builderNodes) {
    addEdge(mgrNode, b, b.data.role === 'frontend' ? 'UI Spec' : 'Task Spec');
    addEdge(b, secNode ?? execNode, secNode ? 'Audit' : 'Verify');
  }
  if (builderNodes.length === 0 && secNode) {
    addEdge(mgrNode, secNode, 'Audit Scope');
  }
  addEdge(secNode, execNode, 'Run Tests');
  if (execNode && builderNodes[0]) {
    addEdge(execNode, builderNodes[0], 'Self-Heal Logs', true);
  }

  return {
    id:
      mode === 'merge' && existingWorkflow
        ? existingWorkflow.id
        : `wf-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28) || 'project'}-${Date.now().toString(36).slice(-4)}`,
    name:
      mode === 'merge' && existingWorkflow
        ? existingWorkflow.name
        : `${project.name} · AI Team`,
    description: project.managerSummary,
    maxRounds: clampMaxRounds(
      mode === 'merge' && existingWorkflow
        ? Math.max(existingWorkflow.maxRounds, allNodes.length + 2)
        : Math.max(6, allNodes.length + 2),
    ),
    humanInTheLoop:
      mode === 'merge' && existingWorkflow
        ? existingWorkflow.humanInTheLoop
        : appSettings?.globalHumanInTheLoop ?? true,
    nodes: allNodes,
    edges: [...baseEdges, ...newEdges],
    projectContext: {
      projectId: project.id,
      name: project.name,
      sourceType: project.sourceType,
      sourceUrl: project.sourceUrl,
      branch: project.branch,
      frameworks: project.frameworks,
      summary: project.managerSummary,
    },
    updatedAt: new Date().toISOString(),
  };
}
