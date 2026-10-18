import fs from 'fs';
import os from 'os';
import path from 'path';

// One temporary root per test run. Every temporary folder a test creates
// (os.tmpdir() based: yk-test-data-*, yk-test-downloads-*, per-test dirs)
// lands inside it, because TMPDIR is pointed at it before the workers start
// and they inherit it. It is removed when the run ends, so a run leaves
// nothing behind in the system temporary folder, even when a worker exits
// without running its own cleanup.
let root: string | null = null;

export function setup(): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-run-'));
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
}

export function teardown(): void {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
}
