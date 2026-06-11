import Database from 'better-sqlite3';
import path from 'path';

try {
  const dbPath = path.resolve('data/myteub.db');
  const db = new Database(dbPath);
  
  db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`);
  console.log("Successfully added like_count column to database.");
} catch (e) {
  console.log("Error or already added:", e.message);
}
