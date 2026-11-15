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
  upsertReadmeChangelog,
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

test('assembleExportBundleFiles overlays edits inside project folders and writes changelog ONLY into README.md', () => {
  const wf = DEFAULT_SEED_WORKFLOWS[0];
  const files = assembleExportBundleFiles({
    scope: 'project_bundle',
    workflow: wf,
    importedProjectFiles: [
      { path: 'README.md', content: '# Sample Project\n\nOriginal overview.' },
      { path: 'app/service.mjs', content: 'export const v = 1;' },
      { path: 'app/unchanged.mjs', content: 'export const keep = true;' },
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
        path: 'app/unchanged.mjs',
        content: 'export const keep = true;',
        size: 25,
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
  assert.deepEqual(paths, [
    'app/service.mjs',
    'app/unchanged.mjs',
    'README.md',
    'tests/service.test.mjs',
  ]);
  assert.equal(paths.some((p) => p.includes('.aetherflow')), false);
  assert.equal(paths.some((p) => p.includes('AETHERFLOW_WORKFLOW.md')), false);
  assert.equal(paths.some((p) => p.endsWith('.workflow.json')), false);
  assert.equal(paths.some((p) => p.startsWith('sandbox_output/')), false);
  assert.equal(paths.includes('.env'), false);

  const serviceEntry = files.find((f) => f.path === 'app/service.mjs');
  assert.ok(serviceEntry?.content.includes('updated by Backend Agent'));
  assert.equal(serviceEntry?.changeType, 'modified');
  assert.equal(files.find((f) => f.path === 'app/unchanged.mjs')?.changeType, 'project');
  assert.equal(files.find((f) => f.path === 'tests/service.test.mjs')?.changeType, 'added');

  const readmeEntry = files.find((f) => f.path === 'README.md');
  assert.equal(readmeEntry?.changeType, 'modified');
  assert.ok(readmeEntry?.content.includes('# Sample Project'));
  assert.ok(readmeEntry?.content.includes('Original overview.'));
  assert.ok(readmeEntry?.content.includes('## Changelog (Agent Team Edits)'));
  assert.ok(readmeEntry?.content.includes('`app/service.mjs`'));
  assert.ok(readmeEntry?.content.includes('`tests/service.test.mjs`'));
  assert.equal(readmeEntry?.content.includes('`app/unchanged.mjs`'), false);

  const summary = computeExportChangeSummary(files);
  assert.equal(summary.modifiedCount, 2); // app/service.mjs + README.md
  assert.equal(summary.addedCount, 1);
  assert.equal(summary.projectCount, 1);
  assert.equal(summary.metadataCount, 0);

  // Verify ZIP creation round-trip
  const zipBuf = createZipBufferFromBundle(files);
  const zip = new AdmZip(zipBuf);
  const zipEntries = zip.getEntries().map((e) => e.entryName);
  assert.deepEqual(zipEntries.sort(), [
    'README.md',
    'app/service.mjs',
    'app/unchanged.mjs',
    'tests/service.test.mjs',
  ]);
});

test('assembleExportBundleFiles applies edits directly in full_studio and sandbox_only without wrapper folders', () => {
  const wf = DEFAULT_SEED_WORKFLOWS[0];

  const fullFiles = assembleExportBundleFiles({
    scope: 'full_studio',
    workflow: wf,
    studioSourceFiles: [
      { path: 'README.md', content: '# Studio Root' },
      { path: 'src/App.tsx', content: 'export const App = () => null;' },
    ],
    sandboxFiles: [
      {
        path: 'src/App.tsx',
        content: 'export const App = () => "updated";',
        size: 35,
        updatedAt: '2026-11-15T08:00:00.000Z',
      },
      {
        path: 'src/utils/helper.ts',
        content: 'export const helper = 1;',
        size: 24,
        updatedAt: '2026-11-15T08:01:00.000Z',
      },
    ],
  });

  assert.deepEqual(
    fullFiles.map((f) => f.path),
    ['README.md', 'src/App.tsx', 'src/utils/helper.ts'],
  );
  assert.equal(fullFiles.find((f) => f.path === 'src/App.tsx')?.changeType, 'modified');
  assert.equal(fullFiles.find((f) => f.path === 'src/utils/helper.ts')?.changeType, 'added');
  assert.ok(fullFiles.find((f) => f.path === 'README.md')?.content.includes('`src/App.tsx`'));

  const sandboxOnly = assembleExportBundleFiles({
    scope: 'sandbox_only',
    workflow: wf,
    importedProjectFiles: [
      { path: 'src/unchanged.ts', content: 'const x = 1;' },
      { path: 'src/App.tsx', content: 'const app = 1;' },
    ],
    sandboxFiles: [
      { path: 'src/unchanged.ts', content: 'const x = 1;', size: 12, updatedAt: '2026-11-15T08:00:00.000Z' },
      { path: 'src/App.tsx', content: 'const app = 2;', size: 14, updatedAt: '2026-11-15T08:00:00.000Z' },
      { path: 'tests/new.test.ts', content: 'export {};', size: 10, updatedAt: '2026-11-15T08:00:00.000Z' },
    ],
  });

  assert.deepEqual(
    sandboxOnly.map((f) => f.path),
    ['README.md', 'src/App.tsx', 'tests/new.test.ts'],
  );
  assert.equal(sandboxOnly.find((f) => f.path === 'README.md')?.changeType, 'added');
});

test('upsertReadmeChangelog replaces previous changelog markers without duplicating sections', () => {
  const wf = DEFAULT_SEED_WORKFLOWS[0];
  const first = upsertReadmeChangelog('# App Title', {
    workflow: wf,
    modifiedPaths: ['src/a.ts'],
    addedPaths: [],
  });
  const second = upsertReadmeChangelog(first, {
    workflow: wf,
    modifiedPaths: ['src/a.ts', 'src/b.ts'],
    addedPaths: ['tests/b.test.ts'],
  });
  assert.equal((second.match(/## Changelog \(Agent Team Edits\)/g) ?? []).length, 1);
  assert.ok(second.includes('# App Title'));
  assert.ok(second.includes('`src/b.ts`'));
  assert.ok(second.includes('`tests/b.test.ts`'));
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

test('assembleExportBundleFiles produces clean README-only fallback ZIP for non-ASCII workflow with no edits', () => {
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
    ['README.md'],
  );
  const zipBuf = createZipBufferFromBundle(files);
  const zip = new AdmZip(zipBuf);
  assert.equal(zip.getEntries().length, 1);
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
