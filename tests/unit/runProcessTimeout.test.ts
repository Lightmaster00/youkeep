import { describe, it, expect } from 'vitest';
import { runProcessAsync } from '../../server/utils/downloader';

describe('runProcessAsync time limit', () => {
  it('kills a process that runs past the limit and fails with a clear message', async () => {
    const started = Date.now();
    await expect(runProcessAsync('/bin/sleep', ['5'], process.env, undefined, 150)).rejects.toThrow(/Timed out after/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('resolves normally when the process ends in time', async () => {
    await expect(runProcessAsync('/bin/echo', ['hi'], process.env, undefined, 5000)).resolves.toMatchObject({ status: 0, stdout: 'hi\n' });
  });
});
