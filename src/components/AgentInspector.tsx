import { useEffect, useRef, useState } from 'react';
import { Trash2, Check, ShieldCheck, KeyRound, CopyPlus } from 'lucide-react';
import {
  AGENT_SECTIONS,
  AGENT_SPECIALTY_PRESETS,
  POWER_LEVEL_META,
} from '../data/agentTemplates';
import type {
  AgentNodeData,
  AgentPowerLevel,
  AgentRole,
  AppSettings,
  CapabilitiesState,
  LLMProvider,
  ProviderSecretStatus,
  WorkflowNode,
} from '../types/workflow';
import { getEffectiveProviderModels } from '../utils/catalogUtils';
import { normalizeSecretName } from '../utils/secretUtils';
import { clampTemperature, getDefaultEnvRef } from '../utils/workflowEngine';

interface AgentInspectorProps {
  node: WorkflowNode | null;
  lang?: 'en' | 'fa';
  appSettings?: AppSettings;
  capabilities?: CapabilitiesState;
  onCapabilitiesUpdated?: (next: CapabilitiesState) => void;
  onOpenSettings?: () => void;
  onUpdateNode: (nodeId: string, nextData: AgentNodeData) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

const ROLE_OPTIONS: Array<{ value: AgentRole; label: string }> = [
  { value: 'manager', label: 'Manager Agent' },
  { value: 'backend', label: 'Backend Agent' },
  { value: 'frontend', label: 'Frontend Agent' },
  { value: 'security_qa', label: 'Security & QA Agent' },
  { value: 'executor', label: 'Executor Agent' },
  { value: 'custom', label: 'Custom Agent' },
];

export function AgentInspector({
  node,
  lang = 'en',
  appSettings,
  capabilities,
  onCapabilitiesUpdated,
  onOpenSettings,
  onUpdateNode,
  onDuplicateNode,
  onDeleteNode,
}: AgentInspectorProps) {
  const [draft, setDraft] = useState<AgentNodeData | null>(node ? node.data : null);
  const [savedToast, setSavedToast] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [inlineApiKey, setInlineApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyStatusMsg, setKeyStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lastCommittedSigRef = useRef<string>('');
  const prevNodeIdRef = useRef<string | null>(node?.id ?? null);

  useEffect(() => {
    const incomingSig = node ? JSON.stringify(node.data) : '';
    const nodeChanged = (node?.id ?? null) !== prevNodeIdRef.current;
    if (nodeChanged) {
      prevNodeIdRef.current = node?.id ?? null;
      lastCommittedSigRef.current = incomingSig;
      setDraft(node ? { ...node.data, tools: { ...node.data.tools } } : null);
      setSavedToast(false);
      setShowKeyForm(false);
      setInlineApiKey('');
      setKeyStatusMsg(null);
      return;
    }
    if (node && incomingSig !== lastCommittedSigRef.current) {
      lastCommittedSigRef.current = incomingSig;
      setDraft({ ...node.data, tools: { ...node.data.tools } });
    } else if (!node) {
      lastCommittedSigRef.current = '';
      setDraft(null);
    }
  }, [node]);

  if (!node || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          {lang === 'fa' ? 'هیچ ایجنتی انتخاب نشده است' : 'No Agent Node Selected'}
        </h3>
        <p className="mt-2 max-w-xs text-sm text-slate-500 dark:text-slate-400">
          {lang === 'fa'
            ? 'روی یک نود در بوم کلیک کنید تا پست، بخش، قدرت، مدل هوش مصنوعی و دسترسی‌های آن را ویرایش یا حذف کنید.'
            : 'Click any node on the workflow canvas to inspect and customize its section, position, power tier, LLM model, and sandbox tools.'}
        </p>
      </div>
    );
  }

  const effectiveModels = getEffectiveProviderModels(
    draft.provider,
    appSettings?.providers[draft.provider],
  );
  const knownModelIds = effectiveModels.map((m) => m.id);
  const normalizedRef =
    normalizeSecretName(draft.envSecretRef || '') || getDefaultEnvRef(draft.provider);
  const secretsMap = capabilities?.secrets ?? {};
  const secretInfo: ProviderSecretStatus | undefined = secretsMap[normalizedRef];

  const commitDraft = (next: AgentNodeData, trimFields = false) => {
    setDraft(next);
    const cleanLabel = trimFields ? next.label.trim() : next.label;
    const cleanPrompt = trimFields ? next.systemPrompt.trim() : next.systemPrompt;
    if (!cleanLabel.trim() || !cleanPrompt.trim()) return;
    const ref = normalizeSecretName(next.envSecretRef || '') || getDefaultEnvRef(next.provider);
    const payload: AgentNodeData = {
      ...next,
      label: cleanLabel,
      section: trimFields ? next.section?.trim() || undefined : next.section,
      positionTitle: trimFields ? next.positionTitle?.trim() || undefined : next.positionTitle,
      responsibility: trimFields ? next.responsibility?.trim() || undefined : next.responsibility,
      powerLevel: next.powerLevel ?? 'standard',
      envSecretRef: ref,
      temperature: clampTemperature(next.temperature),
      tools: { ...next.tools },
    };
    lastCommittedSigRef.current = JSON.stringify(payload);
    onUpdateNode(node.id, payload);
  };

  const handleProviderChange = (provider: LLMProvider) => {
    const providerModels = getEffectiveProviderModels(provider, appSettings?.providers[provider]);
    const configuredDefault = appSettings?.providers[provider]?.defaultModel;
    commitDraft({
      ...draft,
      provider,
      model: configuredDefault || providerModels[0]?.id || '',
      envSecretRef: appSettings?.providers[provider]?.envVarName || getDefaultEnvRef(provider),
    });
  };

  const handleSaveInlineKey = async () => {
    const trimmed = inlineApiKey.trim();
    if (!trimmed) return;
    setSavingKey(true);
    setKeyStatusMsg(null);
    try {
      const res = await fetch('/api/provider-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretName: normalizedRef, apiKey: trimmed }),
      });
      const data = (await res.json()) as {
        error?: string;
        secret?: ProviderSecretStatus;
        capabilities?: CapabilitiesState;
      };
      if (!res.ok) {
        setKeyStatusMsg({ ok: false, text: data.error || 'Failed to save API key.' });
        return;
      }
      if (data.capabilities && onCapabilitiesUpdated) {
        onCapabilitiesUpdated(data.capabilities);
      }
      setInlineApiKey('');
      setShowKeyForm(false);
      setKeyStatusMsg({
        ok: true,
        text: `Saved ${normalizedRef} on server (${data.secret?.maskedHint ?? '••••'}).`,
      });
    } catch {
      setKeyStatusMsg({ ok: false, text: 'Network error saving key.' });
    } finally {
      setSavingKey(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim() || !draft.systemPrompt.trim()) return;
    commitDraft(draft, true);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  const knownSecretNames = Object.keys(secretsMap);
  const currentPower: AgentPowerLevel = draft.powerLevel ?? 'standard';

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Agent Configuration
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            Node ID: <span className="font-mono">{node.id}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onDuplicateNode && (
            <button
              type="button"
              data-testid="inspector-duplicate-node-btn"
              onClick={() => onDuplicateNode(node.id)}
              aria-label={`Duplicate ${draft.label}`}
              title="Add another agent with this configuration (+1)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <CopyPlus className="h-3.5 w-3.5" />
              +1
            </button>
          )}
          <button
            type="button"
            data-testid="inspector-delete-node-btn"
            onClick={() => onDeleteNode(node.id)}
            aria-label={`Delete ${draft.label}`}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="agent-name-input"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Agent Name
          </label>
          <input
            id="agent-name-input"
            type="text"
            required
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            onBlur={() => commitDraft(draft, true)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {(draft.role === 'manager' || /مدیر|manager/i.test(draft.label)) && (
            <p
              data-testid="manager-supervision-badge"
              className="mt-1.5 flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
            >
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span>
                Manager Supervision Active: Automatically inspects team outputs during Test &amp; Deploy and delegates domain issues to the right agent.
              </span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="agent-section-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              {lang === 'fa' ? 'بخش / دپارتمان' : 'Section / Department'}
            </label>
            <select
              id="agent-section-select"
              data-testid="inspector-section-select"
              value={AGENT_SECTIONS.some((s) => s.id === draft.section) ? draft.section : '__custom__'}
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  commitDraft({ ...draft, section: e.target.value });
                }
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {AGENT_SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {lang === 'fa' ? `${s.fa} (${s.en})` : `${s.en} — ${s.fa}`}
                </option>
              ))}
              <option value="__custom__">
                {lang === 'fa' ? 'دپارتمان سفارشی...' : 'Custom Department...'}
              </option>
            </select>
            <input
              id="agent-section-input"
              data-testid="inspector-section-input"
              list="agent-section-suggestions"
              type="text"
              value={draft.section ?? ''}
              onChange={(e) => setDraft({ ...draft, section: e.target.value })}
              onBlur={() => commitDraft(draft, true)}
              placeholder={lang === 'fa' ? 'مثلاً Database یا Payment' : 'e.g. Backend & API'}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <datalist id="agent-section-suggestions">
              {AGENT_SECTIONS.map((s) => (
                <option key={s.id} value={s.id} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor="agent-position-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              {lang === 'fa' ? 'پست و سمت' : 'Position / Post'}
            </label>
            <select
              data-testid="inspector-specialty-select"
              aria-label={lang === 'fa' ? 'انتخاب تخصص آماده' : 'Apply Specialty Preset'}
              value=""
              onChange={(e) => {
                const sp = AGENT_SPECIALTY_PRESETS.find((p) => p.id === e.target.value);
                if (!sp) return;
                commitDraft({
                  ...draft,
                  section: sp.section,
                  role: sp.role,
                  positionTitle: lang === 'fa' ? sp.faPosition : sp.enPosition,
                  responsibility: lang === 'fa' ? sp.faResponsibility : sp.enResponsibility,
                  powerLevel: sp.powerLevel,
                  systemPrompt: sp.systemPrompt,
                });
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">
                {lang === 'fa' ? 'اعمال تخصص آماده...' : 'Apply Specialty Preset...'}
              </option>
              {AGENT_SPECIALTY_PRESETS.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {lang === 'fa'
                    ? `[${sp.section}] ${sp.faTitle}`
                    : `[${sp.section}] ${sp.enTitle}`}
                </option>
              ))}
            </select>
            <input
              id="agent-position-input"
              data-testid="inspector-position-input"
              type="text"
              value={draft.positionTitle ?? ''}
              onChange={(e) => setDraft({ ...draft, positionTitle: e.target.value })}
              onBlur={() => commitDraft(draft, true)}
              placeholder={lang === 'fa' ? 'مثلاً معمار ارشد API' : 'e.g. Senior API Lead'}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="agent-responsibility-input"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            {lang === 'fa' ? 'مسئولیت در این پروژه' : 'Project Responsibility'}
          </label>
          <input
            id="agent-responsibility-input"
            data-testid="inspector-responsibility-input"
            type="text"
            value={draft.responsibility ?? ''}
            onChange={(e) => setDraft({ ...draft, responsibility: e.target.value })}
            onBlur={() => commitDraft(draft, true)}
            placeholder={
              lang === 'fa'
                ? 'شرح دقیق وظایف و مسئولیت این ایجنت...'
                : 'Specific tasks and ownership in this project...'
            }
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            {lang === 'fa' ? 'قدرت و سطح استدلال ایجنت' : 'Agent Power Tier'}
          </span>
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            {(['eco', 'standard', 'pro', 'ultra'] as AgentPowerLevel[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                data-testid={`inspector-power-${lvl}`}
                onClick={() =>
                  commitDraft({
                    ...draft,
                    powerLevel: lvl,
                    temperature: POWER_LEVEL_META[lvl].defaultTemp,
                  })
                }
                className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  currentPower === lvl
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                }`}
              >
                {POWER_LEVEL_META[lvl].short}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="agent-role-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Role Template
            </label>
            <select
              id="agent-role-select"
              value={draft.role}
              onChange={(e) => commitDraft({ ...draft, role: e.target.value as AgentRole })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="agent-provider-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              LLM Provider
            </label>
            <select
              id="agent-provider-select"
              value={draft.provider}
              onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="gemini">Google Gemini</option>
              <option value="opencode">OpenCode Zen (Free)</option>
              <option value="openai">OpenAI ChatGPT</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="ollama">Local Ollama</option>
            </select>
          </div>
        </div>

        <div>
          <label
            htmlFor="agent-model-select"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Model Identifier
          </label>
          <select
            id="agent-model-select"
            value={knownModelIds.includes(draft.model) ? draft.model : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                commitDraft({ ...draft, model: e.target.value });
              }
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {effectiveModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ? `${m.displayName} (${m.id})` : m.id} ·{' '}
                {POWER_LEVEL_META[m.power].short}
              </option>
            ))}
            <option value="__custom__">Custom Model ID...</option>
          </select>
          <input
            type="text"
            aria-label="Custom Model Name"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            onBlur={() => commitDraft(draft, true)}
            placeholder="Model identifier"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
        </div>

        {/* Server Secret Binding + Quick Vault Key Input */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="agent-secret-ref"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              <KeyRound className="h-3.5 w-3.5 text-blue-600" />
              <span>API Key Binding</span>
            </label>
            <span
              className={`font-mono text-[10px] font-medium ${
                secretInfo?.configured
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {secretInfo?.configured
                ? `Active (${secretInfo.maskedHint})`
                : draft.provider === 'ollama' || draft.provider === 'opencode'
                  ? 'Optional'
                  : 'Not set'}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              id="agent-secret-ref"
              list="known-secret-refs"
              type="text"
              value={draft.envSecretRef}
              onChange={(e) => setDraft({ ...draft, envSecretRef: e.target.value })}
              onBlur={() => commitDraft(draft, true)}
              placeholder={getDefaultEnvRef(draft.provider)}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <datalist id="known-secret-refs">
              {knownSecretNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button
              type="button"
              data-testid="inspector-toggle-key-btn"
              onClick={() => setShowKeyForm((v) => !v)}
              className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {secretInfo?.configured ? 'Update Key' : 'Add Key'}
            </button>
          </div>

          {showKeyForm && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="password"
                data-testid="inspector-api-key-input"
                autoComplete="new-password"
                value={inlineApiKey}
                onChange={(e) => setInlineApiKey(e.target.value)}
                placeholder={`Paste key for ${normalizedRef}...`}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                data-testid="inspector-save-key-btn"
                disabled={savingKey || !inlineApiKey.trim()}
                onClick={() => void handleSaveInlineKey()}
                className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600"
              >
                Save
              </button>
            </div>
          )}

          {keyStatusMsg && (
            <p
              className={`mt-1.5 text-[11px] font-medium ${
                keyStatusMsg.ok
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {keyStatusMsg.text}
            </p>
          )}

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="mt-1.5 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Manage all API keys in Settings →
            </button>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <label
              htmlFor="agent-temp-range"
              className="font-medium text-slate-700 dark:text-slate-300"
            >
              Temperature
            </label>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {draft.temperature.toFixed(2)}
            </span>
          </div>
          <input
            id="agent-temp-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => commitDraft({ ...draft, temperature: Number(e.target.value) })}
            className="mt-1 w-full accent-blue-600"
          />
        </div>

        <div>
          <label
            htmlFor="agent-system-prompt"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            System Prompt
          </label>
          <textarea
            id="agent-system-prompt"
            rows={4}
            required
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            onBlur={() => commitDraft(draft, true)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <fieldset className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <legend className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Sandbox Tool Permissions
          </legend>
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                data-testid="inspector-tool-readFile"
                checked={draft.tools.readFile}
                onChange={(e) =>
                  commitDraft({
                    ...draft,
                    tools: { ...draft.tools, readFile: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>Read Files (READ_FILE)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                data-testid="inspector-tool-writeFile"
                checked={draft.tools.writeFile}
                onChange={(e) =>
                  commitDraft({
                    ...draft,
                    tools: { ...draft.tools, writeFile: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>Write Files (WRITE_FILE)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                data-testid="inspector-tool-execBash"
                checked={draft.tools.execBash}
                onChange={(e) =>
                  commitDraft({
                    ...draft,
                    tools: { ...draft.tools, execBash: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>Execute Bash in Docker Sandbox (EXEC_BASH)</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
        >
          {savedToast ? (
            <>
              <Check className="h-4 w-4" />
              Node Updated
            </>
          ) : (
            'Apply Node Changes'
          )}
        </button>
      </div>
    </form>
  );
}
