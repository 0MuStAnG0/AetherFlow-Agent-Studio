import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskApiKey,
  normalizeSecretName,
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
