import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { ingestPodcastFeed, PODCAST_FEED_TIMEOUT_MS, PODCAST_FEED_MAX_BYTES } from '../../server/utils/podcastDownloader';
import { createTestDb } from '../helpers/testDb';

// A real HTTP server on 127.0.0.1 plays the feed (an admin-typed feed may be on the LAN).
let server: http.Server;
let base: string;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
const requests: http.IncomingMessage[] = [];

beforeEach(async () => {
  const db = createTestDb();
  (globalThis as any).getDb = () => db;
  requests.length = 0;
  server = http.createServer((req, res) => { requests.push(req); handler(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  vi.useRealTimers();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Local Show</title><item><title>Ep 1</title><guid>g1</guid><enclosure url="https://cdn.example/e1.mp3" type="audio/mpeg"/></item></channel></rss>';

describe('podcast feed fetch', () => {
  it('fetches and parses a feed, asking for XML', async () => {
    handler = (_req, res) => { res.setHeader('content-type', 'application/rss+xml'); res.end(RSS); };
    const res = await ingestPodcastFeed(`${base}/feed.xml`);
    expect(res).toMatchObject({ success: true, count: 1 });
    expect(String(requests[0]!.headers.accept)).toContain('application/rss+xml');
  });

  it('one 15 s deadline covers the whole body: a feed that trickles forever fails clearly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.write('<?xml version="1.0"?><rss>'); };
    const pending = ingestPodcastFeed(`${base}/slow.xml`);
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 3000 });
    await new Promise((r) => setImmediate(r));
    vi.advanceTimersByTime(PODCAST_FEED_TIMEOUT_MS);
    expect(PODCAST_FEED_TIMEOUT_MS).toBe(15_000);
    expect(await pending).toEqual({ success: false, message: 'The feed did not answer within 15 s. Check the address or try again later.', count: 0 });
  });

  it('refuses a feed over the byte cap without holding it all', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      const chunk = Buffer.alloc(1024 * 1024, 32);
      let sent = 0;
      const pump = () => { while (sent < 20 && res.write(chunk)) sent++; if (sent < 20) res.once('drain', pump); else res.end(); };
      pump();
    };
    const res = await ingestPodcastFeed(`${base}/huge.xml`);
    expect(res.success).toBe(false);
    expect(res.message).toContain(`larger than ${PODCAST_FEED_MAX_BYTES / (1024 * 1024)} MB`);
  });

  it('follows at most 5 redirects', async () => {
    handler = (req, res) => { res.writeHead(302, { location: `${req.url}x` }); res.end(); };
    const res = await ingestPodcastFeed(`${base}/r`);
    expect(res.success).toBe(false);
    expect(requests.length).toBe(6);
  });

  it('refuses non-http schemes and metadata addresses before any request', async () => {
    handler = (_req, res) => res.end(RSS);
    for (const url of ['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data/']) {
      const res = await ingestPodcastFeed(url);
      expect(res.success).toBe(false);
      expect(res.message).toContain('not allowed');
    }
    expect(requests).toHaveLength(0);
  });

  it('keeps the parse error message for other failures', async () => {
    handler = (_req, res) => res.end('this is not xml');
    const res = await ingestPodcastFeed(`${base}/bad.xml`);
    expect(res.message).toMatch(/^Failed to fetch\/parse RSS feed: /);
  });
});
