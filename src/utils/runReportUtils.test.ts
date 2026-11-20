import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunChangeReport, detectConversationLanguage } from './runReportUtils';
import type { BugReportItem, ExecutionEvent, FileDiffEntry } from '../types/workflow';

test('detectConversationLanguage detects Persian conversation even when UI fallback is English', () => {
  const lang = detectConversationLanguage({
    taskPrompt: 'سلام، لطفاً سرویس احراز هویت و تست واحد را اضافه کن',
    events: [
      {
        id: 'e1',
        runId: 'run-1',
        type: 'user_message',
        round: 1,
        content: 'سلام، فایل سرویس را ویرایش کن',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
    fallbackLanguage: 'en',
  });
  assert.equal(lang, 'fa');
});

test('detectConversationLanguage detects English conversation even when UI fallback is Persian', () => {
  const lang = detectConversationLanguage({
    taskPrompt: 'Add rate limiting middleware to server/routes.ts',
    events: [
      {
        id: 'e1',
        runId: 'run-2',
        type: 'user_message',
        round: 1,
        content: 'Please implement and test the rate limiter',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'e2',
        runId: 'run-2',
        type: 'agent_message',
        round: 1,
        agentName: 'Backend Agent',
        content: 'Implemented the rate limiting module in server/rateLimiter.ts.',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ],
    fallbackLanguage: 'fa',
  });
  assert.equal(lang, 'en');
});

test('buildRunChangeReport produces complete Persian report with file attributions, commands, and bugs', () => {
  const events: ExecutionEvent[] = [
    {
      id: 'u1',
      runId: 'run-fa',
      type: 'user_message',
      round: 1,
      content: 'فایل app/auth.ts را ایجاد کن و تست‌ها را اجرا کن',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'a1',
      runId: 'run-fa',
      type: 'agent_message',
      round: 1,
      agentId: 'n-backend',
      agentName: 'Backend Agent',
      role: 'backend',
      content: 'فایل احراز هویت ایجاد شد.',
      toolCalls: [
        {
          id: 'tc-1',
          tool: 'write_file',
          target: 'app/auth.ts',
          result: 'Wrote 120 bytes',
          exitCode: 0,
        },
      ],
      timestamp: '2026-01-01T00:00:02.000Z',
    },
    {
      id: 'a2',
      runId: 'run-fa',
      type: 'agent_message',
      round: 2,
      agentId: 'n-exec',
      agentName: 'Executor Agent',
      role: 'executor',
      content: 'تست اجرا شد.',
      toolCalls: [
        {
          id: 'tc-2',
          tool: 'exec_bash',
          target: 'node --test tests/auth.test.mjs',
          result: 'ok 1',
          exitCode: 0,
          approved: true,
        },
      ],
      timestamp: '2026-01-01T00:00:04.000Z',
    },
  ];

  const diffs: FileDiffEntry[] = [
    {
      path: 'app/auth.ts',
      status: 'added',
      additions: 5,
      deletions: 0,
      lines: [{ type: 'added', newLine: 1, text: 'export const ok = true;' }],
    },
    {
      path: 'README.md',
      status: 'modified',
      additions: 2,
      deletions: 1,
      lines: [
        { type: 'removed', oldLine: 1, text: 'old' },
        { type: 'added', newLine: 1, text: 'new' },
      ],
    },
  ];

  const bugs: BugReportItem[] = [
    {
      id: 'b-1',
      runId: 'run-fa',
      agentId: 'n-sec',
      agentName: 'Security & QA Agent',
      role: 'security_qa',
      category: 'improvement',
      severity: 'low',
      title: 'افزودن تست توکن منقضی‌شده',
      description: 'تست خطای انقضا اضافه شود',
      status: 'open',
      createdAt: '2026-01-01T00:00:05.000Z',
    },
  ];

  const report = buildRunChangeReport({
    runId: 'run-fa',
    workflowName: 'Auth Team',
    taskPrompt: 'فایل app/auth.ts را ایجاد کن',
    status: 'completed',
    roundsExecuted: 2,
    durationMs: 4200,
    events,
    diffs,
    bugReports: bugs,
    fallbackLanguage: 'en',
  });

  assert.equal(report.language, 'fa');
  assert.equal(report.stats.addedFiles, 1);
  assert.equal(report.stats.modifiedFiles, 1);
  assert.equal(report.stats.totalAdditions, 7);
  assert.equal(report.stats.totalDeletions, 1);
  assert.equal(report.stats.totalCommands, 1);
  assert.equal(report.stats.totalBugs, 1);
  assert.deepEqual(report.fileChanges[0].agents, ['Backend Agent']);
  assert.ok(report.summaryText.includes('گزارش کامل تغییرات اعمال‌شده'));
  assert.ok(report.summaryText.includes('app/auth.ts'));
  assert.ok(report.summaryText.includes('Backend Agent'));
  assert.ok(report.summaryText.includes('node --test tests/auth.test.mjs'));
  assert.ok(report.summaryText.includes('افزودن تست توکن منقضی‌شده'));
});

test('buildRunChangeReport produces English report when chat was in English', () => {
  const report = buildRunChangeReport({
    runId: 'run-en',
    workflowName: 'API Team',
    taskPrompt: 'Update README and add health endpoint',
    status: 'completed',
    roundsExecuted: 1,
    durationMs: 1500,
    events: [
      {
        id: 'u1',
        runId: 'run-en',
        type: 'user_message',
        round: 1,
        content: 'Update README',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
    diffs: [
      {
        path: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 0,
        lines: [{ type: 'added', newLine: 2, text: 'Health endpoint added' }],
      },
    ],
    fallbackLanguage: 'fa',
  });

  assert.equal(report.language, 'en');
  assert.ok(report.summaryText.includes('Complete Applied Changes Report'));
  assert.ok(report.summaryText.includes('[MODIFIED] README.md'));
});

test('buildRunChangeReport builds per-agent work reports with delegations, manager replies, and agent errors', () => {
  const events: ExecutionEvent[] = [
    {
      id: 'u1',
      runId: 'run-team-fa',
      type: 'user_message',
      round: 1,
      content: 'سرویس پرداخت را پیاده‌سازی و بررسی کن',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'm1',
      runId: 'run-team-fa',
      type: 'agent_message',
      round: 1,
      agentId: 'node-mgr',
      agentName: 'مدیر فنی',
      role: 'manager',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      durationMs: 650,
      content: 'معماری سرویس پرداخت مشخص شد و وظیفه به بک‌اند ارجاع داده شد.',
      timestamp: '2026-01-01T00:00:01.000Z',
    },
    {
      id: 'del-1',
      runId: 'run-team-fa',
      type: 'manager_delegation',
      round: 1,
      agentId: 'node-mgr',
      agentName: 'مدیر فنی',
      role: 'manager',
      delegation: {
        id: 'dlg-1',
        managerId: 'node-mgr',
        managerName: 'مدیر فنی',
        targetAgentId: 'node-be',
        targetAgentName: 'Backend Engineer',
        targetRole: 'backend',
        issue: 'اعتبارسنجی امضای وب‌هوک پرداخت',
        reason: 'نیاز به بررسی امضای HMAC در سرور',
        phase: 'review',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      content: 'Manager delegated to Backend Engineer',
      timestamp: '2026-01-01T00:00:02.000Z',
    },
    {
      id: 'be1',
      runId: 'run-team-fa',
      type: 'agent_message',
      round: 2,
      agentId: 'node-be',
      agentName: 'Backend Engineer',
      role: 'backend',
      provider: 'openai',
      model: 'gpt-4o',
      durationMs: 1200,
      replyingToManager: 'مدیر فنی',
      content: '@مدیر فنی اعتبارسنجی HMAC پیاده‌سازی شد و تست واحد پاس شد.',
      toolCalls: [
        { id: 'tc-1', tool: 'write_file', target: 'server/payment.ts', result: 'Wrote 400 bytes', exitCode: 0 },
      ],
      timestamp: '2026-01-01T00:00:04.000Z',
    },
    {
      id: 'err-1',
      runId: 'run-team-fa',
      type: 'agent_error',
      round: 2,
      agentId: 'node-qa',
      agentName: 'Security QA',
      role: 'security_qa',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      errorSource: 'config',
      content: 'Missing ANTHROPIC_API_KEY in Provider Vault',
      timestamp: '2026-01-01T00:00:05.000Z',
    },
  ];

  const report = buildRunChangeReport({
    runId: 'run-team-fa',
    workflowName: 'Payment Pipeline',
    taskPrompt: 'سرویس پرداخت را پیاده‌سازی و بررسی کن',
    status: 'completed',
    roundsExecuted: 2,
    durationMs: 5000,
    events,
    diffs: [],
    fallbackLanguage: 'en',
  });

  assert.equal(report.language, 'fa');
  assert.equal(report.stats.totalErrors, 1);
  assert.ok(Array.isArray(report.agentReports));
  assert.equal(report.agentReports!.length, 3);

  const mgrReport = report.agentReports!.find((r) => r.agentId === 'node-mgr');
  assert.ok(mgrReport);
  assert.equal(mgrReport!.delegationsIssued, 1);
  assert.equal(mgrReport!.status, 'completed');

  const beReport = report.agentReports!.find((r) => r.agentId === 'node-be');
  assert.ok(beReport);
  assert.equal(beReport!.delegationsReceived, 1);
  assert.equal(beReport!.repliedToManager, true);
  assert.deepEqual(beReport!.filesModified, ['server/payment.ts']);
  assert.equal(beReport!.status, 'completed');
  assert.ok(beReport!.workSummary.includes('پاسخ‌گویی مستقیم به مدیر'));

  const qaReport = report.agentReports!.find((r) => r.agentId === 'node-qa');
  assert.ok(qaReport);
  assert.equal(qaReport!.status, 'error');
  assert.equal(qaReport!.errors.length, 1);
  assert.ok(qaReport!.errors[0].includes('ANTHROPIC_API_KEY'));
  assert.ok(report.summaryText.includes('گزارش کار هر ایجنت'));
  assert.ok(report.summaryText.includes('Security QA'));
});

