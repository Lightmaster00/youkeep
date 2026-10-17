import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Container and CI hygiene (ops M3, M4, L5): static checks of the files, and
// the entrypoint run in dry-run mode against a temporary data folder.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('Dockerfile and compose', () => {
  it('runs node under tini (orphaned yt-dlp/ffmpeg children are reaped)', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/apk add --no-cache[^\n]*\btini\b/);
    expect(dockerfile).toMatch(/ENTRYPOINT \["\/sbin\/tini", "--", "\/bin\/sh", "\.\/entrypoint\.sh"\]/);
  });

  it('compose enables init, no-new-privileges and documents a loopback bind', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toMatch(/^\s+init: true$/m);
    expect(compose).toMatch(/security_opt:\s*\n\s+- no-new-privileges:true/);
    expect(compose).toContain('127.0.0.1:3000:3000');
  });

  it('the build context leaves secrets, tests, docs and notes out', () => {
    const ignore = read('.dockerignore').split('\n').map((l) => l.trim());
    for (const entry of ['.env', '.claude', 'tests', 'docs', 'scratch*', '*.md', '!README.md']) expect(ignore).toContain(entry);
    expect(read('.gitignore').split('\n').map((l) => l.trim())).toContain('.claude/');
  });
});

describe('CI workflow', () => {
  const wf = () => read('.github/workflows/docker.yml');
  it('tests before publishing', () => {
    expect(wf()).toMatch(/\n  test:\n/);
    expect(wf()).toMatch(/node-version: ['"]?24/);
    expect(wf()).toContain('npm ci');
    expect(wf()).toContain('npx vitest run');
    expect(wf()).toMatch(/\n  publish:\n(?:.*\n)*?\s+needs: test/);
  });
  it('keeps latest and sha tags, adds semver tags on v* tags, and recommends SHA pinning', () => {
    expect(wf()).toMatch(/tags: \[ ?['"]?v\*/);
    expect(wf()).toContain('type=semver,pattern={{version}}');
    expect(wf()).toContain('type=sha');
    expect(wf()).toMatch(/latest/);
    expect(wf()).toMatch(/#.*pin.*SHA/i);
  });
});

describe('entrypoint.sh (dry run)', () => {
  let dataDir: string;
  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-entry-'));
  });
  afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const run = (env: Record<string, string>) => spawnSync('/bin/sh', [path.join(ROOT, 'entrypoint.sh')], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', YOUKEEP_ENTRYPOINT_DRY_RUN: '1', YOUKEEP_APP_DATA: dataDir, ...env },
    encoding: 'utf8',
  });
  const owner = () => spawnSync('/bin/sh', ['-c', `ls -nd "${dataDir}" | awk '{print $3":"$4}'`], { encoding: 'utf8' }).stdout.trim();

  it('refuses to run as root unless ALLOW_ROOT=true', () => {
    const r = run({ PUID: '0', PGID: '0' });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/ALLOW_ROOT/);
    const allowed = run({ PUID: '0', PGID: '0', ALLOW_ROOT: 'true' });
    expect(allowed.status).toBe(0);
    expect(run({ PUID: '1000', PGID: '0' }).status).not.toBe(0);
  });

  it('warns about an invalid UMASK and falls back to 022', () => {
    const bad = run({ PUID: '1000', PGID: '1000', UMASK: '0x7' });
    expect(bad.status).toBe(0);
    expect(bad.stderr + bad.stdout).toMatch(/UMASK/);
    expect(bad.stdout).toMatch(/umask 022/);
    expect(run({ PUID: '1000', PGID: '1000', UMASK: '0027' }).stdout).toMatch(/umask 0027/);
  });

  it('chowns (without following symlinks) only when the data folder owner differs', () => {
    const [uid, gid] = owner().split(':');
    const same = run({ PUID: uid!, PGID: gid! });
    expect(same.status).toBe(0);
    expect(same.stdout).not.toMatch(/chown -R/);
    const other = run({ PUID: String(Number(uid) + 1), PGID: gid! });
    expect(other.stdout).toMatch(/chown -R -h \d+:\d+ /);
  });
});
