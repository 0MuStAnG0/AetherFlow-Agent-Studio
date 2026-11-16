import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_SETTINGS } from './workflowEngine';
import {
  applyProviderJsonPatches,
  exportProvidersCatalogJson,
  parseGoogleJsonCredential,
  parseProviderJsonSync,
} from './providerJsonSync';
import { maskApiKey, validateProviderCredentialValue } from './secretUtils';

const SAMPLE_SA_JSON = JSON.stringify(
  {
    type: 'service_account',
    project_id: 'aetherflow-vertex-prod',
    private_key_id: 'key123',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----\n',
    client_email: 'runner@aetherflow-vertex-prod.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
    location: 'europe-west4',
  },
  null,
  2,
);

test('parseProviderJsonSync parses Google Service Account JSON and compacts credential safely', () => {
  const result = parseProviderJsonSync(SAMPLE_SA_JSON);
  assert.equal(result.valid, true);
  assert.equal(result.detectedFormat, 'google_service_account');
  assert.equal(result.providerPatches.length, 1);

  const patch = result.providerPatches[0];
  assert.equal(patch.provider, 'gemini');
  assert.equal(patch.baseUrl, 'https://europe-west4-aiplatform.googleapis.com');
  assert.equal(patch.secretName, 'GEMINI_API_KEY');
  assert.equal(patch.secretKind, 'google_service_account');
  assert.ok(patch.secretValue);
  assert.equal(/[\r\n]/.test(patch.secretValue), false);
  assert.equal(maskApiKey(patch.secretValue), 'SA:aetherflow-vertex-prod');

  const parsedCred = parseGoogleJsonCredential(patch.secretValue);
  assert.ok(parsedCred);
  assert.equal(parsedCred.projectId, 'aetherflow-vertex-prod');
  assert.equal(parsedCred.location, 'europe-west4');
});

test('validateProviderCredentialValue accepts compacted or multiline Google Service Account JSON', () => {
  const res = validateProviderCredentialValue(SAMPLE_SA_JSON);
  assert.equal(res.valid, true);
  assert.equal(res.kind, 'google_service_account');
  assert.equal(/[\r\n]/.test(res.cleaned), false);

  const badSa = validateProviderCredentialValue(JSON.stringify({ type: 'service_account', project_id: 'x' }));
  assert.equal(badSa.valid, false);
});

test('parseProviderJsonSync parses OpenCode / Codex auth.json multi-provider format', () => {
  const raw = JSON.stringify({
    openai: { type: 'api', key: 'sk-openai-test-99887766' },
    anthropic: { key: 'sk-ant-test-11223344' },
    google: { key: 'AIzaSyTestExampleKey1234567' },
  });
  const res = parseProviderJsonSync(raw);
  assert.equal(res.valid, true);
  assert.equal(res.detectedFormat, 'auth_json');
  assert.equal(res.providerPatches.length, 3);
  assert.equal(res.providerPatches[0].provider, 'openai');
  assert.equal(res.providerPatches[0].secretValue, 'sk-openai-test-99887766');
  assert.equal(res.providerPatches[1].provider, 'anthropic');
  assert.equal(res.providerPatches[2].provider, 'gemini');
});

test('parseProviderJsonSync parses opencode.json provider + models catalog', () => {
  const raw = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      opencode: {
        options: {
          baseURL: 'https://opencode.ai/zen/v1',
          apiKey: 'oc-zen-test-token-5555',
        },
        models: {
          'qwen-coder-plus': { name: 'Qwen Coder Plus', power: 'pro' },
          'big-pickle': { name: 'Big Pickle' },
        },
      },
    },
  });
  const res = parseProviderJsonSync(raw);
  assert.equal(res.valid, true);
  assert.equal(res.detectedFormat, 'opencode_config');
  assert.equal(res.providerPatches.length, 1);
  const patch = res.providerPatches[0];
  assert.equal(patch.provider, 'opencode');
  assert.equal(patch.baseUrl, 'https://opencode.ai/zen/v1');
  assert.equal(patch.secretValue, 'oc-zen-test-token-5555');
  assert.equal(patch.modelsToAdd.length, 2);
  assert.equal(patch.modelsToAdd[0].id, 'qwen-coder-plus');
  assert.equal(patch.modelsToAdd[0].power, 'pro');
});

test('parseProviderJsonSync parses single-provider JSON and rejects non-HTTP endpoints', () => {
  const validRaw = JSON.stringify({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test-key-000111',
    baseUrl: 'https://openrouter.ai/api/v1/',
    defaultModel: 'deepseek/deepseek-r1:free',
    models: ['deepseek/deepseek-r1:free', { id: 'qwen/qwen3-32b', power: 'pro' }],
  });
  const ok = parseProviderJsonSync(validRaw);
  assert.equal(ok.valid, true);
  assert.equal(ok.detectedFormat, 'single_provider');
  assert.equal(ok.providerPatches[0].provider, 'openai');
  assert.equal(ok.providerPatches[0].baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(ok.providerPatches[0].defaultModel, 'deepseek/deepseek-r1:free');
  assert.equal(ok.providerPatches[0].modelsToAdd.length, 2);

  const badUrl = parseProviderJsonSync(
    JSON.stringify({
      provider: 'openai',
      baseUrl: 'javascript:alert(1)',
    }),
  );
  assert.equal(badUrl.valid, false);
  assert.match(badUrl.error || '', /http:\/\/ or https:\/\//i);
});

test('applyProviderJsonPatches merges without duplicate models and exportProvidersCatalogJson omits secrets', () => {
  const res = parseProviderJsonSync(
    JSON.stringify({
      provider: 'openai',
      apiKey: 'sk-secret-must-not-leak',
      baseUrl: 'https://api.example-llm.com/v1',
      defaultModel: 'custom-gpt-pro',
      models: ['custom-gpt-pro', 'gpt-4o'],
    }),
  );
  assert.equal(res.valid, true);

  const merged = applyProviderJsonPatches(DEFAULT_APP_SETTINGS.providers, res.providerPatches);
  assert.equal(merged.openai.baseUrl, 'https://api.example-llm.com/v1');
  assert.equal(merged.openai.defaultModel, 'custom-gpt-pro');
  assert.equal(merged.openai.customModels.includes('custom-gpt-pro'), true);
  // Built-in gpt-4o should not duplicate in customModels
  assert.equal(merged.openai.customModels.includes('gpt-4o'), false);

  const exportedJson = exportProvidersCatalogJson(merged);
  assert.equal(exportedJson.includes('sk-secret-must-not-leak'), false);
  const parsedExport = JSON.parse(exportedJson) as {
    format: string;
    providers: Record<string, { baseUrl: string; defaultModel: string }>;
  };
  assert.equal(parsedExport.format, 'aetherflow-providers-v1');
  assert.equal(parsedExport.providers.openai.baseUrl, 'https://api.example-llm.com/v1');

  // Re-importing our own export format works seamlessly
  const reimported = parseProviderJsonSync(exportedJson);
  assert.equal(reimported.valid, true);
  assert.equal(reimported.detectedFormat, 'aetherflow_bundle');
});
