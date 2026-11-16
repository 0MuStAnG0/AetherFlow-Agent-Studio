import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, UserPlus, X } from 'lucide-react';
import type { AuthStatusPayload } from '../types/workflow';

interface AuthLockScreenProps {
  lang?: 'en' | 'fa';
  hasUsers?: boolean;
  allowSelfRegistration?: boolean;
  operatorTokenEnabled?: boolean;
  onAuthenticated: (status?: Partial<AuthStatusPayload>) => void;
  onClose?: () => void;
}

type AuthTab = 'login' | 'register' | 'token';

export function AuthLockScreen({
  lang = 'en',
  hasUsers = true,
  allowSelfRegistration = false,
  operatorTokenEnabled = false,
  onAuthenticated,
  onClose,
}: AuthLockScreenProps) {
  const isFa = lang === 'fa';
  const canRegister = !hasUsers || allowSelfRegistration;
  const [activeTab, setActiveTab] = useState<AuthTab>(!hasUsers ? 'register' : 'login');

  // Sign-in state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Register state
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Operator token fallback state
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setError(
        isFa
          ? 'لطفاً ایمیل یا نام کاربری و رمز عبور را وارد کنید.'
          : 'Enter your email/username and password.',
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        user?: AuthStatusPayload['user'];
        error?: string;
      };
      if (!res.ok || !data.authenticated) {
        setError(
          data.error ||
            (isFa ? 'ایمیل/نام کاربری یا رمز عبور نادرست است.' : 'Invalid credentials.'),
        );
        return;
      }
      onAuthenticated({
        authenticated: true,
        authEnabled: true,
        hasUsers: true,
        user: data.user ?? null,
      });
    } catch {
      setError(
        isFa ? 'برقراری ارتباط با سرور احراز هویت ناموفق بود.' : 'Could not reach authentication server.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || displayName.trim().length < 2) {
      setError(
        isFa ? 'نام نمایشی باید حداقل ۲ کاراکتر باشد.' : 'Display name must be at least 2 characters.',
      );
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError(isFa ? 'لطفاً یک ایمیل معتبر وارد کنید.' : 'Enter a valid email address.');
      return;
    }
    if (regPassword.length < 8) {
      setError(
        isFa ? 'رمز عبور باید حداقل ۸ کاراکتر باشد.' : 'Password must be at least 8 characters.',
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          username: username.trim() || undefined,
          jobTitle: jobTitle.trim() || undefined,
          password: regPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        user?: AuthStatusPayload['user'];
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!res.ok || !data.authenticated) {
        setError(
          data.error || (isFa ? 'ایجاد حساب کاربری ناموفق بود.' : 'Account registration failed.'),
        );
        return;
      }
      onAuthenticated(
        data.status ?? {
          authenticated: true,
          authEnabled: true,
          hasUsers: true,
          requireAuth: true,
          user: data.user ?? null,
        },
      );
    } catch {
      setError(
        isFa ? 'برقراری ارتباط با سرور ناموفق بود.' : 'Could not reach authentication server.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleTokenSubmit = async (e: FormEvent) => {
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
          data.error || (isFa ? 'توکن دسترسی نامعتبر است.' : 'Invalid operator access token.'),
        );
        return;
      }
      onAuthenticated({ authenticated: true, authEnabled: true });
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
      className={
        onClose
          ? 'w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'
          : 'flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100'
      }
    >
      <div
        className={
          onClose
            ? 'w-full'
            : 'w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900'
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-400">
              {activeTab === 'register' ? (
                <UserPlus className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {!hasUsers
                  ? isFa
                    ? 'ساخت حساب مدیر استودیو'
                    : 'Create Studio Admin Account'
                  : isFa
                    ? 'ورود امن به استودیو AetherFlow'
                    : 'AetherFlow Studio · Sign In'}
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {!hasUsers
                  ? isFa
                    ? 'اولین حساب ایجادشده به‌عنوان مدیر (Admin) ثبت می‌شود و قفل امنیتی ورود را فعال می‌کند.'
                    : 'The first registered user becomes the workspace Admin and enables secure cookie session authentication.'
                  : isFa
                    ? 'برای دسترسی به بوم، کلیدهای API و اجرای تیم ایجنت‌ها وارد حساب خود شوید.'
                    : 'Sign in with your studio account or operator credentials to unlock workflows and keys.'}
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={isFa ? 'بستن' : 'Close'}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {(canRegister || operatorTokenEnabled) && (
          <div className="mt-4 flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              data-testid="auth-tab-login"
              onClick={() => {
                setActiveTab('login');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'login'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {isFa ? 'ورود با حساب' : 'Sign In'}
            </button>

            {canRegister && (
              <button
                type="button"
                data-testid="auth-tab-register"
                onClick={() => {
                  setActiveTab('register');
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'register'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {!hasUsers
                  ? isFa
                    ? 'ساخت حساب مدیر'
                    : 'Create Admin'
                  : isFa
                    ? 'ثبت‌نام'
                    : 'Register'}
              </button>
            )}

            {operatorTokenEnabled && (
              <button
                type="button"
                data-testid="auth-tab-token"
                onClick={() => {
                  setActiveTab('token');
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'token'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {isFa ? 'توکن اپراتور' : 'Access Token'}
              </button>
            )}
          </div>
        )}

        {activeTab === 'login' && (
          <form onSubmit={(e) => void handleLoginSubmit(e)} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="auth-login-identifier"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'ایمیل یا نام کاربری' : 'Email or Username'}
              </label>
              <input
                id="auth-login-identifier"
                data-testid="auth-login-identifier"
                type="text"
                dir="ltr"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@company.com or admin"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="auth-login-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'رمز عبور' : 'Password'}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="auth-login-password"
                  data-testid="auth-login-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pr-9 pl-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
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
              data-testid="auth-login-submit-btn"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <ShieldCheck className="h-4 w-4" />
              {submitting
                ? isFa
                  ? 'در حال ورود...'
                  : 'Signing In...'
                : isFa
                  ? 'ورود به استودیو'
                  : 'Sign In'}
            </button>
          </form>
        )}

        {activeTab === 'register' && canRegister && (
          <form onSubmit={(e) => void handleRegisterSubmit(e)} className="mt-5 space-y-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="auth-reg-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isFa ? 'نام و نام خانوادگی' : 'Display Name'}
                </label>
                <input
                  id="auth-reg-name"
                  data-testid="auth-reg-name"
                  type="text"
                  autoFocus
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={isFa ? 'مثلاً علی رضایی' : 'Alex Mercer'}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="auth-reg-username"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isFa ? 'نام کاربری (اختیاری)' : 'Username (Optional)'}
                </label>
                <input
                  id="auth-reg-username"
                  data-testid="auth-reg-username"
                  type="text"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-reg-email"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'ایمیل' : 'Email Address'}
              </label>
              <input
                id="auth-reg-email"
                data-testid="auth-reg-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="auth-reg-job"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'عنوان شغلی (اختیاری)' : 'Role / Job Title (Optional)'}
              </label>
              <input
                id="auth-reg-job"
                data-testid="auth-reg-job"
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder={isFa ? 'معمار سیستم / DevOps' : 'Lead Architect / DevOps'}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="auth-reg-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'رمز عبور (حداقل ۸ کاراکتر)' : 'Password (min 8 chars)'}
              </label>
              <div className="relative mt-1">
                <input
                  id="auth-reg-password"
                  data-testid="auth-reg-password"
                  type={showRegPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pr-9 pl-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword((prev) => !prev)}
                  aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showRegPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
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
              data-testid="auth-reg-submit-btn"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <UserPlus className="h-4 w-4" />
              {submitting
                ? isFa
                  ? 'در حال ایجاد حساب...'
                  : 'Creating Account...'
                : !hasUsers
                  ? isFa
                    ? 'ساخت حساب مدیر و ورود'
                    : 'Create Admin Account'
                  : isFa
                    ? 'ثبت‌نام و ورود'
                    : 'Create Account'}
            </button>
          </form>
        )}

        {activeTab === 'token' && operatorTokenEnabled && (
          <form onSubmit={(e) => void handleTokenSubmit(e)} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="operator-auth-token"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'توکن دسترسی اپراتور' : 'Operator Access Token'}
              </label>
              <div className="relative mt-1.5">
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
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pr-9 pl-9 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                  ? 'ورود با توکن'
                  : 'Unlock with Token'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
