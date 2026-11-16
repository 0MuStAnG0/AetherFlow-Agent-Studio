import crypto from 'node:crypto';
import { safeEqualSecret } from './security.ts';

const HASH_PREFIX = 'scrypt:v1:';
const SCRYPT_KEYLEN = 64;

export function normalizeEmailInput(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function validateEmailAddress(email: string): {
  valid: boolean;
  email: string;
  error?: string;
} {
  const cleaned = normalizeEmailInput(email);
  if (!cleaned) {
    return { valid: false, email: '', error: 'Email address is required.' };
  }
  if (cleaned.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned)) {
    return { valid: false, email: '', error: 'Enter a valid email address.' };
  }
  return { valid: true, email: cleaned };
}

export function normalizeUsernameInput(raw: string, fallbackEmail?: string): string {
  const candidate = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (candidate.length >= 3) return candidate.slice(0, 32);
  if (fallbackEmail) {
    const local = fallbackEmail.split('@')[0]?.replace(/[^a-z0-9._-]/g, '') || 'user';
    return local.slice(0, 28) || 'operator';
  }
  return '';
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must not exceed 128 characters.' };
  }
  return { valid: true };
}

export function hashUserPassword(password: string): string {
  const check = validatePasswordStrength(password);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid password.');
  }
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('base64url');
  return `${HASH_PREFIX}${salt}:${derived}`;
}

export function verifyUserPassword(password: string, storedHash: string): boolean {
  if (!password || typeof storedHash !== 'string' || !storedHash.startsWith(HASH_PREFIX)) {
    return false;
  }
  const rest = storedHash.slice(HASH_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return false;
  const salt = rest.slice(0, sep);
  const expectedB64 = rest.slice(sep + 1);
  if (!salt || !expectedB64) return false;
  try {
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('base64url');
    return safeEqualSecret(derived, expectedB64);
  } catch {
    return false;
  }
}

export function createUserSessionCookieValue(params: {
  userId: string;
  sessionVersion: number;
  signingKey: Buffer;
  issuedAtMs?: number;
}): string {
  const issuedAt = (params.issuedAtMs ?? Date.now()).toString(36);
  const payload = `${params.userId}.${params.sessionVersion}.${issuedAt}`;
  const sig = crypto.createHmac('sha256', params.signingKey).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function parseAndVerifyUserSessionCookie(params: {
  cookieValue: string;
  signingKey: Buffer;
  maxAgeMs?: number;
  nowMs?: number;
}): {
  valid: boolean;
  userId?: string;
  sessionVersion?: number;
} {
  const raw = String(params.cookieValue || '').trim();
  if (!raw) return { valid: false };
  const parts = raw.split('.');
  if (parts.length !== 4) return { valid: false };
  const [userId, versionStr, issuedAtStr, sig] = parts;
  if (!userId || !versionStr || !issuedAtStr || !sig) return { valid: false };
  const sessionVersion = Number(versionStr);
  const issuedAtMs = Number.parseInt(issuedAtStr, 36);
  if (!Number.isInteger(sessionVersion) || sessionVersion < 1 || !Number.isFinite(issuedAtMs)) {
    return { valid: false };
  }
  const maxAge = params.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const now = params.nowMs ?? Date.now();
  if (now - issuedAtMs > maxAge || issuedAtMs - now > 60_000) {
    return { valid: false };
  }

  const payload = `${userId}.${versionStr}.${issuedAtStr}`;
  const expectedSig = crypto
    .createHmac('sha256', params.signingKey)
    .update(payload)
    .digest('base64url');
  if (!safeEqualSecret(sig, expectedSig)) {
    return { valid: false };
  }
  return { valid: true, userId, sessionVersion };
}
