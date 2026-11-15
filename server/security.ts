import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const ENCRYPTED_PREFIX = 'enc:v1:';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const MASTER_KEY_FILE = path.join(DATA_DIR, '.master_key');

let cachedMasterKey: Buffer | null = null;

export function resetSecurityKeyCacheForTests(): void {
  cachedMasterKey = null;
}

export function getMasterEncryptionKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envSecret = (
    process.env.APP_SECRET ||
    process.env.AETHERFLOW_MASTER_KEY ||
    ''
  ).trim();

  if (envSecret) {
    cachedMasterKey = crypto.createHash('sha256').update(envSecret, 'utf-8').digest();
    return cachedMasterKey;
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(MASTER_KEY_FILE)) {
      const raw = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(raw)) {
        cachedMasterKey = Buffer.from(raw, 'hex');
        return cachedMasterKey;
      }
    }
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(MASTER_KEY_FILE, generated.toString('hex'), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    cachedMasterKey = generated;
    return cachedMasterKey;
  } catch {
    // Ephemeral fallback if filesystem is read-only
    cachedMasterKey = crypto.randomBytes(32);
    return cachedMasterKey;
  }
}

export function isEncryptedSecretValue(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) return '';
  if (isEncryptedSecretValue(trimmed)) return trimmed;

  const key = getMasterEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(stored: string): {
  value: string;
  wasPlaintext: boolean;
} {
  if (!stored || typeof stored !== 'string') {
    return { value: '', wasPlaintext: false };
  }
  const trimmed = stored.trim();
  if (!trimmed.startsWith(ENCRYPTED_PREFIX)) {
    return { value: trimmed, wasPlaintext: Boolean(trimmed) };
  }

  const parts = trimmed.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret envelope');
  }

  const [ivB64, tagB64, cipherB64] = parts;
  const key = getMasterEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  return { value: decrypted, wasPlaintext: false };
}

export function safeEqualSecret(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(String(a || ''), 'utf-8').digest();
  const bufB = crypto.createHash('sha256').update(String(b || ''), 'utf-8').digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getConfiguredOperatorAuthToken(): string {
  return (process.env.AETHERFLOW_AUTH_TOKEN || process.env.AUTH_TOKEN || '').trim();
}

export function isOperatorAuthEnabled(): boolean {
  return getConfiguredOperatorAuthToken().length > 0;
}

const SESSION_COOKIE_NAME = 'aetherflow_session';

export function createSignedSessionToken(authToken: string): string {
  const key = getMasterEncryptionKey();
  const issuedAt = Date.now().toString(36);
  const sig = crypto
    .createHmac('sha256', key)
    .update(`${issuedAt}:${authToken}`)
    .digest('base64url');
  return `${issuedAt}.${sig}`;
}

export function verifySignedSessionToken(sessionCookie: string, expectedAuthToken: string): boolean {
  if (!sessionCookie || !expectedAuthToken) return false;
  const dot = sessionCookie.indexOf('.');
  if (dot <= 0) return false;
  const issuedAt = sessionCookie.slice(0, dot);
  const sig = sessionCookie.slice(dot + 1);
  if (!issuedAt || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', getMasterEncryptionKey())
    .update(`${issuedAt}:${expectedAuthToken}`)
    .digest('base64url');
  return safeEqualSecret(sig, expectedSig);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export function isRequestAuthorized(req: {
  headers: { authorization?: string; cookie?: string };
}): boolean {
  const expected = getConfiguredOperatorAuthToken();
  if (!expected) return true;

  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (safeEqualSecret(token, expected)) return true;
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken && verifySignedSessionToken(sessionToken, expected)) {
    return true;
  }

  return false;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function requireOperatorAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isOperatorAuthEnabled()) {
    next();
    return;
  }

  // Public routes that remain accessible without operator login:
  if (
    req.path === '/health' ||
    req.path === '/auth/status' ||
    req.path === '/auth/login' ||
    req.path === '/auth/logout' ||
    /^\/webhooks\/[^/]+(\/trigger)?$/.test(req.path)
  ) {
    next();
    return;
  }

  if (!isRequestAuthorized(req)) {
    res.status(401).json({
      error: 'Authentication required. Sign in with the configured AETHERFLOW_AUTH_TOKEN.',
      authRequired: true,
    });
    return;
  }

  next();
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

export function createIpRateLimiter(params: {
  windowMs: number;
  maxRequests: number;
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const now = Date.now();
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ||
      req.ip ||
      'unknown';

    if (buckets.size > 2000) {
      for (const [k, v] of buckets.entries()) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }

    const entry = buckets.get(ip);
    if (!entry || entry.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + params.windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > params.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests from ${ip}. Retry after ${retryAfterSec}s.`,
      });
      return;
    }

    next();
  };
}

/**
 * Resolves a relative file path safely inside baseDir and blocks:
 * 1. ".." segments and absolute paths
 * 2. Sibling prefix collisions (/tmp/sandbox-1 vs /tmp/sandbox-12)
 * 3. Symlink escapes pointing outside baseDir
 */
export function safeResolveSandboxPath(baseDir: string, relPath: string): string {
  const normalizedBase = path.resolve(baseDir);
  if (!fs.existsSync(normalizedBase)) {
    fs.mkdirSync(normalizedBase, { recursive: true });
  }
  const realBase = fs.realpathSync(normalizedBase);
  const cleaned = String(relPath || '').replace(/\\/g, '/').trim();

  if (!cleaned || cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error(`Blocked invalid sandbox path: ${relPath}`);
  }

  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`Blocked path traversal attempt: ${relPath}`);
  }

  const target = path.resolve(realBase, ...segments);
  const relFromBase = path.relative(realBase, target);
  if (!relFromBase || relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
    throw new Error(`Blocked path traversal attempt: ${relPath}`);
  }

  // Walk up to the nearest existing ancestor and verify realpath does not escape via symlink
  let probe = target;
  while (probe !== realBase && !fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    const probeRel = path.relative(realBase, realProbe);
    if (probeRel.startsWith('..') || path.isAbsolute(probeRel)) {
      throw new Error(`Blocked symlink escape outside sandbox: ${relPath}`);
    }
  }

  return target;
}

const SENSITIVE_ENV_KEYS = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENCODE_API_KEY',
  'GITHUB_TOKEN',
  'APP_SECRET',
  'AETHERFLOW_MASTER_KEY',
  'AETHERFLOW_AUTH_TOKEN',
  'AUTH_TOKEN',
]);

export function sanitizeSandboxEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (!v) continue;
    const upper = k.toUpperCase();
    if (
      SENSITIVE_ENV_KEYS.has(upper) ||
      upper.endsWith('_API_KEY') ||
      upper.endsWith('_SECRET') ||
      upper.endsWith('_TOKEN')
    ) {
      continue;
    }
    clean[k] = v;
  }
  return clean;
}
