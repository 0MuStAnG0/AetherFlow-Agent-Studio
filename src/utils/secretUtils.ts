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
