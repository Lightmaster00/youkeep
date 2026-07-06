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
- **Downloads**: `./data/downloads/` (stores all archived videos, audio, and thumbnails)

---

## Unraid and Permission Mapping (PUID & PGID)

To prevent file permission conflicts on self-hosted servers (like Unraid, Synology, or standard Linux machines), you can map the container's internal processes to use your host user's specific User ID (`PUID`) and Group ID (`PGID`). 

This ensures that all downloaded videos, audio, and database files in your `./data` directory are owned by your host user rather than the `root` user, making them easy to move, delete, or edit from the host.

### Configuring Permissions in docker-compose.yml:
```yaml
version: '3.8'

services:
  youkeep:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: youkeep
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # Map the data folder to your desired path (e.g. /mnt/user/appdata/youkeep on Unraid)
      - ./data:/app/data
    environment:
      - PUID=99     # Set to your host user's UID (Unraid's default app user 'nobody' is 99)
      - PGID=100    # Set to your host user's GID (Unraid's default app group 'users' is 100)
      - PORT=3000
      - HOST=0.0.0.0
      - NODE_ENV=production
```
