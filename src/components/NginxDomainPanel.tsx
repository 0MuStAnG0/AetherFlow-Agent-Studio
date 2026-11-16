import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Globe,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { NginxDomainConfig, NginxSslMode } from '../types/workflow';

interface NginxDomainItem extends NginxDomainConfig {
  nginxConf: string;
  setupScript: string;
}

interface NginxEnvironment {
  nginxInstalled: boolean;
  certbotInstalled: boolean;
  isRoot: boolean;
  appPort: number;
}

interface NginxDomainPanelProps {
  lang?: 'en' | 'fa';
  onDomainSelected?: (domain: string) => void;
}

export function NginxDomainPanel({ lang = 'en', onDomainSelected }: NginxDomainPanelProps) {
  const isFa = lang === 'fa';
  const [domains, setDomains] = useState<NginxDomainItem[]>([]);
  const [envInfo, setEnvInfo] = useState<NginxEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [upstreamPort, setUpstreamPort] = useState('3000');
  const [sslMode, setSslMode] = useState<NginxSslMode>('letsencrypt');
  const [sslEmail, setSslEmail] = useState('');
  const [sslCertPath, setSslCertPath] = useState('/etc/letsencrypt/live/studio.example.com/fullchain.pem');
  const [sslKeyPath, setSslKeyPath] = useState('/etc/letsencrypt/live/studio.example.com/privkey.pem');
  const [clientMaxBodyMb, setClientMaxBodyMb] = useState('50');
  const [redirectWww, setRedirectWww] = useState(false);
  const [enableWebsocket, setEnableWebsocket] = useState(true);
  const [enableHsts, setEnableHsts] = useState(true);

  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'conf' | 'script'>('conf');
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const loadDomains = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/nginx/domains');
      if (!res.ok) return;
      const data = (await res.json()) as {
        domains?: NginxDomainItem[];
        environment?: NginxEnvironment;
      };
      const list = Array.isArray(data.domains) ? data.domains : [];
      setDomains(list);
      if (data.environment) {
        setEnvInfo(data.environment);
        if (!editingId && upstreamPort === '3000') {
          setUpstreamPort(String(data.environment.appPort || 3000));
        }
      }
      if (list.length > 0 && !selectedDomainId) {
        setSelectedDomainId(list[0].id);
        onDomainSelected?.(list[0].domain);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setDomainInput('');
    setUpstreamPort(String(envInfo?.appPort || 3000));
    setSslMode('letsencrypt');
    setSslEmail('');
    setRedirectWww(false);
    setClientMaxBodyMb('50');
    setEnableWebsocket(true);
    setEnableHsts(true);
  };

  const handleSaveDomain = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/nginx/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId ?? undefined,
          domain: domainInput.trim(),
          upstreamPort: Number(upstreamPort) || 3000,
          sslMode,
          sslEmail: sslEmail.trim() || undefined,
          sslCertPath: sslMode === 'custom_cert' ? sslCertPath.trim() : undefined,
          sslKeyPath: sslMode === 'custom_cert' ? sslKeyPath.trim() : undefined,
          redirectWww,
          clientMaxBodyMb: Number(clientMaxBodyMb) || 50,
          enableWebsocket,
          enableHsts,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        domain?: NginxDomainItem;
        error?: string;
      };
      if (!res.ok || !data.domain) {
        setFeedback({
          ok: false,
          text: data.error || (isFa ? 'ذخیره تنظیمات دامنه ناموفق بود.' : 'Failed to save domain.'),
        });
        return;
      }
      const saved = data.domain;
      setDomains((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)]);
      setSelectedDomainId(saved.id);
      onDomainSelected?.(saved.domain);
      resetForm();
      setFeedback({
        ok: true,
        text: isFa
          ? `دامنه ${saved.domain} و فایل Nginx آن با موفقیت ذخیره شد.`
          : `Saved Nginx reverse-proxy configuration for ${saved.domain}.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyDns = async (item: NginxDomainItem) => {
    setBusyId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/nginx/domains/${encodeURIComponent(item.id)}/verify-dns`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        resolvedIps?: string[];
        error?: string;
        domain?: NginxDomainItem;
      };
      if (data.domain) {
        setDomains((prev) => prev.map((d) => (d.id === item.id ? data.domain! : d)));
        setSelectedDomainId(data.domain.id);
      }
      setFeedback({
        ok: Boolean(data.verified),
        text: data.verified
          ? isFa
            ? `DNS دامنه ${item.domain} به IP های ${(data.resolvedIps ?? []).join(', ')} متصل است.`
            : `DNS verified for ${item.domain}: ${(data.resolvedIps ?? []).join(', ')}`
          : data.error ||
            (isFa
              ? `رکورد DNS (A/AAAA) برای ${item.domain} هنوز پیدا نشد.`
              : `No A/AAAA DNS record found yet for ${item.domain}.`),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyNginx = async (item: NginxDomainItem) => {
    setBusyId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/nginx/domains/${encodeURIComponent(item.id)}/apply`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as {
        applied?: boolean;
        needsServerPrivilege?: boolean;
        message?: string;
        error?: string;
        domain?: NginxDomainItem;
      };
      if (data.domain) {
        setDomains((prev) => prev.map((d) => (d.id === item.id ? data.domain! : d)));
      }
      setSelectedDomainId(item.id);
      if (data.needsServerPrivilege) {
        setPreviewTab('script');
      }
      setFeedback({
        ok: Boolean(data.applied),
        text:
          data.message ||
          data.error ||
          (isFa ? 'نتیجه اعمال Nginx دریافت شد.' : 'Nginx apply finished.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteDomain = async (id: string) => {
    setBusyId(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/nginx/domains/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const remaining = domains.filter((d) => d.id !== id);
        setDomains(remaining);
        if (selectedDomainId === id) {
          setSelectedDomainId(remaining[0]?.id ?? null);
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleEditDomain = (item: NginxDomainItem) => {
    setEditingId(item.id);
    setDomainInput(item.domain);
    setUpstreamPort(String(item.upstreamPort));
    setSslMode(item.sslMode);
    setSslEmail(item.sslEmail ?? '');
    if (item.sslCertPath) setSslCertPath(item.sslCertPath);
    if (item.sslKeyPath) setSslKeyPath(item.sslKeyPath);
    setClientMaxBodyMb(String(item.clientMaxBodyMb));
    setRedirectWww(item.redirectWww);
    setEnableWebsocket(item.enableWebsocket);
    setEnableHsts(item.enableHsts);
    setSelectedDomainId(item.id);
    onDomainSelected?.(item.domain);
  };

  const activeItem = domains.find((d) => d.id === selectedDomainId) ?? domains[0] ?? null;

  const handleCopyPreview = async () => {
    if (!activeItem) return;
    const content = previewTab === 'conf' ? activeItem.nginxConf : activeItem.setupScript;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPreview(true);
      setTimeout(() => setCopiedPreview(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      data-testid="nginx-domain-panel"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Globe className="h-4 w-4 text-blue-600" />
            {isFa
              ? 'اتصال دامنه اختصاصی و Reverse Proxy با Nginx + SSL'
              : 'Custom Domain Connection & Nginx SSL Reverse Proxy'}
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {isFa
              ? 'دامنه خود را به استودیو متصل کنید، DNS را بررسی نمایید، فایل کانفیگ Nginx (با پشتیبانی WebSocket و SSE) بسازید و گواهی HTTPS رایگان دریافت کنید.'
              : 'Bind a domain to AetherFlow Studio, verify DNS A/AAAA records, generate hardened Nginx configs (WebSocket + SSE streaming), and apply Certbot HTTPS.'}
          </p>
        </div>

        {envInfo && (
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            <span
              className={`rounded-md border px-2 py-0.5 ${
                envInfo.nginxInstalled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
              }`}
            >
              nginx: {envInfo.nginxInstalled ? 'installed' : 'vps script'}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 ${
                envInfo.certbotInstalled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
              }`}
            >
              certbot: {envInfo.certbotInstalled ? 'ready' : 'script installs'}
            </span>
          </div>
        )}
      </div>

      {/* Add / Edit Domain Form */}
      <form
        onSubmit={(e) => void handleSaveDomain(e)}
        className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 md:grid-cols-12 dark:border-slate-800 dark:bg-slate-950"
      >
        <label className="flex flex-col gap-1 md:col-span-4">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {isFa ? 'نام دامنه (Domain Hostname)' : 'Domain Hostname'}
          </span>
          <input
            type="text"
            dir="ltr"
            data-testid="nginx-domain-input"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="studio.example.com"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {isFa ? 'پورت داخلی اپ' : 'Upstream Port'}
          </span>
          <input
            type="number"
            dir="ltr"
            data-testid="nginx-port-input"
            value={upstreamPort}
            onChange={(e) => setUpstreamPort(e.target.value)}
            min={80}
            max={65535}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-3">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {isFa ? 'حالت گواهی SSL' : 'SSL / HTTPS Mode'}
          </span>
          <select
            data-testid="nginx-ssl-mode-select"
            value={sslMode}
            onChange={(e) => setSslMode(e.target.value as NginxSslMode)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="letsencrypt">
              {isFa ? "Let's Encrypt SSL (خودکار)" : "Let's Encrypt HTTPS (Auto)"}
            </option>
            <option value="http_only">{isFa ? 'فقط HTTP (پورت 80)' : 'HTTP Only (Port 80)'}</option>
            <option value="custom_cert">
              {isFa ? 'گواهی SSL اختصاصی' : 'Custom SSL Certificate'}
            </option>
          </select>
        </label>

        {sslMode === 'letsencrypt' ? (
          <label className="flex flex-col gap-1 md:col-span-3">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? 'ایمیل Certbot (اختیاری)' : 'Certbot Email (Optional)'}
            </span>
            <input
              type="email"
              dir="ltr"
              data-testid="nginx-ssl-email-input"
              value={sslEmail}
              onChange={(e) => setSslEmail(e.target.value)}
              placeholder="admin@example.com"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 md:col-span-3">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? 'حداکثر حجم آپلود (MB)' : 'Max Upload Body (MB)'}
            </span>
            <input
              type="number"
              dir="ltr"
              value={clientMaxBodyMb}
              onChange={(e) => setClientMaxBodyMb(e.target.value)}
              min={1}
              max={1024}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        )}

        {sslMode === 'custom_cert' && (
          <>
            <label className="flex flex-col gap-1 md:col-span-6">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                SSL Certificate Path (fullchain.pem)
              </span>
              <input
                type="text"
                dir="ltr"
                value={sslCertPath}
                onChange={(e) => setSslCertPath(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-6">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                SSL Private Key Path (privkey.pem)
              </span>
              <input
                type="text"
                dir="ltr"
                value={sslKeyPath}
                onChange={(e) => setSslKeyPath(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-600 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 md:col-span-12">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={enableWebsocket}
                onChange={(e) => setEnableWebsocket(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-blue-600"
              />
              <span>WebSocket (/ws) + SSE Proxy</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={redirectWww}
                onChange={(e) => setRedirectWww(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-blue-600"
              />
              <span>{isFa ? 'اتصال www به دامنه' : 'Include www alias'}</span>
            </label>

            {sslMode !== 'http_only' && (
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={enableHsts}
                  onChange={(e) => setEnableHsts(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-blue-600"
                />
                <span>HSTS Security Header</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                {isFa ? 'انصراف' : 'Cancel'}
              </button>
            )}
            <button
              type="submit"
              data-testid="nginx-save-domain-btn"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {saving
                ? isFa
                  ? 'در حال ذخیره...'
                  : 'Saving...'
                : editingId
                  ? isFa
                    ? 'به‌روزرسانی دامنه'
                    : 'Update Domain'
                  : isFa
                    ? 'افزودن و ساخت کانفیگ Nginx'
                    : 'Save & Generate Nginx Config'}
            </button>
          </div>
        </div>
      </form>

      {feedback && (
        <p
          data-testid="nginx-feedback"
          className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* Saved Domains List */}
      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : domains.length > 0 ? (
        <div className="mt-4 space-y-2.5">
          {domains.map((item) => {
            const isSelected = activeItem?.id === item.id;
            const busy = busyId === item.id;
            return (
              <div
                key={item.id}
                data-testid={`nginx-domain-row-${item.domain}`}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDomainId(item.id);
                    onDomainSelected?.(item.domain);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start text-start"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span dir="ltr" className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.domain}
                    </span>
                    <span className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-700 dark:border-slate-700 dark:text-slate-300">
                      :{item.upstreamPort} · {item.sslMode}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                        item.status === 'active'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : item.status === 'dns_verified'
                            ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {item.status === 'active' && <CheckCircle2 className="h-3 w-3" />}
                      {item.status}
                    </span>
                  </div>
                  {item.dnsResolvedIps && item.dnsResolvedIps.length > 0 && (
                    <span dir="ltr" className="mt-1 font-mono text-[11px] text-slate-500">
                      DNS: {item.dnsResolvedIps.join(', ')}
                    </span>
                  )}
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`nginx-verify-dns-btn-${item.domain}`}
                    disabled={busy}
                    onClick={() => void handleVerifyDns(item)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
                    {isFa ? 'بررسی DNS' : 'Verify DNS'}
                  </button>

                  <button
                    type="button"
                    data-testid={`nginx-apply-btn-${item.domain}`}
                    disabled={busy}
                    onClick={() => void handleApplyNginx(item)}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    <Play className="h-3 w-3" />
                    {isFa ? 'اعمال روی سرور' : 'Apply on Server'}
                  </button>

                  <a
                    href={`/api/nginx/domains/${encodeURIComponent(item.id)}/download-conf`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Download className="h-3 w-3" />
                    .conf
                  </a>

                  <button
                    type="button"
                    onClick={() => handleEditDomain(item)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {isFa ? 'ویرایش' : 'Edit'}
                  </button>

                  <button
                    type="button"
                    data-testid={`nginx-delete-btn-${item.domain}`}
                    disabled={busy}
                    onClick={() => void handleDeleteDomain(item.id)}
                    aria-label={`Delete ${item.domain}`}
                    className="inline-flex items-center rounded-md border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Generated Nginx Config & Certbot Script Preview */}
      {activeItem && (
        <div
          data-testid="nginx-preview-box"
          className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="nginx-preview-tab-conf"
                onClick={() => setPreviewTab('conf')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  previewTab === 'conf'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <Server className="h-3.5 w-3.5 text-blue-600" />
                <span>/etc/nginx/sites-available/aetherflow-{activeItem.domain}</span>
              </button>
              <button
                type="button"
                data-testid="nginx-preview-tab-script"
                onClick={() => setPreviewTab('script')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  previewTab === 'script'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>{isFa ? 'اسکریپت نصب خودکار روی VPS' : 'Linux VPS Install + Certbot Script'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyPreview()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {copiedPreview ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedPreview ? (isFa ? 'کپی شد' : 'Copied') : isFa ? 'کپی' : 'Copy'}
            </button>
          </div>

          <pre
            dir="ltr"
            data-testid="nginx-preview-code"
            className="max-h-72 overflow-auto bg-slate-950 p-3.5 font-mono text-[11px] leading-relaxed text-slate-200"
          >
            <code>{previewTab === 'conf' ? activeItem.nginxConf : activeItem.setupScript}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
