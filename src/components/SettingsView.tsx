import { useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { PROVIDER_MODELS } from '../data/agentTemplates';
import type { AppSettings, LLMProvider } from '../types/workflow';
import { DEFAULT_APP_SETTINGS } from '../utils/workflowEngine';

interface SettingsViewProps {
  settings: AppSettings;
  capabilities: {
    geminiConfigured: boolean;
    openaiConfigured: boolean;
    anthropicConfigured: boolean;
    opencodeConfigured?: boolean;
  };
  onSaveSettings: (next: AppSettings) => Promise<void>;
}

const PROVIDER_ORDER: LLMProvider[] = ['gemini', 'opencode', 'openai', 'anthropic', 'ollama'];

const SETTINGS_COPY = {
  en: {
    title: 'Studio Settings & Capabilities',
    subtitle:
      'Configure LLM provider endpoints, custom model catalogs, sandbox tool permissions, Human-in-the-Loop guardrails, and canvas preferences.',
    save: 'Save Settings',
    saved: 'Settings Saved',
    reset: 'Reset Defaults',
    sectionProviders: 'LLM Providers, Endpoints & Model Definitions',
    sectionProvidersDesc:
      'API keys are injected server-side via environment secrets (Settings > Secrets or deploy/.env). Configure endpoint URLs, default models, and custom model IDs below.',
    sectionCapabilities: 'Global Capabilities & Sandbox Guardrails',
    sectionCapabilitiesDesc:
      'Control which sandbox tools agents can invoke globally, container execution budgets, and Human-in-the-Loop bash command rules.',
    sectionUi: 'Interface & Canvas Preferences',
    sectionUiDesc:
      'Customize studio language, color theme, default workflow limits, and React Flow canvas layout options.',
  },
  fa: {
    title: 'تنظیمات سیستم و مدیریت امکانات',
    subtitle:
      'پیکربندی آدرس سرویس‌دهنده‌های مدل هوش مصنوعی، تعریف مدل‌های سفارشی، مدیریت دسترسی ابزارهای سندباکس، قوانین تایید انسانی و تنظیمات ظاهری استودیو.',
    save: 'ذخیره تنظیمات',
    saved: 'تنظیمات ذخیره شد',
    reset: 'بازنشانی پیش‌فرض',
    sectionProviders: 'ارائه‌دهندگان LLM، آدرس سرویس‌ها و تعریف مدل‌ها',
    sectionProvidersDesc:
      'کلیدهای محرمانه از طریق متغیرهای محیطی سرور (Settings > Secrets یا فایل deploy/.env) تامین می‌شوند. در این بخش آدرس Endpoint، مدل پیش‌فرض و مدل‌های سفارشی را مدیریت کنید.',
    sectionCapabilities: 'مدیریت امکانات و محدودیت‌های Sandbox',
    sectionCapabilitiesDesc:
      'کنترل دسترسی سراسری ایجنت‌ها به فایل و Bash، زمان و حافظه کانتینر، و الگوهای حساس تایید انسانی (HITL).',
    sectionUi: 'تنظیمات رابط کاربری و بوم گرافیکی',
    sectionUiDesc:
      'تنظیم زبان رابط، تم روشن/تیره، سقف راند پیش‌فرض و جزئیات نمایشی بوم React Flow.',
  },
};

export function SettingsView({
  settings,
  capabilities,
  onSaveSettings,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [newModelInputs, setNewModelInputs] = useState<Record<LLMProvider, string>>({
    gemini: '',
    openai: '',
    anthropic: '',
    ollama: '',
    opencode: '',
  });
  const [newPattern, setNewPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [syncingOpenCode, setSyncingOpenCode] = useState(false);
  const [openCodeSyncMessage, setOpenCodeSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const t = SETTINGS_COPY[draft.language];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings(draft);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft({
      ...DEFAULT_APP_SETTINGS,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddCustomModel = (provider: LLMProvider) => {
    const val = newModelInputs[provider].trim();
    if (!val) return;
    const currentList = draft.providers[provider].customModels;
    if (currentList.includes(val)) return;
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: {
          ...prev.providers[provider],
          customModels: [...prev.providers[provider].customModels, val],
        },
      },
    }));
    setNewModelInputs((prev) => ({ ...prev, [provider]: '' }));
  };

  const handleRemoveCustomModel = (provider: LLMProvider, modelId: string) => {
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: {
          ...prev.providers[provider],
          customModels: prev.providers[provider].customModels.filter((m) => m !== modelId),
        },
      },
    }));
  };

  const handleAddPattern = () => {
    const val = newPattern.trim();
    if (!val || draft.customSensitivePatterns.includes(val)) return;
    setDraft((prev) => ({
      ...prev,
      customSensitivePatterns: [...prev.customSensitivePatterns, val],
    }));
    setNewPattern('');
  };

  const handleRemovePattern = (pattern: string) => {
    setDraft((prev) => ({
      ...prev,
      customSensitivePatterns: prev.customSensitivePatterns.filter((p) => p !== pattern),
    }));
  };

  const handleSyncOpenCodeFreeModels = async () => {
    setSyncingOpenCode(true);
    setOpenCodeSyncMessage(null);
    try {
      const baseUrl = draft.providers.opencode.baseUrl;
      const res = await fetch(
        `/api/opencode/free-models?baseUrl=${encodeURIComponent(baseUrl)}`,
      );
      if (!res.ok) {
        setOpenCodeSyncMessage('Failed to fetch OpenCode free models');
        return;
      }
      const data = (await res.json()) as { models?: string[]; source?: string };
      const fetched = Array.isArray(data.models) ? data.models : [];
      if (fetched.length === 0) {
        setOpenCodeSyncMessage('No free OpenCode models returned');
        return;
      }
      setDraft((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          opencode: {
            ...prev.providers.opencode,
            customModels: Array.from(
              new Set([...prev.providers.opencode.customModels, ...fetched]),
            ),
          },
        },
      }));
      setOpenCodeSyncMessage(
        `Synced ${fetched.length} free OpenCode models (${data.source ?? 'live'})`,
      );
    } catch {
      setOpenCodeSyncMessage('Network error syncing OpenCode models');
    } finally {
      setSyncingOpenCode(false);
    }
  };

  const getSecretStatus = (provider: LLMProvider) => {
    if (provider === 'gemini') {
      return capabilities.geminiConfigured ? 'Active on server' : 'Not configured in Secrets';
    }
    if (provider === 'opencode') {
      return capabilities.opencodeConfigured
        ? 'Active on server'
        : 'Uses OPENCODE_API_KEY / Free Tier';
    }
    if (provider === 'openai') {
      return capabilities.openaiConfigured ? 'Active on server' : 'Uses deploy/.env on Linux';
    }
    if (provider === 'anthropic') {
      return capabilities.anthropicConfigured ? 'Active on server' : 'Uses deploy/.env on Linux';
    }
    return 'Local endpoint (no key required)';
  };

  return (
    <section
      dir={draft.language === 'fa' ? 'rtl' : 'ltr'}
      className="h-full overflow-y-auto p-6"
    >
      <form
        onSubmit={handleSave}
        className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 pb-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
              {t.title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              {t.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t.reset}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {savedToast ? <Check className="h-3.5 w-3.5" /> : null}
              {savedToast ? t.saved : t.save}
            </button>
          </div>
        </div>

        {/* Section 1: LLM Providers & Custom Model Definitions */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {t.sectionProviders}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t.sectionProvidersDesc}
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PROVIDER_ORDER.map((provider) => {
              const meta = PROVIDER_MODELS[provider];
              const cfg = draft.providers[provider];
              const allModels = Array.from(new Set([...meta.models, ...cfg.customModels]));

              return (
                <div
                  key={provider}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {meta.label}
                    </h3>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {getSecretStatus(provider)}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3" dir="ltr">
                    <div>
                      <label
                        htmlFor={`provider-url-${provider}`}
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        API Endpoint / Base URL
                      </label>
                      <input
                        id={`provider-url-${provider}`}
                        type="url"
                        value={cfg.baseUrl}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            providers: {
                              ...prev.providers,
                              [provider]: { ...prev.providers[provider], baseUrl: e.target.value },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor={`provider-default-${provider}`}
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Default Model
                        </label>
                        <select
                          id={`provider-default-${provider}`}
                          value={cfg.defaultModel}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              providers: {
                                ...prev.providers,
                                [provider]: {
                                  ...prev.providers[provider],
                                  defaultModel: e.target.value,
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          {allModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor={`provider-env-${provider}`}
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Server Env Var Name
                        </label>
                        <input
                          id={`provider-env-${provider}`}
                          type="text"
                          readOnly={provider === 'gemini'}
                          value={cfg.envVarName}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              providers: {
                                ...prev.providers,
                                [provider]: {
                                  ...prev.providers[provider],
                                  envVarName: e.target.value,
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1.5 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`custom-model-input-${provider}`}
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Custom Models Catalog ({allModels.length} available)
                        </label>
                        {provider === 'opencode' && (
                          <button
                            type="button"
                            onClick={() => void handleSyncOpenCodeFreeModels()}
                            disabled={syncingOpenCode}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900/60 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/50"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${syncingOpenCode ? 'animate-spin' : ''}`}
                            />
                            {syncingOpenCode ? 'Syncing...' : 'Sync All Free Models'}
                          </button>
                        )}
                      </div>
                      {provider === 'opencode' && openCodeSyncMessage && (
                        <p
                          data-testid="opencode-sync-status"
                          className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                        >
                          {openCodeSyncMessage}
                        </p>
                      )}
                      <div className="mt-1 flex gap-2">
                        <input
                          id={`custom-model-input-${provider}`}
                          type="text"
                          value={newModelInputs[provider]}
                          onChange={(e) =>
                            setNewModelInputs((prev) => ({ ...prev, [provider]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomModel(provider);
                            }
                          }}
                          placeholder={`Add ${provider} model ID...`}
                          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddCustomModel(provider)}
                          aria-label={`Add custom model to ${meta.label}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>

                      {cfg.customModels.length > 0 && (
                        <ul className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                          {cfg.customModels.map((cm) => (
                            <li
                              key={cm}
                              className="flex items-center justify-between px-2.5 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300"
                            >
                              <span>{cm}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomModel(provider, cm)}
                                aria-label={`Remove ${cm}`}
                                className="text-red-600 hover:text-red-700 dark:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 2: Global Capabilities & Sandbox Guardrails */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {t.sectionCapabilities}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t.sectionCapabilitiesDesc}
          </p>

          <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Global Agent Tool Capabilities
              </h3>
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.allowReadFile}
                  onChange={(e) => setDraft({ ...draft, allowReadFile: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>Allow Sandbox File Reading (READ_FILE)</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.allowWriteFile}
                  onChange={(e) => setDraft({ ...draft, allowWriteFile: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>Allow Sandbox File Writing (WRITE_FILE)</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.allowExecBash}
                  onChange={(e) => setDraft({ ...draft, allowExecBash: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>Allow Bash Command Execution (EXEC_BASH)</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.globalHumanInTheLoop}
                  onChange={(e) => setDraft({ ...draft, globalHumanInTheLoop: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>Enforce Global Human-in-the-Loop Gate</span>
              </label>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label
                    htmlFor="sandbox-timeout-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Sandbox Timeout (sec)
                  </label>
                  <input
                    id="sandbox-timeout-input"
                    type="number"
                    min={5}
                    max={60}
                    value={draft.sandboxTimeoutSec}
                    onChange={(e) =>
                      setDraft({ ...draft, sandboxTimeoutSec: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sandbox-mem-select"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Container Memory Limit
                  </label>
                  <select
                    id="sandbox-mem-select"
                    value={draft.sandboxMemoryMb}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sandboxMemoryMb: Number(e.target.value) as 256 | 512 | 1024,
                      })
                    }
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value={256}>256 MB</option>
                    <option value={512}>512 MB</option>
                    <option value={1024}>1024 MB</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3" dir="ltr">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Custom Sensitive Command Rules (HITL Triggers)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Built-in rules already guard rm -rf, sudo, chmod/chown, curl | sh, docker, and package installs. Add custom keywords below:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="New sensitive command pattern"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPattern();
                    }
                  }}
                  placeholder="e.g. helm uninstall"
                  className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleAddPattern}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Rule
                </button>
              </div>

              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-slate-50 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
                {draft.customSensitivePatterns.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-slate-500">
                    No custom patterns added.
                  </li>
                ) : (
                  draft.customSensitivePatterns.map((pat) => (
                    <li
                      key={pat}
                      className="flex items-center justify-between px-3 py-1.5 font-mono text-xs text-slate-800 dark:text-slate-200"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePattern(pat)}
                        aria-label={`Delete rule ${pat}`}
                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* Section 3: Studio Interface & Canvas Preferences */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {t.sectionUi}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t.sectionUiDesc}
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="settings-lang-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Interface Language
              </label>
              <select
                id="settings-lang-select"
                value={draft.language}
                onChange={(e) =>
                  setDraft({ ...draft, language: e.target.value as 'en' | 'fa' })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="en">English (EN)</option>
                <option value="fa">Persian / فارسی (FA)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-theme-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Color Theme
              </label>
              <select
                id="settings-theme-select"
                value={draft.darkMode ? 'dark' : 'light'}
                onChange={(e) =>
                  setDraft({ ...draft, darkMode: e.target.value === 'dark' })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="light">Light Workspace</option>
                <option value="dark">Dark Slate</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-grid-select"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Canvas Background Grid
              </label>
              <select
                id="settings-grid-select"
                value={draft.canvasGridVariant}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    canvasGridVariant: e.target.value as 'dots' | 'lines' | 'cross',
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="dots">Dots</option>
                <option value="lines">Lines</option>
                <option value="cross">Crosshairs</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-max-rounds"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Default max_rounds
              </label>
              <input
                id="settings-max-rounds"
                type="number"
                min={1}
                max={25}
                value={draft.defaultMaxRounds}
                onChange={(e) =>
                  setDraft({ ...draft, defaultMaxRounds: Number(e.target.value) })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4 dark:border-slate-800">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={draft.showMiniMap}
                onChange={(e) => setDraft({ ...draft, showMiniMap: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>Show Canvas MiniMap</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={draft.defaultExecutionMode === 'dry_run'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultExecutionMode: e.target.checked ? 'dry_run' : 'live',
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>Default to Sandbox Dry-Run Mode</span>
            </label>
          </div>
        </div>
      </form>
    </section>
  );
}
