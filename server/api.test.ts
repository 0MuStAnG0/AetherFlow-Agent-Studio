import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.AETHERFLOW_NO_LISTEN = '1';

let server: Server;
let baseUrl = '';
const createdRunIds: string[] = [];
const createdWorkflowIds: string[] = [];

test.before(async () => {
  const mod = await import('../server.ts');
  server = mod.server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  delete process.env.AETHERFLOW_AUTH_TOKEN;

  for (const runId of createdRunIds) {
    await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }).catch(
      () => {},
    );
  }
  for (const wfId of createdWorkflowIds) {
    await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(wfId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('GET /api/health and /api/capabilities return valid baseline diagnostics', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(healthRes.headers.get('x-frame-options'), null);

  const capRes = await fetch(`${baseUrl}/api/capabilities`);
  assert.equal(capRes.status, 200);
  const cap = (await capRes.json()) as {
    vaultEncrypted?: boolean;
    authEnabled?: boolean;
  };
  assert.equal(cap.vaultEncrypted, true);
  assert.equal(typeof cap.authEnabled, 'boolean');
});

test('POST /api/runs dry_run, /api/runs/:id/diff, and /api/export/zip execute cleanly', async () => {
  const wfRes = await fetch(`${baseUrl}/api/workflows`);
  assert.equal(wfRes.status, 200);
  const workflows = (await wfRes.json()) as Array<{ id: string }>;
  assert.ok(workflows.length > 0);
  const wfId = workflows[0].id;

  const runRes = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: wfId,
      taskPrompt: 'Smoke integration check in dry-run mode',
      mode: 'dry_run',
    }),
  });
  assert.equal(runRes.status, 200);
  const runData = (await runRes.json()) as { runId: string; mode: string };
  assert.ok(runData.runId);
  assert.equal(runData.mode, 'dry_run');
  createdRunIds.push(runData.runId);

  // Allow dry-run async writer a brief tick
  await new Promise((r) => setTimeout(r, 400));

  const diffRes = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runData.runId)}/diff`);
  assert.equal(diffRes.status, 200);
  const diffData = (await diffRes.json()) as { runId: string; diffs: unknown[] };
  assert.equal(diffData.runId, runData.runId);
  assert.ok(Array.isArray(diffData.diffs));

  const zipRes = await fetch(`${baseUrl}/api/export/zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: 'project_bundle',
      workflowId: wfId,
      runId: runData.runId,
    }),
  });
  assert.equal(zipRes.status, 200);
  const zipJson = (await zipRes.json()) as {
    fileCount: number;
    downloadUrl: string;
    zipBase64: string;
  };
  assert.ok(zipJson.fileCount > 0);
  assert.ok(zipJson.zipBase64.length > 20);
  assert.ok(zipJson.downloadUrl.startsWith('/api/export/zip/download/'));

  const dlRes = await fetch(`${baseUrl}${zipJson.downloadUrl}`);
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get('content-type'), 'application/zip');
});

test('POST /api/webhooks/:workflowId enforces webhookSecret when configured', async () => {
  const wfId = `wf-webhook-test-${Date.now()}`;
  createdWorkflowIds.push(wfId);

  const saveRes = await fetch(`${baseUrl}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: wfId,
      name: 'Webhook Auth Test Flow',
      description: 'Test webhook authentication',
      maxRounds: 4,
      humanInTheLoop: false,
      webhookEnabled: true,
      webhookSecret: 'secret-hook-value',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 100, y: 100 },
          data: {
            role: 'manager',
            label: 'Manager',
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            systemPrompt: 'Coordinate test.',
            temperature: 0.2,
            tools: { read: true, write: false, bash: false },
            status: 'idle',
          },
        },
      ],
      edges: [],
      updatedAt: new Date().toISOString(),
    }),
  });
  assert.equal(saveRes.status, 200);

  const badHook = await fetch(`${baseUrl}/api/webhooks/${encodeURIComponent(wfId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': 'wrong-secret',
    },
    body: JSON.stringify({ prompt: 'Should be rejected', mode: 'dry_run' }),
  });
  assert.equal(badHook.status, 401);

  const goodHook = await fetch(`${baseUrl}/api/webhooks/${encodeURIComponent(wfId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': 'secret-hook-value',
    },
    body: JSON.stringify({ prompt: 'Accepted webhook run', mode: 'dry_run' }),
  });
  assert.equal(goodHook.status, 202);
  const hookJson = (await goodHook.json()) as { accepted: boolean; runId: string };
  assert.equal(hookJson.accepted, true);
  if (hookJson.runId) createdRunIds.push(hookJson.runId);
});

test('Operator auth gate locks /api/* when AETHERFLOW_AUTH_TOKEN is set and accepts cookie login', async () => {
  process.env.AETHERFLOW_AUTH_TOKEN = 'integration-op-secret';

  try {
    const unauth = await fetch(`${baseUrl}/api/workflows`);
    assert.equal(unauth.status, 401);

    const statusBefore = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(statusBefore.status, 200);
    const statusJson = (await statusBefore.json()) as {
      authEnabled: boolean;
      authenticated: boolean;
    };
    assert.equal(statusJson.authEnabled, true);
    assert.equal(statusJson.authenticated, false);

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-pass' }),
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'integration-op-secret' }),
    });
    assert.equal(goodLogin.status, 200);
    const setCookie = goodLogin.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes('aetherflow_session='));

    const cookiePair = setCookie.split(';')[0];
    const authed = await fetch(`${baseUrl}/api/workflows`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(authed.status, 200);
  } finally {
    delete process.env.AETHERFLOW_AUTH_TOKEN;
  }
});
