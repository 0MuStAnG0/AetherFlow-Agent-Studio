import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactSystemPrompt,
  compactCodeBlocksInMessage,
  compactConversationHistory,
  compactPromptText,
  compactSandboxOutput,
  estimateCharTokens,
  truncateMiddle,
} from './promptOptimizer';
import type { WorkflowNode } from '../types/workflow';

function makeAgentNode(overrides: Partial<WorkflowNode['data']> = {}): WorkflowNode {
  return {
    id: 'agent-1',
    type: 'agentNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Backend Architect',
      role: 'backend',
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      powerLevel: 'standard',
      envSecretRef: 'GEMINI_API_KEY',
      temperature: 0.2,
      systemPrompt:
        'You are the senior backend engineer responsible for API security, SQLite persistence, and clean TypeScript validation.',
      tools: { readFile: true, writeFile: true, execBash: true },
      ...overrides,
    },
  };
}

test('estimateCharTokens and truncateMiddle bound text length cleanly', () => {
  assert.equal(estimateCharTokens(''), 0);
  assert.equal(estimateCharTokens('abcd'), 1);
  assert.equal(estimateCharTokens('abcdefgh'), 2);

  const long = 'HEAD '.repeat(40) + 'TAIL '.repeat(40);
  const trimmed = truncateMiddle(long, 120);
  assert.ok(trimmed.length <= 125);
  assert.ok(trimmed.includes('...[trimmed]...'));
  assert.ok(trimmed.startsWith('HEAD'));
  assert.ok(trimmed.endsWith('TAIL'));
});

test('compactCodeBlocksInMessage collapses bulky WRITE_FILE and fenced blocks', () => {
  const bulkyLines = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  const msg =
    `Implemented auth service.\n` +
    `WRITE_FILE:src/auth.ts\n\`\`\`ts\n${bulkyLines}\n\`\`\`\n` +
    `Also checked tests:\n\`\`\`bash\n${bulkyLines}\n\`\`\``;

  const compacted = compactCodeBlocksInMessage(msg, 3);
  assert.ok(compacted.includes('[wrote src/auth.ts (30 lines)]'));
  assert.ok(compacted.includes('[bash block omitted (30 lines); use read_file if needed]'));
  assert.ok(compacted.length < msg.length * 0.35);

  const tinyMsg = `WRITE_FILE:src/tiny.ts\n\`\`\`ts\nconst ok = true;\n\`\`\``;
  assert.ok(compactCodeBlocksInMessage(tinyMsg, 3).includes('const ok = true;'));
});

test('compactSandboxOutput trims redundant blank lines and caps middle', () => {
  const noisy = Array.from({ length: 40 }, (_, i) => `line-${i} test output\n\n`).join('');
  const compact = compactSandboxOutput(noisy, 160);
  assert.ok(compact.length <= 165);
  assert.ok(!compact.includes('\n\n'));
});

test('compactConversationHistory pins memory/task anchors, slides window, and cuts tokens >= 40%', () => {
  const bigCode = Array.from({ length: 35 }, (_, i) => `const row_${i} = ${i};`).join('\n');
  const history = [
    { role: 'memory', content: '[WORKFLOW MEMORY FROM PRIOR RUNS]\n- Last: auth middleware' },
    { role: 'user', content: 'Build JWT login endpoint and add unit tests.' },
    { role: 'Manager', content: `Planning architecture...\n\`\`\`ts\n${bigCode}\n\`\`\`` },
    { role: 'Backend', content: `WRITE_FILE:src/jwt.ts\n\`\`\`ts\n${bigCode}\n\`\`\`` },
    { role: 'sandbox', content: Array.from({ length: 20 }, (_, i) => `PASS test #${i}`).join('\n') },
    { role: 'Frontend', content: `WRITE_FILE:src/Login.tsx\n\`\`\`tsx\n${bigCode}\n\`\`\`` },
    { role: 'Security & QA', content: `Audited routes.\n\`\`\`ts\n${bigCode}\n\`\`\`` },
    { role: 'Executor', content: 'Tests passing: 18/18.' },
    { role: 'user', content: 'Now verify refresh token rotation.' },
  ];

  const ultra = compactConversationHistory(history, { mode: 'ultra_compact' });
  assert.ok(ultra.savedTokens > 0);
  assert.ok(ultra.optimizedEstimatedTokens <= ultra.rawEstimatedTokens * 0.55);
  assert.equal(ultra.messages[0].role, 'memory');
  assert.equal(ultra.messages[1].role, 'user');
  assert.ok(ultra.messages.some((m) => m.role === 'context' && m.content.includes('omitted')));
  assert.equal(ultra.messages[ultra.messages.length - 1].content, 'Now verify refresh token rotation.');

  const off = compactConversationHistory(history, { mode: 'off' });
  assert.equal(off.savedTokens, 0);
  assert.equal(off.messages.length, history.length);
});

test('buildCompactSystemPrompt omits prose tool syntax when native tools active and preserves rules', () => {
  const mgr = makeAgentNode({ label: 'Lead Manager', role: 'manager' });
  const nativeCompact = buildCompactSystemPrompt({
    node: mgr,
    mode: 'ultra_compact',
    nativeToolsEnabled: true,
    isManager: true,
    isGroupDiscussion: true,
    teammates: ['Backend', 'Frontend', 'QA'],
    delegationPhase: 'test',
  });

  assert.ok(nativeCompact.systemPrompt.includes('use native read_file/write_file/exec_bash'));
  assert.ok(!nativeCompact.systemPrompt.includes('WRITE_FILE:<path>+```code```'));
  assert.ok(nativeCompact.systemPrompt.includes('delegate_agent'));
  assert.ok(nativeCompact.systemPrompt.includes('report_bug'));
  assert.ok(nativeCompact.systemPrompt.includes('under 140 words'));
  assert.ok(nativeCompact.savedTokens > 50);

  const fallbackCompact = buildCompactSystemPrompt({
    node: makeAgentNode({ provider: 'ollama', model: 'ollama/qwen2.5-coder:32b' }),
    mode: 'ultra_compact',
    nativeToolsEnabled: false,
    isManager: false,
  });
  assert.ok(fallbackCompact.systemPrompt.includes('WRITE_FILE:<path>'));
  assert.ok(fallbackCompact.systemPrompt.includes('BUG_REPORT:'));
  assert.ok(compactPromptText(fallbackCompact.systemPrompt).length > 40);
});

test('compactConversationHistory preserves latest Manager directive when Manager turn falls out of recent window', () => {
  const history = [
    { role: 'user', content: 'Build payment webhook verification.' },
    { role: 'Manager Lead', content: 'Directive: Use HMAC-SHA256 with raw body buffer and return 401 on mismatch.' },
    { role: 'Backend', content: 'Drafted initial route.' },
    { role: 'Frontend', content: 'Added webhook settings UI.' },
    { role: 'QA', content: 'Checking signature replay window.' },
    { role: 'Executor', content: 'Ran integration tests.' },
    { role: 'Security', content: 'Verified constant-time comparison.' },
    { role: 'user', content: 'Please finalize the fix.' },
  ];

  const ultra = compactConversationHistory(history, { mode: 'ultra_compact' });
  const contextEntry = ultra.messages.find((m) => m.role === 'context');
  assert.ok(contextEntry, 'Expected omitted context marker');
  assert.ok(
    contextEntry!.content.includes('HMAC-SHA256'),
    `Expected Manager directive carryover in context marker, got: ${contextEntry!.content}`,
  );
});

test('buildCompactSystemPrompt injects activeManagerAssignment and human-like Manager reply guidance', () => {
  const backend = makeAgentNode({ label: 'Backend Engineer', role: 'backend' });
  const built = buildCompactSystemPrompt({
    node: backend,
    mode: 'ultra_compact',
    nativeToolsEnabled: true,
    isManager: false,
    managerName: 'مدیر فنی پروژه',
    activeAssignment: {
      managerName: 'مدیر فنی پروژه',
      issue: 'Validate refresh token signature expiry',
      reason: 'Unit test failed with 500 on expired token',
      phase: 'test',
    },
  });

  assert.ok(built.systemPrompt.includes('مدیر فنی پروژه'));
  assert.ok(built.systemPrompt.includes('Validate refresh token signature expiry'));
  assert.ok(built.systemPrompt.includes('Unit test failed with 500 on expired token'));
});

