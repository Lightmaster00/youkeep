import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data/myteub.db');
const db = new Database(dbPath);

const channels = db.prepare("SELECT id, title, sync_status, download_videos, download_shorts FROM channels").all();
console.log("Channels:", channels);
