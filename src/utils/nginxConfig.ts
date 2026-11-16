import type { NginxDomainConfig, NginxSslMode } from '../types/workflow';

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomainInput(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

export function validateDomainHostname(raw: string): {
  valid: boolean;
  domain: string;
  error?: string;
} {
  const cleaned = normalizeDomainInput(raw);
  if (!cleaned) {
    return { valid: false, domain: '', error: 'Domain name is required.' };
  }
  if (cleaned.length > 253) {
    return { valid: false, domain: '', error: 'Domain name exceeds 253 characters.' };
  }
  if (/[^a-z0-9.-]/.test(cleaned)) {
    return {
      valid: false,
      domain: '',
      error: 'Domain may only contain letters, digits, hyphens, and dots.',
    };
  }
  const labels = cleaned.split('.');
  if (labels.length < 2) {
    return {
      valid: false,
      domain: '',
      error: 'Enter a valid fully-qualified domain (e.g. studio.example.com).',
    };
  }
  for (const label of labels) {
    if (!DOMAIN_LABEL_RE.test(label)) {
      return {
        valid: false,
        domain: '',
        error: `Invalid domain segment "${label}".`,
      };
    }
  }
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) {
    return {
      valid: false,
      domain: '',
      error: 'Use a DNS hostname rather than a bare IPv4 address.',
    };
  }
  return { valid: true, domain: cleaned };
}

export function clampUpstreamPort(port: unknown): number {
  const num = Number(port);
  if (!Number.isInteger(num) || num < 1 || num > 65535) return 3000;
  return num;
}

export function clampMaxBodyMb(mb: unknown): number {
  const num = Number(mb);
  if (!Number.isFinite(num)) return 30;
  return Math.min(500, Math.max(1, Math.round(num)));
}

export function sanitizeCertPath(raw: string | undefined, fallback: string): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return fallback;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(cleaned) || cleaned.includes('..')) {
    return fallback;
  }
  return cleaned;
}

export function generateNginxServerBlock(
  input: Pick<
    NginxDomainConfig,
    | 'domain'
    | 'upstreamPort'
    | 'sslMode'
    | 'sslCertPath'
    | 'sslKeyPath'
    | 'redirectWww'
    | 'clientMaxBodyMb'
    | 'enableWebsocket'
    | 'enableHsts'
  >,
): string {
  const domainCheck = validateDomainHostname(input.domain);
  const serverName = domainCheck.valid ? domainCheck.domain : 'studio.example.com';
  const port = clampUpstreamPort(input.upstreamPort);
  const maxBodyMb = clampMaxBodyMb(input.clientMaxBodyMb);
  const sslMode: NginxSslMode = input.sslMode || 'letsencrypt';
  const includeWww = Boolean(input.redirectWww && !serverName.startsWith('www.'));
  const wwwDomain = `www.${serverName}`;

  const certPath = sanitizeCertPath(
    input.sslCertPath,
    `/etc/letsencrypt/live/${serverName}/fullchain.pem`,
  );
  const keyPath = sanitizeCertPath(
    input.sslKeyPath,
    `/etc/letsencrypt/live/${serverName}/privkey.pem`,
  );

  const wsLocation = input.enableWebsocket
    ? `
    location /ws {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
`
    : '';

  const proxyLocations = `${wsLocation}
    location /api/ {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }`;

  if (sslMode === 'custom_cert') {
    const wwwRedirectBlock = includeWww
      ? `server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${wwwDomain};
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    return 301 https://${serverName}$request_uri;
}

`
      : '';

    const hstsHeader = input.enableHsts
      ? `\n    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`
      : '';

    return `# AetherFlow Agent Studio · Nginx Reverse Proxy (${serverName})
server {
    listen 80;
    listen [::]:80;
    server_name ${serverName}${includeWww ? ` ${wwwDomain}` : ''};
    return 301 https://${serverName}$request_uri;
}

${wwwRedirectBlock}server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverName};

    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size ${maxBodyMb}M;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;${hstsHeader}
${proxyLocations}
}
`;
  }

  return `# AetherFlow Agent Studio · Nginx Reverse Proxy (${serverName})
# ${sslMode === 'letsencrypt' ? `Certbot will automatically upgrade this block to HTTPS for ${serverName}.` : 'HTTP-only reverse proxy block.'}
server {
    listen 80;
    listen [::]:80;
    server_name ${serverName}${includeWww ? ` ${wwwDomain}` : ''};

    client_max_body_size ${maxBodyMb}M;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
${proxyLocations}
}
`;
}

export function generateNginxApplyScript(config: NginxDomainConfig): string {
  const domainCheck = validateDomainHostname(config.domain);
  const serverName = domainCheck.valid ? domainCheck.domain : 'studio.example.com';
  const slug = serverName.replace(/[^a-z0-9.-]/g, '_');
  const nginxConf = generateNginxServerBlock(config);
  const email = (config.sslEmail || '').trim();
  const safeEmail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)
    ? email
    : '';
  const certDomains =
    config.redirectWww && !serverName.startsWith('www.')
      ? `-d ${serverName} -d www.${serverName}`
      : `-d ${serverName}`;
  const certEmailFlag = safeEmail
    ? `--email ${safeEmail}`
    : '--register-unsafely-without-email';

  const certbotBlock =
    config.sslMode === 'letsencrypt'
      ? `
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx ${certDomains} --non-interactive --agree-tos --redirect ${certEmailFlag}
fi
`
      : '';

  return `#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${serverName}"
SITE_NAME="aetherflow-${slug}"

if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y nginx ${config.sslMode === 'letsencrypt' ? 'certbot python3-certbot-nginx' : ''}
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx ${config.sslMode === 'letsencrypt' ? 'certbot python3-certbot-nginx' : ''}
fi

if [ -d /etc/nginx/sites-available ]; then
  CONF_PATH="/etc/nginx/sites-available/\${SITE_NAME}"
else
  mkdir -p /etc/nginx/conf.d
  CONF_PATH="/etc/nginx/conf.d/\${SITE_NAME}.conf"
fi

cat > "\$CONF_PATH" <<'NGINX_EOF'
${nginxConf.trimEnd()}
NGINX_EOF

if [ -d /etc/nginx/sites-enabled ]; then
  ln -sf "\$CONF_PATH" "/etc/nginx/sites-enabled/\${SITE_NAME}"
  rm -f /etc/nginx/sites-enabled/default || true
fi

nginx -t
systemctl enable --now nginx || true
systemctl reload nginx || systemctl restart nginx
${certbotBlock}
echo "Nginx reverse proxy active for ${serverName}"
`;
}
