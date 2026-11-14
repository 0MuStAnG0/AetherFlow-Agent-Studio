import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeProjectFiles,
  buildWorkflowFromRecommendations,
  parseGitHubRepoInput,
  sanitizeArchiveEntryPath,
} from './projectAnalyzer';

test('parseGitHubRepoInput parses standard URLs, tree branches, and owner/repo shorthand', () => {
  assert.deepEqual(parseGitHubRepoInput('https://github.com/fastapi/fastapi'), {
    owner: 'fastapi',
    repo: 'fastapi',
    branch: undefined,
  });
  assert.deepEqual(
    parseGitHubRepoInput('https://github.com/vercel/next.js/tree/canary'),
    {
      owner: 'vercel',
      repo: 'next.js',
      branch: 'canary',
    },
  );
  assert.deepEqual(parseGitHubRepoInput('openai/openai-node.git', 'main'), {
    owner: 'openai',
    repo: 'openai-node',
    branch: 'main',
  });
  assert.equal(parseGitHubRepoInput('https://gitlab.com/user/repo'), null);
  assert.equal(parseGitHubRepoInput('invalid'), null);
});

test('sanitizeArchiveEntryPath blocks zip-slip traversal and ignores build/vendor folders', () => {
  assert.equal(sanitizeArchiveEntryPath('repo-main/src/app.py', true), 'src/app.py');
  assert.equal(sanitizeArchiveEntryPath('repo-main/node_modules/pkg/index.js', true), null);
  assert.equal(sanitizeArchiveEntryPath('repo-main/.git/HEAD', true), null);
  assert.equal(sanitizeArchiveEntryPath('repo-main/assets/logo.png', true), null);
  assert.equal(sanitizeArchiveEntryPath('../../etc/passwd', false), null);
  assert.equal(sanitizeArchiveEntryPath('package.json', false), 'package.json');
});

test('analyzeProjectFiles detects full-stack Python + React + Docker stack and recommends tailored agents in EN and FA', () => {
  const sampleFiles = [
    {
      path: 'requirements.txt',
      content: 'fastapi==0.115.0\nsqlalchemy==2.0.35\npytest==8.3.0\n',
    },
    {
      path: 'backend/main.py',
      content: 'from fastapi import FastAPI\napp = FastAPI()\n',
    },
    {
      path: 'package.json',
      content: JSON.stringify({
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', '@google/genai': '^2.0.0' },
        devDependencies: { tailwindcss: '^4.0.0', vite: '^6.0.0' },
      }),
    },
    {
      path: 'src/App.tsx',
      content: 'export function App() { return <main>Dashboard</main>; }',
    },
    {
      path: 'Dockerfile',
      content: 'FROM python:3.11-slim\nCMD ["uvicorn", "backend.main:app"]',
    },
    {
      path: 'tests/test_api.py',
      content: 'def test_health(): assert True',
    },
  ];

  const analysisEn = analyzeProjectFiles({
    name: 'acme/fullstack-ai',
    sourceType: 'github',
    sourceUrl: 'https://github.com/acme/fullstack-ai',
    branch: 'main',
    files: sampleFiles,
    language: 'en',
  });

  assert.equal(analysisEn.totalFiles, 6);
  assert.ok(analysisEn.frameworks.includes('FastAPI'));
  assert.ok(analysisEn.frameworks.includes('React'));
  assert.ok(analysisEn.frameworks.includes('Docker'));
  assert.ok(analysisEn.frameworks.includes('AI / LLM SDK'));
  assert.ok(analysisEn.recommendations.some((r) => r.role === 'manager'));
  assert.ok(
    analysisEn.recommendations.some(
      (r) => r.role === 'backend' && r.specialty.includes('FastAPI'),
    ),
  );
  assert.ok(
    analysisEn.recommendations.some(
      (r) => r.role === 'frontend' && r.specialty.includes('React'),
    ),
  );
  assert.ok(analysisEn.recommendations.some((r) => r.role === 'security_qa'));
  assert.ok(analysisEn.recommendations.some((r) => r.role === 'executor'));
  assert.ok(
    analysisEn.recommendations.some((r) => r.id === 'rec-database'),
  );

  const analysisFa = analyzeProjectFiles({
    name: 'پروژه تست',
    sourceType: 'zip',
    files: sampleFiles,
    language: 'fa',
  });
  assert.ok(/[\u0600-\u06FF]/.test(analysisFa.managerSummary));
  assert.ok(analysisFa.recommendations.every((r) => /[\u0600-\u06FF]/.test(r.specialty)));
});

test('buildWorkflowFromRecommendations constructs connected React Flow workflow with projectContext', () => {
  const analysis = analyzeProjectFiles({
    id: 'proj-sample-1',
    name: 'demo-service',
    sourceType: 'zip',
    files: [
      { path: 'package.json', content: '{"dependencies":{"express":"^4.21.0","react":"^19.0.0"}}' },
      { path: 'server.ts', content: 'import express from "express";' },
      { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
    ],
  });

  const wf = buildWorkflowFromRecommendations({
    project: analysis,
    selectedSpecs: analysis.recommendations,
    mode: 'replace',
  });

  assert.equal(wf.nodes.length, analysis.recommendations.length);
  assert.ok(wf.edges.length >= 3);
  assert.equal(wf.projectContext?.projectId, 'proj-sample-1');
  assert.equal(wf.projectContext?.name, 'demo-service');

  const merged = buildWorkflowFromRecommendations({
    project: analysis,
    selectedSpecs: [
      {
        ...analysis.recommendations[0],
        id: 'rec-extra',
        title: 'Performance Profiler Agent',
        role: 'custom',
      },
    ],
    existingWorkflow: wf,
    mode: 'merge',
  });

  assert.equal(merged.nodes.length, wf.nodes.length + 1);
});
