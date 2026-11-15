import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { POWER_LEVEL_META, PROVIDER_MODELS } from '../data/agentTemplates';
import type {
  AgentPowerLevel,
  AppSettings,
  CapabilitiesState,
  LLMProvider,
  ProviderSecretStatus,
} from '../types/workflow';
import {
  addProviderModel,
  deleteProviderModel,
  getEffectiveProviderModels,
  restoreDefaultProviderModels,
  updateProviderModel,
} from '../utils/catalogUtils';
import { normalizeSecretName } from '../utils/secretUtils';
import { DEFAULT_APP_SETTINGS } from '../utils/workflowEngine';

interface SettingsViewProps {
  settings: AppSettings;
  capabilities: CapabilitiesState;
  onCapabilitiesUpdated?: (next: CapabilitiesState) => void;
  onSaveSettings: (next: AppSettings) => Promise<void>;
}

const PROVIDER_ORDER: LLMProvider[] = ['gemini', 'opencode', 'openai', 'anthropic', 'ollama'];

const SETTINGS_COPY = {
  en: {
    title: 'Studio Settings, API Keys & Capabilities',
    subtitle:
      'Add and verify LLM API keys (stored server-side in SQLite), configure endpoints and custom models, and manage sandbox guardrails.',
    save: 'Save Settings',
    saved: 'Settings Saved',
    reset: 'Reset Defaults',
    sectionProviders: 'LLM Providers, API Keys & Custom Model Catalog',
    sectionProvidersDesc:
      'API keys are stored securely server-side in the SQLite vault (or read from Linux .env) and are never returned in plaintext to the browser.',
    sectionCapabilities: 'Global Capabilities & Sandbox Guardrails',
    sectionCapabilitiesDesc:
      'Control which sandbox tools agents can invoke globally, container execution budgets, and Human-in-the-Loop bash command rules.',
    sectionUi: 'Interface & Canvas Preferences',
    sectionUiDesc:
      'Customize studio language, color theme, default workflow limits, and React Flow canvas layout options.',
  },
  fa: {
    title: 'تنظیمات سیستم، کلیدهای API و مدیریت امکانات',
    subtitle:
      'افزودن و تست کلید API مدل‌های هوش مصنوعی (ذخیره امن در سمت سرور)، تنظیم آدرس سرویس‌ها، تعریف مدل‌های سفارشی و مدیریت دسترسی سندباکس.',
    save: 'ذخیره تنظیمات',
    saved: 'تنظیمات ذخیره شد',
    reset: 'بازنشانی پیش‌فرض',
    sectionProviders: 'ارائه‌دهندگان LLM، کلیدهای API و تعریف مدل‌ها',
    sectionProvidersDesc:
      'کلیدهای API به‌صورت امن در پایگاه‌داده سمت سرور (SQLite) یا فایل .env لینوکس نگهداری می‌شوند و هرگز در کلاینت افشا نمی‌گردند.',
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
  onCapabilitiesUpdated,
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
  const [newModelPowers, setNewModelPowers] = useState<Record<LLMProvider, AgentPowerLevel>>({
    gemini: 'pro',
    openai: 'pro',
    anthropic: 'pro',
    ollama: 'standard',
    opencode: 'standard',
  });
  const [editingModel, setEditingModel] = useState<{
    provider: LLMProvider;
    oldId: string;
    nextId: string;
    displayName: string;
    power: AgentPowerLevel;
  } | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<LLMProvider, string>>({
    gemini: '',
    openai: '',
    anthropic: '',
    ollama: '',
    opencode: '',
  });
  const [showKey, setShowKey] = useState<Record<LLMProvider, boolean>>({
    gemini: false,
    openai: false,
    anthropic: false,
    ollama: false,
    opencode: false,
  });
  const [keyBusy, setKeyBusy] = useState<Record<LLMProvider, boolean>>({
    gemini: false,
    openai: false,
    anthropic: false,
    ollama: false,
    opencode: false,
  });
  const [keyFeedback, setKeyFeedback] = useState<
    Partial<Record<LLMProvider, { ok: boolean; text: string }>>
  >({});

  const [customSecretName, setCustomSecretName] = useState('');
  const [customSecretVal, setCustomSecretVal] = useState('');
  const [customSecretBusy, setCustomSecretBusy] = useState(false);
  const [customSecretMsg, setCustomSecretMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [newPattern, setNewPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [syncingOpenCode, setSyncingOpenCode] = useState(false);
  const [openCodeSyncMessage, setOpenCodeSyncMessage] = useState<string | null>(null);
  const [showGeminiProxyGuide, setShowGeminiProxyGuide] = useState(false);
  const [copiedWorkerSnippet, setCopiedWorkerSnippet] = useState(false);

  const CLOUDFLARE_WORKER_RELAY = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'generativelanguage.googleapis.com';
    return fetch(new Request(url, request));
  },
};`;

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const t = SETTINGS_COPY[draft.language];
  const isFa = draft.language === 'fa';
  const secretsMap: Record<string, ProviderSecretStatus> = capabilities.secrets ?? {};

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

  const getSecretNameForProvider = (provider: LLMProvider): string => {
    const raw = draft.providers[provider]?.envVarName;
    const norm = normalizeSecretName(raw || '');
    if (provider === 'ollama') {
      return !norm || norm === 'OLLAMA_BASE_URL' ? 'OLLAMA_API_KEY' : norm;
    }
    if (norm) return norm;
    if (provider === 'gemini') return 'GEMINI_API_KEY';
    if (provider === 'openai') return 'OPENAI_API_KEY';
    if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
    return 'OPENCODE_API_KEY';
  };

  const handleSaveProviderKey = async (provider: LLMProvider) => {
    const secretName = getSecretNameForProvider(provider);
    const apiKey = apiKeyInputs[provider].trim();
    if (!apiKey) {
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: {
          ok: false,
          text: isFa ? 'لطفاً کلید API را وارد کنید.' : 'Please enter an API key first.',
        },
      }));
      return;
    }

    setKeyBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      const res = await fetch('/api/provider-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretName, apiKey }),
      });
      const data = (await res.json()) as {
        error?: string;
        secret?: ProviderSecretStatus;
        capabilities?: CapabilitiesState;
      };
      if (!res.ok) {
        setKeyFeedback((prev) => ({
          ...prev,
          [provider]: { ok: false, text: data.error || 'Failed to save API key.' },
        }));
        return;
      }
      if (data.capabilities && onCapabilitiesUpdated) {
        onCapabilitiesUpdated(data.capabilities);
      }
      if (
        draft.providers[provider].baseUrl.trim() !== settings.providers[provider].baseUrl.trim() ||
        draft.providers[provider].defaultModel !== settings.providers[provider].defaultModel ||
        draft.providers[provider].envVarName.trim() !== settings.providers[provider].envVarName.trim()
      ) {
        await onSaveSettings(draft);
      }
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: {
          ok: true,
          text: isFa
            ? `کلید ${secretName} با موفقیت روی سرور ذخیره شد (${data.secret?.maskedHint ?? '••••'}).`
            : `Saved ${secretName} on server (${data.secret?.maskedHint ?? '••••'}).`,
        },
      }));
    } catch {
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: { ok: false, text: 'Network error saving API key.' },
      }));
    } finally {
      setKeyBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleDeleteProviderKey = async (provider: LLMProvider) => {
    const secretName = getSecretNameForProvider(provider);
    setKeyBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      const res = await fetch(`/api/provider-keys/${encodeURIComponent(secretName)}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { capabilities?: CapabilitiesState };
      if (data.capabilities && onCapabilitiesUpdated) {
        onCapabilitiesUpdated(data.capabilities);
      }
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: {
          ok: true,
          text: isFa
            ? `کلید ذخیره‌شده ${secretName} حذف شد.`
            : `Cleared stored key for ${secretName}.`,
        },
      }));
    } catch {
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: { ok: false, text: 'Failed to remove key.' },
      }));
    } finally {
      setKeyBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleTestProviderKey = async (provider: LLMProvider) => {
    const secretName = getSecretNameForProvider(provider);
    const pendingKey = apiKeyInputs[provider].trim();
    setKeyBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      const res = await fetch('/api/provider-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          secretName,
          baseUrl: draft.providers[provider].baseUrl,
          model: draft.providers[provider].defaultModel,
          apiKey: pendingKey || undefined,
          language: draft.language,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (
        data.ok &&
        (draft.providers[provider].baseUrl.trim() !== settings.providers[provider].baseUrl.trim() ||
          draft.providers[provider].defaultModel !== settings.providers[provider].defaultModel)
      ) {
        await onSaveSettings(draft);
      }
      if (!data.ok && provider === 'gemini' && (data.message || '').includes('403')) {
        setShowGeminiProxyGuide(true);
      }
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: {
          ok: Boolean(data.ok),
          text: data.message || (data.ok ? 'Connection OK' : 'Connection test failed'),
        },
      }));
    } catch {
      setKeyFeedback((prev) => ({
        ...prev,
        [provider]: { ok: false, text: 'Network error testing provider connection.' },
      }));
    } finally {
      setKeyBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleSaveCustomSecret = async () => {
    const name = normalizeSecretName(customSecretName);
    if (!name || !customSecretVal.trim()) {
      setCustomSecretMsg({
        ok: false,
        text: isFa
          ? 'نام کلید (حروف بزرگ انگلیسی) و مقدار کلید را وارد کنید.'
          : 'Provide a valid secret name (e.g. OPENAI_TEAM_B) and API key.',
      });
      return;
    }
    setCustomSecretBusy(true);
    try {
      const res = await fetch('/api/provider-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretName: name, apiKey: customSecretVal.trim() }),
      });
      const data = (await res.json()) as {
        error?: string;
        secret?: ProviderSecretStatus;
        capabilities?: CapabilitiesState;
      };
      if (!res.ok) {
        setCustomSecretMsg({ ok: false, text: data.error || 'Failed to save custom key.' });
        return;
      }
      if (data.capabilities && onCapabilitiesUpdated) {
        onCapabilitiesUpdated(data.capabilities);
      }
      setCustomSecretName('');
      setCustomSecretVal('');
      setCustomSecretMsg({
        ok: true,
        text: isFa
          ? `کلید ${name} ذخیره شد (${data.secret?.maskedHint ?? '••••'}).`
          : `Saved ${name} (${data.secret?.maskedHint ?? '••••'}).`,
      });
    } finally {
      setCustomSecretBusy(false);
    }
  };

  const handleDeleteNamedSecret = async (secretName: string) => {
    const res = await fetch(`/api/provider-keys/${encodeURIComponent(secretName)}`, {
      method: 'DELETE',
    });
    const data = (await res.json()) as { capabilities?: CapabilitiesState };
    if (data.capabilities && onCapabilitiesUpdated) {
      onCapabilitiesUpdated(data.capabilities);
    }
  };

  const handleAddCustomModel = (provider: LLMProvider) => {
    const val = newModelInputs[provider].trim();
    if (!val) return;
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: addProviderModel(
          provider,
          prev.providers[provider],
          val,
          newModelPowers[provider],
        ),
      },
    }));
    setNewModelInputs((prev) => ({ ...prev, [provider]: '' }));
  };

  const handleDeleteModel = (provider: LLMProvider, modelId: string) => {
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: deleteProviderModel(provider, prev.providers[provider], modelId),
      },
    }));
    if (editingModel?.provider === provider && editingModel.oldId === modelId) {
      setEditingModel(null);
    }
  };

  const handleSaveEditedModel = () => {
    if (!editingModel || !editingModel.nextId.trim()) return;
    const { provider, oldId, nextId, displayName, power } = editingModel;
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: updateProviderModel(provider, prev.providers[provider], oldId, {
          id: nextId,
          displayName,
          power,
        }),
      },
    }));
    setEditingModel(null);
  };

  const handleRestoreProviderModels = (provider: LLMProvider) => {
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: restoreDefaultProviderModels(provider, prev.providers[provider]),
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

  const getSecretStatusText = (provider: LLMProvider) => {
    const secretName = getSecretNameForProvider(provider);
    const info = secretsMap[secretName];
    if (info?.configured) {
      return info.source === 'vault'
        ? `Vault Active · ${info.maskedHint}`
        : `Active · ${info.maskedHint || 'Server .env'}`;
    }
    if (provider === 'gemini' && capabilities.geminiConfigured) return 'Active on server';
    if (provider === 'openai' && capabilities.openaiConfigured) return 'Active on server';
    if (provider === 'anthropic' && capabilities.anthropicConfigured) return 'Active on server';
    if (provider === 'opencode') {
      return capabilities.opencodeConfigured
        ? 'Active on server'
        : 'Free Tier (or add OPENCODE_API_KEY)';
    }
    if (provider === 'ollama') return 'Local endpoint (key optional)';
    return isFa ? 'تنظیم نشده' : 'Not configured';
  };

  const standardSecretNames = new Set(PROVIDER_ORDER.map((p) => getSecretNameForProvider(p)));
  const extraSecrets = Object.values(secretsMap).filter(
    (s) => s.configured && !standardSecretNames.has(s.secretName),
  );

  return (
    <section
      dir={draft.language === 'fa' ? 'rtl' : 'ltr'}
      className="h-full overflow-y-auto p-6"
    >
      <form
        onSubmit={handleSave}
        className="mx-auto flex w-full max-w-[1140px] flex-col gap-6 pb-10"
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

        {/* Section 1: LLM Providers, API Keys & Custom Model Definitions */}
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
              const allModels = getEffectiveProviderModels(provider, cfg);
              const secretName = getSecretNameForProvider(provider);
              const secretStatus = secretsMap[secretName];
              const feedback = keyFeedback[provider];
              const hasDisabledBuiltIns = (cfg.disabledModels?.length ?? 0) > 0;

              return (
                <div
                  key={provider}
                  data-testid={`provider-card-${provider}`}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {meta.label}
                    </h3>
                    <span
                      data-testid={`provider-key-status-${provider}`}
                      className={`font-mono text-[11px] font-medium ${
                        secretStatus?.configured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {getSecretStatusText(provider)}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3" dir="ltr">
                    {/* API Key Input & Actions */}
                    <div className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`api-key-input-${provider}`}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-blue-600" />
                          <span>
                            API Key (<span className="font-mono">{secretName}</span>)
                          </span>
                        </label>
                        {secretStatus?.source === 'vault' && (
                          <button
                            type="button"
                            data-testid={`delete-api-key-${provider}`}
                            disabled={keyBusy[provider]}
                            onClick={() => void handleDeleteProviderKey(provider)}
                            className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
                          >
                            Clear Vault Key
                          </button>
                        )}
                      </div>

                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="relative min-w-0 flex-1">
                          <input
                            id={`api-key-input-${provider}`}
                            data-testid={`api-key-input-${provider}`}
                            type={showKey[provider] ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={apiKeyInputs[provider]}
                            onChange={(e) =>
                              setApiKeyInputs((prev) => ({
                                ...prev,
                                [provider]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveProviderKey(provider);
                              }
                            }}
                            placeholder={
                              secretStatus?.configured
                                ? `Enter new key to replace (${secretStatus.maskedHint})`
                                : `Paste ${secretName}...`
                            }
                            className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-2.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))
                            }
                            aria-label={`Toggle ${provider} key visibility`}
                            className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
                          >
                            {showKey[provider] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        <button
                          type="button"
                          data-testid={`save-api-key-${provider}`}
                          disabled={keyBusy[provider]}
                          onClick={() => void handleSaveProviderKey(provider)}
                          className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                        >
                          Save Key
                        </button>

                        <button
                          type="button"
                          data-testid={`test-api-key-${provider}`}
                          disabled={keyBusy[provider]}
                          onClick={() => void handleTestProviderKey(provider)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        >
                          <Zap className="h-3 w-3" />
                          Test
                        </button>
                      </div>

                      {feedback && (
                        <p
                          data-testid={`api-key-feedback-${provider}`}
                          className={`mt-1.5 break-words text-[11px] leading-relaxed font-medium ${
                            feedback.ok
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {feedback.text}
                        </p>
                      )}
                    </div>

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
                      {provider === 'gemini' && (
                        <div className="mt-1.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            <span>
                              {isFa
                                ? 'در صورت خطای 403 (محدودیت منطقه/IP)، آدرس رله/پراکسی Gemini را اینجا وارد کنید.'
                                : 'If direct Google access returns 403 (region/IP block), set a Gemini relay/proxy URL here.'}
                            </span>
                            <button
                              type="button"
                              data-testid="toggle-gemini-proxy-guide"
                              onClick={() => setShowGeminiProxyGuide((prev) => !prev)}
                              className="font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                            >
                              {showGeminiProxyGuide
                                ? isFa
                                  ? 'بستن راهنمای رفع 403'
                                  : 'Hide 403 Relay Guide'
                                : isFa
                                  ? 'راهنمای رفع 403 (Cloudflare Worker)'
                                  : 'How to bypass 403 (Cloudflare Worker)'}
                            </button>
                          </div>

                          {showGeminiProxyGuide && (
                            <div
                              data-testid="gemini-proxy-guide"
                              className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">
                                  {isFa
                                    ? 'کد رله رایگان Cloudflare Worker برای عبور از خطای 403:'
                                    : 'Free Cloudflare Worker Relay (paste worker URL into Base URL above):'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(CLOUDFLARE_WORKER_RELAY);
                                    setCopiedWorkerSnippet(true);
                                    setTimeout(() => setCopiedWorkerSnippet(false), 1800);
                                  }}
                                  className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                                >
                                  {copiedWorkerSnippet ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                  <span>
                                    {copiedWorkerSnippet
                                      ? isFa
                                        ? 'کپی شد'
                                        : 'Copied'
                                      : isFa
                                        ? 'کپی کد'
                                        : 'Copy Code'}
                                  </span>
                                </button>
                              </div>
                              <pre
                                dir="ltr"
                                className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 font-mono text-[10px] leading-relaxed text-emerald-300"
                              >
                                <code>{CLOUDFLARE_WORKER_RELAY}</code>
                              </pre>
                              <p className="mt-1.5 leading-relaxed opacity-90">
                                {isFa
                                  ? 'یا در فایل .env سرور مقدار HTTPS_PROXY را تنظیم کرده و سرویس را ری‌استارت کنید.'
                                  : 'Or set HTTPS_PROXY in your server .env file and restart the service.'}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
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
                            <option key={m.id} value={m.id}>
                              {m.displayName ? `${m.displayName} (${m.id})` : m.id} ·{' '}
                              {POWER_LEVEL_META[m.power].short}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor={`provider-env-${provider}`}
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Server Secret / Env Name
                        </label>
                        <input
                          id={`provider-env-${provider}`}
                          type="text"
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
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label
                          htmlFor={`custom-model-input-${provider}`}
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Models Catalog ({allModels.length} active)
                        </label>
                        <div className="flex items-center gap-1.5">
                          {hasDisabledBuiltIns && (
                            <button
                              type="button"
                              data-testid={`restore-models-${provider}`}
                              onClick={() => handleRestoreProviderModels(provider)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore Defaults
                            </button>
                          )}
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
                      </div>
                      {provider === 'opencode' && openCodeSyncMessage && (
                        <p
                          data-testid="opencode-sync-status"
                          className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                        >
                          {openCodeSyncMessage}
                        </p>
                      )}
                      <div className="mt-1 flex gap-1.5">
                        <input
                          id={`custom-model-input-${provider}`}
                          data-testid={`add-model-input-${provider}`}
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
                        <select
                          aria-label={`Power tier for new ${provider} model`}
                          data-testid={`add-model-power-${provider}`}
                          value={newModelPowers[provider]}
                          onChange={(e) =>
                            setNewModelPowers((prev) => ({
                              ...prev,
                              [provider]: e.target.value as AgentPowerLevel,
                            }))
                          }
                          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <option value="eco">Eco</option>
                          <option value="standard">Standard</option>
                          <option value="pro">Pro</option>
                          <option value="ultra">Ultra</option>
                        </select>
                        <button
                          type="button"
                          data-testid={`add-model-btn-${provider}`}
                          onClick={() => handleAddCustomModel(provider)}
                          aria-label={`Add model to ${meta.label}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>

                      {allModels.length > 0 && (
                        <ul
                          data-testid={`model-list-${provider}`}
                          className="mt-2 max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
                        >
                          {allModels.map((entry) => {
                            const isEditing =
                              editingModel?.provider === provider &&
                              editingModel.oldId === entry.id;
                            return (
                              <li key={entry.id} className="px-2.5 py-1.5 text-xs">
                                {isEditing ? (
                                  <div className="space-y-1.5">
                                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-12">
                                      <input
                                        type="text"
                                        aria-label="Edit model ID"
                                        data-testid={`edit-model-id-${provider}`}
                                        value={editingModel.nextId}
                                        onChange={(e) =>
                                          setEditingModel({
                                            ...editingModel,
                                            nextId: e.target.value,
                                          })
                                        }
                                        className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:col-span-5"
                                      />
                                      <input
                                        type="text"
                                        aria-label="Edit model display label"
                                        placeholder="Display label (optional)"
                                        value={editingModel.displayName}
                                        onChange={(e) =>
                                          setEditingModel({
                                            ...editingModel,
                                            displayName: e.target.value,
                                          })
                                        }
                                        className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:col-span-4"
                                      />
                                      <select
                                        aria-label="Edit model power tier"
                                        data-testid={`edit-model-power-${provider}`}
                                        value={editingModel.power}
                                        onChange={(e) =>
                                          setEditingModel({
                                            ...editingModel,
                                            power: e.target.value as AgentPowerLevel,
                                          })
                                        }
                                        className="rounded border border-slate-300 bg-slate-50 px-1.5 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:col-span-3"
                                      >
                                        <option value="eco">Eco</option>
                                        <option value="standard">Standard</option>
                                        <option value="pro">Pro</option>
                                        <option value="ultra">Ultra</option>
                                      </select>
                                    </div>
                                    <div className="flex justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditingModel(null)}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                                      >
                                        <X className="h-3 w-3" />
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`save-edited-model-${provider}`}
                                        onClick={handleSaveEditedModel}
                                        className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                                      >
                                        <Check className="h-3 w-3" />
                                        Save Model
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="truncate font-mono text-slate-800 dark:text-slate-200">
                                        {entry.id}
                                      </span>
                                      {entry.displayName && (
                                        <span className="truncate text-[11px] text-slate-500">
                                          ({entry.displayName})
                                        </span>
                                      )}
                                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {POWER_LEVEL_META[entry.power].short}
                                      </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditingModel({
                                            provider,
                                            oldId: entry.id,
                                            nextId: entry.id,
                                            displayName: entry.displayName ?? '',
                                            power: entry.power,
                                          })
                                        }
                                        aria-label={`Edit model ${entry.id}`}
                                        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteModel(provider, entry.id)}
                                        aria-label={`Delete model ${entry.id}`}
                                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Named API Keys (Multi-Key per Provider) */}
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {isFa
                    ? 'کلیدهای سفارشی بیشتر (اختصاص کلید مجزا به هر نود)'
                    : 'Additional Custom API Keys (Per-Agent Key Bindings)'}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {isFa
                    ? 'می‌توانید چند کلید مجزا بسازید و نام کلید را در تنظیمات هر نود (Server Secret Binding) انتخاب کنید.'
                    : 'Create named keys (e.g. OPENAI_TEAM_B) and bind individual agent nodes to them in Agent Inspector.'}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-12" dir="ltr">
              <input
                type="text"
                data-testid="custom-secret-name-input"
                value={customSecretName}
                onChange={(e) => setCustomSecretName(e.target.value)}
                placeholder="SECRET_NAME (e.g. OPENAI_BACKUP_KEY)"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-4"
              />
              <input
                type="password"
                data-testid="custom-secret-value-input"
                autoComplete="new-password"
                value={customSecretVal}
                onChange={(e) => setCustomSecretVal(e.target.value)}
                placeholder="Paste API key value..."
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-6"
              />
              <button
                type="button"
                data-testid="save-custom-secret-btn"
                disabled={customSecretBusy}
                onClick={() => void handleSaveCustomSecret()}
                className="inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700 sm:col-span-2"
              >
                <Plus className="h-3.5 w-3.5" />
                Save Key
              </button>
            </div>

            {customSecretMsg && (
              <p
                className={`mt-2 text-xs font-medium ${
                  customSecretMsg.ok
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {customSecretMsg.text}
              </p>
            )}

            {extraSecrets.length > 0 && (
              <ul
                dir="ltr"
                className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
              >
                {extraSecrets.map((sec) => (
                  <li
                    key={sec.secretName}
                    className="flex items-center justify-between px-3 py-2 font-mono text-xs text-slate-800 dark:text-slate-200"
                  >
                    <span>
                      {sec.secretName}{' '}
                      <span className="text-slate-500">({sec.maskedHint})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteNamedSecret(sec.secretName)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                      aria-label={`Delete ${sec.secretName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
