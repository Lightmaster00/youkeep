const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/myteub.db');
const db = new Database(dbPath);

const users = db.prepare('SELECT id, username, role, must_change_password FROM users').all();
console.log('Current Users:', users);

// Reset admin password to 'admin123'
const admin = users.find(u => u.role === 'admin');
if (admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, admin.id);
  console.log(`Reset password for admin user "${admin.username}" to "admin123"`);
} else {
  console.log('No admin user found to reset!');
}
