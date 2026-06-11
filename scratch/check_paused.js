import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data/myteub.db');
const db = new Database(dbPath);

const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get();
console.log("downloader_paused setting:", pausedSetting);
