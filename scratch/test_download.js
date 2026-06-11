import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('data/myteub.db');
const db = new Database(dbPath);

const video = db.prepare("SELECT id, title, channel_id FROM videos WHERE is_short = 1 LIMIT 1").get();
if (!video) {
  console.log("No short found.");
  process.exit(0);
}

console.log("Found short to download:", video);

const binDir = path.resolve('data/bin');
const filename = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const ytdlPath = path.join(binDir, filename);

const channel = db.prepare('SELECT title FROM channels WHERE id = ?').get(video.channel_id);
const channelTitle = channel ? channel.title : video.channel_id;

const channelDir = path.resolve('data/downloads', channelTitle.replace(/[\\/:*?"<>|]/g, '_').trim());
if (!fs.existsSync(channelDir)) {
  fs.mkdirSync(channelDir, { recursive: true });
}
const outputTemplate = path.join(channelDir, `${video.id}.%(ext)s`);

const args = [
  '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  '-o', outputTemplate,
  '--write-thumbnail',
  '--no-playlist',
  '--write-info-json',
  '--get-comments',
  '--extractor-args', 'youtube:max-comments=50',
  `https://www.youtube.com/shorts/${video.id}`
];

const env = { ...process.env };
env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

console.log("Running ytdlp command:", ytdlPath, args.join(' '));
const res = spawnSync(ytdlPath, args, { env });
console.log("Status code:", res.status);
console.log("Stdout:", res.stdout?.toString());
console.log("Stderr:", res.stderr?.toString());
