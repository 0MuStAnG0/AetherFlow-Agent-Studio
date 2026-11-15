import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';

interface AuthLockScreenProps {
  lang?: 'en' | 'fa';
  onAuthenticated: () => void;
}

export function AuthLockScreen({ lang = 'en', onAuthenticated }: AuthLockScreenProps) {
  const isFa = lang === 'fa';
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = token.trim();
    if (!cleaned) {
      setError(
        isFa ? 'لطفاً توکن دسترسی اپراتور را وارد کنید.' : 'Enter your operator access token.',
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleaned }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        error?: string;
      };
      if (!res.ok || !data.authenticated) {
        setError(
          data.error ||
            (isFa ? 'توکن دسترسی نامعتبر است.' : 'Invalid operator access token.'),
        );
        return;
      }
      onAuthenticated();
    } catch {
      setError(
        isFa ? 'برقراری ارتباط با سرور احراز هویت ناموفق بود.' : 'Could not reach authentication server.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir={isFa ? 'rtl' : 'ltr'}
      data-testid="auth-lock-screen"
      className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {isFa ? 'ورود اپراتور استودیو' : 'AetherFlow Studio · Operator Sign-In'}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {isFa
                ? 'احراز هویت سرور فعال است. برای دسترسی به بوم، کلیدهای API و اجرای تیم ایجنت‌ها، توکن AETHERFLOW_AUTH_TOKEN را وارد کنید.'
                : 'Operator authentication is enabled on this server. Enter the configured AETHERFLOW_AUTH_TOKEN to unlock studio controls.'}
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="operator-auth-token"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {isFa ? 'توکن دسترسی اپراتور' : 'Operator Access Token'}
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  id="operator-auth-token"
                  data-testid="auth-token-input"
                  type={showToken ? 'text' : 'password'}
                  dir="ltr"
                  autoFocus
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="AETHERFLOW_AUTH_TOKEN"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pr-9 pl-9 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((prev) => !prev)}
                  aria-label={showToken ? 'Hide access token' : 'Show access token'}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              data-testid="auth-error-message"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            {submitting
              ? isFa
                ? 'در حال بررسی...'
                : 'Verifying...'
              : isFa
                ? 'ورود به استودیو'
                : 'Unlock Studio'}
          </button>
        </form>
      </div>
    </div>
  );
}
