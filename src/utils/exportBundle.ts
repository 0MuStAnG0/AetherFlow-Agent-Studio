import type { BugReportItem, SandboxFile, WorkflowConfig } from '../types/workflow';
import { parseGitHubDeployTarget } from './githubDeploy';
import { serializeWorkflowForExport } from './workflowEngine';

export type ExportBundleScope = 'project_bundle' | 'sandbox_only' | 'full_studio';

export interface BundleFileEntry {
  path: string;
  content: string;
  size: number;
}

export interface BuildExportBundleParams {
  scope: ExportBundleScope;
  workflow: WorkflowConfig;
  sandboxFiles?: SandboxFile[];
  importedProjectFiles?: Array<{ path: string; content: string }>;
  studioSourceFiles?: Array<{ path: string; content: string }>;
  bugReports?: BugReportItem[];
}

export interface GitHubPushRequestValidation {
  valid: boolean;
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  error?: string;
}

const FORBIDDEN_EXPORT_PATHS = /(^|\/)(\.env(\..+)?|.*\.db|.*\.sqlite.*|node_modules|dist|\.git)(\/|$)/i;
const textEncoder = new TextEncoder();

export function isSafeExportFilePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..')) return false;
  if (
    normalized.toLowerCase() === '.env.example' ||
    normalized.toLowerCase().endsWith('/.env.example')
  ) {
    return true;
  }
  return !FORBIDDEN_EXPORT_PATHS.test(normalized);
}

export function slugifyBundleName(rawName: string): string {
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'aetherflow-project';
}

export function buildWorkflowMarkdownSummary(
  workflow: WorkflowConfig,
  bugReports: BugReportItem[] = [],
): string {
  const lines: string[] = [
    `# ${workflow.name}`,
    '',
    workflow.description || 'Multi-agent workflow exported from AetherFlow Agent Studio.',
    '',
    `- **Workflow ID**: \`${workflow.id}\``,
    `- **Max Rounds**: \`${workflow.maxRounds}\``,
    `- **Human-in-the-Loop Gate**: \`${workflow.humanInTheLoop ? 'Enabled' : 'Disabled'}\``,
  ];

  if (workflow.projectContext) {
    lines.push(
      `- **Linked Project**: ${workflow.projectContext.name} (\`${workflow.projectContext.sourceType}\`)`,
    );
  }

  lines.push('', '## Configured Agents', '');
  lines.push('| Agent | Role | Section | Position / Post | Power | Provider & Model | Tools |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  for (const node of workflow.nodes) {
    const d = node.data;
    const tools =
      [
        d.tools.readFile ? 'READ' : null,
        d.tools.writeFile ? 'WRITE' : null,
        d.tools.execBash ? 'BASH' : null,
      ]
        .filter(Boolean)
        .join(', ') || 'None';
    lines.push(
      `| **${d.label}** | \`${d.role}\` | ${d.section || '—'} | ${d.positionTitle || '—'} | \`${d.powerLevel || 'standard'}\` | \`${d.provider} / ${d.model}\` | ${tools} |`,
    );
  }

  if (bugReports.length > 0) {
    lines.push('', '## Recorded Bug Reports & Improvement Ideas', '');
    for (const bug of bugReports.slice(0, 25)) {
      lines.push(
        `- **[${bug.status.toUpperCase()} · ${bug.severity.toUpperCase()}] ${bug.title}** (${bug.agentName}): ${bug.description}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function assembleExportBundleFiles(params: BuildExportBundleParams): BundleFileEntry[] {
  const {
    scope,
    workflow,
    sandboxFiles = [],
    importedProjectFiles = [],
    studioSourceFiles = [],
    bugReports = [],
  } = params;

  const fileMap = new Map<string, string>();
  const addFile = (relPath: string, content: string) => {
    const cleanPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!isSafeExportFilePath(cleanPath)) return;
    fileMap.set(cleanPath, content);
  };

  const wfSlug = slugifyBundleName(workflow.name);
  const workflowJson = serializeWorkflowForExport(workflow);

  if (scope === 'full_studio') {
    for (const f of studioSourceFiles) {
      addFile(f.path, f.content);
    }
    addFile(`workflows/${wfSlug}.workflow.json`, workflowJson);
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports));
    for (const sf of sandboxFiles) {
      addFile(`sandbox_output/${sf.path.replace(/^\/+/, '')}`, sf.content);
    }
  } else if (scope === 'sandbox_only') {
    for (const sf of sandboxFiles) {
      addFile(sf.path, sf.content);
    }
    addFile(`${wfSlug}.workflow.json`, workflowJson);
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports));
  } else {
    // project_bundle (default): Imported project files + Sandbox files overlaid + workflow metadata
    for (const pf of importedProjectFiles) {
      addFile(pf.path, pf.content);
    }
    for (const sf of sandboxFiles) {
      addFile(sf.path, sf.content);
    }
    addFile(`.aetherflow/${wfSlug}.workflow.json`, workflowJson);
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports));
    if (bugReports.length > 0) {
      addFile('.aetherflow/bug-reports.json', JSON.stringify(bugReports, null, 2));
    }
  }

  return Array.from(fileMap.entries())
    .map(([filePath, content]) => ({
      path: filePath,
      content,
      size: textEncoder.encode(content).byteLength,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function validateGitHubPushParams(input: {
  repoInput?: string;
  branch?: string;
  commitMessage?: string;
}): GitHubPushRequestValidation {
  const parsed = parseGitHubDeployTarget(input.repoInput || '', input.branch);
  if (!parsed.valid || !parsed.owner || !parsed.repo) {
    return {
      valid: false,
      owner: '',
      repo: '',
      branch: 'main',
      commitMessage: '',
      error: parsed.error || 'Valid GitHub repository (owner/repo or URL) is required.',
    };
  }

  const branch = (input.branch?.trim() || parsed.branch || 'main').replace(/^refs\/heads\//, '');
  if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    return {
      valid: false,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      commitMessage: '',
      error: 'Invalid Git branch name.',
    };
  }

  const commitMessage =
    input.commitMessage?.trim() ||
    `feat: export AetherFlow workflow and project bundle (${new Date().toISOString().slice(0, 10)})`;

  return {
    valid: true,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    commitMessage,
  };
}
