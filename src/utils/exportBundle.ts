import type { BugReportItem, SandboxFile, WorkflowConfig } from '../types/workflow';
import { parseGitHubDeployTarget } from './githubDeploy';

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

const FORBIDDEN_EXPORT_PATHS = /(^|\/)(\.env(\..+)?|.*\.db|.*\.sqlite.*|.*\.zip|node_modules|dist|\.git|\.playwright-cli)(\/|$)/i;
const CHANGELOG_START = '<!-- aetherflow-changelog:start -->';
const CHANGELOG_END = '<!-- aetherflow-changelog:end -->';
const CHANGELOG_BLOCK_REGEX = /\n*<!-- aetherflow-changelog:start -->[\s\S]*?<!-- aetherflow-changelog:end -->\n*/g;
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

export function stripReadmeChangelogBlock(content: string): string {
  return content.replace(CHANGELOG_BLOCK_REGEX, '\n').trimEnd();
}

export function buildReadmeChangelogSection(params: {
  workflow: WorkflowConfig;
  modifiedPaths: string[];
  addedPaths: string[];
  bugReports?: BugReportItem[];
}): string {
  const { workflow, modifiedPaths, addedPaths, bugReports = [] } = params;
  const sortedModified = Array.from(new Set(modifiedPaths)).sort((a, b) => a.localeCompare(b));
  const sortedAdded = Array.from(new Set(addedPaths)).sort((a, b) => a.localeCompare(b));

  const lines: string[] = [
    CHANGELOG_START,
    '## Changelog (Agent Team Edits)',
    '',
    `- **Workflow**: ${workflow.name}`,
    `- **Modified Files (${sortedModified.length})**:`,
  ];

  if (sortedModified.length > 0) {
    for (const filePath of sortedModified) {
      lines.push(`  - \`${filePath}\``);
    }
  } else {
    lines.push('  - None');
  }

  lines.push(`- **Added Files (${sortedAdded.length})**:`);
  if (sortedAdded.length > 0) {
    for (const filePath of sortedAdded) {
      lines.push(`  - \`${filePath}\``);
    }
  } else {
    lines.push('  - None');
  }

  if (bugReports.length > 0) {
    lines.push('', '### Recorded Bug Reports & Fixes', '');
    for (const bug of bugReports.slice(0, 25)) {
      lines.push(
        `- **[${bug.status.toUpperCase()} · ${bug.severity.toUpperCase()}] ${bug.title}** (${bug.agentName}): ${bug.description}`,
      );
    }
  }

  lines.push(CHANGELOG_END);
  return lines.join('\n');
}

export function upsertReadmeChangelog(
  existingReadme: string | undefined,
  params: {
    workflow: WorkflowConfig;
    modifiedPaths: string[];
    addedPaths: string[];
    bugReports?: BugReportItem[];
  },
): string {
  const cleanedBase = stripReadmeChangelogBlock(existingReadme || '');
  const section = buildReadmeChangelogSection(params);
  if (!cleanedBase) {
    return `# ${params.workflow.projectContext?.name || params.workflow.name}\n\n${section}\n`;
  }
  return `${cleanedBase}\n\n${section}\n`;
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

  const baseContents = new Map<string, string>();
  const modifiedPaths: string[] = [];
  const addedPaths: string[] = [];

  if (scope === 'full_studio') {
    for (const f of studioSourceFiles) {
      const cleanPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      baseContents.set(cleanPath, f.content);
      addFile(cleanPath, f.content, 'project');
    }
    for (const sf of sandboxFiles) {
      const cleanPath = sf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      const existed = baseContents.has(cleanPath);
      const baseVal = baseContents.get(cleanPath) ?? '';
      const changed =
        cleanPath === 'README.md'
          ? existed && stripReadmeChangelogBlock(baseVal) !== stripReadmeChangelogBlock(sf.content)
          : existed && baseVal !== sf.content;
      addFile(cleanPath, sf.content, existed ? (changed ? 'modified' : 'project') : 'added');
      if (cleanPath !== 'README.md') {
        if (changed) modifiedPaths.push(cleanPath);
        else if (!existed) addedPaths.push(cleanPath);
      }
    }
  } else if (scope === 'sandbox_only') {
    for (const pf of importedProjectFiles) {
      const cleanPath = pf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      baseContents.set(cleanPath, pf.content);
    }
    for (const sf of sandboxFiles) {
      const cleanPath = sf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      const existed = baseContents.has(cleanPath);
      const baseVal = baseContents.get(cleanPath) ?? '';
      if (cleanPath === 'README.md') {
        if (!existed || stripReadmeChangelogBlock(baseVal) !== stripReadmeChangelogBlock(sf.content)) {
          addFile(cleanPath, sf.content, existed ? 'modified' : 'added');
        }
        continue;
      }
      if (existed && baseVal === sf.content) {
        // Skip untouched base files seeded into sandbox when exporting changes only
        continue;
      }
      addFile(cleanPath, sf.content, existed ? 'modified' : 'added');
      if (existed) modifiedPaths.push(cleanPath);
      else addedPaths.push(cleanPath);
    }
  } else {
    // project_bundle (default): Base project files + agent edits overlaid directly inside code folders
    for (const pf of importedProjectFiles) {
      const cleanPath = pf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      baseContents.set(cleanPath, pf.content);
      addFile(cleanPath, pf.content, 'project');
    }
    for (const sf of sandboxFiles) {
      const cleanPath = sf.path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!isSafeExportFilePath(cleanPath)) continue;
      const existed = baseContents.has(cleanPath);
      const baseVal = baseContents.get(cleanPath) ?? '';
      const changed =
        cleanPath === 'README.md'
          ? existed && stripReadmeChangelogBlock(baseVal) !== stripReadmeChangelogBlock(sf.content)
          : existed && baseVal !== sf.content;
      addFile(cleanPath, sf.content, existed ? (changed ? 'modified' : 'project') : 'added');
      if (cleanPath !== 'README.md') {
        if (changed) modifiedPaths.push(cleanPath);
        else if (!existed) addedPaths.push(cleanPath);
      }
    }
  }

  // Write ONLY the list of changes into README.md (no extra .aetherflow/, workflows/, or AETHERFLOW_WORKFLOW.md files)
  const shouldUpdateReadme =
    modifiedPaths.length > 0 ||
    addedPaths.length > 0 ||
    bugReports.length > 0 ||
    fileMap.size === 0;

  if (shouldUpdateReadme) {
    const baseHadReadme = baseContents.has('README.md');
    const existingReadme = fileMap.get('README.md')?.content ?? baseContents.get('README.md');
    const updatedReadme = upsertReadmeChangelog(existingReadme, {
      workflow,
      modifiedPaths,
      addedPaths,
      bugReports,
    });
    addFile('README.md', updatedReadme, baseHadReadme ? 'modified' : 'added');
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
