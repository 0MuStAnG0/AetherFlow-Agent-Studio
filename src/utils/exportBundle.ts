import type { BugReportItem, SandboxFile, WorkflowConfig } from '../types/workflow';
import { parseGitHubDeployTarget } from './githubDeploy';
import { serializeWorkflowForExport } from './workflowEngine';

export type ExportBundleScope = 'project_bundle' | 'sandbox_only' | 'full_studio';

export type BundleFileChangeType = 'modified' | 'added' | 'project' | 'metadata';

export interface BundleFileEntry {
  path: string;
  content: string;
  size: number;
  changeType?: BundleFileChangeType;
}

export interface ExportChangeSummary {
  totalFiles: number;
  totalBytes: number;
  modifiedCount: number;
  addedCount: number;
  projectCount: number;
  metadataCount: number;
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

const FORBIDDEN_EXPORT_PATHS = /(^|\/)(\.env(\..+)?|.*\.db|.*\.sqlite.*|node_modules|dist|\.git|\.playwright-cli)(\/|$)/i;
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

export function buildContentDispositionHeader(filename: string): string {
  const cleaned = filename.replace(/[\r\n"\\]/g, '_').trim() || 'aetherflow-bundle.zip';
  const asciiFallback = cleaned.replace(/[^\x20-\x7E]/g, '_') || 'aetherflow-bundle.zip';
  const encoded = encodeURIComponent(cleaned);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function mergeSandboxSnapshots(snapshots: SandboxFile[][]): SandboxFile[] {
  const merged = new Map<string, SandboxFile>();
  for (const snapshot of snapshots) {
    for (const file of snapshot) {
      const cleanPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      merged.set(cleanPath, { ...file, path: cleanPath });
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function computeExportChangeSummary(entries: BundleFileEntry[]): ExportChangeSummary {
  let modifiedCount = 0;
  let addedCount = 0;
  let projectCount = 0;
  let metadataCount = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    totalBytes += entry.size;
    switch (entry.changeType) {
      case 'modified':
        modifiedCount += 1;
        break;
      case 'added':
        addedCount += 1;
        break;
      case 'project':
        projectCount += 1;
        break;
      case 'metadata':
        metadataCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    totalFiles: entries.length,
    totalBytes,
    modifiedCount,
    addedCount,
    projectCount,
    metadataCount,
  };
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

  const fileMap = new Map<string, { content: string; changeType: BundleFileChangeType }>();
  const addFile = (
    relPath: string,
    content: string,
    changeType: BundleFileChangeType,
  ) => {
    const cleanPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!isSafeExportFilePath(cleanPath)) return;
    fileMap.set(cleanPath, { content, changeType });
  };

  const wfSlug = slugifyBundleName(workflow.name);
  const workflowJson = serializeWorkflowForExport(workflow);

  if (scope === 'full_studio') {
    for (const f of studioSourceFiles) {
      addFile(f.path, f.content, 'project');
    }
    addFile(`workflows/${wfSlug}.workflow.json`, workflowJson, 'metadata');
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports), 'metadata');
    for (const sf of sandboxFiles) {
      addFile(`sandbox_output/${sf.path.replace(/^\/+/, '')}`, sf.content, 'added');
    }
  } else if (scope === 'sandbox_only') {
    const importedPaths = new Set(
      importedProjectFiles.map((pf) => pf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim()),
    );
    for (const sf of sandboxFiles) {
      const cleanPath = sf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      addFile(cleanPath, sf.content, importedPaths.has(cleanPath) ? 'modified' : 'added');
    }
    addFile(`${wfSlug}.workflow.json`, workflowJson, 'metadata');
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports), 'metadata');
  } else {
    // project_bundle (default): Imported project files + Sandbox files overlaid + workflow metadata
    const importedContents = new Map<string, string>();
    for (const pf of importedProjectFiles) {
      const cleanPath = pf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      importedContents.set(cleanPath, pf.content);
      addFile(cleanPath, pf.content, 'project');
    }
    for (const sf of sandboxFiles) {
      const cleanPath = sf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      const existed = importedContents.has(cleanPath);
      const changed = existed && importedContents.get(cleanPath) !== sf.content;
      addFile(cleanPath, sf.content, existed ? (changed ? 'modified' : 'project') : 'added');
    }
    addFile(`.aetherflow/${wfSlug}.workflow.json`, workflowJson, 'metadata');
    addFile('AETHERFLOW_WORKFLOW.md', buildWorkflowMarkdownSummary(workflow, bugReports), 'metadata');
    if (bugReports.length > 0) {
      addFile('.aetherflow/bug-reports.json', JSON.stringify(bugReports, null, 2), 'metadata');
    }
  }

  return Array.from(fileMap.entries())
    .map(([filePath, entry]) => ({
      path: filePath,
      content: entry.content,
      size: textEncoder.encode(entry.content).byteLength,
      changeType: entry.changeType,
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
