import { useMemo, useRef, useState } from 'react';
import {
  Braces,
  Check,
  Download,
  FileUp,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  CapabilitiesState,
  LLMProvider,
} from '../types/workflow';
import {
  exportProvidersCatalogJson,
  parseProviderJsonSync,
} from '../utils/providerJsonSync';

interface ProviderJsonSyncPanelProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  isFa: boolean;
  providers: AppSettings['providers'];
  onSynced: (payload: {
    settings: AppSettings;
    capabilities: CapabilitiesState;
    summaryText: string;
  }) => void;
}

const SAMPLE_TEMPLATES: Record<'service_account' | 'provider_config' | 'opencode_auth', string> = {
  service_account: JSON.stringify(
    {
      type: 'service_account',
      project_id: 'your-gcp-project-id',
      private_key_id: 'replace-with-key-id',
      private_key:
        '-----BEGIN PRIVATE KEY-----\nREPLACE_WITH_YOUR_PEM_PRIVATE_KEY\n-----END PRIVATE KEY-----\n',
      client_email: 'vertex-runner@your-gcp-project-id.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
      location: 'us-central1',
    },
    null,
    2,
  ),
  provider_config: JSON.stringify(
    {
      provider: 'openai',
      apiKey: 'sk-your-api-key-here',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4.1',
      models: ['gpt-4.1', { id: 'o3-mini', displayName: 'o3 Mini', power: 'ultra' }],
    },
    null,
    2,
  ),
  opencode_auth: JSON.stringify(
    {
      provider: {
        opencode: {
          options: {
            baseURL: 'https://opencode.ai/zen/v1',
            apiKey: 'your-opencode-key',
          },
          models: {
            'big-pickle': { name: 'Big Pickle', power: 'pro' },
            'qwen-coder-plus': { name: 'Qwen Coder Plus', power: 'pro' },
          },
        },
      },
    },
    null,
    2,
  ),
};

export function ProviderJsonSyncPanel({
  isOpen,
  onToggleOpen,
  isFa,
  providers,
  onSynced,
}: ProviderJsonSyncPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [targetProvider, setTargetProvider] = useState<'' | LLMProvider>('');
  const [testConnections, setTestConnections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultFeedback, setResultFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const preview = useMemo(() => {
    if (!rawJson.trim()) return null;
    return parseProviderJsonSync(rawJson, targetProvider || undefined);
  }, [rawJson, targetProvider]);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setRawJson(content);
      setResultFeedback(null);
    } catch {
      setResultFeedback({
        ok: false,
        text: isFa ? 'خطا در خواندن فایل JSON انتخاب‌شده.' : 'Failed to read selected JSON file.',
      });
    }
  };

  const handleExportCatalog = () => {
    const jsonText = exportProvidersCatalogJson(providers);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aetherflow-providers-catalog.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleApplySync = async () => {
    if (!rawJson.trim()) {
      setResultFeedback({
        ok: false,
        text: isFa
          ? 'ابتدا فایل JSON را آپلود یا متن JSON را وارد کنید.'
          : 'Upload a .json file or paste JSON configuration first.',
      });
      return;
    }

    if (preview && !preview.valid) {
      setResultFeedback({
        ok: false,
        text: preview.error || (isFa ? 'ساختار JSON نامعتبر است.' : 'Invalid JSON configuration.'),
      });
      return;
    }

    setBusy(true);
    setResultFeedback(null);
    try {
      const res = await fetch('/api/providers/json-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawJson,
          ...(targetProvider ? { targetProvider } : {}),
          testConnections,
          language: isFa ? 'fa' : 'en',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detectedFormat?: string;
        appliedProviders?: Array<{
          provider: LLMProvider;
          modelsAdded: number;
          baseUrlUpdated: boolean;
          secretStored: boolean;
          credentialLabel?: string;
        }>;
        storedSecrets?: string[];
        connectionTests?: Partial<
          Record<LLMProvider, { ok: boolean; status: number; message: string }>
        >;
        settings?: AppSettings;
        capabilities?: CapabilitiesState;
      };

      if (!res.ok || !data.ok || !data.settings || !data.capabilities) {
        setResultFeedback({
          ok: false,
          text: data.error || (isFa ? 'خطا در سینک JSON' : 'Failed to apply JSON sync.'),
        });
        return;
      }

      const providerNames = (data.appliedProviders ?? []).map((p) => p.provider).join(', ');
      const totalModels = (data.appliedProviders ?? []).reduce((s, p) => s + p.modelsAdded, 0);
      const secretsCount = (data.storedSecrets ?? []).length;

      const testSummaries = Object.entries(data.connectionTests ?? {})
        .map(([prov, t]) => `${prov}: ${t?.ok ? 'OK' : t?.message || 'Failed'}`)
        .join(' | ');

      const summaryText = isFa
        ? `سینک JSON با موفقیت انجام شد (${data.detectedFormat ?? 'json'}) · سرویس‌ها: ${providerNames || '—'} · مدل‌های همگام‌شده: ${totalModels} · کلیدهای ذخیره شده: ${secretsCount}${testSummaries ? ` · تست اتصال: ${testSummaries}` : ''}`
        : `JSON Synced (${data.detectedFormat ?? 'json'}) · Providers: ${providerNames || '—'} · Models synced: ${totalModels} · Secrets stored: ${secretsCount}${testSummaries ? ` · Tests: ${testSummaries}` : ''}`;

      setResultFeedback({ ok: true, text: summaryText });
      onSynced({
        settings: data.settings,
        capabilities: data.capabilities,
        summaryText,
      });
    } catch {
      setResultFeedback({
        ok: false,
        text: isFa ? 'خطای شبکه هنگام اتصال JSON به سرور.' : 'Network error syncing JSON config.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/60">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Braces className="h-3.5 w-3.5 text-blue-600" />
            <span>
              {isFa
                ? 'سینک و اتصال سرویس‌های هوش مصنوعی با فایل JSON'
                : 'JSON Sync & Connect (Service Account / Config / Auth JSON)'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {isFa
              ? 'پشتیبانی از Google Service Account JSON (Vertex AI)، فایل auth.json / opencode.json و کانفیگ مدل‌ها و اندپوینت‌ها'
              : 'Supports Google Cloud Service Account JSON (Vertex AI), auth.json / opencode.json, and provider endpoint/model manifests.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="export-providers-json-btn"
            onClick={handleExportCatalog}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            {isFa ? 'خروجی JSON کاتالوگ' : 'Export Catalog JSON'}
          </button>
          <button
            type="button"
            data-testid="toggle-json-sync-panel"
            aria-expanded={isOpen}
            onClick={onToggleOpen}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Upload className="h-3.5 w-3.5" />
            {isOpen
              ? isFa
                ? 'بستن پنل JSON'
                : 'Close JSON Sync'
              : isFa
                ? 'سینک و اتصال با JSON'
                : 'Sync & Connect via JSON'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div
          data-testid="provider-json-sync-panel"
          className="mt-3 rounded-lg border border-blue-200 bg-blue-50/30 p-4 dark:border-blue-900/60 dark:bg-slate-950/80"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                data-testid="provider-json-file-input"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  void handleFileUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                data-testid="upload-json-file-btn"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileUp className="h-3.5 w-3.5 text-blue-600" />
                {isFa ? 'آپلود فایل .json' : 'Upload .json File'}
              </button>

              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa ? 'نمونه آماده:' : 'Templates:'}
              </span>
              <button
                type="button"
                data-testid="template-sa-json-btn"
                onClick={() => {
                  setRawJson(SAMPLE_TEMPLATES.service_account);
                  setResultFeedback(null);
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Service Account JSON
              </button>
              <button
                type="button"
                data-testid="template-provider-json-btn"
                onClick={() => {
                  setRawJson(SAMPLE_TEMPLATES.provider_config);
                  setResultFeedback(null);
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Provider Config
              </button>
              <button
                type="button"
                data-testid="template-opencode-json-btn"
                onClick={() => {
                  setRawJson(SAMPLE_TEMPLATES.opencode_auth);
                  setResultFeedback(null);
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                opencode.json
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="json-sync-target-provider"
                className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
              >
                {isFa ? 'سرویس مقصد:' : 'Target Provider:'}
              </label>
              <select
                id="json-sync-target-provider"
                data-testid="json-sync-target-provider"
                value={targetProvider}
                onChange={(e) => setTargetProvider(e.target.value as '' | LLMProvider)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">{isFa ? 'تشخیص خودکار از JSON' : 'Auto-detect from JSON'}</option>
                <option value="gemini">Google Gemini / Vertex AI</option>
                <option value="openai">OpenAI / Compatible</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="opencode">OpenCode Zen</option>
                <option value="ollama">Ollama Local</option>
              </select>
            </div>
          </div>

          <textarea
            dir="ltr"
            rows={7}
            data-testid="provider-json-textarea"
            aria-label={isFa ? 'محتوای JSON ارائه‌دهنده' : 'Provider JSON payload'}
            value={rawJson}
            onChange={(e) => {
              setRawJson(e.target.value);
              setResultFeedback(null);
            }}
            placeholder='Paste Service Account JSON ({"type": "service_account", ...}), auth.json, opencode.json, or {"provider": "openai", "apiKey": "...", "baseUrl": "...", "models": [...]}'
            className="mt-3 w-full rounded-md border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />

          {preview && (
            <div
              data-testid="provider-json-preview"
              className={`mt-2 rounded-md border px-3 py-2 text-xs ${
                preview.valid
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : 'border-red-200 bg-red-50/70 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
              }`}
            >
              {preview.valid ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">
                    {isFa ? 'فرمت شناسایی‌شده:' : 'Detected:'}{' '}
                    <code className="font-mono">{preview.detectedFormat}</code>
                  </span>
                  <span>
                    {isFa ? 'ارائه‌دهندگان:' : 'Providers:'}{' '}
                    {preview.providerPatches.map((p) => p.provider).join(', ') || '—'}
                  </span>
                  <span>
                    {isFa ? 'مدل‌ها:' : 'Models:'}{' '}
                    {preview.providerPatches.reduce((sum, p) => sum + p.modelsToAdd.length, 0)}
                  </span>
                  <span>
                    {isFa ? 'کلیدها/اعتبارنامه‌ها:' : 'Credentials:'}{' '}
                    {preview.providerPatches.filter((p) => Boolean(p.secretValue)).length +
                      preview.extraSecrets.length}
                  </span>
                </div>
              ) : (
                <span>{preview.error}</span>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                data-testid="json-sync-test-checkbox"
                checked={testConnections}
                onChange={(e) => setTestConnections(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>
                {isFa
                  ? 'تست برقراری اتصال بلافاصله پس از ذخیره'
                  : 'Test connection immediately after syncing'}
              </span>
            </label>

            <div className="flex items-center gap-2">
              {rawJson.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setRawJson('');
                    setResultFeedback(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                  {isFa ? 'پاک کردن' : 'Clear'}
                </button>
              )}
              <button
                type="button"
                data-testid="apply-json-sync-btn"
                disabled={busy || !rawJson.trim() || Boolean(preview && !preview.valid)}
                onClick={() => void handleApplySync()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {busy
                  ? isFa
                    ? 'در حال همگام‌سازی...'
                    : 'Syncing...'
                  : isFa
                    ? 'اعمال سینک و اتصال JSON'
                    : 'Apply JSON Sync & Connect'}
              </button>
            </div>
          </div>

          {resultFeedback && (
            <div
              data-testid="json-sync-feedback"
              className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                resultFeedback.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
              }`}
            >
              {resultFeedback.ok && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="break-words">{resultFeedback.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
