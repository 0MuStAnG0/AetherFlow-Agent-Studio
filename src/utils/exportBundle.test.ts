import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DEFAULT_SEED_WORKFLOWS } from '../data/agentTemplates.ts';
import { createZipBufferFromBundle } from '../../server/zipBundle.ts';
import {
  assembleExportBundleFiles,
  isSafeExportFilePath,
  slugifyBundleName,
  validateGitHubPushParams,
} from './exportBundle.ts';

test('isSafeExportFilePath blocks .env secrets, databases, and path traversal while allowing .env.example', () => {
  assert.equal(isSafeExportFilePath('src/App.tsx'), true);
  assert.equal(isSafeExportFilePath('.env.example'), true);
  assert.equal(isSafeExportFilePath('deploy/.env.example'), true);
  assert.equal(isSafeExportFilePath('.env'), false);
  assert.equal(isSafeExportFilePath('.env.local'), false);
  assert.equal(isSafeExportFilePath('data/studio.db'), false);
  assert.equal(isSafeExportFilePath('../etc/passwd'), false);
  assert.equal(isSafeExportFilePath('node_modules/pkg/index.js'), false);
});

test('assembleExportBundleFiles merges project and sandbox files and creates valid ZIP buffer', () => {
  const wf = DEFAULT_SEED_WORKFLOWS[0];
  const files = assembleExportBundleFiles({
    scope: 'project_bundle',
    workflow: wf,
    importedProjectFiles: [
      { path: 'README.md', content: '# Sample Project' },
      { path: 'app/service.mjs', content: 'export const v = 1;' },
      { path: '.env', content: 'SECRET=should_not_be_exported' },
    ],
    sandboxFiles: [
      {
        path: 'app/service.mjs',
        content: 'export const v = 2; // updated by Backend Agent',
        size: 48,
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
      {
        path: 'tests/service.test.mjs',
        content: 'import assert from "node:assert";',
        size: 33,
        updatedAt: '2026-11-14T10:01:00.000Z',
      },
    ],
  });

  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('README.md'));
  assert.ok(paths.includes('app/service.mjs'));
  assert.ok(paths.includes('tests/service.test.mjs'));
  assert.ok(paths.includes('AETHERFLOW_WORKFLOW.md'));
  assert.ok(paths.some((p) => p.endsWith('.workflow.json')));
  assert.equal(paths.includes('.env'), false);

  // Verify sandbox file overlaid imported project file
  const serviceEntry = files.find((f) => f.path === 'app/service.mjs');
  assert.ok(serviceEntry?.content.includes('updated by Backend Agent'));

  // Verify ZIP creation round-trip
  const zipBuf = createZipBufferFromBundle(files);
  const zip = new AdmZip(zipBuf);
  const zipEntries = zip.getEntries().map((e) => e.entryName);
  assert.ok(zipEntries.includes('app/service.mjs'));
  assert.ok(zipEntries.includes('AETHERFLOW_WORKFLOW.md'));
});

test('validateGitHubPushParams parses owner/repo, URL, branch, and default commit message', () => {
  const valid = validateGitHubPushParams({
    repoInput: 'https://github.com/0MuStAnG0/AetherFlow-Agent-Studio',
    branch: 'feat/agents-export',
    commitMessage: 'chore: push agent studio bundle',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.owner, '0MuStAnG0');
  assert.equal(valid.repo, 'AetherFlow-Agent-Studio');
  assert.equal(valid.branch, 'feat/agents-export');
  assert.equal(valid.commitMessage, 'chore: push agent studio bundle');

  const invalid = validateGitHubPushParams({
    repoInput: 'https://gitlab.com/foo/bar',
    branch: 'main',
  });
  assert.equal(invalid.valid, false);
  assert.equal(slugifyBundleName('Full-Stack Pipeline!'), 'full-stack-pipeline');
});
