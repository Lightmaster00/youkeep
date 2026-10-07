import path from 'path';

/**
 * The app's local data folder: `./data` in the working directory, unless the
 * YOUKEEP_DATA_DIR environment variable names another one (the test setup
 * points it at a temporary folder so test runs never touch the real data).
 * Read on every call, never cached, so it always reflects the environment.
 */
export function getDataDir(): string {
  const override = process.env.YOUKEEP_DATA_DIR?.trim();
  return override ? path.resolve(override) : path.resolve(process.cwd(), 'data');
}
