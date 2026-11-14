export type LinuxInstallMode = 'auto' | 'docker' | 'systemd' | 'native';

export const DEFAULT_GITHUB_REPO_URL =
  'https://github.com/0MuStAnG0/AetherFlow-Agent-Studio';
export const DEFAULT_GITHUB_OWNER = '0MuStAnG0';
export const DEFAULT_GITHUB_REPO = 'AetherFlow-Agent-Studio';

export interface ParsedGitHubDeployTarget {
  valid: boolean;
  owner: string;
  repo: string;
  branch: string;
  cloneUrl: string;
  rawInstallerUrl: string;
  error?: string;
}

export interface LinuxOneLineCommandOptions {
  repoInput: string;
  branch?: string;
  mode?: LinuxInstallMode;
  installDir?: string;
  port?: string | number;
}

export interface GeneratedLinuxInstallCommands {
  valid: boolean;
  target: ParsedGitHubDeployTarget;
  oneLineCurlCommand: string;
  gitCloneCommand: string;
  rawScriptUrl: string;
}

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH_RE = /^[A-Za-z0-9_./-]+$/;

export function parseGitHubDeployTarget(
  input: string,
  preferredBranch?: string
): ParsedGitHubDeployTarget {
  const trimmed = input.trim();
  const fallbackBranch = sanitizeBranch(preferredBranch) || 'main';

  if (!trimmed) {
    return {
      valid: false,
      owner: '',
      repo: '',
      branch: fallbackBranch,
      cloneUrl: '',
      rawInstallerUrl: '',
      error: 'GitHub repository URL or owner/repo is required.',
    };
  }

  let owner = '';
  let repo = '';
  let extractedBranch = '';

  const sshMatch = /^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  } else if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) {
        return {
          valid: false,
          owner: '',
          repo: '',
          branch: fallbackBranch,
          cloneUrl: '',
          rawInstallerUrl: '',
          error: 'URL must point to github.com.',
        };
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        return {
          valid: false,
          owner: '',
          repo: '',
          branch: fallbackBranch,
          cloneUrl: '',
          rawInstallerUrl: '',
          error: 'GitHub URL must include owner and repository name.',
        };
      }
      owner = parts[0];
      repo = parts[1].replace(/\.git$/i, '');
      if (parts[2] === 'tree' && parts[3]) {
        extractedBranch = parts.slice(3).join('/');
      }
    } catch {
      return {
        valid: false,
        owner: '',
        repo: '',
        branch: fallbackBranch,
        cloneUrl: '',
        rawInstallerUrl: '',
        error: 'Invalid GitHub repository URL.',
      };
    }
  } else {
    const clean = trimmed.replace(/^github\.com\//i, '').replace(/\/+$/, '');
    const parts = clean.split('/').filter(Boolean);
    if (parts.length !== 2) {
      return {
        valid: false,
        owner: '',
        repo: '',
        branch: fallbackBranch,
        cloneUrl: '',
        rawInstallerUrl: '',
        error: 'Use owner/repo or https://github.com/owner/repo.',
      };
    }
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, '');
  }

  if (!SAFE_SEGMENT_RE.test(owner) || !SAFE_SEGMENT_RE.test(repo) || owner === '.' || repo === '..') {
    return {
      valid: false,
      owner: '',
      repo: '',
      branch: fallbackBranch,
      cloneUrl: '',
      rawInstallerUrl: '',
      error: 'Repository owner or name contains unsupported characters.',
    };
  }

  const branch = sanitizeBranch(preferredBranch) || sanitizeBranch(extractedBranch) || 'main';
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const rawInstallerUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/install-linux.sh`;

  return {
    valid: true,
    owner,
    repo,
    branch,
    cloneUrl,
    rawInstallerUrl,
  };
}

function sanitizeBranch(branch?: string): string {
  const value = (branch ?? '').trim();
  if (!value || !SAFE_BRANCH_RE.test(value) || value.includes('..')) {
    return '';
  }
  return value;
}

function shellQuoteIfNeeded(value: string): string {
  if (/^[A-Za-z0-9_./:~-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildLinuxOneLineCommand(
  options: LinuxOneLineCommandOptions
): GeneratedLinuxInstallCommands {
  const effectiveInput = options.repoInput.trim() || DEFAULT_GITHUB_REPO_URL;
  const target = parseGitHubDeployTarget(effectiveInput, options.branch);
  const effectiveOwner = target.valid ? target.owner : DEFAULT_GITHUB_OWNER;
  const effectiveRepo = target.valid ? target.repo : DEFAULT_GITHUB_REPO;
  const effectiveBranch = target.valid ? target.branch : sanitizeBranch(options.branch) || 'main';
  const cloneUrl = target.valid
    ? target.cloneUrl
    : `https://github.com/${effectiveOwner}/${effectiveRepo}.git`;
  const rawScriptUrl = target.valid
    ? target.rawInstallerUrl
    : `https://raw.githubusercontent.com/${effectiveOwner}/${effectiveRepo}/${effectiveBranch}/install-linux.sh`;

  const isBuiltinDefaultRepo =
    effectiveOwner.toLowerCase() === DEFAULT_GITHUB_OWNER.toLowerCase() &&
    effectiveRepo.toLowerCase() === DEFAULT_GITHUB_REPO.toLowerCase();

  const flags: string[] = [];
  if (!isBuiltinDefaultRepo) {
    flags.push('--repo', cloneUrl);
  }
  if (effectiveBranch !== 'main') {
    flags.push('--branch', effectiveBranch);
  }

  const mode = options.mode ?? 'auto';
  if (mode === 'docker') flags.push('--docker');
  else if (mode === 'systemd') flags.push('--systemd');
  else if (mode === 'native') flags.push('--native');

  const dir = (options.installDir ?? '').trim();
  if (dir) {
    flags.push('--dir', shellQuoteIfNeeded(dir));
  }

  const portNum = Number(options.port);
  if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 && portNum !== 3000) {
    flags.push('--port', String(portNum));
  }

  const oneLineCurlCommand =
    flags.length === 0
      ? `curl -fsSL ${rawScriptUrl} | bash`
      : `curl -fsSL ${rawScriptUrl} | bash -s -- ${flags.join(' ')}`;

  const cloneBranchFlag = effectiveBranch !== 'main' ? ` -b ${effectiveBranch}` : '';
  const localFlags: string[] = [];
  if (mode === 'docker') localFlags.push('--docker');
  else if (mode === 'systemd') localFlags.push('--systemd');
  else if (mode === 'native') localFlags.push('--native');
  if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 && portNum !== 3000) {
    localFlags.push('--port', String(portNum));
  }
  const localFlagSuffix = localFlags.length > 0 ? ` ${localFlags.join(' ')}` : '';
  const targetDirName = dir ? shellQuoteIfNeeded(dir) : effectiveRepo;
  const gitCloneCommand = `git clone${cloneBranchFlag} ${cloneUrl} ${targetDirName} && cd ${targetDirName} && chmod +x install-linux.sh && ./install-linux.sh${localFlagSuffix}`;

  return {
    valid: target.valid,
    target,
    oneLineCurlCommand,
    gitCloneCommand,
    rawScriptUrl,
  };
}
