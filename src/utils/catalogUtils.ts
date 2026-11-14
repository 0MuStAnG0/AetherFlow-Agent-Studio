import {
  AGENT_ROLE_TEMPLATES,
  POWER_LEVEL_META,
  PROVIDER_MODELS,
  type AgentRoleTemplate,
} from '../data/agentTemplates';
import type {
  AgentNodeData,
  AgentPowerLevel,
  AgentRole,
  AppSettings,
  CustomAgentTemplate,
  LLMProvider,
  ProviderEndpointConfig,
  WorkflowEdge,
  WorkflowNode,
} from '../types/workflow';
import { clampTemperature, getDefaultEnvRef, isManagerNode } from './workflowEngine';

export interface EffectiveModelEntry {
  id: string;
  displayName?: string;
  power: AgentPowerLevel;
  isBuiltIn: boolean;
}

export function inferModelPowerTier(modelId: string): AgentPowerLevel {
  const lower = modelId.toLowerCase();
  if (/(o3|o1|r1|carbon|ultra|opus|70b|thinking|reason)/.test(lower)) {
    return 'ultra';
  }
  if (/(hydrogen|gpt-4\.1|gpt-4o|sonnet|pro|32b|big-pickle|40b|super)/.test(lower)) {
    return 'pro';
  }
  if (/(lite|mini|haiku|small|flash|lightning|nano|eco)/.test(lower)) {
    return 'eco';
  }
  return 'standard';
}

export function getEffectiveProviderModels(
  provider: LLMProvider,
  providerConfig?: ProviderEndpointConfig,
): EffectiveModelEntry[] {
  const builtInList = PROVIDER_MODELS[provider]?.models ?? [];
  const disabledSet = new Set(providerConfig?.disabledModels ?? []);
  const customList = providerConfig?.customModels ?? [];
  const metaMap = providerConfig?.modelMeta ?? {};

  const seen = new Set<string>();
  const result: EffectiveModelEntry[] = [];

  for (const id of builtInList) {
    if (disabledSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    const meta = metaMap[id];
    result.push({
      id,
      displayName: meta?.displayName,
      power: meta?.power ?? inferModelPowerTier(id),
      isBuiltIn: true,
    });
  }

  for (const rawId of customList) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const meta = metaMap[id];
    result.push({
      id,
      displayName: meta?.displayName,
      power: meta?.power ?? inferModelPowerTier(id),
      isBuiltIn: false,
    });
  }

  return result;
}

export function addProviderModel(
  provider: LLMProvider,
  cfg: ProviderEndpointConfig,
  rawModelId: string,
  power?: AgentPowerLevel,
  displayName?: string,
): ProviderEndpointConfig {
  const modelId = rawModelId.trim();
  if (!modelId) return cfg;

  const builtInSet = new Set(PROVIDER_MODELS[provider]?.models ?? []);
  const nextDisabled = (cfg.disabledModels ?? []).filter((m) => m !== modelId);
  const nextCustom = builtInSet.has(modelId)
    ? cfg.customModels
    : cfg.customModels.includes(modelId)
      ? cfg.customModels
      : [...cfg.customModels, modelId];

  const nextMeta = { ...(cfg.modelMeta ?? {}) };
  if (power || displayName?.trim()) {
    nextMeta[modelId] = {
      ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
      ...(power ? { power } : {}),
    };
  }

  return {
    ...cfg,
    customModels: nextCustom,
    disabledModels: nextDisabled,
    modelMeta: nextMeta,
  };
}

export function updateProviderModel(
  provider: LLMProvider,
  cfg: ProviderEndpointConfig,
  oldModelId: string,
  next: { id: string; displayName?: string; power?: AgentPowerLevel },
): ProviderEndpointConfig {
  const nextId = next.id.trim();
  if (!nextId) return cfg;

  const builtInSet = new Set(PROVIDER_MODELS[provider]?.models ?? []);
  let nextDisabled = [...(cfg.disabledModels ?? [])];
  let nextCustom = [...cfg.customModels];
  const nextMeta = { ...(cfg.modelMeta ?? {}) };

  if (nextId !== oldModelId) {
    if (builtInSet.has(oldModelId) && !nextDisabled.includes(oldModelId)) {
      nextDisabled.push(oldModelId);
    }
    nextCustom = nextCustom.filter((m) => m !== oldModelId);
    if (builtInSet.has(nextId)) {
      nextDisabled = nextDisabled.filter((m) => m !== nextId);
    } else if (!nextCustom.includes(nextId)) {
      nextCustom.push(nextId);
    }
    delete nextMeta[oldModelId];
  }

  const cleanName = next.displayName?.trim();
  if (cleanName || next.power) {
    nextMeta[nextId] = {
      ...(cleanName ? { displayName: cleanName } : {}),
      ...(next.power ? { power: next.power } : {}),
    };
  } else {
    delete nextMeta[nextId];
  }

  const nextDefault = cfg.defaultModel === oldModelId ? nextId : cfg.defaultModel;

  return {
    ...cfg,
    defaultModel: nextDefault,
    customModels: nextCustom,
    disabledModels: nextDisabled,
    modelMeta: nextMeta,
  };
}

export function deleteProviderModel(
  provider: LLMProvider,
  cfg: ProviderEndpointConfig,
  modelId: string,
): ProviderEndpointConfig {
  const builtInSet = new Set(PROVIDER_MODELS[provider]?.models ?? []);
  const nextDisabled = builtInSet.has(modelId)
    ? Array.from(new Set([...(cfg.disabledModels ?? []), modelId]))
    : cfg.disabledModels ?? [];
  const nextCustom = cfg.customModels.filter((m) => m !== modelId);
  const nextMeta = { ...(cfg.modelMeta ?? {}) };
  delete nextMeta[modelId];

  const updatedCfg: ProviderEndpointConfig = {
    ...cfg,
    customModels: nextCustom,
    disabledModels: nextDisabled,
    modelMeta: nextMeta,
  };

  if (cfg.defaultModel === modelId) {
    const remaining = getEffectiveProviderModels(provider, updatedCfg);
    updatedCfg.defaultModel = remaining[0]?.id ?? '';
  }

  return updatedCfg;
}

export function restoreDefaultProviderModels(
  provider: LLMProvider,
  cfg: ProviderEndpointConfig,
): ProviderEndpointConfig {
  const builtIn = PROVIDER_MODELS[provider]?.models ?? [];
  return {
    ...cfg,
    disabledModels: [],
    defaultModel: cfg.defaultModel || builtIn[0] || '',
  };
}

export function getEffectiveAgentTemplates(settings?: AppSettings): AgentRoleTemplate[] {
  const hidden = new Set(settings?.hiddenTemplateIds ?? []);
  const customList = settings?.customTemplates ?? [];
  const customById = new Map<string, CustomAgentTemplate>(
    customList.map((tpl) => [tpl.id, tpl]),
  );

  const merged: AgentRoleTemplate[] = [];
  const seen = new Set<string>();

  for (const builtIn of AGENT_ROLE_TEMPLATES) {
    if (hidden.has(builtIn.id)) continue;
    seen.add(builtIn.id);
    const override = customById.get(builtIn.id);
    if (override) {
      merged.push({
        id: override.id,
        role: override.role,
        title: override.title,
        subtitle: override.subtitle,
        section: override.section ?? builtIn.section,
        positionTitle: override.positionTitle ?? builtIn.positionTitle,
        responsibility: override.responsibility ?? builtIn.responsibility,
        powerLevel: override.powerLevel ?? builtIn.powerLevel,
        defaultProvider: override.defaultProvider,
        defaultModel: override.defaultModel,
        defaultTemperature: override.defaultTemperature,
        defaultTools: { ...override.defaultTools },
        systemPrompt: override.systemPrompt,
      });
    } else {
      merged.push(builtIn);
    }
  }

  for (const tpl of customList) {
    if (seen.has(tpl.id) || hidden.has(tpl.id)) continue;
    seen.add(tpl.id);
    merged.push({
      id: tpl.id,
      role: tpl.role,
      title: tpl.title,
      subtitle: tpl.subtitle,
      section: tpl.section || 'General',
      positionTitle: tpl.positionTitle || tpl.title,
      responsibility: tpl.responsibility || tpl.subtitle,
      powerLevel: tpl.powerLevel || 'standard',
      defaultProvider: tpl.defaultProvider,
      defaultModel: tpl.defaultModel,
      defaultTemperature: tpl.defaultTemperature,
      defaultTools: { ...tpl.defaultTools },
      systemPrompt: tpl.systemPrompt,
    });
  }

  return merged;
}

export function upsertCustomAgentTemplate(
  settings: AppSettings,
  template: CustomAgentTemplate,
): AppSettings {
  const existing = settings.customTemplates ?? [];
  const nextTemplates = existing.some((t) => t.id === template.id)
    ? existing.map((t) => (t.id === template.id ? template : t))
    : [...existing, template];

  return {
    ...settings,
    customTemplates: nextTemplates,
    hiddenTemplateIds: (settings.hiddenTemplateIds ?? []).filter((id) => id !== template.id),
  };
}

export function deleteAgentTemplate(settings: AppSettings, templateId: string): AppSettings {
  const isBuiltIn = AGENT_ROLE_TEMPLATES.some((t) => t.id === templateId);
  return {
    ...settings,
    customTemplates: (settings.customTemplates ?? []).filter((t) => t.id !== templateId),
    hiddenTemplateIds: isBuiltIn
      ? Array.from(new Set([...(settings.hiddenTemplateIds ?? []), templateId]))
      : settings.hiddenTemplateIds ?? [],
  };
}

export function restoreDefaultAgentTemplates(settings: AppSettings): AppSettings {
  const builtInIds = new Set(AGENT_ROLE_TEMPLATES.map((t) => t.id));
  return {
    ...settings,
    hiddenTemplateIds: [],
    customTemplates: (settings.customTemplates ?? []).filter((t) => !builtInIds.has(t.id)),
  };
}

export function duplicateWorkflowNode(
  sourceNode: WorkflowNode,
  existingNodes: WorkflowNode[],
): WorkflowNode {
  const baseName = sourceNode.data.label.replace(/\s+#?\d+$/, '').trim() || sourceNode.data.label;
  let counter = 2;
  const usedLabels = new Set(existingNodes.map((n) => n.data.label.toLowerCase()));
  while (usedLabels.has(`${baseName} ${counter}`.toLowerCase())) {
    counter += 1;
  }

  return {
    id: `node-${sourceNode.data.role}-${Date.now().toString(36).slice(-4)}-${existingNodes.length + 1}`,
    type: 'agentNode',
    position: {
      x: sourceNode.position.x + 48,
      y: sourceNode.position.y + 150,
    },
    data: {
      ...sourceNode.data,
      label: `${baseName} ${counter}`,
      tools: { ...sourceNode.data.tools },
      status: 'idle',
    },
  };
}

export interface CreateAgentBatchParams {
  count: number;
  baseLabel: string;
  role: AgentRole;
  section: string;
  positionTitle: string;
  responsibility: string;
  powerLevel: AgentPowerLevel;
  provider: LLMProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  tools: AgentNodeData['tools'];
  existingNodes: WorkflowNode[];
  existingEdges: WorkflowEdge[];
  appSettings?: AppSettings;
  autoConnect?: boolean;
}

export function createAgentNodesBatch(params: CreateAgentBatchParams): {
  nodesToAdd: WorkflowNode[];
  edgesToAdd: WorkflowEdge[];
} {
  const safeCount = Math.max(1, Math.min(10, Math.round(params.count || 1)));
  const nodesToAdd: WorkflowNode[] = [];
  const edgesToAdd: WorkflowEdge[] = [];

  const maxY =
    params.existingNodes.length > 0
      ? Math.max(...params.existingNodes.map((n) => n.position.y)) + 190
      : 80;
  const baseX =
    params.role === 'manager'
      ? 60
      : params.role === 'security_qa'
        ? 660
        : params.role === 'executor'
          ? 940
          : 340;

  const envSecretRef =
    params.appSettings?.providers[params.provider]?.envVarName ||
    getDefaultEnvRef(params.provider);

  const managerNode = params.existingNodes.find((n) => isManagerNode(n));
  const powerDirective = POWER_LEVEL_META[params.powerLevel]?.directive ?? '';
  const enrichedPrompt = params.systemPrompt.trim()
    ? params.systemPrompt.trim()
    : `You are ${params.positionTitle || params.baseLabel} in the ${params.section} department. Your core responsibility: ${params.responsibility}. ${powerDirective}`.trim();

  const usedLabels = new Set(params.existingNodes.map((n) => n.data.label.toLowerCase()));
  const stamp = Date.now().toString(36).slice(-4);

  for (let i = 0; i < safeCount; i++) {
    let label = safeCount === 1 ? params.baseLabel.trim() : `${params.baseLabel.trim()} ${i + 1}`;
    if (usedLabels.has(label.toLowerCase())) {
      let suffix = i + 2;
      while (usedLabels.has(`${params.baseLabel.trim()} ${suffix}`.toLowerCase())) {
        suffix += 1;
      }
      label = `${params.baseLabel.trim()} ${suffix}`;
    }
    usedLabels.add(label.toLowerCase());

    const nodeId = `node-${params.role}-${stamp}-${i + 1}`;
    const node: WorkflowNode = {
      id: nodeId,
      type: 'agentNode',
      position: {
        x: baseX + (i % 2) * 280,
        y: maxY + Math.floor(i / 2) * 185,
      },
      data: {
        label,
        role: params.role,
        section: params.section.trim() || undefined,
        positionTitle: params.positionTitle.trim() || undefined,
        responsibility: params.responsibility.trim() || undefined,
        powerLevel: params.powerLevel,
        provider: params.provider,
        model: params.model,
        envSecretRef,
        temperature: clampTemperature(params.temperature),
        systemPrompt: enrichedPrompt,
        tools: { ...params.tools },
        status: 'idle',
      },
    };
    nodesToAdd.push(node);

    if (params.autoConnect && managerNode && managerNode.id !== node.id) {
      edgesToAdd.push({
        id: `e-${managerNode.id}-${node.id}`,
        source: managerNode.id,
        target: node.id,
        label: params.section.trim() || 'Delegate',
      });
    }
  }

  return { nodesToAdd, edgesToAdd };
}
