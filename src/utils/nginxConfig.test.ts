import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMaxBodyMb,
  clampUpstreamPort,
  generateNginxApplyScript,
  generateNginxServerBlock,
  normalizeDomainInput,
  sanitizeCertPath,
  validateDomainHostname,
} from './nginxConfig';
import type { NginxDomainConfig } from '../types/workflow';

function makeDomainConfig(overrides: Partial<NginxDomainConfig> = {}): NginxDomainConfig {
  return {
    id: 'dom-1',
    domain: 'studio.example.com',
    upstreamPort: 3000,
    sslMode: 'letsencrypt',
    sslEmail: 'ops@example.com',
    redirectWww: true,
    clientMaxBodyMb: 30,
    enableWebsocket: true,
    enableHsts: true,
    status: 'draft',
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizeDomainInput and validateDomainHostname accept FQDNs and block unsafe inputs', () => {
  assert.equal(normalizeDomainInput(' https://Studio.Example.COM:8443/login '), 'studio.example.com');
  assert.equal(validateDomainHostname('studio.example.com').valid, true);
  assert.equal(validateDomainHostname('ai-1.my-domain.ir').valid, true);

  assert.equal(validateDomainHostname('').valid, false);
  assert.equal(validateDomainHostname('localhost').valid, false);
  assert.equal(validateDomainHostname('192.168.1.10').valid, false);
  assert.equal(validateDomainHostname('bad;rm -rf /;.com').valid, false);
  assert.equal(validateDomainHostname('-invalid.example.com').valid, false);
});

test('clampUpstreamPort, clampMaxBodyMb, and sanitizeCertPath enforce bounds', () => {
  assert.equal(clampUpstreamPort(3000), 3000);
  assert.equal(clampUpstreamPort(99999), 3000);
  assert.equal(clampUpstreamPort('abc'), 3000);
  assert.equal(clampMaxBodyMb(0), 1);
  assert.equal(clampMaxBodyMb(1000), 500);
  assert.equal(clampMaxBodyMb(50), 50);

  assert.equal(sanitizeCertPath('/etc/ssl/certs/fullchain.pem', '/fallback'), '/etc/ssl/certs/fullchain.pem');
  assert.equal(sanitizeCertPath('/etc/../etc/passwd', '/fallback'), '/fallback');
  assert.equal(sanitizeCertPath('relative/path.pem', '/fallback'), '/fallback');
});

test('generateNginxServerBlock emits WebSocket, SSE proxy_buffering off, and custom SSL when configured', () => {
  const letsEncryptConf = generateNginxServerBlock(makeDomainConfig());
  assert.ok(letsEncryptConf.includes('server_name studio.example.com www.studio.example.com;'));
  assert.ok(letsEncryptConf.includes('location /ws'));
  assert.ok(letsEncryptConf.includes('proxy_pass http://127.0.0.1:3000;'));
  assert.ok(letsEncryptConf.includes('proxy_buffering off;'));
  assert.ok(letsEncryptConf.includes('client_max_body_size 30M;'));

  const customSslConf = generateNginxServerBlock(
    makeDomainConfig({
      sslMode: 'custom_cert',
      sslCertPath: '/etc/ssl/studio/fullchain.pem',
      sslKeyPath: '/etc/ssl/studio/privkey.pem',
      upstreamPort: 4100,
    }),
  );
  assert.ok(customSslConf.includes('listen 443 ssl http2;'));
  assert.ok(customSslConf.includes('ssl_certificate /etc/ssl/studio/fullchain.pem;'));
  assert.ok(customSslConf.includes('Strict-Transport-Security'));
  assert.ok(customSslConf.includes('http://127.0.0.1:4100;'));
});

test('generateNginxApplyScript includes nginx validation and certbot command for letsencrypt', () => {
  const script = generateNginxApplyScript(makeDomainConfig());
  assert.ok(script.includes('nginx -t'));
  assert.ok(script.includes('certbot --nginx -d studio.example.com -d www.studio.example.com'));
  assert.ok(script.includes('--email ops@example.com'));

  const httpOnlyScript = generateNginxApplyScript(makeDomainConfig({ sslMode: 'http_only' }));
  assert.ok(!httpOnlyScript.includes('certbot --nginx'));
});
