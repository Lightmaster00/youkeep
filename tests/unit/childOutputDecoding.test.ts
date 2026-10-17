import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// yt-dlp's JSON arrives in 64 KB chunks: a multi-byte character split across
// two chunks must not turn into U+FFFD. Children here are fakes whose stdout
// is a real stream (so setEncoding works) fed a split character.
const TEXT = '{"title":"日本語タイトル"}';
const BYTES = Buffer.from(TEXT, 'utf8');
const CUT = BYTES.indexOf(Buffer.from('本', 'utf8')) + 1; // inside 本

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  setImmediate(() => {
    child.stdout.write(BYTES.subarray(0, CUT));
    setImmediate(() => {
      child.stdout.write(BYTES.subarray(CUT));
      child.stderr.write(BYTES.subarray(0, CUT));
      setImmediate(() => {
        child.stderr.write(BYTES.subarray(CUT));
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); });
      });
    });
  });
  return child;
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: () => fakeChild() };
});

const { runProcessAsync } = await import('../../server/utils/downloader');
const { runFfprobe } = await import('../../server/utils/videoDurations');
const { decodeChildOutput } = await import('../../server/utils/processTree');

afterEach(() => { vi.restoreAllMocks(); });

describe('child output decoding (M2)', () => {
  it('runProcessAsync keeps a character split across two chunks', async () => {
    const r = await runProcessAsync('yt-dlp', ['--dump-single-json', 'x'], {}, undefined, 5000);
    expect(r.stdout).toBe(TEXT);
    expect(r.stderr).toBe(TEXT);
  });

  it('decodeChildOutput sets UTF-8 decoding on both streams and tolerates fakes without streams', () => {
    const child: any = { stdout: new PassThrough(), stderr: new PassThrough() };
    decodeChildOutput(child);
    expect(child.stdout.readableEncoding).toBe('utf8');
    expect(child.stderr.readableEncoding).toBe('utf8');
    expect(() => decodeChildOutput({ stdout: new EventEmitter() } as any)).not.toThrow();
    expect(() => decodeChildOutput({} as any)).not.toThrow();
  });

  it('every child process output reader in server/utils decodes as UTF-8 first', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(__dirname, '../../server/utils');
    const missing: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const readers = (src.match(/\b(?:child|proc)\.std(?:out|err)\??\.on\('data'/g) ?? []).length;
      const decoded = (src.match(/decodeChildOutput\(/g) ?? []).length;
      if (readers > 0 && decoded === 0) missing.push(f);
    }
    expect(missing).toEqual([]);
  });

  it('runFfprobe parses output fed in split chunks', async () => {
    const spawnFn: any = () => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough();
      child.kill = () => true;
      setImmediate(() => {
        child.stdout.write(Buffer.from('12.'));
        child.stdout.write(Buffer.from('5\n'));
        child.stdout.end();
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    };
    expect(await runFfprobe('/x.mp4', { spawnFn })).toBe(12.5);
  });
});
