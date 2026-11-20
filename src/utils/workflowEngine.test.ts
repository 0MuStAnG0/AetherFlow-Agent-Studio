import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagerInspectionContext,
  buildStructuredAgentPrompt,
  buildWorkflowMemorySnapshot,
  buildWorkflowShareUrl,
  clampContinuousIntervalSec,
  clampMaxRounds,
  clampTemperature,
  computeExecutionOrder,
  computeParallelFanoutTargets,
  decodeWorkflowFromShareParam,
  detectSensitiveCommand,
  estimateTokenUsage,
  evaluateEdgeCondition,
  extractBugReportsFromReply,
  extractFreeOpenCodeModels,
  extractManagerDelegations,
  findDomainSpecialistNode,
  findManagerNode,
  getDefaultEdgeLabelForCondition,
  isManagerNode,
  normalizeAppSettings,
  orderGroupChatParticipants,
  parseImportedWorkflowJson,
  selectNextSpeaker,
  serializeWorkflowForExport,
  syncWorkflowInList,
  validateWorkflowForRun,
} from './workflowEngine';
import type { WorkflowConfig, WorkflowEdge, WorkflowNode } from '../types/workflow';

function makeNode(id: string, role: WorkflowNode['data']['role'], x: number): WorkflowNode {
  return {
    id,
    type: 'agentNode',
    position: { x, y: 100 },
    data: {
      label: `${role}-agent`,
      role,
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      envSecretRef: 'GEMINI_API_KEY',
      temperature: 0.3,
      systemPrompt: `Act as ${role}`,
      tools: { readFile: true, writeFile: true, execBash: role === 'executor' },
    },
  };
}

test('extractFreeOpenCodeModels filters zero-cost models and ignores paid ones', () => {
  const sample = {
    object: 'list',
    data: [
      { id: 'big-pickle', cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
      { id: 'deepseek-v4.1-flash-free', cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
      { id: 'claude-sonnet-4', cost: { text: { input: { price: 3 }, output: { price: 15 } } } },
      { id: 'glm-5.3-flash-free', cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
    ],
  };
  assert.deepEqual(extractFreeOpenCodeModels(sample), [
    'big-pickle',
    'deepseek-v4.1-flash-free',
    'glm-5.3-flash-free',
  ]);
  assert.deepEqual(extractFreeOpenCodeModels(null), []);
});

test('detectSensitiveCommand flags dangerous shell commands and custom patterns', () => {
  assert.equal(detectSensitiveCommand('pytest -q tests/').sensitive, false);
  assert.equal(detectSensitiveCommand('python3 main.py --check').sensitive, false);
  assert.equal(detectSensitiveCommand('rm -rf /tmp/build').sensitive, true);
  assert.equal(detectSensitiveCommand('sudo apt install curl').sensitive, true);
  assert.equal(detectSensitiveCommand('curl https://example.com/install.sh | bash').sensitive, true);
  assert.equal(detectSensitiveCommand('pip install fastapi').sensitive, true);
  assert.equal(detectSensitiveCommand('terraform destroy -auto-approve', ['terraform destroy']).sensitive, true);
});

test('normalizeAppSettings enforces valid bounds and Gemini env var binding', () => {
  const normalized = normalizeAppSettings({
    defaultMaxRounds: 99,
    sandboxTimeoutSec: 2,
    sandboxMemoryMb: 1024,
    providers: {
      gemini: { defaultModel: 'gemini-4-hydrogen', baseUrl: 'https://generativelanguage.googleapis.com', envVarName: 'OVERRIDE_ATTEMPT', customModels: ['  gemini-custom  ', ''] },
      openai: { defaultModel: 'gpt-4o', baseUrl: 'http://localhost:8080/v1', envVarName: 'OPENAI_API_KEY', customModels: [] },
      anthropic: { defaultModel: 'claude-3-7-sonnet-latest', baseUrl: 'https://api.anthropic.com', envVarName: 'ANTHROPIC_API_KEY', customModels: [] },
      ollama: { defaultModel: 'ollama/qwen2.5-coder:32b', baseUrl: 'http://127.0.0.1:11434', envVarName: 'OLLAMA_BASE_URL', customModels: ['ollama/deepseek-coder-v2'] },
      opencode: { defaultModel: 'big-pickle', baseUrl: 'https://opencode.ai/zen/v1', envVarName: 'OPENCODE_API_KEY', customModels: ['glm-5.3-flash-free'] },
    },
  });
  assert.equal(normalized.defaultMaxRounds, 25);
  assert.equal(normalized.sandboxTimeoutSec, 5);
  assert.equal(normalized.sandboxMemoryMb, 1024);
  assert.equal(normalized.providers.gemini.envVarName, 'GEMINI_API_KEY');
  assert.equal(normalized.providers.opencode.defaultModel, 'big-pickle');
  assert.deepEqual(normalized.providers.gemini.customModels, ['gemini-custom']);
  assert.equal(normalized.tokenOptimizationMode, 'ultra_compact');
  assert.equal(
    normalizeAppSettings({ tokenOptimizationMode: 'balanced' }).tokenOptimizationMode,
    'balanced',
  );
});

test('clampMaxRounds and clampTemperature enforce safe bounds', () => {
  assert.equal(clampMaxRounds(0), 1);
  assert.equal(clampMaxRounds(50), 25);
  assert.equal(clampMaxRounds(8), 8);
  assert.equal(clampTemperature(-0.5), 0);
  assert.equal(clampTemperature(1.8), 1);
  assert.equal(clampTemperature(0.456), 0.46);
});

test('computeExecutionOrder places manager first and resolves DAG with feedback cycle', () => {
  const nodes = [
    makeNode('exec', 'executor', 700),
    makeNode('be', 'backend', 350),
    makeNode('mgr', 'manager', 50),
  ];
  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'mgr', target: 'be' },
    { id: 'e2', source: 'be', target: 'exec' },
    { id: 'e3', source: 'exec', target: 'be' },
  ];

  const ordered = computeExecutionOrder(nodes, edges);
  assert.equal(ordered[0].id, 'mgr');
  assert.equal(ordered.length, 3);
  assert.ok(ordered.some((n) => n.id === 'be'));
  assert.ok(ordered.some((n) => n.id === 'exec'));
});

test('selectNextSpeaker enforces maxRounds and routes along edges', () => {
  const mgr = makeNode('mgr', 'manager', 50);
  const be = makeNode('be', 'backend', 300);
  const qa = makeNode('qa', 'security_qa', 550);
  const ordered = [mgr, be, qa];
  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'mgr', target: 'be' },
    { id: 'e2', source: 'be', target: 'qa' },
  ];

  const step0 = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: null,
    roundIndex: 0,
    maxRounds: 4,
  });
  assert.equal(step0.node?.id, 'mgr');

  const step1 = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'mgr',
    roundIndex: 1,
    maxRounds: 4,
  });
  assert.equal(step1.node?.id, 'be');

  const stopped = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'be',
    roundIndex: 4,
    maxRounds: 4,
  });
  assert.equal(stopped.node, null);
});

test('validateWorkflowForRun rejects empty task prompts or missing nodes', () => {
  const validWorkflow: WorkflowConfig = {
    id: 'wf-1',
    name: 'Test Pipeline',
    description: 'Pipeline',
    maxRounds: 6,
    humanInTheLoop: true,
    nodes: [makeNode('mgr', 'manager', 0)],
    edges: [],
    updatedAt: new Date().toISOString(),
  };

  const emptyTaskResult = validateWorkflowForRun(validWorkflow, '   ');
  assert.equal(emptyTaskResult.valid, false);
  assert.equal(emptyTaskResult.errors.length, 1);

  const okResult = validateWorkflowForRun(validWorkflow, 'Build an auth endpoint');
  assert.equal(okResult.valid, true);
});

test('buildStructuredAgentPrompt converts plain instructions into role-aware prompts', () => {
  const be = makeNode('be', 'backend', 200);
  assert.equal(buildStructuredAgentPrompt({ rawInstruction: '   ' }), '');

  const enPrompt = buildStructuredAgentPrompt({
    rawInstruction: 'build a login endpoint with rate limit',
    targetNode: be,
    language: 'en',
  });
  assert.ok(enPrompt.includes('backend-agent (backend)'));
  assert.ok(enPrompt.includes('WRITE_FILE:'));
  assert.ok(enPrompt.includes('build a login endpoint with rate limit'));

  const faPrompt = buildStructuredAgentPrompt({
    rawInstruction: 'یک فرم لاگین امن بساز',
    targetNode: be,
    language: 'fa',
  });
  assert.ok(faPrompt.includes('مخاطب: backend-agent (backend)'));
  assert.ok(faPrompt.includes('یک فرم لاگین امن بساز'));
});

test('orderGroupChatParticipants prioritizes unique specialist roles before duplicates', () => {
  const nodes = [
    makeNode('mgr1', 'manager', 50),
    makeNode('mgr2', 'manager', 90),
    makeNode('be1', 'backend', 200),
    makeNode('qa1', 'security_qa', 400),
  ];
  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'mgr1', target: 'be1' },
    { id: 'e2', source: 'be1', target: 'qa1' },
  ];
  const ordered = orderGroupChatParticipants(nodes, edges);
  assert.deepEqual(
    ordered.slice(0, 3).map((n) => n.data.role),
    ['manager', 'backend', 'security_qa'],
  );
  assert.equal(ordered[3].id, 'mgr2');
});

test('extractBugReportsFromReply parses structured BUG_REPORT blocks and strips raw JSON', () => {
  const sample = `بررسی کد انجام شد.\n\nBUG_REPORT: {"category":"bug","severity":"high","title":"Missing rate limit","description":"Endpoint lacks request throttling.","suggestedFix":"Add slowapi limiter"}\n\nلطفاً بررسی کنید.`;
  const parsed = extractBugReportsFromReply(sample, {
    runId: 'run-1',
    workflowId: 'wf-1',
    agentId: 'node-security',
    agentName: 'Security & QA Agent',
    role: 'security_qa',
  });
  assert.equal(parsed.reports.length, 1);
  assert.equal(parsed.reports[0].category, 'bug');
  assert.equal(parsed.reports[0].severity, 'high');
  assert.equal(parsed.reports[0].title, 'Missing rate limit');
  assert.ok(!parsed.cleanedReply.includes('BUG_REPORT:'));
  assert.ok(parsed.cleanedReply.includes('بررسی کد انجام شد.'));
});

test('isManagerNode recognizes Persian مدیر title and extractManagerDelegations resolves domain agent', () => {
  const customManager = makeNode('node-persian-mgr', 'custom', 300);
  customManager.data.label = 'مدیر فنی پروژه';
  const backend = makeNode('node-be', 'backend', 100);
  const security = makeNode('node-sec', 'security_qa', 200);
  const nodes = [backend, customManager, security];

  assert.equal(isManagerNode(customManager), true);
  assert.equal(isManagerNode(backend), false);
  assert.equal(findManagerNode(nodes)?.id, 'node-persian-mgr');

  const ordered = computeExecutionOrder(nodes, []);
  assert.equal(ordered[0].id, 'node-persian-mgr');

  const reply =
    `بررسی خروجی تست انجام شد و خطا در اعتبارسنجی بک‌اند دیده شد.\n` +
    `DELEGATE: {"targetRole":"backend","issue":"Validation error on empty payload","reason":"Fix payload schema check in app/service.mjs"}`;
  const parsed = extractManagerDelegations(reply, customManager, nodes, 'test');
  assert.equal(parsed.delegations.length, 1);
  assert.equal(parsed.delegations[0].targetAgentId, 'node-be');
  assert.equal(parsed.delegations[0].targetRole, 'backend');
  assert.equal(parsed.delegations[0].phase, 'test');
  assert.ok(!parsed.cleanedReply.includes('DELEGATE:'));
});

test('buildManagerInspectionContext flags failing tool exit codes and open bugs', () => {
  const ctx = buildManagerInspectionContext({
    sandboxFiles: [{ path: 'app/service.mjs', content: 'export const x = 1;', size: 19, updatedAt: '' }],
    toolCalls: [{ id: 'tc1', tool: 'exec_bash', target: 'node --test', result: 'AssertionError', exitCode: 1 }],
    openBugs: [
      {
        id: 'b1',
        agentId: 'node-sec',
        agentName: 'Security & QA Agent',
        role: 'security_qa',
        category: 'bug',
        severity: 'high',
        title: 'Input length unbounded',
        description: 'Missing maxLength',
        status: 'open',
        createdAt: '',
      },
    ],
  });
  assert.equal(ctx.hasIssues, true);
  assert.equal(ctx.failingTools.length, 1);
  assert.equal(ctx.openBugsByRole[0].role, 'security_qa');
  assert.ok(ctx.summaryText.includes('FAIL exit=1'));
});

test('serializeWorkflowForExport, parseImportedWorkflowJson, and share URL round-trip Unicode workflows', () => {
  const mgr = makeNode('mgr', 'manager', 40);
  mgr.data.label = 'مدیر کنترل کیفیت';
  const be = makeNode('be', 'backend', 340);
  const wf: WorkflowConfig = {
    id: 'wf-vcs-1',
    name: 'خط لوله هوشمند تولید API',
    description: 'Version-controlled multi-agent pipeline',
    maxRounds: 8,
    humanInTheLoop: true,
    nodes: [mgr, be],
    edges: [{ id: 'e-1', source: 'mgr', target: 'be', label: 'Spec' }],
    updatedAt: '2026-11-14T00:00:00.000Z',
  };

  const json = serializeWorkflowForExport(wf);
  const parsed = parseImportedWorkflowJson(json);
  assert.ok(parsed.workflow);
  assert.equal(parsed.workflow!.name, wf.name);
  assert.equal(parsed.workflow!.nodes[0].data.label, 'مدیر کنترل کیفیت');
  assert.equal(parsed.workflow!.edges.length, 1);

  const shareUrl = buildWorkflowShareUrl('http://localhost:3000/', wf);
  const token = new URL(shareUrl).searchParams.get('wf');
  assert.ok(token);
  const decoded = decodeWorkflowFromShareParam(token!);
  assert.ok(decoded);
  assert.equal(decoded!.id, wf.id);
  assert.equal(decoded!.nodes[0].data.label, 'مدیر کنترل کیفیت');
  assert.equal(decoded!.edges[0].label, 'Spec');

  const rawEnvelope = JSON.parse(json) as { schemaVersion: string; workflow: WorkflowConfig };
  assert.equal(rawEnvelope.schemaVersion, '1.0');
  assert.equal(rawEnvelope.workflow.nodes[0].data.status, 'idle');
  assert.equal(parseImportedWorkflowJson('{bad json').workflow, null);
  assert.equal(decodeWorkflowFromShareParam('invalid@@@'), null);
});

test('syncWorkflowInList keeps active node permission edits synced and preserves continuousAgentWork', () => {
  const mgr = makeNode('mgr', 'manager', 40);
  mgr.data.powerLevel = 'ultra';
  mgr.data.section = 'Architecture';
  mgr.data.tools.execBash = true;

  const baseWf: WorkflowConfig = {
    id: 'wf-sync-1',
    name: 'Sync Project',
    description: 'Continuous build project',
    maxRounds: 8,
    humanInTheLoop: true,
    continuousAgentWork: true,
    continuousIntervalSec: 45,
    strictPrelaunchGate: true,
    nodes: [mgr],
    edges: [],
    updatedAt: '2026-11-15T00:00:00.000Z',
  };

  const modifiedWf: WorkflowConfig = {
    ...baseWf,
    nodes: [
      {
        ...mgr,
        data: {
          ...mgr.data,
          tools: { readFile: true, writeFile: false, execBash: true },
        },
      },
    ],
  };

  const synced = syncWorkflowInList([baseWf], modifiedWf);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].nodes[0].data.tools.execBash, true);
  assert.equal(synced[0].nodes[0].data.tools.writeFile, false);
  assert.equal(clampContinuousIntervalSec(2), 5);
  assert.equal(clampContinuousIntervalSec(7200), 3600);

  const parsed = parseImportedWorkflowJson(serializeWorkflowForExport(modifiedWf));
  assert.equal(parsed.workflow?.continuousAgentWork, true);
  assert.equal(parsed.workflow?.continuousIntervalSec, 45);
  assert.equal(parsed.workflow?.strictPrelaunchGate, true);
  assert.equal(parsed.workflow?.nodes[0].data.powerLevel, 'ultra');
  assert.equal(parsed.workflow?.nodes[0].data.section, 'Architecture');
  assert.equal(parsed.workflow?.nodes[0].data.tools.execBash, true);
});

test('evaluateEdgeCondition and selectNextSpeaker route conditionally on success, failure, and keyword match', () => {
  const be = makeNode('be', 'backend', 100);
  const qa = makeNode('qa', 'security_qa', 300);
  const mgr = makeNode('mgr', 'manager', 500);
  const fe = makeNode('fe', 'frontend', 700);
  const ordered = [be, qa, mgr, fe];
  const edges: WorkflowEdge[] = [
    { id: 'e-ok', source: 'be', target: 'qa', conditionType: 'on_success' },
    { id: 'e-err', source: 'be', target: 'mgr', conditionType: 'on_failure' },
    { id: 'e-kw', source: 'qa', target: 'fe', conditionType: 'when_contains', conditionValue: 'READY_FOR_UI' },
  ];

  assert.equal(evaluateEdgeCondition(edges[0], { lastTurnHadError: false }), true);
  assert.equal(evaluateEdgeCondition(edges[0], { lastTurnHadError: true }), false);
  assert.equal(evaluateEdgeCondition(edges[1], { lastTurnHadError: true }), true);
  assert.equal(evaluateEdgeCondition(edges[2], { lastReply: 'Checks passed. READY_FOR_UI now.' }), true);
  assert.equal(evaluateEdgeCondition(edges[2], { lastReply: 'Still investigating bugs.' }), false);

  const okRoute = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'be',
    roundIndex: 1,
    maxRounds: 6,
    lastTurnHadError: false,
  });
  assert.equal(okRoute.node?.id, 'qa');

  const failRoute = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'be',
    roundIndex: 1,
    maxRounds: 6,
    lastTurnHadError: true,
  });
  assert.equal(failRoute.node?.id, 'mgr');

  const kwRoute = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'qa',
    roundIndex: 2,
    maxRounds: 6,
    lastReply: 'ready_for_ui confirmed',
  });
  assert.equal(kwRoute.node?.id, 'fe');
  assert.equal(getDefaultEdgeLabelForCondition('when_contains', 'DEPLOY'), 'If "DEPLOY"');
});

test('buildWorkflowMemorySnapshot and estimateTokenUsage summarize cross-run state cleanly', () => {
  assert.equal(
    buildWorkflowMemorySnapshot({ priorRuns: [], openBugs: [], workspaceFiles: [] }),
    '',
  );

  const mem = buildWorkflowMemorySnapshot({
    priorRuns: [
      {
        taskPrompt: 'Build rate limiter middleware',
        status: 'completed',
        summary: 'Implemented token bucket limiter in src/rateLimit.ts',
        createdAt: '2026-11-15T01:00:00.000Z',
      },
    ],
    openBugs: [
      {
        id: 'bug-1',
        agentId: 'qa',
        agentName: 'Security & QA',
        role: 'security_qa',
        category: 'bug',
        severity: 'high',
        title: 'Missing max header check',
        description: 'Validate X-Forwarded-For cleanly',
        status: 'open',
        createdAt: '2026-11-15T01:05:00.000Z',
      },
    ],
    workspaceFiles: [{ path: 'src/rateLimit.ts', size: 420 }],
  });

  assert.ok(mem.includes('[WORKFLOW MEMORY FROM PRIOR RUNS]'));
  assert.ok(mem.includes('Build rate limiter middleware'));
  assert.ok(mem.includes('Missing max header check'));
  assert.ok(mem.includes('src/rateLimit.ts'));

  const usage = estimateTokenUsage('abcdefgh', '1234');
  assert.equal(usage.promptTokens, 2);
  assert.equal(usage.completionTokens, 1);
  assert.equal(usage.totalTokens, 3);
  assert.equal(usage.estimated, true);
});

test('serializeWorkflowForExport preserves edge conditions and strips webhookSecret', () => {
  const mgr = makeNode('mgr', 'manager', 50);
  const be = makeNode('be', 'backend', 300);
  const wf: WorkflowConfig = {
    id: 'wf-sec-edge',
    name: 'Webhook Edge Flow',
    description: 'Conditional + webhook workflow',
    maxRounds: 6,
    humanInTheLoop: true,
    memoryEnabled: false,
    webhookEnabled: true,
    webhookSecret: 'super-secret-token-should-not-leak',
    nodes: [mgr, be],
    edges: [
      {
        id: 'e-cond',
        source: 'mgr',
        target: 'be',
        label: 'If API',
        conditionType: 'when_contains',
        conditionValue: 'API',
      },
    ],
    updatedAt: '2026-11-15T00:00:00.000Z',
  };

  const exported = serializeWorkflowForExport(wf);
  assert.ok(!exported.includes('super-secret-token-should-not-leak'));
  const parsed = parseImportedWorkflowJson(exported);
  assert.equal(parsed.workflow?.memoryEnabled, false);
  assert.equal(parsed.workflow?.webhookEnabled, true);
  assert.equal(parsed.workflow?.webhookSecret, undefined);
  assert.equal(parsed.workflow?.edges[0].conditionType, 'when_contains');
  assert.equal(parsed.workflow?.edges[0].conditionValue, 'API');
});

test('computeParallelFanoutTargets detects independent parallel branches vs dependent/linear edges', () => {
  const mgr = makeNode('mgr', 'manager', 50);
  const fe = makeNode('fe', 'frontend', 300);
  const be = makeNode('be', 'backend', 300);
  const qa = makeNode('qa', 'security_qa', 600);

  // Diamond: mgr -> fe, mgr -> be, fe -> qa, be -> qa
  const diamondEdges: WorkflowEdge[] = [
    { id: 'e1', source: 'mgr', target: 'fe', label: 'UI', conditionType: 'always' },
    { id: 'e2', source: 'mgr', target: 'be', label: 'API', conditionType: 'always' },
    { id: 'e3', source: 'fe', target: 'qa', label: 'QA', conditionType: 'always' },
    { id: 'e4', source: 'be', target: 'qa', label: 'QA', conditionType: 'always' },
  ];

  const ordered = [mgr, fe, be, qa];
  const targets = computeParallelFanoutTargets({
    orderedNodes: ordered,
    edges: diamondEdges,
    sourceNodeId: 'mgr',
    alreadyExecutedIds: new Set(['mgr']),
    lastTurnHadError: false,
    lastReply: 'Delegate both UI and API now',
  });
  assert.deepEqual(
    targets.map((n) => n.id),
    ['fe', 'be'],
  );

  // If fe depends on be (be -> fe), fe is filtered out so only 1 independent remains -> []
  const dependentEdges: WorkflowEdge[] = [
    ...diamondEdges,
    { id: 'e-dep', source: 'be', target: 'fe', label: 'After BE', conditionType: 'always' },
  ];
  const noFanout = computeParallelFanoutTargets({
    orderedNodes: ordered,
    edges: dependentEdges,
    sourceNodeId: 'mgr',
    alreadyExecutedIds: new Set(['mgr']),
  });
  assert.deepEqual(noFanout, []);

  // Conditional edge skipped when condition doesn't match -> only 1 matching target -> []
  const condEdges: WorkflowEdge[] = [
    { id: 'e1', source: 'mgr', target: 'fe', conditionType: 'always' },
    { id: 'e2', source: 'mgr', target: 'be', conditionType: 'on_failure' },
  ];
  const singleMatch = computeParallelFanoutTargets({
    orderedNodes: ordered,
    edges: condEdges,
    sourceNodeId: 'mgr',
    lastTurnHadError: false,
  });
  assert.deepEqual(singleMatch, []);
});

test('selectNextSpeaker honors requestedNextAgentId and findDomainSpecialistNode matches custom specialists', () => {
  const mgr = makeNode('mgr', 'manager', 50);
  const be = makeNode('be', 'backend', 250);
  const customDevOps = makeNode('node-devops', 'custom', 450);
  customDevOps.data.label = 'DevOps & Release Engineer';
  customDevOps.data.section = 'Cloud & CI/CD';
  customDevOps.data.positionTitle = 'Site Reliability Lead';
  customDevOps.data.responsibility = 'Docker, Kubernetes, deployment automation';

  const ordered = [mgr, be, customDevOps];
  const edges: WorkflowEdge[] = [{ id: 'e1', source: 'mgr', target: 'be' }];

  // Direct requestedNextAgentId overrides static edge order
  const delegatedStep = selectNextSpeaker({
    orderedNodes: ordered,
    edges,
    currentNodeId: 'mgr',
    roundIndex: 1,
    maxRounds: 6,
    requestedNextAgentId: 'node-devops',
  });
  assert.equal(delegatedStep.node?.id, 'node-devops');
  assert.ok(delegatedStep.reason.includes('DevOps & Release Engineer'));

  // Matching by exact id, label, section, and positionTitle
  assert.equal(findDomainSpecialistNode(ordered, 'node-devops', 'mgr')?.id, 'node-devops');
  assert.equal(findDomainSpecialistNode(ordered, 'DevOps & Release Engineer', 'mgr')?.id, 'node-devops');
  assert.equal(findDomainSpecialistNode(ordered, 'Cloud & CI/CD', 'mgr')?.id, 'node-devops');
  assert.equal(findDomainSpecialistNode(ordered, 'Site Reliability', 'mgr')?.id, 'node-devops');

  // extractManagerDelegations resolves targetAgent for custom specialists
  const reply =
    'بررسی زیرساخت انجام شد.\n' +
    'DELEGATE: {"targetRole":"custom","targetAgent":"DevOps & Release Engineer","issue":"Fix Dockerfile healthcheck","reason":"Container healthcheck returns 503"}';
  const parsed = extractManagerDelegations(reply, mgr, ordered, 'review');
  assert.equal(parsed.delegations.length, 1);
  assert.equal(parsed.delegations[0].targetAgentId, 'node-devops');
  assert.equal(parsed.delegations[0].targetAgentName, 'DevOps & Release Engineer');
  assert.equal(parsed.delegations[0].issue, 'Fix Dockerfile healthcheck');
});

