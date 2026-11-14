import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGeminiApiError,
  maskApiKey,
  normalizeSecretName,
  parseGeminiBaseUrl,
  validateApiKeyValue,
} from './secretUtils.ts';

test('normalizeSecretName sanitizes and validates env-style secret identifiers', () => {
  assert.equal(normalizeSecretName('openai_api_key'), 'OPENAI_API_KEY');
  assert.equal(normalizeSecretName(' gemini-team b '), 'GEMINI_TEAM_B');
  assert.equal(normalizeSecretName('123INVALID'), '');
  assert.equal(normalizeSecretName(''), '');
});

test('maskApiKey never returns full secret and masks middle characters', () => {
  assert.equal(maskApiKey('sk-proj-1234567890abcd'), 'sk-p••••abcd');
  assert.equal(maskApiKey('short1'), '••••••');
  assert.equal(maskApiKey(''), '');
});

test('validateApiKeyValue rejects placeholders, newlines, and short keys', () => {
  assert.equal(validateApiKeyValue('MY_GEMINI_API_KEY').valid, false);
  assert.equal(validateApiKeyValue('abc').valid, false);
  assert.equal(validateApiKeyValue('sk-valid-key-123456\nmore').valid, false);
  const ok = validateApiKeyValue('  sk-live-9988776655  ');
  assert.equal(ok.valid, true);
  assert.equal(ok.cleaned, 'sk-live-9988776655');
});

test('parseGeminiBaseUrl extracts proxy origin and apiVersion without double /v1', () => {
  assert.deepEqual(parseGeminiBaseUrl(''), {});
  assert.deepEqual(parseGeminiBaseUrl('https://generativelanguage.googleapis.com'), {});
  assert.deepEqual(parseGeminiBaseUrl('https://generativelanguage.googleapis.com/v1beta/'), {
    apiVersion: 'v1beta',
  });
  assert.deepEqual(parseGeminiBaseUrl('https://gemini-relay.workers.dev'), {
    baseUrl: 'https://gemini-relay.workers.dev',
  });
  assert.deepEqual(parseGeminiBaseUrl('https://gemini-relay.workers.dev/proxy/v1beta/'), {
    baseUrl: 'https://gemini-relay.workers.dev/proxy',
    apiVersion: 'v1beta',
  });
  assert.deepEqual(parseGeminiBaseUrl('http://127.0.0.1:8787/v1'), {
    baseUrl: 'http://127.0.0.1:8787',
    apiVersion: 'v1',
  });
  assert.ok(parseGeminiBaseUrl('not-a-url').error);
});

test('formatGeminiApiError converts Google HTML 403 and JSON API errors into clean messages', () => {
  const html403Payload = JSON.stringify({
    error: {
      message:
        '<!DOCTYPE html>\n<html lang=en><title>Error 403 (Forbidden)!!1</title><p>Your client does not have permission to get URL <code>/v1/models/gemini-3.1-flash-lite:generateContent</code> from this server.</p>',
      code: 403,
      status: 'Forbidden',
    },
  });

  const enRes = formatGeminiApiError(new Error(html403Payload), 'en');
  assert.equal(enRes.status, 403);
  assert.equal(enRes.code, 'GEO_OR_ENDPOINT_FORBIDDEN');
  assert.ok(!enRes.message.includes('<!DOCTYPE'));
  assert.ok(enRes.message.includes('Base URL'));

  const faRes = formatGeminiApiError(new Error(html403Payload), 'fa');
  assert.equal(faRes.status, 403);
  assert.ok(!faRes.message.includes('<html'));
  assert.ok(faRes.message.includes('403'));

  const invalidKeyRes = formatGeminiApiError(
    new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'),
    'en',
  );
  assert.equal(invalidKeyRes.status, 400);
  assert.equal(invalidKeyRes.code, 'API_KEY_INVALID');

  const unauthRes = formatGeminiApiError(
    new Error('{"error":{"code":401,"message":"API keys are not supported by this API.","status":"UNAUTHENTICATED"}}'),
    'fa',
  );
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthRes.code, 'UNAUTHENTICATED');
  assert.ok(unauthRes.message.includes('AIza'));
});
