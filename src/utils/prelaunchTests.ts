import type {
  AgentRole,
  PrelaunchCategoryId,
  PrelaunchTestId,
  PrelaunchTestReport,
  PrelaunchTestResult,
  WorkflowConfig,
} from '../types/workflow';

export interface PrelaunchCategoryMeta {
  id: PrelaunchCategoryId;
  order: number;
  titleEn: string;
  titleFa: string;
  subtitleEn: string;
  subtitleFa: string;
}

export interface PrelaunchTestDefinition {
  id: PrelaunchTestId;
  category: PrelaunchCategoryId;
  severity: 'critical' | 'high' | 'medium';
  titleEn: string;
  titleFa: string;
  descriptionEn: string;
  descriptionFa: string;
}

export const PRELAUNCH_CATEGORIES: PrelaunchCategoryMeta[] = [
  {
    id: 'core_technical',
    order: 1,
    titleEn: '1. Core & Technical Tests (Code & Structure)',
    titleFa: '۱. تست‌های پایه و فنی (کد و ساختار)',
    subtitleEn: 'Verifies isolated units, module integration, and whole-system integrity.',
    subtitleFa: 'بررسی توابع مستقل، ارتباط بین ماژول‌ها و یکپارچگی کل سیستم نرم‌افزاری.',
  },
  {
    id: 'functional_nonfunctional',
    order: 2,
    titleEn: '2. Functional & Non-Functional Tests',
    titleFa: '۲. تست‌های عملکردی و غیرعملکردی',
    subtitleEn: 'Evaluates workflows, speed, high-load stability, and security hardening.',
    subtitleFa: 'بررسی کارکرد قابلیت‌ها، سرعت و کارایی، پایداری در بار بالا و امنیت کدها.',
  },
  {
    id: 'ux_compatibility',
    order: 3,
    titleEn: '3. UX & Compatibility Tests',
    titleFa: '۳. تست‌های تجربه کاربری و سازگاری',
    subtitleEn: 'Checks UI usability, cross-environment compatibility, and regressions.',
    subtitleFa: 'بررسی تجربه کاربری، سازگاری با مرورگرها/سرورها و عدم بازگشت باگ‌های قبلی.',
  },
  {
    id: 'final_pre_release',
    order: 4,
    titleEn: '4. Final Pre-Release Tests',
    titleFa: '۴. تست‌های نهایی قبل از انتشار',
    subtitleEn: 'Strict Smoke, Alpha, Beta, and User Acceptance (UAT) release gates.',
    subtitleFa: 'تست دود، آلفا، بتا و پذیرش نهایی کاربر پیش از لانچ عمومی پروژه.',
  },
];

export const PRELAUNCH_TEST_DEFINITIONS: PrelaunchTestDefinition[] = [
  // Category 1: Core & Technical
  {
    id: 'unit',
    category: 'core_technical',
    severity: 'critical',
    titleEn: 'Unit Testing',
    titleFa: 'تست واحد (Unit Testing)',
    descriptionEn: 'Verifies smallest isolated code units, utilities, and state functions via automated test suites.',
    descriptionFa: 'بررسی کوچک‌ترین بخش‌های کد (توابع و ماژول‌ها) به صورت مستقل و خودکار.',
  },
  {
    id: 'integration',
    category: 'core_technical',
    severity: 'critical',
    titleEn: 'Integration Testing',
    titleFa: 'تست یکپارچه‌سازی (Integration Testing)',
    descriptionEn: 'Verifies data flow between API routes, SQLite persistence, provider routers, and agent pipelines.',
    descriptionFa: 'بررسی نحوه کارکرد و ارتباط درست ماژول‌ها، دیتابیس و سرویس‌های مختلف با یکدیگر.',
  },
  {
    id: 'system',
    category: 'core_technical',
    severity: 'critical',
    titleEn: 'System Testing',
    titleFa: 'تست سیستم (System Testing)',
    descriptionEn: 'Evaluates full-system compilation, TypeScript/Python syntax, containers, and requirement alignment.',
    descriptionFa: 'ارزیابی کل سیستم نرم‌افزاری به عنوان یک مجموعه واحد برای اطمینان از تطابق فنی.',
  },

  // Category 2: Functional & Non-Functional
  {
    id: 'functional',
    category: 'functional_nonfunctional',
    severity: 'critical',
    titleEn: 'Functional Testing',
    titleFa: 'تست کارکردی (Functional Testing)',
    descriptionEn: 'Checks interactive workflows, forms, agent tool permissions, prompts, and feature completeness.',
    descriptionFa: 'بررسی اینکه تمام دکمه‌ها، فرم‌ها، لینک‌ها و قابلیت‌های اصلی طبق انتظار کار می‌کنند.',
  },
  {
    id: 'performance',
    category: 'functional_nonfunctional',
    severity: 'high',
    titleEn: 'Performance Testing',
    titleFa: 'تست عملکرد و کارایی (Performance Testing)',
    descriptionEn: 'Measures API response latency, payload weight, oversized assets, and blocking code patterns.',
    descriptionFa: 'سنجش سرعت پاسخ‌دهی، حجم فایل‌ها، راندمان کد و نبود گلوگاه‌های کندی.',
  },
  {
    id: 'stress',
    category: 'functional_nonfunctional',
    severity: 'high',
    titleEn: 'Stress Testing',
    titleFa: 'تست استرس (Stress Testing)',
    descriptionEn: 'Probes burst concurrent requests, timeout limits, retry backoff, and resource guardrails.',
    descriptionFa: 'بررسی پایداری نرم‌افزار تحت بار هم‌زمان بالا، محدودیت منابع و شرایط بحرانی.',
  },
  {
    id: 'security',
    category: 'functional_nonfunctional',
    severity: 'critical',
    titleEn: 'Security Testing',
    titleFa: 'تست امنیت (Security Testing)',
    descriptionEn: 'Scans code for leaked secrets, XSS, eval/injection flaws, path traversal, and HITL safety gates.',
    descriptionFa: 'شناسایی حفره‌های امنیتی، کلیدهای لو رفته، تزریق کد و آسیب‌پذیری‌های نفوذ.',
  },

  // Category 3: UX & Compatibility
  {
    id: 'usability',
    category: 'ux_compatibility',
    severity: 'high',
    titleEn: 'Usability & UI/UX Testing',
    titleFa: 'تست رابط و تجربه کاربری (Usability Testing)',
    descriptionEn: 'Audits RTL/LTR support, accessibility labels, dark mode contrast, and error/empty feedback states.',
    descriptionFa: 'بررسی خوانایی، پشتیبانی راست‌به‌چپ، دسترس‌پذیری و تجربه کاربری در نمایشگرهای مختلف.',
  },
  {
    id: 'compatibility',
    category: 'ux_compatibility',
    severity: 'high',
    titleEn: 'Compatibility Testing',
    titleFa: 'تست سازگاری (Compatibility Testing)',
    descriptionEn: 'Checks responsive viewport CSS, browser standards, Linux/Docker/Nginx scripts, and Node compatibility.',
    descriptionFa: 'بررسی سازگاری در مرورگرها، موبایل/دسکتاپ و استقرار روی سرورهای لینوکس و Docker.',
  },
  {
    id: 'regression',
    category: 'ux_compatibility',
    severity: 'critical',
    titleEn: 'Regression Testing',
    titleFa: 'تست رگرسیون (Regression Testing)',
    descriptionEn: 'Audits open critical/high bug reports and recent run errors so previous fixes remain unbroken.',
    descriptionFa: 'اطمینان از نبود باگ‌های باز بحرانی و عدم خرابی قابلیت‌های قبلی پس از تغییرات جدید.',
  },

  // Category 4: Final Pre-Release
  {
    id: 'smoke',
    category: 'final_pre_release',
    severity: 'critical',
    titleEn: 'Smoke Testing',
    titleFa: 'تست دود (Smoke Testing)',
    descriptionEn: 'Verifies essential boot and health endpoints respond quickly without fatal runtime errors.',
    descriptionFa: 'بررسی سریع پایداری اولیه سرویس‌ها و پاسخ‌دهی سالم بخش‌های حیاتی پیش از تست عمیق.',
  },
  {
    id: 'alpha',
    category: 'final_pre_release',
    severity: 'high',
    titleEn: 'Alpha Testing',
    titleFa: 'تست آلفا (Alpha Testing)',
    descriptionEn: 'Internal team & QA supervisor verification of architecture, specialists, and artifact completeness.',
    descriptionFa: 'بررسی داخلی تیم فنی (Manager/QA) بر کامل بودن ساختار و خروجی‌های تولیدشده.',
  },
  {
    id: 'beta',
    category: 'final_pre_release',
    severity: 'high',
    titleEn: 'Beta Testing',
    titleFa: 'تست بتا (Beta Testing)',
    descriptionEn: 'Staging & deployment readiness check: .env.example, SSL/Nginx proxy options, README, and installer.',
    descriptionFa: 'آمادگی محیط واقعی برای کاربران آزمایشی: مستندات، تنظیمات محیطی، Nginx/SSL و نصاب.',
  },
  {
    id: 'uat',
    category: 'final_pre_release',
    severity: 'critical',
    titleEn: 'User Acceptance Testing (UAT)',
    titleFa: 'تست پذیرش کاربر (Acceptance Testing)',
    descriptionEn: 'Confirms deliverables meet the project goals, acceptance criteria, and zero-blocker release rules.',
    descriptionFa: 'تطبیق نهایی محصول با اهداف پروژه و تایید آمادگی کامل برای انتشار عمومی.',
  },
];

export function evaluatePrelaunchGate(params: {
  id: string;
  workflowId: string;
  workflowName: string;
  strictMode: boolean;
  targetScope: string;
  durationMs: number;
  results: PrelaunchTestResult[];
  createdAt?: string;
}): PrelaunchTestReport {
  const { id, workflowId, workflowName, strictMode, targetScope, durationMs, results } = params;
  const totalTests = results.length;
  const passedCount = results.filter((r) => r.status === 'pass').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const failedCount = results.filter((r) => r.status === 'fail').length;

  const overallScore =
    totalTests > 0
      ? Math.round(results.reduce((acc, item) => acc + Math.max(0, Math.min(100, item.score)), 0) / totalTests)
      : 0;

  const hasCriticalFailure = results.some(
    (r) => r.status === 'fail' && (strictMode || r.severity === 'critical'),
  );
  const hasAnyFailureInStrict = strictMode && failedCount > 0;
  const gateStatus: PrelaunchTestReport['gateStatus'] =
    hasCriticalFailure || hasAnyFailureInStrict || (strictMode && overallScore < 75)
      ? 'blocked'
      : 'approved';

  return {
    id,
    workflowId,
    workflowName,
    strictMode,
    gateStatus,
    overallScore,
    passedCount,
    warnCount,
    failedCount,
    totalTests,
    durationMs,
    targetScope,
    results,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function buildPrelaunchFixPrompt(params: {
  report: PrelaunchTestReport;
  lang: 'en' | 'fa';
}): string {
  const { report, lang } = params;
  const issues = report.results.filter((r) => r.status !== 'pass');
  if (issues.length === 0) {
    return lang === 'fa'
      ? `تمامی ۱۴ تست سخت پیش از لانچ برای پروژه «${report.workflowName}» با امتیاز ${report.overallScore}٪ پاس شدند.`
      : `All 14 pre-launch strict checks passed (${report.overallScore}%) for "${report.workflowName}".`;
  }

  const defMap = new Map(PRELAUNCH_TEST_DEFINITIONS.map((d) => [d.id, d]));
  const lines = issues.map((item, idx) => {
    const def = defMap.get(item.id);
    const title = lang === 'fa' ? def?.titleFa ?? item.id : def?.titleEn ?? item.id;
    const summary = lang === 'fa' ? item.summaryFa : item.summaryEn;
    const rec = lang === 'fa' ? item.recommendationFa : item.recommendationEn;
    const badge = item.status.toUpperCase();
    return `${idx + 1}. [${badge}] ${title}: ${summary}${rec ? ` | Fix: ${rec}` : ''}`;
  });

  if (lang === 'fa') {
    return [
      `گزارش «تست سخت قبل از لانچ نهایی» برای پروژه «${report.workflowName}» (امتیاز ${report.overallScore}٪ - وضعیت: ${report.gateStatus === 'blocked' ? 'مسدود' : 'تایید مشروط'}):`,
      `موارد نیازمند اصلاح یا بررسی:`,
      ...lines,
      `لطفاً هر ایجنت در بخش تخصصی خود موارد خطا و هشدار بالا را برطرف کند، فایل‌ها را با WRITE_FILE به‌روزرسانی کند و تست‌های لازم را اجرا نماید تا گیت لانچ تایید شود.`,
    ].join('\n');
  }

  return [
    `Strict Pre-Launch Final Test Gate Report for "${report.workflowName}" (Score: ${report.overallScore}%, Gate: ${report.gateStatus.toUpperCase()}):`,
    `Items requiring remediation:`,
    ...lines,
    `Each domain specialist should resolve these failures/warnings, update files via WRITE_FILE, and verify fixes before final launch.`,
  ].join('\n');
}

export function suggestAgentRoleForPrelaunchTest(testId: PrelaunchTestId): AgentRole {
  switch (testId) {
    case 'security':
    case 'regression':
    case 'alpha':
      return 'security_qa';
    case 'usability':
    case 'compatibility':
      return 'frontend';
    case 'unit':
    case 'integration':
    case 'performance':
      return 'backend';
    case 'stress':
    case 'smoke':
    case 'beta':
    case 'system':
      return 'executor';
    case 'uat':
    case 'functional':
    default:
      return 'manager';
  }
}

export function scanSourceSecurityIssues(
  files: Array<{ path: string; content: string }>,
): Array<{ file: string; issue: string; severity: 'critical' | 'high' }> {
  const findings: Array<{ file: string; issue: string; severity: 'critical' | 'high' }> = [];

  const rules: Array<{ pattern: RegExp; issue: string; severity: 'critical' | 'high' }> = [
    {
      pattern: /\bAIzaSy[A-Za-z0-9_-]{25,}\b/,
      issue: 'Hardcoded Google/Gemini API key literal detected in source',
      severity: 'critical',
    },
    {
      pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/,
      issue: 'Hardcoded OpenAI/Anthropic secret key literal detected in source',
      severity: 'critical',
    },
    {
      pattern: /\bgh[ps]_[A-Za-z0-9]{25,}\b/,
      issue: 'Hardcoded GitHub token detected in source',
      severity: 'critical',
    },
    {
      pattern: /\beval\s*\(/,
      issue: 'Unsafe eval() execution pattern detected',
      severity: 'high',
    },
    {
      pattern: /dangerouslySetInnerHTML\s*=/,
      issue: 'Potential XSS risk via dangerouslySetInnerHTML',
      severity: 'high',
    },
  ];

  for (const file of files) {
    if (
      file.path.endsWith('.test.ts') ||
      file.path.endsWith('.test.tsx') ||
      file.path.includes('prelaunchTests.ts') ||
      file.path.includes('secretUtils')
    ) {
      continue;
    }
    for (const rule of rules) {
      const match = rule.pattern.exec(file.content);
      if (match) {
        const matchedText = match[0] ?? '';
        // Ignore obvious dummy UI placeholders like ghp_xxxxxxxxxxxx... or sk-000000000000...
        if (/(.)\1{9,}/.test(matchedText)) {
          continue;
        }
        findings.push({
          file: file.path,
          issue: rule.issue,
          severity: rule.severity,
        });
      }
    }
  }

  return findings;
}

export function findMissingWorkflowCoverage(workflow: WorkflowConfig): string[] {
  const issues: string[] = [];
  if (workflow.nodes.length === 0) {
    issues.push('Workflow has zero agent nodes.');
    return issues;
  }
  const hasManager = workflow.nodes.some((n) => n.data.role === 'manager');
  if (!hasManager) {
    issues.push('No Manager supervisor node assigned to audit deliverables.');
  }
  const missingPrompts = workflow.nodes.filter((n) => !n.data.systemPrompt?.trim());
  if (missingPrompts.length > 0) {
    issues.push(`${missingPrompts.length} agent(s) are missing a system prompt.`);
  }
  return issues;
}
