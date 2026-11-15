import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRELAUNCH_CATEGORIES,
  PRELAUNCH_TEST_DEFINITIONS,
  buildPrelaunchFixPrompt,
  evaluatePrelaunchGate,
  scanSourceSecurityIssues,
  suggestAgentRoleForPrelaunchTest,
} from './prelaunchTests';
import type { PrelaunchTestResult } from '../types/workflow';

test('prelaunch suite covers all 4 categories and 14 required test types', () => {
  assert.equal(PRELAUNCH_CATEGORIES.length, 4);
  assert.equal(PRELAUNCH_TEST_DEFINITIONS.length, 14);

  const ids = new Set(PRELAUNCH_TEST_DEFINITIONS.map((d) => d.id));
  for (const required of [
    'unit',
    'integration',
    'system',
    'functional',
    'performance',
    'stress',
    'security',
    'usability',
    'compatibility',
    'regression',
    'smoke',
    'alpha',
    'beta',
    'uat',
  ] as const) {
    assert.equal(ids.has(required), true, `Missing prelaunch test definition: ${required}`);
    assert.ok(suggestAgentRoleForPrelaunchTest(required));
  }
});

test('evaluatePrelaunchGate blocks release when strict mode sees failures or low score', () => {
  const results: PrelaunchTestResult[] = PRELAUNCH_TEST_DEFINITIONS.map((def, idx) => ({
    id: def.id,
    category: def.category,
    severity: def.severity,
    status: idx === 0 ? 'fail' : 'pass',
    score: idx === 0 ? 20 : 95,
    durationMs: 12,
    summaryEn: idx === 0 ? 'Unit tests failed' : 'Passed cleanly',
    summaryFa: idx === 0 ? 'تست واحد خطا داشت' : 'با موفقیت پاس شد',
    evidence: ['check executed'],
  }));

  const report = evaluatePrelaunchGate({
    id: 'rep-1',
    workflowId: 'wf-1',
    workflowName: 'Production App',
    strictMode: true,
    targetScope: 'workspace',
    durationMs: 250,
    results,
  });

  assert.equal(report.gateStatus, 'blocked');
  assert.equal(report.failedCount, 1);
  assert.equal(report.passedCount, 13);

  const faPrompt = buildPrelaunchFixPrompt({ report, lang: 'fa' });
  assert.match(faPrompt, /تست واحد/);
  assert.match(faPrompt, /مسدود/);
});

test('evaluatePrelaunchGate approves release when all checks pass or only non-critical warnings exist', () => {
  const results: PrelaunchTestResult[] = PRELAUNCH_TEST_DEFINITIONS.map((def, idx) => ({
    id: def.id,
    category: def.category,
    severity: def.severity,
    status: idx === 4 ? 'warn' : 'pass',
    score: idx === 4 ? 80 : 100,
    durationMs: 10,
    summaryEn: 'OK',
    summaryFa: 'تایید',
    evidence: ['verified'],
  }));

  const report = evaluatePrelaunchGate({
    id: 'rep-2',
    workflowId: 'wf-1',
    workflowName: 'Production App',
    strictMode: true,
    targetScope: 'workspace',
    durationMs: 180,
    results,
  });

  assert.equal(report.gateStatus, 'approved');
  assert.equal(report.warnCount, 1);
  assert.equal(report.failedCount, 0);
  assert.ok(report.overallScore >= 95);
});

test('scanSourceSecurityIssues detects hardcoded keys and unsafe patterns while ignoring test files and dummy placeholders', () => {
  const issues = scanSourceSecurityIssues([
    { path: 'src/bad.ts', content: 'const k = "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456";' },
    { path: 'src/xss.tsx', content: '<div dangerouslySetInnerHTML={{ __html: html }} />' },
    { path: 'src/placeholder.tsx', content: 'placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"' },
    { path: 'src/ok.test.ts', content: 'const k = "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456";' },
  ]);

  assert.equal(issues.length, 2);
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[1].severity, 'high');
});
