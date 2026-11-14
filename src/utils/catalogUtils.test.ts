import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_SECTIONS, AGENT_SPECIALTY_PRESETS } from '../data/agentTemplates';
import {
  addProviderModel,
  createAgentNodesBatch,
  deleteAgentTemplate,
  deleteProviderModel,
  duplicateWorkflowNode,
  getEffectiveAgentTemplates,
  getEffectiveProviderModels,
  restoreDefaultAgentTemplates,
  restoreDefaultProviderModels,
  updateProviderModel,
  upsertCustomAgentTemplate,
} from './catalogUtils';
import { DEFAULT_APP_SETTINGS } from './workflowEngine';

test('getEffectiveProviderModels supports adding, editing, deleting, and restoring built-in & custom models', () => {
  let cfg = { ...DEFAULT_APP_SETTINGS.providers.openai };
  const initial = getEffectiveProviderModels('openai', cfg);
  assert.ok(initial.some((m) => m.id === 'gpt-4o'));
  assert.ok(initial.some((m) => m.id === 'o3-mini'));

  // Add a custom model with ultra power
  cfg = addProviderModel('openai', cfg, 'gpt-5-codex', 'ultra', 'GPT-5 Codex');
  const afterAdd = getEffectiveProviderModels('openai', cfg);
  const added = afterAdd.find((m) => m.id === 'gpt-5-codex');
  assert.ok(added);
  assert.equal(added.power, 'ultra');
  assert.equal(added.displayName, 'GPT-5 Codex');

  // Edit a built-in model ID and power tier
  cfg = updateProviderModel('openai', cfg, 'gpt-4o', {
    id: 'gpt-4o-enterprise',
    displayName: 'GPT-4o Enterprise',
    power: 'ultra',
  });
  const afterEdit = getEffectiveProviderModels('openai', cfg);
  assert.equal(afterEdit.some((m) => m.id === 'gpt-4o'), false);
  assert.equal(cfg.defaultModel, 'gpt-4o-enterprise');
  assert.equal(afterEdit.find((m) => m.id === 'gpt-4o-enterprise')?.power, 'ultra');

  // Delete a built-in model (o3-mini) and custom model
  cfg = deleteProviderModel('openai', cfg, 'o3-mini');
  cfg = deleteProviderModel('openai', cfg, 'gpt-5-codex');
  const afterDelete = getEffectiveProviderModels('openai', cfg);
  assert.equal(afterDelete.some((m) => m.id === 'o3-mini'), false);
  assert.equal(afterDelete.some((m) => m.id === 'gpt-5-codex'), false);

  // Restore built-in defaults
  cfg = restoreDefaultProviderModels('openai', cfg);
  const restored = getEffectiveProviderModels('openai', cfg);
  assert.ok(restored.some((m) => m.id === 'o3-mini'));
  assert.ok(restored.some((m) => m.id === 'gpt-4o'));
});

test('agent template catalog supports editing built-ins, adding custom roles, deleting, and restoring', () => {
  let settings = { ...DEFAULT_APP_SETTINGS };
  const initial = getEffectiveAgentTemplates(settings);
  assert.equal(initial.length, 7);

  // Add custom template
  settings = upsertCustomAgentTemplate(settings, {
    id: 'tpl-db-lead',
    role: 'custom',
    title: 'Database Lead',
    subtitle: 'Owns SQL migrations and query tuning',
    section: 'Database & Storage',
    positionTitle: 'Principal DBA',
    responsibility: 'Optimize schemas, indexes, and zero-downtime migrations',
    powerLevel: 'pro',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.15,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt: 'You are Principal DBA.',
  });
  assert.equal(getEffectiveAgentTemplates(settings).length, 8);

  // Delete a built-in template
  settings = deleteAgentTemplate(settings, 'tpl-executor');
  const afterDel = getEffectiveAgentTemplates(settings);
  assert.equal(afterDel.some((t) => t.id === 'tpl-executor'), false);
  assert.equal(afterDel.length, 7);

  // Restore defaults
  settings = restoreDefaultAgentTemplates(settings);
  const afterRestore = getEffectiveAgentTemplates(settings);
  assert.ok(afterRestore.some((t) => t.id === 'tpl-executor'));
  assert.ok(afterRestore.some((t) => t.id === 'tpl-db-lead'));
});

test('AGENT_SECTIONS and AGENT_SPECIALTY_PRESETS cover all 20 engineering departments with bilingual presets', () => {
  assert.equal(AGENT_SECTIONS.length, 20);
  assert.ok(AGENT_SPECIALTY_PRESETS.length >= 25);

  const sectionIds = new Set(AGENT_SECTIONS.map((s) => s.id));
  for (const preset of AGENT_SPECIALTY_PRESETS) {
    assert.ok(
      sectionIds.has(preset.section),
      `Specialty ${preset.id} references unknown section ${preset.section}`,
    );
    assert.ok(preset.enTitle.length > 0 && preset.faTitle.length > 0);
    assert.ok(preset.enPosition.length > 0 && preset.faPosition.length > 0);
    assert.ok(preset.systemPrompt.length > 20);
  }
});

test('createAgentNodesBatch and duplicateWorkflowNode scale agent counts with section, position, and power', () => {
  const managerNode = {
    id: 'node-mgr',
    type: 'agentNode' as const,
    position: { x: 40, y: 100 },
    data: {
      label: 'Manager Agent',
      role: 'manager' as const,
      provider: 'gemini' as const,
      model: 'gemini-4-hydrogen',
      envSecretRef: 'GEMINI_API_KEY',
      temperature: 0.2,
      systemPrompt: 'Manage',
      tools: { readFile: true, writeFile: false, execBash: false },
    },
  };

  const batch = createAgentNodesBatch({
    count: 3,
    baseLabel: 'API Worker',
    role: 'backend',
    section: 'Backend & API',
    positionTitle: 'Senior Payment Engineer',
    responsibility: 'Implement idempotent payment webhooks',
    powerLevel: 'pro',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.2,
    systemPrompt: '',
    tools: { readFile: true, writeFile: true, execBash: false },
    existingNodes: [managerNode],
    existingEdges: [],
    appSettings: DEFAULT_APP_SETTINGS,
    autoConnect: true,
  });

  assert.equal(batch.nodesToAdd.length, 3);
  assert.equal(batch.edgesToAdd.length, 3);
  assert.equal(batch.nodesToAdd[0].data.label, 'API Worker 1');
  assert.equal(batch.nodesToAdd[2].data.label, 'API Worker 3');
  assert.equal(batch.nodesToAdd[0].data.section, 'Backend & API');
  assert.equal(batch.nodesToAdd[0].data.positionTitle, 'Senior Payment Engineer');
  assert.equal(batch.nodesToAdd[0].data.powerLevel, 'pro');

  const cloned = duplicateWorkflowNode(batch.nodesToAdd[0], [managerNode, ...batch.nodesToAdd]);
  assert.equal(cloned.data.label, 'API Worker 4');
  assert.equal(cloned.data.section, 'Backend & API');
  assert.equal(cloned.data.powerLevel, 'pro');
});
