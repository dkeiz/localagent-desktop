const Database = require('better-sqlite3');
const path = require('path');

const fs = require('fs');

// Get database path
const userDataPath = process.env.APPDATA || (process.platform === 'darwin' ? 
    process.env.HOME + '/Library/Application Support' : process.env.HOME);
const dbDir = path.join(userDataPath, 'localagent');
const dbPath = path.join(dbDir, 'localagent.db');

// Create directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('Created database directory:', dbDir);
}

// Initialize database and create tables if needed
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

try {
  // Create settings table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Token data
  const tokenData = {
    access_token: "aUobK37kCKKTx1E69n8MKZxvJfm4LkKIhF23TX89ZGtuzzqMOdVOAhMpBPt2VK5nGZOFso7NWGslTVLotuM2NQ",
    token_type: "Bearer",
    refresh_token: "-a_8GolmiYV1ReeLMeIByG4TG39FRJS2ckM9Vu8bUChM6hAVodaARZ01Mtv4MMOI2EpvKUTaALRmgdPqxOeXtg",
    resource_url: "portal.qwen.ai",
    expiry_date: 1762590966352
  };

  // Insert into settings
  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run('llm.qwen.oauthCreds', JSON.stringify(tokenData));

  console.log('Qwen OAuth token successfully added to database!');
} catch (error) {
  console.error('Error inserting token:', error);
} finally {
  db.close();
}
