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
| `PUID` / `PGID` | `99` / `100` | Owner of `/app/data` and of every file the app writes. `0` (root) is refused unless `ALLOW_ROOT=true` |
| `ALLOW_ROOT` | empty | Set to `true` to run as root anyway (not recommended: yt-dlp and ffmpeg parse untrusted media) |
| `TZ` | `UTC` | Timezone, e.g. `Europe/Paris`; download schedules (cron) run in it |
| `UMASK` | `022` | Permissions of created files (`000` = world-writable). An invalid value (not 3-4 octal digits) is ignored with a warning |
| `COOKIE_SECURE` | auto | Force `Secure` cookies on (`true`) or off (`false`) |
| `TRUST_PROXY` | empty | Number of reverse proxies in front of YouKeep (`true` = `1`). Empty: `X-Forwarded-*` headers are ignored. See below |
| `PORT` | `3000` | Port inside the container (usually just change the host port instead) |

### HTTPS / reverse proxy

Behind a reverse proxy (Nginx Proxy Manager, Traefik, Caddy, Cloudflare Tunnel...) set `TRUST_PROXY=1` (or the number of proxies chained in front of YouKeep). Without it, every visitor arrives from the proxy's address: the login rate limit then counts everyone as one client (a few wrong passwords lock everybody out for 15 minutes) and `X-Forwarded-Proto` is ignored. With `TRUST_PROXY=N` the client address is the Nth entry from the right of `X-Forwarded-For` (the entries to its left are sent by the client and can be forged). Never set it when YouKeep is reachable directly, without the proxy: anyone could then pick their own address.

Session cookies are marked `Secure` only when the request arrives over HTTPS (directly, or through a trusted proxy (`TRUST_PROXY`) that sends `X-Forwarded-Proto: https`). Plain `http://<lan-ip>:3000` works too. Set `COOKIE_SECURE=true` or `false` to force the behaviour.

When the proxy runs on the same host, publish the port on loopback only (`"127.0.0.1:3000:3000"` in `docker-compose.yml`): Docker's published ports bypass host firewalls such as ufw, so `"3000:3000"` also exposes the app directly, around the proxy.

### Backups

Everything that is not media lives in the app data folder (`/app/data`, e.g. `./data` or `/mnt/user/appdata/youkeep`): the SQLite database (`youkeep.db`, plus its `-wal`/`-shm` files while running), users, settings, history and the yt-dlp binary. Back it up regularly. For a consistent copy, stop the container first (it checkpoints and closes the database on shutdown), or copy with `sqlite3 youkeep.db ".backup backup.db"` while it runs. Media folders can be re-downloaded but are usually worth backing up too.

### API tokens

Tokens created in Account give scripts and other clients access with the rights of their owner (an admin's token can manage channels, downloads and settings). Send one as `Authorization: Bearer yk_...`. The secret is shown once, at creation; only its hash is stored.

- **Scope.** *Read-only* (the default) tokens may only make `GET`/`HEAD` requests; any other method gets `403 This API token is read-only.`, admin routes included. *Full access* tokens can also change things. Tokens created before scopes existed keep full access.
- **Expiry.** 30 days, 90 days (the default), 1 year or never. Expired tokens are refused at once and deleted by the hourly cleanup. Tokens created before expiry existed never expire.
- The token list in Account shows each token's scope, expiry and when it was last used (updated at most once a minute).

Create one token per client and revoke it when unused. A token can never manage accounts or credentials (create tokens, change passwords, manage users, search-platform keys), nor wipe the library, tidy it or change the downloads folder: those need a browser session.

---

### Exposure

YouKeep is a personal archive meant to run on your LAN or behind your own authentication layer (VPN, reverse proxy with SSO / basic auth, Cloudflare Access...). It has its own accounts, but guests can open public channels, videos and share links, and the app is not hardened or rate-limited for direct exposure to the whole internet. If you publish it, put it behind HTTPS and an access-controlled proxy. See [docs/SECURITY.md](docs/SECURITY.md) for the threat model, known limitations and a hardening checklist. Pages are marked `noindex` and `robots.txt` disallows all crawling.

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
