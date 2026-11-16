import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  KeyRound,
  LogOut,
  Save,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AuthStatusPayload, UserProfile, UserRole } from '../types/workflow';
import { AuthLockScreen } from './AuthLockScreen';

interface ProfileModalProps {
  isOpen: boolean;
  lang?: 'en' | 'fa';
  authStatus: AuthStatusPayload | null;
  onClose: () => void;
  onAuthUpdated: (next: AuthStatusPayload) => void;
  onSignedOut: (next: AuthStatusPayload) => void;
}

type ProfileTab = 'profile' | 'security' | 'team';

const AVATAR_SWATCHES = ['#2563eb', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#334155'];

export function getUserInitials(name?: string): string {
  const clean = (name || '').trim();
  if (!clean) return 'AF';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function ProfileModal({
  isOpen,
  lang = 'en',
  authStatus,
  onClose,
  onAuthUpdated,
  onSignedOut,
}: ProfileModalProps) {
  const isFa = lang === 'fa';
  const [tab, setTab] = useState<ProfileTab>('profile');
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(authStatus?.user ?? null);
  const [teamUsers, setTeamUsers] = useState<UserProfile[]>([]);
  const [requireAuth, setRequireAuth] = useState<boolean>(Boolean(authStatus?.requireAuth));
  const [allowSelfReg, setAllowSelfReg] = useState<boolean>(
    Boolean(authStatus?.allowSelfRegistration),
  );

  // Profile fields
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [bio, setBio] = useState('');
  const [avatarColor, setAvatarColor] = useState('#2563eb');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Password change fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Team create user fields
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberJob, setNewMemberJob] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<UserRole>('operator');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamNotice, setTeamNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const syncFormFromUser = (u: UserProfile | null) => {
    setUser(u);
    if (u) {
      setDisplayName(u.displayName);
      setEmail(u.email);
      setJobTitle(u.jobTitle ?? '');
      setBio(u.bio ?? '');
      setAvatarColor(u.avatarColor || '#2563eb');
    }
  };

  const fetchProfileData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) return;
      const data = (await res.json()) as {
        user?: UserProfile | null;
        hasUsers?: boolean;
        requireAuth?: boolean;
        allowSelfRegistration?: boolean;
        operatorTokenEnabled?: boolean;
        users?: UserProfile[];
      };
      syncFormFromUser(data.user ?? null);
      setTeamUsers(Array.isArray(data.users) ? data.users : []);
      if (typeof data.requireAuth === 'boolean') setRequireAuth(data.requireAuth);
      if (typeof data.allowSelfRegistration === 'boolean') {
        setAllowSelfReg(data.allowSelfRegistration);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setProfileNotice(null);
    setSecurityNotice(null);
    setTeamNotice(null);
    syncFormFromUser(authStatus?.user ?? null);
    void fetchProfileData();
  }, [isOpen, authStatus?.user?.id]);

  if (!isOpen) return null;

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileNotice(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          jobTitle: jobTitle.trim(),
          bio: bio.trim(),
          avatarColor,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: UserProfile;
        error?: string;
      };
      if (!res.ok || !data.user) {
        setProfileNotice({
          ok: false,
          text: data.error || (isFa ? 'خطا در ذخیره پروفایل.' : 'Failed to save profile.'),
        });
        return;
      }
      syncFormFromUser(data.user);
      setTeamUsers((prev) => prev.map((member) => (member.id === data.user!.id ? data.user! : member)));
      setProfileNotice({
        ok: true,
        text: isFa ? 'تغییرات پروفایل با موفقیت ذخیره شد.' : 'Profile updated successfully.',
      });
      if (authStatus) {
        onAuthUpdated({ ...authStatus, user: data.user });
      }
    } finally {
      setProfileBusy(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setSecurityNotice({
        ok: false,
        text: isFa ? 'تکرار رمز عبور جدید مطابقت ندارد.' : 'New password confirmation does not match.',
      });
      return;
    }
    setSecurityBusy(true);
    setSecurityNotice(null);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        updated?: boolean;
        user?: UserProfile;
        error?: string;
      };
      if (!res.ok || !data.updated) {
        setSecurityNotice({
          ok: false,
          text: data.error || (isFa ? 'تغییر رمز عبور ناموفق بود.' : 'Failed to change password.'),
        });
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecurityNotice({
        ok: true,
        text: isFa
          ? 'رمز عبور با موفقیت تغییر یافت و نشست‌های قبلی باطل شدند.'
          : 'Password changed and previous sessions revoked.',
      });
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleSaveSecurityPolicy = async (nextRequire: boolean, nextSelfReg: boolean) => {
    setSecurityBusy(true);
    setSecurityNotice(null);
    try {
      const res = await fetch('/api/profile/security', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requireAuth: nextRequire,
          allowSelfRegistration: nextSelfReg,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        requireAuth?: boolean;
        allowSelfRegistration?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setSecurityNotice({
          ok: false,
          text: data.error || (isFa ? 'خطا در به‌روزرسانی سیاست امنیتی.' : 'Failed to update security policy.'),
        });
        return;
      }
      setRequireAuth(Boolean(data.requireAuth));
      setAllowSelfReg(Boolean(data.allowSelfRegistration));
      setSecurityNotice({
        ok: true,
        text: isFa ? 'تنظیمات امنیتی ورود ذخیره شد.' : 'Authentication policy saved.',
      });
      if (authStatus) {
        onAuthUpdated({
          ...authStatus,
          requireAuth: Boolean(data.requireAuth),
          allowSelfRegistration: Boolean(data.allowSelfRegistration),
          authEnabled: Boolean(
            authStatus.operatorTokenEnabled || (authStatus.hasUsers && data.requireAuth),
          ),
        });
      }
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleRevokeSessions = async () => {
    setSecurityBusy(true);
    setSecurityNotice(null);
    try {
      const res = await fetch('/api/profile/revoke-sessions', { method: 'POST' });
      if (res.ok) {
        setSecurityNotice({
          ok: true,
          text: isFa
            ? 'تمام نشست‌های فعال در مرورگرهای دیگر باطل شدند.'
            : 'All other active browser sessions have been revoked.',
        });
      }
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    setTeamBusy(true);
    setTeamNotice(null);
    try {
      const res = await fetch('/api/profile/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: newMemberName.trim(),
          email: newMemberEmail.trim(),
          username: newMemberUsername.trim() || undefined,
          jobTitle: newMemberJob.trim() || undefined,
          role: newMemberRole,
          password: newMemberPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        users?: UserProfile[];
        error?: string;
      };
      if (!res.ok) {
        setTeamNotice({
          ok: false,
          text: data.error || (isFa ? 'ایجاد کاربر جدید ناموفق بود.' : 'Could not add team user.'),
        });
        return;
      }
      setTeamUsers(Array.isArray(data.users) ? data.users : []);
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberUsername('');
      setNewMemberJob('');
      setNewMemberPassword('');
      setTeamNotice({
        ok: true,
        text: isFa ? 'عضو جدید به سیستم اضافه شد.' : 'Team user account created.',
      });
    } finally {
      setTeamBusy(false);
    }
  };

  const handleDeleteMember = async (id: string) => {
    setTeamBusy(true);
    setTeamNotice(null);
    try {
      const res = await fetch(`/api/profile/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as {
        users?: UserProfile[];
        error?: string;
      };
      if (!res.ok) {
        setTeamNotice({
          ok: false,
          text: data.error || (isFa ? 'حذف کاربر ناموفق بود.' : 'Could not delete user.'),
        });
        return;
      }
      setTeamUsers(Array.isArray(data.users) ? data.users : []);
    } finally {
      setTeamBusy(false);
    }
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    const statusRes = await fetch('/api/auth/status').catch(() => null);
    const nextStatus = statusRes
      ? ((await statusRes.json().catch(() => null)) as AuthStatusPayload | null)
      : null;
    onSignedOut(
      nextStatus ?? {
        authEnabled: Boolean(authStatus?.hasUsers && requireAuth),
        authenticated: false,
        hasUsers: Boolean(authStatus?.hasUsers),
        requireAuth,
        allowSelfRegistration: allowSelfReg,
        operatorTokenEnabled: Boolean(authStatus?.operatorTokenEnabled),
        user: null,
      },
    );
  };

  // Unauthenticated modal view -> Prompt account creation / sign-in
  if (!user) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        data-testid="profile-modal-unauth"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      >
        <AuthLockScreen
          lang={lang}
          hasUsers={Boolean(authStatus?.hasUsers)}
          allowSelfRegistration={Boolean(authStatus?.allowSelfRegistration)}
          operatorTokenEnabled={Boolean(authStatus?.operatorTokenEnabled)}
          onClose={onClose}
          onAuthenticated={async (partial) => {
            const res = await fetch('/api/auth/status').catch(() => null);
            const full = res ? ((await res.json().catch(() => null)) as AuthStatusPayload | null) : null;
            onAuthUpdated(
              full ?? {
                authEnabled: true,
                authenticated: true,
                hasUsers: true,
                requireAuth: true,
                allowSelfRegistration: Boolean(authStatus?.allowSelfRegistration),
                operatorTokenEnabled: Boolean(authStatus?.operatorTokenEnabled),
                user: partial?.user ?? null,
              },
            );
            void fetchProfileData();
          }}
        />
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="profile-modal"
      dir={isFa ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: avatarColor }}
            >
              {getUserInitials(user.displayName)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {user.displayName}
                </h2>
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300">
                  {user.role}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span dir="ltr" className="font-mono">
                  @{user.username} · {user.email}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="profile-signout-btn"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              {isFa ? 'خروج / قفل استودیو' : 'Sign Out'}
            </button>
            <button
              type="button"
              data-testid="profile-close-btn"
              onClick={onClose}
              aria-label={isFa ? 'بستن' : 'Close'}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5 pt-2 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            data-testid="profile-tab-profile"
            onClick={() => setTab('profile')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
              tab === 'profile'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            {isFa ? 'مشخصات پروفایل' : 'My Profile'}
          </button>

          <button
            type="button"
            data-testid="profile-tab-security"
            onClick={() => setTab('security')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
              tab === 'security'
                ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            {isFa ? 'امنیت و رمز عبور' : 'Security & Sessions'}
          </button>

          {user.role === 'admin' && (
            <button
              type="button"
              data-testid="profile-tab-team"
              onClick={() => setTab('team')}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                tab === 'team'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              {isFa ? 'حساب‌های تیم' : 'Team Accounts'}
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] tabular-nums dark:bg-slate-800">
                {teamUsers.length}
              </span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && !user ? (
            <div className="py-10 text-center text-xs text-slate-500">Loading...</div>
          ) : null}

          {tab === 'profile' && (
            <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isFa ? 'نام نمایشی' : 'Display Name'}
                  </span>
                  <input
                    type="text"
                    data-testid="profile-displayname-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isFa ? 'ایمیل حساب' : 'Account Email'}
                  </span>
                  <input
                    type="email"
                    dir="ltr"
                    data-testid="profile-email-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isFa ? 'عنوان شغلی / تخصص' : 'Job Title / Specialty'}
                </span>
                <input
                  type="text"
                  data-testid="profile-jobtitle-input"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder={isFa ? 'مثلاً مهندس DevOps' : 'Platform Engineer'}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isFa ? 'توضیحات پروفایل (Bio)' : 'Bio / Workspace Note'}
                </span>
                <textarea
                  rows={2}
                  data-testid="profile-bio-input"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>

              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isFa ? 'رنگ آواتار پروفایل' : 'Avatar Accent Color'}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {AVATAR_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setAvatarColor(hex)}
                      aria-label={`Select color ${hex}`}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-transform ${
                        avatarColor === hex
                          ? 'scale-110 border-slate-900 dark:border-white'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                    >
                      {avatarColor === hex && <Check className="h-3.5 w-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {profileNotice && (
                <p
                  data-testid="profile-notice"
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                    profileNotice.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  {profileNotice.text}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  data-testid="profile-save-btn"
                  disabled={profileBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  <Save className="h-3.5 w-3.5" />
                  {profileBusy
                    ? isFa
                      ? 'در حال ذخیره...'
                      : 'Saving...'
                    : isFa
                      ? 'ذخیره پروفایل'
                      : 'Save Profile'}
                </button>
              </div>
            </form>
          )}

          {tab === 'security' && (
            <div className="space-y-5">
              {user.role === 'admin' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {isFa ? 'سیاست امنیتی ورود به استودیو' : 'Workspace Login Security Policy'}
                  </h3>
                  <div className="mt-3 space-y-2.5">
                    <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        data-testid="security-require-auth-checkbox"
                        checked={requireAuth}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setRequireAuth(next);
                          void handleSaveSecurityPolicy(next, allowSelfReg);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
                      />
                      <span>
                        <strong className="block text-slate-900 dark:text-slate-100">
                          {isFa
                            ? 'اجبار به ورود با حساب کاربری هنگام باز کردن استودیو'
                            : 'Require login screen on startup & protect API routes'}
                        </strong>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isFa
                            ? 'تمام درخواست‌های API و WebSocket بدون کوکی نشست معتبر مسدود می‌شوند.'
                            : 'All studio routes and WebSocket streams require an authenticated session cookie.'}
                        </span>
                      </span>
                    </label>

                    <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        data-testid="security-self-reg-checkbox"
                        checked={allowSelfReg}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setAllowSelfReg(next);
                          void handleSaveSecurityPolicy(requireAuth, next);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
                      />
                      <span>
                        <strong className="block text-slate-900 dark:text-slate-100">
                          {isFa
                            ? 'اجازه ثبت‌نام عمومی در صفحه ورود'
                            : 'Allow self-registration on Sign-In screen'}
                        </strong>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isFa
                            ? 'اگر غیرفعال باشد، فقط مدیر سیستم می‌تواند از تب حساب‌های تیم کاربر اضافه کند.'
                            : 'When disabled, only workspace admins can provision new user accounts.'}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <form
                onSubmit={(e) => void handleChangePassword(e)}
                className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <KeyRound className="h-4 w-4 text-blue-600" />
                  <span>{isFa ? 'تغییر رمز عبور' : 'Change Password'}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <input
                    type="password"
                    dir="ltr"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={isFa ? 'رمز فعلی' : 'Current password'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="password"
                    dir="ltr"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={isFa ? 'رمز جدید (۸+ کاراکتر)' : 'New password (8+ chars)'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="password"
                    dir="ltr"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={isFa ? 'تکرار رمز جدید' : 'Confirm new password'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleRevokeSessions()}
                    disabled={securityBusy}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {isFa ? 'ابطال سایر نشست‌های فعال' : 'Revoke Other Sessions'}
                  </button>
                  <button
                    type="submit"
                    disabled={securityBusy}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    {isFa ? 'به‌روزرسانی رمز عبور' : 'Update Password'}
                  </button>
                </div>
              </form>

              {securityNotice && (
                <p
                  data-testid="security-notice"
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                    securityNotice.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  {securityNotice.text}
                </p>
              )}
            </div>
          )}

          {tab === 'team' && user.role === 'admin' && (
            <div className="space-y-4">
              <div className="space-y-2">
                {teamUsers.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                        style={{ backgroundColor: member.avatarColor || '#2563eb' }}
                      >
                        {getUserInitials(member.displayName)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                          <span>{member.displayName}</span>
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] uppercase dark:border-slate-700">
                            {member.role}
                          </span>
                        </div>
                        <div dir="ltr" className="font-mono text-[11px] text-slate-500">
                          @{member.username} · {member.email}
                        </div>
                      </div>
                    </div>

                    {member.id !== user.id && (
                      <button
                        type="button"
                        disabled={teamBusy}
                        onClick={() => void handleDeleteMember(member.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                        {isFa ? 'حذف' : 'Remove'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <form
                onSubmit={(e) => void handleAddMember(e)}
                className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <UserPlus className="h-4 w-4 text-blue-600" />
                  <span>{isFa ? 'افزودن حساب عضو تیم' : 'Add Team User Account'}</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder={isFa ? 'نام نمایشی' : 'Display Name'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="email"
                    dir="ltr"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="member@company.com"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    dir="ltr"
                    value={newMemberUsername}
                    onChange={(e) => setNewMemberUsername(e.target.value)}
                    placeholder={isFa ? 'نام کاربری (اختیاری)' : 'username (optional)'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={newMemberJob}
                    onChange={(e) => setNewMemberJob(e.target.value)}
                    placeholder={isFa ? 'سمت / نقش' : 'Job Title'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as UserRole)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <input
                    type="password"
                    dir="ltr"
                    value={newMemberPassword}
                    onChange={(e) => setNewMemberPassword(e.target.value)}
                    placeholder={isFa ? 'رمز عبور (۸+ کاراکتر)' : 'Password (8+ chars)'}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={teamBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {isFa ? 'ایجاد کاربر' : 'Create User'}
                  </button>
                </div>
              </form>

              {teamNotice && (
                <p
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                    teamNotice.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  {teamNotice.text}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
