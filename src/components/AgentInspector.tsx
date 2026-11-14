import { useEffect, useState } from 'react';
import { Trash2, Check, ShieldCheck } from 'lucide-react';
import { PROVIDER_MODELS } from '../data/agentTemplates';
import type {
  AgentNodeData,
  AgentRole,
  AppSettings,
  LLMProvider,
  WorkflowNode,
} from '../types/workflow';
import { clampTemperature, getDefaultEnvRef } from '../utils/workflowEngine';

interface AgentInspectorProps {
  node: WorkflowNode | null;
  appSettings?: AppSettings;
  onUpdateNode: (nodeId: string, nextData: AgentNodeData) => void;
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
  appSettings,
  onUpdateNode,
  onDeleteNode,
}: AgentInspectorProps) {
  const [draft, setDraft] = useState<AgentNodeData | null>(node ? node.data : null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    setDraft(node ? { ...node.data, tools: { ...node.data.tools } } : null);
    setSavedToast(false);
  }, [node]);

  if (!node || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          No Agent Node Selected
        </h3>
        <p className="mt-2 max-w-xs text-sm text-slate-500 dark:text-slate-400">
          Click any node on the workflow canvas to inspect and customize its LLM provider, temperature, system prompt, and sandbox tools.
        </p>
      </div>
    );
  }

  const providerInfo = PROVIDER_MODELS[draft.provider];
  const customModels = appSettings?.providers[draft.provider]?.customModels ?? [];
  const knownModels = Array.from(new Set([...providerInfo.models, ...customModels]));

  const handleProviderChange = (provider: LLMProvider) => {
    const info = PROVIDER_MODELS[provider];
    const configuredDefault = appSettings?.providers[provider]?.defaultModel;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            provider,
            model: configuredDefault || info.models[0],
            envSecretRef: appSettings?.providers[provider]?.envVarName || getDefaultEnvRef(provider),
          }
        : null,
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim() || !draft.systemPrompt.trim()) return;
    onUpdateNode(node.id, {
      ...draft,
      label: draft.label.trim(),
      temperature: clampTemperature(draft.temperature),
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Agent Configuration
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Node ID: <span className="font-mono">{node.id}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDeleteNode(node.id)}
          aria-label={`Delete ${draft.label}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </button>
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
              htmlFor="agent-role-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Role Template
            </label>
            <select
              id="agent-role-select"
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as AgentRole })}
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
            value={knownModels.includes(draft.model) ? draft.model : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setDraft({ ...draft, model: e.target.value });
              }
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {knownModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">Custom Model ID...</option>
          </select>
          <input
            type="text"
            aria-label="Custom Model Name"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="Model identifier"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Server Secret Binding: <span className="font-mono">{draft.envSecretRef}</span>
          </p>
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
            onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
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
                checked={draft.tools.readFile}
                onChange={(e) =>
                  setDraft({
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
                checked={draft.tools.writeFile}
                onChange={(e) =>
                  setDraft({
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
                checked={draft.tools.execBash}
                onChange={(e) =>
                  setDraft({
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
