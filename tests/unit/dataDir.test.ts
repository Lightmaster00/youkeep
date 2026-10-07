import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertInTmp } from '../helpers/testDb';

describe('test runs never touch the real ./data folder', () => {
  it('importing the downloaders creates no data/bin folder in the working directory', async () => {
    const realBin = path.resolve(process.cwd(), 'data', 'bin');
    const before = fs.existsSync(realBin) ? fs.statSync(realBin).mtimeMs : null;
    await import('../../server/utils/downloader');
    // The data folder the code uses in tests is a temporary one, and the
    // yt-dlp folder is only created when yt-dlp is actually needed.
    const { getDataDir } = await import('../../server/utils/dataDir');
    assertInTmp(getDataDir());
    expect(fs.existsSync(path.join(getDataDir(), 'bin'))).toBe(false);
    expect(fs.existsSync(realBin) ? fs.statSync(realBin).mtimeMs : null).toBe(before);
  });

  it('the music, podcast and video download folders fall back inside a temporary folder', async () => {
    const { getMusicDownloadsDir } = await import('../../server/utils/musicDownloader');
    const { getPodcastDownloadsDir } = await import('../../server/utils/podcastDownloader');
    const { getDataDir } = await import('../../server/utils/dataDir');
    for (const dir of [getMusicDownloadsDir(), getPodcastDownloadsDir()]) {
      assertInTmp(dir);
      expect(dir.startsWith(getDataDir())).toBe(true);
    }
  });
});
