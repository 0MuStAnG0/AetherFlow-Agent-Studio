export function normalizeSecretName(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned || cleaned.length > 64) {
    return '';
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export function maskApiKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { type?: string; project_id?: string };
      if (parsed && typeof parsed === 'object') {
        if (parsed.type === 'service_account') {
          return parsed.project_id ? `SA:${parsed.project_id}` : 'SA:json••••';
        }
        if (parsed.type === 'authorized_user') {
          return 'ADC:json••••';
        }
      }
    } catch {
      // fall back to generic masking
    }
  }
  if (trimmed.length <= 8) {
    return '••••••';
  }
  const prefix = trimmed.slice(0, Math.min(4, trimmed.length));
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function validateApiKeyValue(raw: string): {
  valid: boolean;
  cleaned: string;
  error?: string;
} {
  const cleaned = raw.trim();
  if (!cleaned) {
    return { valid: false, cleaned: '', error: 'API key cannot be empty.' };
  }
  if (cleaned === 'MY_GEMINI_API_KEY' || /^your[_-]?api[_-]?key$/i.test(cleaned)) {
    return { valid: false, cleaned: '', error: 'Please enter a real API key, not a placeholder.' };
  }
  if (cleaned.length < 6) {
    return { valid: false, cleaned: '', error: 'API key appears too short.' };
  }
  if (/[\r\n]/.test(cleaned)) {
    return { valid: false, cleaned: '', error: 'API key cannot contain newline characters.' };
  }
  return { valid: true, cleaned };
}

export function validateProviderCredentialValue(raw: string): {
  valid: boolean;
  cleaned: string;
  kind: 'api_key' | 'google_service_account' | 'google_authorized_user';
  error?: string;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        project_id?: string;
        client_email?: string;
        private_key?: string;
        client_id?: string;
        client_secret?: string;
        refresh_token?: string;
      };
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.type === 'service_account') {
          if (
            typeof parsed.project_id === 'string' &&
            parsed.project_id.trim() &&
            typeof parsed.client_email === 'string' &&
            parsed.client_email.includes('@') &&
            typeof parsed.private_key === 'string' &&
            parsed.private_key.includes('PRIVATE KEY')
          ) {
            return {
              valid: true,
              cleaned: JSON.stringify(parsed),
              kind: 'google_service_account',
            };
          }
          return {
            valid: false,
            cleaned: '',
            kind: 'google_service_account',
            error:
              'Invalid Google Service Account JSON: requires project_id, client_email, and PEM private_key.',
          };
        }
        if (parsed.type === 'authorized_user') {
          if (
            typeof parsed.client_id === 'string' &&
            parsed.client_id.trim() &&
            typeof parsed.client_secret === 'string' &&
            parsed.client_secret.trim() &&
            typeof parsed.refresh_token === 'string' &&
            parsed.refresh_token.trim()
          ) {
            return {
              valid: true,
              cleaned: JSON.stringify(parsed),
              kind: 'google_authorized_user',
            };
          }
          return {
            valid: false,
            cleaned: '',
            kind: 'google_authorized_user',
            error:
              'Invalid Google Authorized User JSON: requires client_id, client_secret, and refresh_token.',
          };
        }
      }
    } catch {
      return {
        valid: false,
        cleaned: '',
        kind: 'api_key',
        error: 'Malformed JSON credential pasted.',
      };
    }
  }
  const keyCheck = validateApiKeyValue(raw);
  return { ...keyCheck, kind: 'api_key' };
}

export type GeminiApiVersion = 'v1' | 'v1beta' | 'v1alpha' | 'v1beta1';

export interface ParsedGeminiBaseUrl {
  baseUrl?: string;
  apiVersion?: GeminiApiVersion;
  error?: string;
}

const DEFAULT_GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

export function parseGeminiBaseUrl(rawUrl?: string): ParsedGeminiBaseUrl {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {};
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      error: 'Invalid Gemini Base URL. Enter a valid http:// or https:// URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      error: 'Invalid Gemini Base URL protocol. Only http:// and https:// are supported.',
    };
  }

  let pathname = parsed.pathname.replace(/\/+$/, '');
  let apiVersion: GeminiApiVersion | undefined;

  const versionMatch = pathname.match(/^(.*)\/(v1beta1|v1beta|v1alpha|v1)$/i);
  if (versionMatch) {
    pathname = versionMatch[1];
    apiVersion = versionMatch[2].toLowerCase() as GeminiApiVersion;
  }

  const normalizedBase = `${parsed.origin}${pathname}`.replace(/\/+$/, '');
  const isDefaultHost = normalizedBase.toLowerCase() === DEFAULT_GEMINI_ORIGIN;

  return {
    ...(isDefaultHost ? {} : { baseUrl: normalizedBase }),
    ...(apiVersion ? { apiVersion } : {}),
  };
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRawErrorMessage(err: unknown): { text: string; statusHint?: number } {
  if (typeof err === 'string') {
    return { text: err };
  }
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const statusHint =
      typeof rec.status === 'number'
        ? rec.status
        : typeof rec.code === 'number'
          ? rec.code
          : undefined;
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return { text: rec.message, statusHint };
    }
    try {
      return { text: JSON.stringify(err), statusHint };
    } catch {
      return { text: String(err), statusHint };
    }
  }
  return { text: String(err ?? 'Unknown error') };
}

function unwrapJsonApiError(text: string): {
  code?: number;
  status?: string;
  message?: string;
} | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate) as {
      error?: { code?: number; status?: string; message?: string };
      code?: number;
      status?: string;
      message?: string;
    };
    const inner = parsed.error ?? parsed;
    if (inner && typeof inner === 'object' && ('message' in inner || 'code' in inner || 'status' in inner)) {
      return {
        code: typeof inner.code === 'number' ? inner.code : undefined,
        status: typeof inner.status === 'string' ? inner.status : undefined,
        message: typeof inner.message === 'string' ? inner.message : undefined,
      };
    }
  } catch {
    // Ignore non-JSON wrapper text
  }
  return null;
}

export function formatGeminiApiError(
  err: unknown,
  lang: 'en' | 'fa' = 'en',
): { status: number; code: string; message: string } {
  const isFa = lang === 'fa';
  const { text: rawText, statusHint } = extractRawErrorMessage(err);
  const jsonInner = unwrapJsonApiError(rawText);
  const innerMessage = jsonInner?.message || rawText;
  const effectiveStatus = jsonInner?.code ?? statusHint ?? 0;
  const effectiveCode = jsonInner?.status || '';
  const lower = innerMessage.toLowerCase();

  // 1. Google GFE / proxy HTML 403 Forbidden page (never leak raw HTML to UI)
  if (
    /<(?:!doctype\s+html|html\b)/i.test(innerMessage) &&
    (effectiveStatus === 403 ||
      /error\s*403|forbidden|does not have permission to get url/i.test(innerMessage))
  ) {
    return {
      status: 403,
      code: 'GEO_OR_ENDPOINT_FORBIDDEN',
      message: isFa
        ? 'دسترسی مستقیم سرور به Google Gemini با خطای 403 مسدود شد (احتمالاً به‌دلیل محدودیت IP/منطقه یا فایروال). در بخش «API Endpoint / Base URL» آدرس یک پراکسی/ورکر معتبر Gemini را وارد کنید.'
        : 'Google blocked direct access to Gemini (HTTP 403 Forbidden, likely region/IP restriction or blocked proxy). Set a working Gemini relay/proxy URL in "API Endpoint / Base URL".',
    };
  }

  // 2. Any other HTML error response from a proxy/gateway
  if (/<(?:!doctype\s+html|html\b)/i.test(innerMessage)) {
    const titleMatch = innerMessage.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? stripHtmlToText(titleMatch[1]) : '';
    const cleaned = stripHtmlToText(innerMessage).slice(0, 180);
    const summary = title || cleaned || 'Gateway returned an HTML error page';
    const status = effectiveStatus || 502;
    return {
      status,
      code: effectiveCode || `HTTP_${status}`,
      message: isFa
        ? `خطای سرور/پراکسی (HTTP ${status}): ${summary}`
        : `Endpoint returned HTTP ${status}: ${summary}`,
    };
  }

  // 3. Invalid API key
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key')
  ) {
    return {
      status: 400,
      code: 'API_KEY_INVALID',
      message: isFa
        ? 'کلید API نامعتبر است. مطمئن شوید کلید معتبر Google AI Studio (شروع با AIza...) را بدون فاصله اضافی وارد کرده‌اید.'
        : 'Invalid API key. Verify you copied a valid Google AI Studio key (AIza...) without extra whitespace.',
    };
  }

  // 4. Token type unsupported (e.g. AQ. / OAuth token sent to AIza endpoint)
  if (
    lower.includes('access_token_type_unsupported') ||
    effectiveStatus === 401 ||
    effectiveCode === 'UNAUTHENTICATED'
  ) {
    return {
      status: 401,
      code: 'UNAUTHENTICATED',
      message: isFa
        ? 'احراز هویت ناموفق بود (HTTP 401). برای Gemini Developer API باید کلید استاندارد AI Studio (شروع با AIza...) وارد شود.'
        : 'Authentication failed (HTTP 401). Standard Gemini Developer API requires an AI Studio API key (starting with AIza...).',
    };
  }

  // 5. Location / Permission denied JSON 403
  if (
    effectiveStatus === 403 ||
    effectiveCode === 'PERMISSION_DENIED' ||
    lower.includes('user location is not supported')
  ) {
    if (lower.includes('user location is not supported')) {
      return {
        status: 403,
        code: 'LOCATION_NOT_SUPPORTED',
        message: isFa
          ? 'منطقه جغرافیایی سرور توسط Google Gemini پشتیبانی نمی‌شود (403). در «API Endpoint / Base URL» آدرس یک پراکسی/ورکر معتبر وارد کنید.'
          : 'Server region is not supported by Gemini API (403). Configure a Gemini relay/proxy URL in "API Endpoint / Base URL".',
      };
    }
    const cleanReason = stripHtmlToText(innerMessage).slice(0, 180);
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message: isFa
        ? `دسترسی کلید API رد شد (403): ${cleanReason}`
        : `API key permission denied (403): ${cleanReason}`,
    };
  }

  // 6. Model or route not found (404)
  if (effectiveStatus === 404 || effectiveCode === 'NOT_FOUND') {
    const cleanReason = stripHtmlToText(innerMessage).slice(0, 180);
    return {
      status: 404,
      code: 'NOT_FOUND',
      message: isFa
        ? `مدل یا مسیر اندپوینت یافت نشد (404). مدل پیش‌فرض یا Base URL را بررسی کنید: ${cleanReason}`
        : `Model or endpoint not found (404). Check Default Model or Base URL: ${cleanReason}`,
    };
  }

  // 7. Quota / Rate limit (429)
  if (effectiveStatus === 429 || effectiveCode === 'RESOURCE_EXHAUSTED') {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message: isFa
        ? 'سهمیه یا محدودیت تعداد درخواست کلید Gemini پر شده است (HTTP 429).'
        : 'Gemini API quota or rate limit exceeded (HTTP 429).',
    };
  }

  // 8. Network / Timeout
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('aborted') ||
    lower.includes('timeout')
  ) {
    const cleanReason = stripHtmlToText(innerMessage).slice(0, 160);
    return {
      status: 504,
      code: 'NETWORK_ERROR',
      message: isFa
        ? `خطای اتصال شبکه یا تایم‌اوت هنگام ارتباط با اندپوینت Gemini: ${cleanReason}`
        : `Network or timeout error reaching Gemini endpoint: ${cleanReason}`,
    };
  }

  const fallbackText = stripHtmlToText(innerMessage).slice(0, 220) || 'Gemini request failed.';
  return {
    status: effectiveStatus || 500,
    code: effectiveCode || 'GEMINI_ERROR',
    message: fallbackText,
  };
}

