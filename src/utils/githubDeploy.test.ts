import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GITHUB_REPO_URL,
  buildLinuxOneLineCommand,
  parseGitHubDeployTarget,
} from './githubDeploy.ts';

test('parseGitHubDeployTarget parses HTTPS, .git, tree branch, SSH, and owner/repo shorthand', () => {
  const httpsRes = parseGitHubDeployTarget('https://github.com/ali-dev/aetherflow-studio');
  assert.equal(httpsRes.valid, true);
  assert.equal(httpsRes.owner, 'ali-dev');
  assert.equal(httpsRes.repo, 'aetherflow-studio');
  assert.equal(httpsRes.branch, 'main');
  assert.equal(httpsRes.cloneUrl, 'https://github.com/ali-dev/aetherflow-studio.git');
  assert.equal(
    httpsRes.rawInstallerUrl,
    'https://raw.githubusercontent.com/ali-dev/aetherflow-studio/main/install-linux.sh'
  );

  const treeRes = parseGitHubDeployTarget('https://github.com/ali-dev/aetherflow-studio/tree/release/v2');
  assert.equal(treeRes.valid, true);
  assert.equal(treeRes.branch, 'release/v2');
  assert.equal(
    treeRes.rawInstallerUrl,
    'https://raw.githubusercontent.com/ali-dev/aetherflow-studio/release/v2/install-linux.sh'
  );

  const sshRes = parseGitHubDeployTarget('git@github.com:ali-dev/aetherflow-studio.git');
  assert.equal(sshRes.valid, true);
  assert.equal(sshRes.cloneUrl, 'https://github.com/ali-dev/aetherflow-studio.git');

  const shortRes = parseGitHubDeployTarget('ali-dev/aetherflow-studio', 'develop');
  assert.equal(shortRes.valid, true);
  assert.equal(shortRes.branch, 'develop');
});

test('parseGitHubDeployTarget rejects non-GitHub URLs and malformed paths', () => {
  assert.equal(parseGitHubDeployTarget('https://gitlab.com/user/repo').valid, false);
  assert.equal(parseGitHubDeployTarget('only-one-part').valid, false);
  assert.equal(parseGitHubDeployTarget('').valid, false);
});

test('buildLinuxOneLineCommand builds curl | bash and git clone commands with mode, dir, and port flags', () => {
  const result = buildLinuxOneLineCommand({
    repoInput: 'https://github.com/ali-dev/aetherflow-studio',
    branch: 'prod',
    mode: 'systemd',
    installDir: '/opt/aetherflow',
    port: '8080',
  });

  assert.equal(result.valid, true);
  assert.equal(
    result.oneLineCurlCommand,
    'curl -fsSL https://raw.githubusercontent.com/ali-dev/aetherflow-studio/prod/install-linux.sh | bash -s -- --repo https://github.com/ali-dev/aetherflow-studio.git --branch prod --systemd --dir /opt/aetherflow --port 8080'
  );
  assert.equal(
    result.gitCloneCommand,
    'git clone -b prod https://github.com/ali-dev/aetherflow-studio.git /opt/aetherflow && cd /opt/aetherflow && chmod +x install-linux.sh && ./install-linux.sh --systemd --port 8080'
  );
});

test('buildLinuxOneLineCommand uses concise curl | bash without redundant --repo for official AetherFlow repo', () => {
  const autoCmd = buildLinuxOneLineCommand({
    repoInput: DEFAULT_GITHUB_REPO_URL,
    mode: 'auto',
  });
  assert.equal(autoCmd.valid, true);
  assert.equal(
    autoCmd.oneLineCurlCommand,
    'curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash'
  );

  const dockerCmd = buildLinuxOneLineCommand({
    repoInput: '0MuStAnG0/AetherFlow-Agent-Studio',
    mode: 'docker',
    port: '3000',
  });
  assert.equal(
    dockerCmd.oneLineCurlCommand,
    'curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --docker'
  );
});
