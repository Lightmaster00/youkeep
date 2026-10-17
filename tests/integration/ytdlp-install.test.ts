import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getYtdlPath, ytdlInstallDeps, YTDL_SUMS_URL } from '../../server/utils/downloader';
import { getDataDir } from '../../server/utils/dataDir';
import { assertInTmp } from '../helpers/testDb';

// The yt-dlp binary is installed from the latest GitHub release: never with
// the network here, the fetchers are injected.
const binDir = path.join(getDataDir(), 'bin');
const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(binDir, binName);
const realDeps = { ...ytdlInstallDeps };
const BINARY = Buffer.from('#!/bin/sh\necho fake yt-dlp\n');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const sums = (hash: string) => `${'0'.repeat(64)}  yt-dlp_linux\n${hash}  ${binName}\n${'1'.repeat(64)}  yt-dlp_macos\n`;

beforeEach(() => {
  assertInTmp(binDir);
  fs.rmSync(binDir, { recursive: true, force: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(ytdlInstallDeps, realDeps);
  fs.rmSync(binDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function inject(opts: { hash?: string; delayMs?: number } = {}) {
  const fetchFile = vi.fn(async (_url: string, dest: string) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    fs.writeFileSync(dest, BINARY);
  });
  const fetchText = vi.fn(async (url: string) => {
    expect(url).toBe(YTDL_SUMS_URL);
    return sums(opts.hash ?? sha(BINARY));
  });
  Object.assign(ytdlInstallDeps, { fetchFile, fetchText });
  return { fetchFile, fetchText };
}

describe('yt-dlp install (L2)', () => {
  it('verifies the release SHA2-256SUMS, then installs an executable binary', async () => {
    const { fetchFile, fetchText } = inject();
    expect(await getYtdlPath()).toBe(binPath);
    expect(fs.readFileSync(binPath)).toEqual(BINARY);
    if (process.platform !== 'win32') expect(fs.statSync(binPath).mode & 0o111).not.toBe(0);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(binDir)).toEqual([binName]);
  });

  it('refuses a binary whose checksum does not match and leaves nothing behind', async () => {
    inject({ hash: 'f'.repeat(64) });
    await expect(getYtdlPath()).rejects.toThrow(/checksum/i);
    expect(fs.existsSync(binPath)).toBe(false);
    expect(fs.readdirSync(binDir)).toEqual([]);
  });

  it('refuses when the sums file has no entry for the binary', async () => {
    inject();
    ytdlInstallDeps.fetchText = vi.fn(async () => `${'0'.repeat(64)}  something-else\n`);
    await expect(getYtdlPath()).rejects.toThrow(/checksum/i);
    expect(fs.existsSync(binPath)).toBe(false);
  });

  it('concurrent first callers share one download (single flight)', async () => {
    const { fetchFile } = inject({ delayMs: 30 });
    const results = await Promise.all([getYtdlPath(), getYtdlPath(), getYtdlPath()]);
    expect(results).toEqual([binPath, binPath, binPath]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(binPath)).toEqual(BINARY);
  });

  it('an installed binary is used as is', async () => {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(binPath, 'already here');
    const { fetchFile } = inject();
    expect(await getYtdlPath()).toBe(binPath);
    expect(fetchFile).not.toHaveBeenCalled();
  });
});
