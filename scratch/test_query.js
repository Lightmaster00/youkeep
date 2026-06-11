import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data/myteub.db');
const db = new Database(dbPath);

const failed = db.prepare("SELECT id, title, is_short, download_status FROM videos WHERE download_status = 'failed' LIMIT 10").all();
console.log("Failed videos:", failed);

const counts = db.prepare("SELECT download_status, is_short, COUNT(*) as count FROM videos GROUP BY download_status, is_short").all();
console.log("Counts:", counts);
