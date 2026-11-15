import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSignedSessionToken,
  decryptSecret,
  encryptSecret,
  isEncryptedSecretValue,
  resetSecurityKeyCacheForTests,
  safeEqualSecret,
  safeResolveSandboxPath,
  sanitizeSandboxEnv,
  verifySignedSessionToken,
} from './security';

test('AES-256-GCM secret encryption round-trip and plaintext migration behavior', () => {
  const prevKey = process.env.AETHERFLOW_MASTER_KEY;
  process.env.AETHERFLOW_MASTER_KEY = 'unit-test-master-key-32-chars-minimum';
  resetSecurityKeyCacheForTests();

  try {
    const encrypted = encryptSecret('sk-test-1234567890');
    assert.ok(isEncryptedSecretValue(encrypted));
    assert.ok(!encrypted.includes('sk-test-1234567890'));

    const decrypted = decryptSecret(encrypted);
    assert.equal(decrypted.value, 'sk-test-1234567890');
    assert.equal(decrypted.wasPlaintext, false);

    // Legacy plaintext fallback signals migration needed
    const legacy = decryptSecret('legacy-plain-secret');
    assert.equal(legacy.value, 'legacy-plain-secret');
    assert.equal(legacy.wasPlaintext, true);
  } finally {
    if (prevKey === undefined) delete process.env.AETHERFLOW_MASTER_KEY;
    else process.env.AETHERFLOW_MASTER_KEY = prevKey;
    resetSecurityKeyCacheForTests();
  }
});

test('safeResolveSandboxPath blocks traversal, sibling prefixes, and symlink escapes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'af-sec-test-'));
  const sandboxDir = path.join(tempRoot, 'sandbox-1');
  const outsideDir = path.join(tempRoot, 'sandbox-12');
  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'top-secret', 'utf-8');

  try {
    const valid = safeResolveSandboxPath(sandboxDir, 'src/index.ts');
    assert.equal(valid, path.join(fs.realpathSync(sandboxDir), 'src', 'index.ts'));

    assert.throws(() => safeResolveSandboxPath(sandboxDir, '../sandbox-12/secret.txt'));
    assert.throws(() => safeResolveSandboxPath(sandboxDir, '/etc/passwd'));
    assert.throws(() => safeResolveSandboxPath(sandboxDir, 'src/../../outside.txt'));

    // Symlink escape guard
    const symlinkPath = path.join(sandboxDir, 'escape-link');
    fs.symlinkSync(outsideDir, symlinkPath);
    assert.throws(() => safeResolveSandboxPath(sandboxDir, 'escape-link/secret.txt'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('sanitizeSandboxEnv strips sensitive API keys and auth tokens', () => {
  const sanitized = sanitizeSandboxEnv({
    PATH: '/usr/bin',
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'gem-secret',
    GITHUB_TOKEN: 'ghp-secret',
    CUSTOM_SERVICE_SECRET: 'custom-secret',
    AETHERFLOW_AUTH_TOKEN: 'op-secret',
    SAFE_VAR: 'keep-me',
  });

  assert.equal(sanitized.PATH, '/usr/bin');
  assert.equal(sanitized.SAFE_VAR, 'keep-me');
  assert.equal(sanitized.GEMINI_API_KEY, undefined);
  assert.equal(sanitized.GITHUB_TOKEN, undefined);
  assert.equal(sanitized.CUSTOM_SERVICE_SECRET, undefined);
  assert.equal(sanitized.AETHERFLOW_AUTH_TOKEN, undefined);
});

test('HMAC signed operator session tokens and timing-safe secret comparison', () => {
  const prevKey = process.env.AETHERFLOW_MASTER_KEY;
  process.env.AETHERFLOW_MASTER_KEY = 'unit-test-hmac-key';
  resetSecurityKeyCacheForTests();

  try {
    const token = 'operator-token-xyz';
    const cookieVal = createSignedSessionToken(token);
    assert.equal(verifySignedSessionToken(cookieVal, token), true);
    assert.equal(verifySignedSessionToken(cookieVal, 'wrong-token'), false);
    assert.equal(verifySignedSessionToken('tampered.sig', token), false);

    assert.equal(safeEqualSecret('abc123', 'abc123'), true);
    assert.equal(safeEqualSecret('abc123', 'abc124'), false);
  } finally {
    if (prevKey === undefined) delete process.env.AETHERFLOW_MASTER_KEY;
    else process.env.AETHERFLOW_MASTER_KEY = prevKey;
    resetSecurityKeyCacheForTests();
  }
});
