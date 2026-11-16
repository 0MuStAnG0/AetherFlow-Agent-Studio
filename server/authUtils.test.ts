import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createUserSessionCookieValue,
  hashUserPassword,
  normalizeEmailInput,
  normalizeUsernameInput,
  parseAndVerifyUserSessionCookie,
  validateEmailAddress,
  validatePasswordStrength,
  verifyUserPassword,
} from './authUtils.ts';

test('validateEmailAddress and normalizeUsernameInput sanitize user identifiers', () => {
  assert.equal(normalizeEmailInput('  Hiva.Golkar@Example.COM '), 'hiva.golkar@example.com');
  assert.equal(validateEmailAddress('hiva@example.com').valid, true);
  assert.equal(validateEmailAddress('invalid-email').valid, false);
  assert.equal(normalizeUsernameInput('Admin User!!', 'admin@example.com'), 'adminuser');
  assert.equal(normalizeUsernameInput('', 'hiva.dev@example.com'), 'hiva.dev');
});

test('hashUserPassword and verifyUserPassword use scrypt salted verification', () => {
  assert.equal(validatePasswordStrength('short').valid, false);
  assert.equal(validatePasswordStrength('StrongPass123!').valid, true);

  const hash1 = hashUserPassword('StrongPass123!');
  const hash2 = hashUserPassword('StrongPass123!');
  assert.ok(hash1.startsWith('scrypt:v1:'));
  assert.notEqual(hash1, hash2); // unique random salt per hash
  assert.equal(verifyUserPassword('StrongPass123!', hash1), true);
  assert.equal(verifyUserPassword('WrongPass123!', hash1), false);
  assert.equal(verifyUserPassword('StrongPass123!', 'malformed'), false);
});

test('createUserSessionCookieValue and parseAndVerifyUserSessionCookie enforce HMAC and sessionVersion', () => {
  const key = crypto.randomBytes(32);
  const now = 1_760_000_000_000;
  const cookie = createUserSessionCookieValue({
    userId: 'usr-123',
    sessionVersion: 2,
    signingKey: key,
    issuedAtMs: now,
  });

  const valid = parseAndVerifyUserSessionCookie({
    cookieValue: cookie,
    signingKey: key,
    nowMs: now + 5000,
  });
  assert.deepEqual(valid, { valid: true, userId: 'usr-123', sessionVersion: 2 });

  const tampered = cookie.slice(0, -4) + 'AAAA';
  assert.equal(
    parseAndVerifyUserSessionCookie({ cookieValue: tampered, signingKey: key, nowMs: now }).valid,
    false,
  );

  const expired = parseAndVerifyUserSessionCookie({
    cookieValue: cookie,
    signingKey: key,
    maxAgeMs: 1000,
    nowMs: now + 5000,
  });
  assert.equal(expired.valid, false);
});
