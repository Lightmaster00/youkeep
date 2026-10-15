# YouKeep - Self-Hosted YouTube Downloader & Archiver

YouKeep is a sleek, self-hosted YouTube downloader and archiver built with Nuxt 3, Vue 3, SQLite, and `yt-dlp`. It allows you to subscribe to channels, download videos, playlists, shorts, and lives, and watch them locally in a high-fidelity YouTube-like web interface.

---

## Key Features

- **Automated Ingestion & Download**: Fetches metadata and automatically queues downloads for channels, playlists, shorts, or lives.
- **Dedicated Shorts Interface**: Scrollable reels viewer styled as a smartphone frame.
- **FTS5 Virtual Table Search**: Highly performant search indexing of video titles, descriptions, and channel names.
- **Robust Authentication**: Multi-user support with custom password modification.
- **Custom Saved Paths**: Map downloaded channels directly to organized directories on disk.

## Docker Deployment (Recommended)

YouKeep is fully dockerized. You do **not** need to install Node.js, `npm`, or compile anything locally on your host machine. Simply running Docker Compose builds and starts the application out-of-the-box.

### Setup and Start

1. Run the container:
   ```bash
   docker-compose up -d --build
   ```

2. Open your browser and navigate to `http://localhost:3000` to configure your administrator account.

---

## Directory & Volume Mapping

All persistent data is stored in the `/app/data` folder inside the container. In your `docker-compose.yml`, this is mapped to a local `./data` folder:

- **Database**: `./data/youkeep.db` (stores users, subscriptions, settings, history, and playlists)
- **Media**: `/downloads/videos`, `/downloads/music`, `/downloads/podcasts` (mount a host folder for each; falls back to `./data/downloads/` if not mounted)

---

## Unraid

**Option 1 - template (recommended).** A ready-made Community Applications template is in [`unraid/youkeep.xml`](unraid/youkeep.xml). On the Unraid terminal:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-youkeep.xml \
  https://raw.githubusercontent.com/Lightmaster00/youkeep/main/unraid/youkeep.xml
```

Then Docker tab -> **Add Container** -> pick **YouKeep** in the *Template* dropdown, adjust the paths and click **Apply**.

**Option 2 - manual.** In the Docker tab, **Add Container**:
   - Repository: `ghcr.io/lightmaster00/youkeep:latest` (the package must be public, or build locally with `docker build -t youkeep .` and use `youkeep`)
   - Port `3000` -> `3000`
   - Path `/app/data` -> `/mnt/user/appdata/youkeep` (database and settings)
   - Path `/downloads/videos` -> e.g. `/mnt/user/media/youkeep/videos`
   - Path `/downloads/music` -> e.g. `/mnt/user/media/youkeep/music`
   - Path `/downloads/podcasts` -> e.g. `/mnt/user/media/youkeep/podcasts`
   - Variables `PUID=99` and `PGID=100`
2. Open `http://<unraid-ip>:3000` and create the admin account.

`PUID`/`PGID` set the owner of `/app/data` and of every file the app writes. Make sure each media folder is writable by that uid:gid (Unraid shares are `nobody:users`, i.e. 99:100, by default). The entrypoint only changes ownership of `/app/data`, never of your media folders. A channel with a custom save path set in Settings needs its own extra mount for that path.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | `99` / `100` | Owner of `/app/data` and of every file the app writes |
| `TZ` | `UTC` | Timezone, e.g. `Europe/Paris`; download schedules (cron) run in it |
| `UMASK` | `022` | Permissions of created files (`000` = world-writable) |
| `COOKIE_SECURE` | auto | Force `Secure` cookies on (`true`) or off (`false`) |
| `TRUST_PROXY` | empty | Number of reverse proxies in front of YouKeep (`true` = `1`). Empty: `X-Forwarded-*` headers are ignored |
| `PORT` | `3000` | Port inside the container (usually just change the host port instead) |

### HTTPS / reverse proxy

Behind a reverse proxy (Nginx Proxy Manager, Traefik, Caddy, Cloudflare Tunnel...) set `TRUST_PROXY=1` (or the number of proxies chained in front of YouKeep). Without it, every visitor arrives from the proxy's address: the login rate limit then counts everyone as one client (a few wrong passwords lock everybody out for 15 minutes) and `X-Forwarded-Proto` is ignored. With `TRUST_PROXY=N` the client address is the Nth entry from the right of `X-Forwarded-For` (the entries to its left are sent by the client and can be forged). Never set it when YouKeep is reachable directly, without the proxy: anyone could then pick their own address.

Session cookies are marked `Secure` only when the request arrives over HTTPS (directly, or through a trusted proxy (`TRUST_PROXY`) that sends `X-Forwarded-Proto: https`). Plain `http://<lan-ip>:3000` works too. Set `COOKIE_SECURE=true` or `false` to force the behaviour.

---

## Development & Testing

Run the full test suite with:
```bash
npm run test
```

Tests are split into two Vitest projects, configured in `vitest.config.ts`:

- **`server`** (`tests/unit/**`, `tests/integration/**`) — Node-environment tests for `server/` code (API routes, DB utilities, download pipelines).
- **`component`** (`tests/component/**`) — Nuxt-environment tests for Vue components and composables, using [`@nuxt/test-utils`](https://nuxt.com/docs/getting-started/testing) (`mountSuspended()` for components) so Nuxt's auto-imports (`useFetch`, `useState`, `useToast`, etc.) resolve the same way they do in the app.

To iterate on just one project while working:
```bash
npx vitest run --project component
npx vitest run --project server
```

Writing a new component test: start from `tests/component/EmptyState.test.ts` for a simple presentational component, `tests/component/useMusicPlayer.test.ts` for a composable built on `useState`, or `tests/component/BaseModal.test.ts` for interaction/emit/lifecycle behavior. Each file's header comment explains the non-obvious mechanics it depends on (e.g. `useState`'s cross-test singleton behavior, watchers without `immediate: true`) — read it before copying the pattern to a component with different behavior.
