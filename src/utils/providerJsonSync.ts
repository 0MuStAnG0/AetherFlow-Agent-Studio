import type {
  AgentPowerLevel,
  AppSettings,
  LLMProvider,
  ProviderEndpointConfig,
} from '../types/workflow';
import { addProviderModel, inferModelPowerTier } from './catalogUtils';
import { normalizeSecretName } from './secretUtils';

export interface ParsedServiceAccountCredential {
  kind: 'service_account' | 'authorized_user';
  projectId: string;
  clientEmail?: string;
  location: string;
  tokenUri: string;
  compactedJson: string;
}

export interface JsonSyncModelPatch {
  id: string;
  displayName?: string;
  power?: AgentPowerLevel;
}

export interface JsonSyncProviderPatch {
  provider: LLMProvider;
  baseUrl?: string;
  defaultModel?: string;
  envVarName?: string;
  modelsToAdd: JsonSyncModelPatch[];
  disabledModels?: string[];
  secretName?: string;
  secretValue?: string;
  secretKind?: 'api_key' | 'google_service_account' | 'google_authorized_user';
  credentialLabel?: string;
}

export interface JsonSyncExtraSecret {
  secretName: string;
  secretValue: string;
  secretKind: 'api_key' | 'google_service_account' | 'google_authorized_user';
  label?: string;
}

export interface ParsedProviderJsonSyncResult {
  valid: boolean;
  detectedFormat:
    | 'google_service_account'
    | 'google_authorized_user'
    | 'opencode_config'
    | 'auth_json'
    | 'single_provider'
    | 'aetherflow_bundle'
    | 'unknown';
  error?: string;
  warnings: string[];
  providerPatches: JsonSyncProviderPatch[];
  extraSecrets: JsonSyncExtraSecret[];
}

const VALID_PROVIDERS = new Set<LLMProvider>([
  'gemini',
  'openai',
  'anthropic',
  'ollama',
  'opencode',
]);

const PROVIDER_ALIAS_MAP: Record<string, LLMProvider> = {
  gemini: 'gemini',
  google: 'gemini',
  google_ai: 'gemini',
  vertex: 'gemini',
  vertexai: 'gemini',
  vertex_ai: 'gemini',
  openai: 'openai',
  'openai-compatible': 'openai',
  openrouter: 'openai',
  deepseek: 'openai',
  groq: 'openai',
  together: 'openai',
  mistral: 'openai',
  xai: 'openai',
  azure: 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  opencode: 'opencode',
  zen: 'opencode',
  ollama: 'ollama',
  local: 'ollama',
};

const DEFAULT_SECRET_BY_PROVIDER: Record<LLMProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: 'OLLAMA_API_KEY',
  opencode: 'OPENCODE_API_KEY',
};

export function resolveProviderAlias(raw?: string | null): LLMProvider | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (VALID_PROVIDERS.has(key as LLMProvider)) return key as LLMProvider;
  return PROVIDER_ALIAS_MAP[key] ?? null;
}

export function validateHttpEndpointUrl(raw?: string): { valid: boolean; cleaned?: string; error?: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { valid: true, cleaned: '' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `Endpoint "${trimmed}" must use http:// or https:// protocol.`,
      };
    }
    return { valid: true, cleaned: trimmed.replace(/\/+$/, '') };
  } catch {
    return {
      valid: false,
      error: `Invalid endpoint URL "${trimmed}".`,
    };
  }
}

export function parseGoogleJsonCredential(raw: string): ParsedServiceAccountCredential | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (obj.type === 'service_account') {
    const projectId = typeof obj.project_id === 'string' ? obj.project_id.trim() : '';
    const clientEmail = typeof obj.client_email === 'string' ? obj.client_email.trim() : '';
    const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
    if (!projectId || !clientEmail || !clientEmail.includes('@') || !privateKey.includes('PRIVATE KEY')) {
      return null;
    }
    const rawLocation =
      typeof obj.location === 'string'
        ? obj.location.trim()
        : typeof obj.region === 'string'
          ? obj.region.trim()
          : 'us-central1';
    const location = /^[a-z0-9-]+$/i.test(rawLocation) ? rawLocation : 'us-central1';
    const tokenUri =
      typeof obj.token_uri === 'string' && obj.token_uri.startsWith('https://')
        ? obj.token_uri.trim()
        : 'https://oauth2.googleapis.com/token';

    return {
      kind: 'service_account',
      projectId,
      clientEmail,
      location,
      tokenUri,
      compactedJson: JSON.stringify(obj),
    };
  }

  if (obj.type === 'authorized_user') {
    const clientId = typeof obj.client_id === 'string' ? obj.client_id.trim() : '';
    const clientSecret = typeof obj.client_secret === 'string' ? obj.client_secret.trim() : '';
    const refreshToken = typeof obj.refresh_token === 'string' ? obj.refresh_token.trim() : '';
    if (!clientId || !clientSecret || !refreshToken) {
      return null;
    }
    const projectId =
      typeof obj.quota_project_id === 'string'
        ? obj.quota_project_id.trim()
        : typeof obj.project_id === 'string'
          ? obj.project_id.trim()
          : '';
    const location =
      typeof obj.location === 'string' && /^[a-z0-9-]+$/i.test(obj.location.trim())
        ? obj.location.trim()
        : 'us-central1';
    return {
      kind: 'authorized_user',
      projectId,
      location,
      tokenUri: 'https://oauth2.googleapis.com/token',
      compactedJson: JSON.stringify(obj),
    };
  }

  return null;
}

function normalizePower(raw: unknown, modelId: string): AgentPowerLevel {
  if (raw === 'eco' || raw === 'standard' || raw === 'pro' || raw === 'ultra') {
    return raw;
  }
  return inferModelPowerTier(modelId);
}

function extractModelsList(raw: unknown): JsonSyncModelPatch[] {
  const out: JsonSyncModelPatch[] = [];
  const seen = new Set<string>();

  const pushModel = (id: unknown, meta?: Record<string, unknown>) => {
    if (typeof id !== 'string') return;
    const cleanId = id.trim();
    if (!cleanId || cleanId.length > 160 || seen.has(cleanId)) return;
    seen.add(cleanId);
    const displayName =
      meta && typeof meta.displayName === 'string'
        ? meta.displayName.trim()
        : meta && typeof meta.name === 'string'
          ? meta.name.trim()
          : undefined;
    out.push({
      id: cleanId,
      ...(displayName ? { displayName } : {}),
      power: normalizePower(meta?.power, cleanId),
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        pushModel(item);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        pushModel(rec.id ?? rec.model ?? rec.modelId, rec);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        pushModel(key, val as Record<string, unknown>);
      } else {
        pushModel(key);
      }
    }
  }
  return out;
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

function extractCredentialFromObject(
  obj: Record<string, unknown>,
  warnings: string[],
): {
  secretValue?: string;
  secretKind?: 'api_key' | 'google_service_account' | 'google_authorized_user';
  credentialLabel?: string;
} {
  // Inline Google service account nested under credentials / serviceAccount / auth
  const nestedObj =
    (obj.serviceAccount && typeof obj.serviceAccount === 'object' && !Array.isArray(obj.serviceAccount)
      ? obj.serviceAccount
      : obj.credentials && typeof obj.credentials === 'object' && !Array.isArray(obj.credentials)
        ? obj.credentials
        : obj.service_account && typeof obj.service_account === 'object' && !Array.isArray(obj.service_account)
          ? obj.service_account
          : null) as Record<string, unknown> | null;

  if (nestedObj) {
    const parsedNested = parseGoogleJsonCredential(JSON.stringify(nestedObj));
    if (parsedNested) {
      return {
        secretValue: parsedNested.compactedJson,
        secretKind:
          parsedNested.kind === 'service_account'
            ? 'google_service_account'
            : 'google_authorized_user',
        credentialLabel: parsedNested.projectId
          ? `SA:${parsedNested.projectId}`
          : 'Google JSON Credential',
      };
    }
  }

  const rawKey = pickFirstString(obj, [
    'apiKey',
    'api_key',
    'key',
    'token',
    'accessToken',
    'access_token',
    'secret',
    'credential',
  ]);
  if (!rawKey) return {};

  if (rawKey.startsWith('{')) {
    const googleCred = parseGoogleJsonCredential(rawKey);
    if (googleCred) {
      return {
        secretValue: googleCred.compactedJson,
        secretKind:
          googleCred.kind === 'service_account'
            ? 'google_service_account'
            : 'google_authorized_user',
        credentialLabel: googleCred.projectId ? `SA:${googleCred.projectId}` : 'Google JSON',
      };
    }
    warnings.push('Ignored malformed JSON string in apiKey field.');
    return {};
  }

  if (/[\r\n]/.test(rawKey) || rawKey.length < 6) {
    warnings.push('Ignored invalid or placeholder API key string.');
    return {};
  }

  return {
    secretValue: rawKey,
    secretKind: 'api_key',
  };
}

export function parseProviderJsonSync(
  rawJson: string,
  targetProviderHint?: LLMProvider,
): ParsedProviderJsonSyncResult {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    return {
      valid: false,
      detectedFormat: 'unknown',
      error: 'JSON payload is empty. Paste JSON or upload a .json file.',
      warnings: [],
      providerPatches: [],
      extraSecrets: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      valid: false,
      detectedFormat: 'unknown',
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'parse failed'}`,
      warnings: [],
      providerPatches: [],
      extraSecrets: [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      detectedFormat: 'unknown',
      error: 'JSON root must be an object ({ ... }).',
      warnings: [],
      providerPatches: [],
      extraSecrets: [],
    };
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  const providerPatches: JsonSyncProviderPatch[] = [];
  const extraSecrets: JsonSyncExtraSecret[] = [];

  // 1. Google Service Account / Authorized User JSON (Vertex AI / Gemini)
  if (obj.type === 'service_account' || obj.type === 'authorized_user') {
    const googleCred = parseGoogleJsonCredential(trimmed);
    if (!googleCred) {
      return {
        valid: false,
        detectedFormat:
          obj.type === 'service_account' ? 'google_service_account' : 'google_authorized_user',
        error:
          obj.type === 'service_account'
            ? 'Google Service Account JSON must include valid "project_id", "client_email", and PEM "private_key".'
            : 'Google Authorized User JSON must include "client_id", "client_secret", and "refresh_token".',
        warnings: [],
        providerPatches: [],
        extraSecrets: [],
      };
    }

    const provider = targetProviderHint ?? 'gemini';
    const customEnv = normalizeSecretName(
      pickFirstString(obj, ['envVarName', 'env_var_name', 'secretName', 'secret_name']) || '',
    );
    const defaultSaSecret =
      provider === 'gemini'
        ? customEnv || 'GEMINI_API_KEY'
        : customEnv || DEFAULT_SECRET_BY_PROVIDER[provider];

    const customBase = pickFirstString(obj, ['baseUrl', 'base_url', 'endpoint']);
    const effectiveBase =
      customBase || `https://${googleCred.location}-aiplatform.googleapis.com`;
    const urlCheck = validateHttpEndpointUrl(effectiveBase);
    if (!urlCheck.valid) {
      return {
        valid: false,
        detectedFormat:
          googleCred.kind === 'service_account'
            ? 'google_service_account'
            : 'google_authorized_user',
        error: urlCheck.error,
        warnings: [],
        providerPatches: [],
        extraSecrets: [],
      };
    }

    const modelsToAdd = extractModelsList(obj.models);
    const defaultModel = pickFirstString(obj, ['defaultModel', 'default_model', 'model']);
    if (defaultModel && !modelsToAdd.some((m) => m.id === defaultModel)) {
      modelsToAdd.unshift({ id: defaultModel, power: inferModelPowerTier(defaultModel) });
    }

    providerPatches.push({
      provider,
      baseUrl: urlCheck.cleaned,
      ...(defaultModel ? { defaultModel } : {}),
      envVarName: defaultSaSecret,
      modelsToAdd,
      secretName: defaultSaSecret,
      secretValue: googleCred.compactedJson,
      secretKind:
        googleCred.kind === 'service_account'
          ? 'google_service_account'
          : 'google_authorized_user',
      credentialLabel: googleCred.projectId
        ? `Google ${googleCred.kind === 'service_account' ? 'Service Account' : 'ADC'} (${googleCred.projectId})`
        : 'Google JSON Credential',
    });

    return {
      valid: true,
      detectedFormat:
        googleCred.kind === 'service_account'
          ? 'google_service_account'
          : 'google_authorized_user',
      warnings,
      providerPatches,
      extraSecrets,
    };
  }

  // 2. AetherFlow Multi-Provider Bundle OR OpenCode `opencode.json` (`{ provider: { ... } }` or `{ providers: { ... } }`)
  const mapContainer =
    obj.providers && typeof obj.providers === 'object' && !Array.isArray(obj.providers)
      ? (obj.providers as Record<string, unknown>)
      : obj.provider && typeof obj.provider === 'object' && !Array.isArray(obj.provider)
        ? (obj.provider as Record<string, unknown>)
        : null;

  if (mapContainer) {
    const isBundle = Boolean(obj.providers);
    for (const [rawKey, rawEntry] of Object.entries(mapContainer)) {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as Record<string, unknown>;
      const mappedProvider = resolveProviderAlias(rawKey) ?? targetProviderHint;
      if (!mappedProvider) {
        warnings.push(`Skipped unknown provider entry "${rawKey}".`);
        continue;
      }

      const optionsObj =
        entry.options && typeof entry.options === 'object' && !Array.isArray(entry.options)
          ? (entry.options as Record<string, unknown>)
          : null;

      const rawBase =
        pickFirstString(entry, ['baseUrl', 'base_url', 'baseURL', 'endpoint', 'api_base']) ??
        (optionsObj
          ? pickFirstString(optionsObj, ['baseURL', 'baseUrl', 'base_url', 'endpoint'])
          : undefined);
      const urlCheck = validateHttpEndpointUrl(rawBase);
      if (!urlCheck.valid) {
        return {
          valid: false,
          detectedFormat: isBundle ? 'aetherflow_bundle' : 'opencode_config',
          error: urlCheck.error,
          warnings: [],
          providerPatches: [],
          extraSecrets: [],
        };
      }

      const envRaw =
        pickFirstString(entry, ['envVarName', 'env_var_name', 'secretName', 'secret_name']) ?? '';
      const envVarName = normalizeSecretName(envRaw) || undefined;

      const cred = extractCredentialFromObject(optionsObj ?? entry, warnings);
      const secretName =
        envVarName || (cred.secretValue ? DEFAULT_SECRET_BY_PROVIDER[mappedProvider] : undefined);

      const modelMeta =
        entry.modelMeta && typeof entry.modelMeta === 'object' && !Array.isArray(entry.modelMeta)
          ? (entry.modelMeta as Record<string, { displayName?: string; power?: AgentPowerLevel }>)
          : {};

      const modelsFromField = extractModelsList(entry.models ?? entry.customModels);
      const modelsToAdd: JsonSyncModelPatch[] = modelsFromField.map((m) => {
        const meta = modelMeta[m.id];
        return {
          id: m.id,
          displayName: m.displayName ?? meta?.displayName,
          power: meta?.power ?? m.power,
        };
      });

      const defaultModel = pickFirstString(entry, ['defaultModel', 'default_model', 'model']);
      if (defaultModel && !modelsToAdd.some((m) => m.id === defaultModel)) {
        const meta = modelMeta[defaultModel];
        modelsToAdd.push({
          id: defaultModel,
          ...(meta?.displayName ? { displayName: meta.displayName } : {}),
          power: meta?.power ?? inferModelPowerTier(defaultModel),
        });
      }

      const disabledModels = Array.isArray(entry.disabledModels)
        ? entry.disabledModels.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : undefined;

      providerPatches.push({
        provider: mappedProvider,
        ...(urlCheck.cleaned ? { baseUrl: urlCheck.cleaned } : {}),
        ...(defaultModel ? { defaultModel } : {}),
        ...(envVarName ? { envVarName } : {}),
        modelsToAdd,
        ...(disabledModels ? { disabledModels } : {}),
        ...(secretName && cred.secretValue
          ? {
              secretName,
              secretValue: cred.secretValue,
              secretKind: cred.secretKind,
              credentialLabel: cred.credentialLabel,
            }
          : {}),
      });
    }

    if (obj.secrets && typeof obj.secrets === 'object' && !Array.isArray(obj.secrets)) {
      for (const [rawSecretKey, rawSecretVal] of Object.entries(
        obj.secrets as Record<string, unknown>,
      )) {
        const secretName = normalizeSecretName(rawSecretKey);
        if (!secretName) continue;
        if (typeof rawSecretVal === 'string' && rawSecretVal.trim()) {
          const val = rawSecretVal.trim();
          const googleCred = val.startsWith('{') ? parseGoogleJsonCredential(val) : null;
          if (googleCred) {
            extraSecrets.push({
              secretName,
              secretValue: googleCred.compactedJson,
              secretKind:
                googleCred.kind === 'service_account'
                  ? 'google_service_account'
                  : 'google_authorized_user',
              label: googleCred.projectId ? `SA:${googleCred.projectId}` : 'Google JSON',
            });
          } else if (!/[\r\n]/.test(val) && val.length >= 6) {
            extraSecrets.push({
              secretName,
              secretValue: val,
              secretKind: 'api_key',
            });
          }
        } else if (rawSecretVal && typeof rawSecretVal === 'object' && !Array.isArray(rawSecretVal)) {
          const googleCred = parseGoogleJsonCredential(JSON.stringify(rawSecretVal));
          if (googleCred) {
            extraSecrets.push({
              secretName,
              secretValue: googleCred.compactedJson,
              secretKind:
                googleCred.kind === 'service_account'
                  ? 'google_service_account'
                  : 'google_authorized_user',
              label: googleCred.projectId ? `SA:${googleCred.projectId}` : 'Google JSON',
            });
          }
        }
      }
    }

    if (providerPatches.length === 0 && extraSecrets.length === 0) {
      return {
        valid: false,
        detectedFormat: isBundle ? 'aetherflow_bundle' : 'opencode_config',
        error: 'No supported provider entries or secrets found inside JSON.',
        warnings,
        providerPatches: [],
        extraSecrets: [],
      };
    }

    return {
      valid: true,
      detectedFormat: isBundle ? 'aetherflow_bundle' : 'opencode_config',
      warnings,
      providerPatches,
      extraSecrets,
    };
  }

  // 3. Single-Provider JSON Config (`{ provider, apiKey, baseUrl, defaultModel, models, envVarName }`)
  const explicitProvider = resolveProviderAlias(
    pickFirstString(obj, ['provider', 'providerId', 'provider_id', 'vendor']),
  );

  const hasSingleProviderShape = Boolean(
    explicitProvider ||
      obj.apiKey ||
      obj.api_key ||
      obj.key ||
      obj.baseUrl ||
      obj.base_url ||
      obj.endpoint ||
      obj.models ||
      obj.defaultModel ||
      obj.default_model ||
      obj.model ||
      obj.serviceAccount ||
      obj.service_account,
  );

  // Distinguish `auth.json` (`{ openai: { type: "api", key: "..." }, anthropic: { key: "..." } }`)
  // from single-provider config when top-level keys are provider names with nested objects.
  const nestedProviderEntries = Object.entries(obj).filter(([k, v]) => {
    const alias = resolveProviderAlias(k);
    return Boolean(alias && v && typeof v === 'object' && !Array.isArray(v));
  });

  if (nestedProviderEntries.length > 0 && !explicitProvider) {
    for (const [rawKey, rawVal] of nestedProviderEntries) {
      const mapped = resolveProviderAlias(rawKey);
      if (!mapped) continue;
      const entry = rawVal as Record<string, unknown>;
      const cred = extractCredentialFromObject(entry, warnings);
      const rawBase = pickFirstString(entry, ['baseUrl', 'base_url', 'baseURL', 'endpoint']);
      const urlCheck = validateHttpEndpointUrl(rawBase);
      if (!urlCheck.valid) {
        return {
          valid: false,
          detectedFormat: 'auth_json',
          error: urlCheck.error,
          warnings: [],
          providerPatches: [],
          extraSecrets: [],
        };
      }
      const modelsToAdd = extractModelsList(entry.models ?? entry.customModels);
      const defaultModel = pickFirstString(entry, ['defaultModel', 'default_model', 'model']);
      if (defaultModel && !modelsToAdd.some((m) => m.id === defaultModel)) {
        modelsToAdd.push({ id: defaultModel, power: inferModelPowerTier(defaultModel) });
      }
      const envRaw =
        pickFirstString(entry, ['envVarName', 'env_var_name', 'secretName', 'secret_name']) ?? '';
      const envVarName = normalizeSecretName(envRaw) || undefined;
      const secretName =
        envVarName || (cred.secretValue ? DEFAULT_SECRET_BY_PROVIDER[mapped] : undefined);

      providerPatches.push({
        provider: mapped,
        ...(urlCheck.cleaned ? { baseUrl: urlCheck.cleaned } : {}),
        ...(defaultModel ? { defaultModel } : {}),
        ...(envVarName ? { envVarName } : {}),
        modelsToAdd,
        ...(secretName && cred.secretValue
          ? {
              secretName,
              secretValue: cred.secretValue,
              secretKind: cred.secretKind,
              credentialLabel: cred.credentialLabel,
            }
          : {}),
      });
    }

    if (providerPatches.length > 0) {
      return {
        valid: true,
        detectedFormat: 'auth_json',
        warnings,
        providerPatches,
        extraSecrets,
      };
    }
  }

  if (hasSingleProviderShape) {
    const inferredProvider =
      explicitProvider ??
      targetProviderHint ??
      (obj.serviceAccount || obj.service_account ? 'gemini' : 'openai');

    const rawBase = pickFirstString(obj, [
      'baseUrl',
      'base_url',
      'baseURL',
      'endpoint',
      'api_base',
      'url',
    ]);
    const urlCheck = validateHttpEndpointUrl(rawBase);
    if (!urlCheck.valid) {
      return {
        valid: false,
        detectedFormat: 'single_provider',
        error: urlCheck.error,
        warnings: [],
        providerPatches: [],
        extraSecrets: [],
      };
    }

    const cred = extractCredentialFromObject(obj, warnings);
    const envRaw =
      pickFirstString(obj, ['envVarName', 'env_var_name', 'secretName', 'secret_name']) ?? '';
    const envVarName = normalizeSecretName(envRaw) || undefined;
    const secretName =
      envVarName || (cred.secretValue ? DEFAULT_SECRET_BY_PROVIDER[inferredProvider] : undefined);

    const modelsToAdd = extractModelsList(obj.models ?? obj.customModels);
    const defaultModel = pickFirstString(obj, ['defaultModel', 'default_model', 'model']);
    if (defaultModel && !modelsToAdd.some((m) => m.id === defaultModel)) {
      modelsToAdd.unshift({ id: defaultModel, power: inferModelPowerTier(defaultModel) });
    }

    if (!urlCheck.cleaned && !defaultModel && modelsToAdd.length === 0 && !cred.secretValue && !envVarName) {
      return {
        valid: false,
        detectedFormat: 'single_provider',
        error: 'JSON did not contain any API key, Service Account, Base URL, or models to sync.',
        warnings,
        providerPatches: [],
        extraSecrets: [],
      };
    }

    providerPatches.push({
      provider: inferredProvider,
      ...(urlCheck.cleaned ? { baseUrl: urlCheck.cleaned } : {}),
      ...(defaultModel ? { defaultModel } : {}),
      ...(envVarName ? { envVarName } : {}),
      modelsToAdd,
      ...(secretName && cred.secretValue
        ? {
            secretName,
            secretValue: cred.secretValue,
            secretKind: cred.secretKind,
            credentialLabel: cred.credentialLabel,
          }
        : {}),
    });

    return {
      valid: true,
      detectedFormat: 'single_provider',
      warnings,
      providerPatches,
      extraSecrets,
    };
  }

  return {
    valid: false,
    detectedFormat: 'unknown',
    error:
      'Unrecognized AI provider JSON structure. Supported: Google Service Account JSON, OpenCode/Auth JSON, Single-Provider Config JSON, or AetherFlow Catalog JSON.',
    warnings,
    providerPatches: [],
    extraSecrets: [],
  };
}

export function applyProviderJsonPatches(
  currentProviders: AppSettings['providers'],
  patches: JsonSyncProviderPatch[],
): AppSettings['providers'] {
  const nextProviders: AppSettings['providers'] = { ...currentProviders };

  for (const patch of patches) {
    let cfg: ProviderEndpointConfig = {
      ...nextProviders[patch.provider],
      customModels: [...(nextProviders[patch.provider]?.customModels ?? [])],
      disabledModels: [...(nextProviders[patch.provider]?.disabledModels ?? [])],
      modelMeta: { ...(nextProviders[patch.provider]?.modelMeta ?? {}) },
    };

    if (patch.baseUrl !== undefined && patch.baseUrl.trim()) {
      cfg.baseUrl = patch.baseUrl.trim();
    }
    if (patch.envVarName) {
      cfg.envVarName = patch.envVarName;
    }
    if (patch.disabledModels) {
      cfg.disabledModels = Array.from(new Set(patch.disabledModels));
    }
    for (const modelPatch of patch.modelsToAdd) {
      cfg = addProviderModel(
        patch.provider,
        cfg,
        modelPatch.id,
        modelPatch.power,
        modelPatch.displayName,
      );
    }
    if (patch.defaultModel) {
      cfg.defaultModel = patch.defaultModel;
    }

    nextProviders[patch.provider] = cfg;
  }

  return nextProviders;
}

export function exportProvidersCatalogJson(providers: AppSettings['providers']): string {
  const sanitizedProviders: Record<string, ProviderEndpointConfig> = {};
  for (const [key, cfg] of Object.entries(providers)) {
    sanitizedProviders[key] = {
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel,
      envVarName: cfg.envVarName,
      customModels: [...(cfg.customModels ?? [])],
      disabledModels: [...(cfg.disabledModels ?? [])],
      modelMeta: { ...(cfg.modelMeta ?? {}) },
    };
  }
  return JSON.stringify(
    {
      format: 'aetherflow-providers-v1',
      exportedAt: new Date().toISOString(),
      note: 'Secret API keys and Service Account private keys are intentionally omitted for security.',
      providers: sanitizedProviders,
    },
    null,
    2,
  );
}
