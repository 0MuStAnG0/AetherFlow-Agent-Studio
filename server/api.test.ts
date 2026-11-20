import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import AdmZip from 'adm-zip';

process.env.AETHERFLOW_NO_LISTEN = '1';

let server: Server;
let baseUrl = '';
const createdRunIds: string[] = [];
const createdWorkflowIds: string[] = [];
const createdProjectIds: string[] = [];

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
  for (const projId of createdProjectIds) {
    await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projId)}`, {
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

test('POST /api/projects/import/zip stores complete files offline and allows read/edit/delete', async () => {
  const zip = new AdmZip();
  zip.addFile(
    'package.json',
    Buffer.from(JSON.stringify({ name: 'offline-sample-app', version: '1.0.0' }, null, 2), 'utf-8'),
  );
  zip.addFile('src/index.ts', Buffer.from('export const greeting = "hello offline";\n', 'utf-8'));
  // 1x1 PNG binary asset
  zip.addFile(
    'assets/pixel.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const zipBase64 = zip.toBuffer().toString('base64');

  const importRes = await fetch(`${baseUrl}/api/projects/import/zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'offline-sample.zip',
      contentBase64: `data:application/zip;base64,${zipBase64}`,
      projectName: 'Offline Sample Project',
      language: 'en',
      mode: 'dry_run',
    }),
  });
  assert.equal(importRes.status, 200);
  const importJson = (await importRes.json()) as { project?: { id: string; totalFiles: number } };
  assert.ok(importJson.project?.id);
  const projId = importJson.project!.id;
  createdProjectIds.push(projId);
  assert.ok(importJson.project!.totalFiles >= 3);

  const filesRes = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projId)}/files`);
  assert.equal(filesRes.status, 200);
  const filesJson = (await filesRes.json()) as {
    storageDir: string;
    hasSourceZip: boolean;
    totalFiles: number;
    files: Array<{ path: string; size: number }>;
  };
  assert.equal(filesJson.hasSourceZip, true);
  assert.ok(filesJson.storageDir.includes('data/projects/'));
  assert.ok(filesJson.files.some((f) => f.path === 'src/index.ts'));
  assert.ok(filesJson.files.some((f) => f.path === 'assets/pixel.png'));

  const readRes = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projId)}/file?path=${encodeURIComponent('src/index.ts')}`,
  );
  assert.equal(readRes.status, 200);
  const readJson = (await readRes.json()) as { isBinary: boolean; content: string };
  assert.equal(readJson.isBinary, false);
  assert.match(readJson.content, /hello offline/);

  const binaryRes = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projId)}/file?path=${encodeURIComponent('assets/pixel.png')}`,
  );
  assert.equal(binaryRes.status, 200);
  const binaryJson = (await binaryRes.json()) as { isBinary: boolean };
  assert.equal(binaryJson.isBinary, true);

  const editRes = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projId)}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'src/index.ts',
      content: 'export const greeting = "updated offline content";\n',
    }),
  });
  assert.equal(editRes.status, 200);

  const rereadRes = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projId)}/file?path=${encodeURIComponent('src/index.ts')}`,
  );
  const rereadJson = (await rereadRes.json()) as { content: string };
  assert.match(rereadJson.content, /updated offline content/);
});

test('POST /api/chat/message in Persian generates Persian changeReport at /api/runs/:id/report', async () => {
  const wfRes = await fetch(`${baseUrl}/api/workflows`);
  const workflows = (await wfRes.json()) as Array<{ id: string }>;
  const wfId = workflows[0].id;

  const chatRes = await fetch(`${baseUrl}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: wfId,
      targetAgentId: 'all',
      message: 'سلام، لطفا سرویس احراز هویت را بررسی و فایل تنظیمات را آماده کن.',
      mode: 'dry_run',
    }),
  });
  assert.equal(chatRes.status, 200);
  const chatJson = (await chatRes.json()) as { runId: string };
  assert.ok(chatJson.runId);
  createdRunIds.push(chatJson.runId);

  // Wait for dry-run group round (including closed-loop Manager -> Specialist -> Manager) to finalize
  let reportJson: {
    run?: { chatLanguage?: string; status?: string };
    changeReport?: {
      language: string;
      summaryText: string;
      agentReports?: Array<{
        agentId: string;
        agentName: string;
        role: string;
        delegationsIssued: number;
        delegationsReceived: number;
        repliedToManager: boolean;
        workSummary: string;
      }>;
    };
  } = {};
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const repRes = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(chatJson.runId)}/report`,
    );
    if (repRes.ok) {
      reportJson = (await repRes.json()) as typeof reportJson;
      if (
        reportJson.run?.status === 'completed' &&
        reportJson.changeReport &&
        (reportJson.changeReport.agentReports?.length ?? 0) >= 2
      ) {
        break;
      }
    }
  }

  assert.equal(reportJson.run?.chatLanguage, 'fa');
  assert.equal(reportJson.changeReport?.language, 'fa');
  assert.match(reportJson.changeReport?.summaryText ?? '', /گزارش کار هر ایجنت/);
  assert.ok((reportJson.changeReport?.agentReports?.length ?? 0) >= 2);
  assert.ok(
    reportJson.changeReport!.agentReports!.some((ar) => ar.repliedToManager),
    'Expected at least one delegated specialist to reply directly to the Manager',
  );

  const runDetailRes = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(chatJson.runId)}`);
  assert.equal(runDetailRes.status, 200);
  const runDetail = (await runDetailRes.json()) as {
    events: Array<{ type: string; replyingToManager?: string }>;
  };
  assert.ok(
    runDetail.events.some((e) => e.type === 'manager_delegation'),
    'Expected manager_delegation event in GroupChat run',
  );
  assert.ok(
    runDetail.events.some((e) => e.type === 'agent_message' && Boolean(e.replyingToManager)),
    'Expected specialist agent_message with replyingToManager populated',
  );
});

test('POST /api/chat/message in live mode on unconfigured agent emits agent_error and records it in report', async () => {
  const wfId = `wf-live-err-${Date.now()}`;
  createdWorkflowIds.push(wfId);

  const saveRes = await fetch(`${baseUrl}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: wfId,
      name: 'Live Error Verification Flow',
      description: 'Verifies agent_error popup payload on missing provider key',
      maxRounds: 4,
      humanInTheLoop: false,
      nodes: [
        {
          id: 'node-unconfigured-openai',
          type: 'agentNode',
          position: { x: 180, y: 120 },
          data: {
            role: 'backend',
            label: 'Unconfigured OpenAI Backend',
            provider: 'openai',
            model: 'gpt-4o',
            envSecretRef: 'NON_EXISTENT_TEST_OPENAI_KEY_XYZ',
            systemPrompt: 'Implement API endpoints.',
            temperature: 0.2,
            tools: { readFile: true, writeFile: false, execBash: false },
            status: 'idle',
          },
        },
      ],
      edges: [],
      updatedAt: new Date().toISOString(),
    }),
  });
  assert.equal(saveRes.status, 200);

  const chatRes = await fetch(`${baseUrl}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: wfId,
      targetAgentId: 'node-unconfigured-openai',
      message: 'Check API health endpoint',
      mode: 'live',
    }),
  });
  assert.equal(chatRes.status, 200);
  const chatJson = (await chatRes.json()) as { runId: string };
  assert.ok(chatJson.runId);
  createdRunIds.push(chatJson.runId);

  let runDetail: {
    status?: string;
    events?: Array<{
      type: string;
      agentId?: string;
      provider?: string;
      model?: string;
      errorSource?: string;
      content: string;
    }>;
  } = {};
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    const res = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(chatJson.runId)}`);
    if (res.ok) {
      runDetail = (await res.json()) as typeof runDetail;
      if (runDetail.events?.some((e) => e.type === 'agent_error')) break;
    }
  }

  const errEvt = runDetail.events?.find((e) => e.type === 'agent_error');
  assert.ok(errEvt, 'Expected agent_error event for unconfigured live agent');
  assert.equal(errEvt!.agentId, 'node-unconfigured-openai');
  assert.equal(errEvt!.provider, 'openai');
  assert.equal(errEvt!.model, 'gpt-4o');
  assert.equal(errEvt!.errorSource, 'config');

  const repRes = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(chatJson.runId)}/report`);
  assert.equal(repRes.status, 200);
  const repJson = (await repRes.json()) as {
    changeReport?: {
      stats: { totalErrors?: number };
      agentReports?: Array<{ agentId: string; status: string; errors: string[] }>;
    };
  };
  assert.ok((repJson.changeReport?.stats.totalErrors ?? 0) >= 1);
  const agentRep = repJson.changeReport?.agentReports?.find(
    (a) => a.agentId === 'node-unconfigured-openai',
  );
  assert.ok(agentRep);
  assert.equal(agentRep!.status, 'error');
  assert.ok(agentRep!.errors.length >= 1);
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
