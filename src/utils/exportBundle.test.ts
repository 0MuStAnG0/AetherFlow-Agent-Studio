import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DEFAULT_SEED_WORKFLOWS } from '../data/agentTemplates.ts';
import { createZipBufferFromBundle } from '../../server/zipBundle.ts';
import {
  assembleExportBundleFiles,
  buildContentDispositionHeader,
  computeExportChangeSummary,
  isSafeExportFilePath,
  mergeSandboxSnapshots,
  slugifyBundleName,
  validateGitHubPushParams,
} from './exportBundle.ts';

test('isSafeExportFilePath blocks .env secrets, databases, and path traversal while allowing .env.example and .gitignore', () => {
  assert.equal(isSafeExportFilePath('src/App.tsx'), true);
  assert.equal(isSafeExportFilePath('.gitignore'), true);
  assert.equal(isSafeExportFilePath('.dockerignore'), true);
  assert.equal(isSafeExportFilePath('.env.example'), true);
  assert.equal(isSafeExportFilePath('deploy/.env.example'), true);
  assert.equal(isSafeExportFilePath('.env'), false);
  assert.equal(isSafeExportFilePath('.env.local'), false);
  assert.equal(isSafeExportFilePath('data/studio.db'), false);
  assert.equal(isSafeExportFilePath('.playwright-cli/snap.yml'), false);
  assert.equal(isSafeExportFilePath('../etc/passwd'), false);
  assert.equal(isSafeExportFilePath('node_modules/pkg/index.js'), false);
});

test('assembleExportBundleFiles merges project and sandbox files with accurate changeType and creates valid ZIP buffer', () => {
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

  // Verify sandbox file overlaid imported project file and marked changeType accurately
  const serviceEntry = files.find((f) => f.path === 'app/service.mjs');
  assert.ok(serviceEntry?.content.includes('updated by Backend Agent'));
  assert.equal(serviceEntry?.changeType, 'modified');
  assert.equal(files.find((f) => f.path === 'README.md')?.changeType, 'project');
  assert.equal(files.find((f) => f.path === 'tests/service.test.mjs')?.changeType, 'added');

  const summary = computeExportChangeSummary(files);
  assert.equal(summary.modifiedCount, 1);
  assert.equal(summary.addedCount, 1);
  assert.equal(summary.projectCount, 1);
  assert.equal(summary.metadataCount, 2);

  // Verify ZIP creation round-trip
  const zipBuf = createZipBufferFromBundle(files);
  const zip = new AdmZip(zipBuf);
  const zipEntries = zip.getEntries().map((e) => e.entryName);
  assert.ok(zipEntries.includes('app/service.mjs'));
  assert.ok(zipEntries.includes('AETHERFLOW_WORKFLOW.md'));
});

test('mergeSandboxSnapshots merges chronological agent runs with newer edits overriding older ones', () => {
  const merged = mergeSandboxSnapshots([
    [
      { path: 'src/api.ts', content: 'v1', size: 2, updatedAt: '2026-11-14T09:00:00.000Z' },
      { path: 'src/legacy.ts', content: 'keep', size: 4, updatedAt: '2026-11-14T09:00:00.000Z' },
    ],
    [
      { path: 'src/api.ts', content: 'v2-final', size: 8, updatedAt: '2026-11-14T10:00:00.000Z' },
      { path: 'src/ui.tsx', content: 'ui', size: 2, updatedAt: '2026-11-14T10:00:00.000Z' },
    ],
  ]);

  assert.deepEqual(
    merged.map((f) => [f.path, f.content]),
    [
      ['src/api.ts', 'v2-final'],
      ['src/legacy.ts', 'keep'],
      ['src/ui.tsx', 'ui'],
    ],
  );
});

test('assembleExportBundleFiles produces clean minimal ZIP for non-ASCII workflow with no test artifacts', () => {
  const wf = { ...DEFAULT_SEED_WORKFLOWS[0], name: 'تیم مهندسی نرم‌افزار' };
  assert.equal(slugifyBundleName(wf.name), 'aetherflow-project');
  const files = assembleExportBundleFiles({
    scope: 'project_bundle',
    workflow: wf,
    sandboxFiles: [],
    importedProjectFiles: [],
    bugReports: [],
  });
  assert.deepEqual(
    files.map((f) => f.path),
    ['.aetherflow/aetherflow-project.workflow.json', 'AETHERFLOW_WORKFLOW.md'],
  );
  const zipBuf = createZipBufferFromBundle(files);
  const zip = new AdmZip(zipBuf);
  assert.equal(zip.getEntries().length, 2);
});

test('validateGitHubPushParams and buildContentDispositionHeader handle valid/invalid inputs safely', () => {
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

  const header = buildContentDispositionHeader('my-bundle.zip');
  assert.ok(header.includes('attachment; filename="my-bundle.zip"'));
  assert.ok(header.includes("filename*=UTF-8''my-bundle.zip"));
});
